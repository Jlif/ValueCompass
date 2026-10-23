import { AwsClient } from 'aws4fetch';
import type { NotesSyncConfig, S3Provider } from '../types';
import { request } from './http.ts';

// S3 兼容对象存储：阿里云 OSS / 腾讯云 COS / 自定义。
// 统一用 AWS SigV4；阿里云/腾讯云请使用它们的 S3 兼容 endpoint。
// 注意：这里只支持 S3 兼容签名，不支持 OSS/COS 原生签名。

export const NOTES_OBJECT_KEY = 'valuecompass/notes.json';

export interface S3ProviderPreset {
  label: string;
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  conditionalWrites: boolean;
}

export const S3_PROVIDER_PRESETS: Record<S3Provider, S3ProviderPreset> = {
  aliyun: {
    label: '阿里云 OSS',
    endpoint: 'https://s3.oss-cn-hangzhou.aliyuncs.com',
    region: 'oss-cn-hangzhou',
    forcePathStyle: true,
    conditionalWrites: false,
  },
  tencent: {
    label: '腾讯云 COS',
    endpoint: 'https://cos.ap-guangzhou.myqcloud.com',
    region: 'ap-guangzhou',
    forcePathStyle: true,
    conditionalWrites: false,
  },
  custom: {
    label: '自定义 S3',
    endpoint: '',
    region: 'us-east-1',
    forcePathStyle: true,
    conditionalWrites: true,
  },
};

export interface S3Object {
  text: string;
  etag: string | null;
}

export interface S3ObjectResult {
  status: number;
  text: string;
  etag: string | null;
}

export class S3ConflictError extends Error {
  constructor(message = '远端笔记已被其他设备更新') {
    super(message);
    this.name = 'S3ConflictError';
  }
}

export class S3HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'S3HttpError';
    this.status = status;
  }
}

export function validateNotesSyncConfig(config: NotesSyncConfig): string | null {
  if (!config.endpoint.trim()) return '请填写 Endpoint';
  try {
    const url = new URL(config.endpoint);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Endpoint 必须是 http(s) 地址';
    const host = url.hostname.toLowerCase();
    const allowed =
      host.endsWith('.aliyuncs.com') ||
      host.endsWith('.myqcloud.com') ||
      host === 'localhost' ||
      host === '127.0.0.1';
    if (!allowed) return '当前只支持阿里云 OSS / 腾讯云 COS 的 S3 兼容 Endpoint';
  } catch {
    return 'Endpoint 不是有效 URL';
  }
  if (!config.region.trim()) return '请填写 Region';
  if (!config.bucket.trim()) return '请填写 Bucket';
  if (!config.key.trim()) return '请填写对象 Key';
  if (!config.accessKeyId.trim()) return '请填写 AccessKey ID';
  if (!config.secretAccessKey.trim()) return '请填写 AccessKey Secret';
  return null;
}

export function normalizeNotesSyncConfig(value: unknown): NotesSyncConfig | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const provider: S3Provider =
    raw.provider === 'aliyun' || raw.provider === 'tencent' ? raw.provider : 'custom';
  const config: NotesSyncConfig = {
    provider,
    endpoint: typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '',
    region: typeof raw.region === 'string' ? raw.region.trim() : '',
    bucket: typeof raw.bucket === 'string' ? raw.bucket.trim() : '',
    key: typeof raw.key === 'string' ? raw.key.trim() : NOTES_OBJECT_KEY,
    accessKeyId: typeof raw.accessKeyId === 'string' ? raw.accessKeyId.trim() : '',
    secretAccessKey: typeof raw.secretAccessKey === 'string' ? raw.secretAccessKey : '',
    forcePathStyle: raw.forcePathStyle === true,
    conditionalWrites: raw.conditionalWrites !== false,
  };
  return validateNotesSyncConfig(config) ? null : config;
}

export function buildObjectUrl(config: NotesSyncConfig, key = config.key): URL {
  const endpoint = new URL(config.endpoint);
  const basePath = endpoint.pathname.replace(/\/+$/, '');
  const cleanKey = key.replace(/^\/+/, '');
  const encodedKey = cleanKey.split('/').map(encodeURIComponent).join('/');
  const bucket = encodeURIComponent(config.bucket.trim());

  if (config.forcePathStyle) {
    endpoint.pathname = `${basePath}/${bucket}/${encodedKey}`;
  } else {
    endpoint.hostname = `${config.bucket.trim()}.${endpoint.hostname}`;
    endpoint.pathname = `${basePath}/${encodedKey}`;
  }
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint;
}

async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface SignedS3Request {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export async function signS3Request(
  config: NotesSyncConfig,
  method: 'GET' | 'PUT',
  body?: string,
  extraHeaders: Record<string, string> = {}
): Promise<SignedS3Request> {
  const url = buildObjectUrl(config);
  const payload = method === 'PUT' ? body || '' : '';
  const headers: Record<string, string> = {
    'x-amz-content-sha256': await sha256Hex(payload),
    ...extraHeaders,
  };
  if (method === 'PUT') headers['content-type'] = 'application/json; charset=utf-8';

  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region,
  });
  const signed = await client.sign(url, {
    method,
    headers,
    body: method === 'PUT' ? payload : undefined,
  });

  return {
    url: signed.url,
    headers: Object.fromEntries(signed.headers.entries()),
    body: method === 'PUT' ? payload : undefined,
  };
}

function errorForStatus(status: number, body: string): Error {
  if (status === 403) {
    return new S3HttpError(status, 'S3 拒绝访问：检查 AK/SK、Bucket、Region 和账号权限');
  }
  if (status === 404 && /NoSuchBucket/i.test(body)) {
    return new S3HttpError(status, 'Bucket 不存在：检查 Bucket 名称和 Region 是否正确');
  }
  if (status === 301 || status === 400) {
    return new S3HttpError(status, 'S3 端点或 Region 不匹配：检查 Endpoint 和 Region 是否对应 Bucket');
  }
  const detail = body.trim().slice(0, 240);
  return new S3HttpError(status, `S3 ${status}${detail ? `: ${detail}` : ''}`);
}

async function send(
  config: NotesSyncConfig,
  method: 'GET' | 'PUT',
  body?: string,
  etag?: string | null
): Promise<S3ObjectResult> {
  const execute = async (conditional: boolean) => {
    const extraHeaders: Record<string, string> = {};
    if (method === 'PUT' && conditional) {
      if (etag) extraHeaders['if-match'] = etag;
      else extraHeaders['if-none-match'] = '*';
    }
    const signed = await signS3Request(config, method, body, extraHeaders);
    return request(signed.url, {
      method,
      headers: signed.headers,
      body: signed.body,
    });
  };

  let response = await execute(method === 'PUT' && config.conditionalWrites);
  // 部分 S3 兼容服务不支持 PUT 条件头，退化为普通覆盖写；同步前仍会先读并合并。
  if (method === 'PUT' && config.conditionalWrites && (response.status === 400 || response.status === 501)) {
    response = await execute(false);
  }

  if (method === 'PUT' && (response.status === 409 || response.status === 412)) {
    throw new S3ConflictError();
  }
  if (!response.ok) {
    if (method === 'GET' && response.status === 404) {
      return { status: 404, text: response.text, etag: null };
    }
    throw errorForStatus(response.status, response.text);
  }
  return {
    status: response.status,
    text: response.text,
    etag: response.headers.get('etag'),
  };
}

export async function getNotesObject(config: NotesSyncConfig): Promise<S3Object | null> {
  const result = await send(config, 'GET');
  if (result.status === 404) {
    // 对象不存在是正常空状态；Bucket 不存在/权限异常必须报错，否则测试连接会误判成功。
    if (/NoSuchBucket/i.test(result.text)) throw errorForStatus(404, result.text);
    if (result.text.trim() && !/NoSuchKey/i.test(result.text)) throw errorForStatus(404, result.text);
    return null;
  }
  return { text: result.text, etag: result.etag };
}

export async function putNotesObject(
  config: NotesSyncConfig,
  text: string,
  etag?: string | null
): Promise<void> {
  await send(config, 'PUT', text, etag);
}

export async function testNotesConnection(config: NotesSyncConfig): Promise<string> {
  const error = validateNotesSyncConfig(config);
  if (error) throw new Error(error);
  const object = await getNotesObject(config);
  return object ? '连接成功，远端已有笔记文件' : '连接成功，远端还没有笔记文件';
}
