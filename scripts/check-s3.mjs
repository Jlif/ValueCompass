// 验证 S3 URL 构造、配置校验与 SigV4 签名头（不访问网络）
// 跑法: npm run check:s3
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  buildObjectUrl,
  getNotesObject,
  normalizeNotesSyncConfig,
  parseS3Endpoint,
  putNotesObject,
  signS3Request,
  S3ConflictError,
  S3_PROVIDER_PRESETS,
  validateNotesSyncConfig,
} = await import(join(root, 'src', 'services', 's3.ts'));

const assert = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`);
  if (!ok) process.exitCode = 1;
};

const base = {
  provider: 'custom',
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'my-bucket',
  key: 'valuecompass/notes.json',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  forcePathStyle: true,
  conditionalWrites: true,
};

assert(buildObjectUrl(base).toString() === 'https://s3.example.com/my-bucket/valuecompass/notes.json', 'Path-style URL 正确');
assert(
  buildObjectUrl({ ...base, forcePathStyle: false }).toString() ===
    'https://my-bucket.s3.example.com/valuecompass/notes.json',
  'Virtual-hosted URL 正确'
);
assert(
  buildObjectUrl({
    ...base,
    endpoint: 'https://common-1252800375.cos.ap-shanghai.myqcloud.com',
    bucket: 'common-1252800375',
    forcePathStyle: false,
  }).toString() ===
    'https://common-1252800375.cos.ap-shanghai.myqcloud.com/valuecompass/notes.json',
  'Endpoint 已含 Bucket 时不会重复拼接'
);
assert(
  buildObjectUrl({ ...base, endpoint: 'https://example.com/s3' }).toString() ===
    'https://example.com/s3/my-bucket/valuecompass/notes.json',
  'Endpoint 路径前缀保留'
);
const encoded = buildObjectUrl({ ...base, key: 'valuecompass/我的 笔记.json' }).toString();
assert(encoded.includes('valuecompass/%E6%88%91%E7%9A%84%20%E7%AC%94%E8%AE%B0.json'), '对象 Key 按路径段编码');
assert(buildObjectUrl({ ...base, key: '/valuecompass/notes.json' }).toString().endsWith('valuecompass/notes.json'), 'Key 前导斜杠被清理');

const allowedBase = { ...base, endpoint: 'https://s3.oss-cn-hangzhou.aliyuncs.com' };
assert(validateNotesSyncConfig(allowedBase) === null, '完整配置通过校验');
assert(validateNotesSyncConfig({ ...allowedBase, bucket: '' })?.includes('Bucket'), '缺少 Bucket 时拒绝');
assert(validateNotesSyncConfig({ ...allowedBase, endpoint: 'https://example.com' })?.includes('只支持'), '拒绝非阿里云/腾讯云 Endpoint');
assert(normalizeNotesSyncConfig({ ...allowedBase, provider: 'aliyun' })?.provider === 'aliyun', '配置归一化保留服务商');
assert(Boolean(S3_PROVIDER_PRESETS.aliyun.endpoint.includes('aliyuncs.com')), '阿里云预设存在');
assert(Boolean(S3_PROVIDER_PRESETS.tencent.endpoint.includes('myqcloud.com')), '腾讯云预设存在');

assert(
  JSON.stringify(parseS3Endpoint('https://common-1252800375.cos.ap-shanghai.myqcloud.com')) ===
    JSON.stringify({
      provider: 'tencent',
      bucket: 'common-1252800375',
      region: 'ap-shanghai',
      forcePathStyle: false,
    }),
  '腾讯云虚拟主机 Endpoint 自动识别 Region 与 Bucket'
);
assert(
  JSON.stringify(parseS3Endpoint('https://cos.ap-guangzhou.myqcloud.com')) ===
    JSON.stringify({ provider: 'tencent', region: 'ap-guangzhou', forcePathStyle: true }),
  '腾讯云 Path-style Endpoint 自动识别 Region'
);
assert(
  JSON.stringify(parseS3Endpoint('https://s3.oss-cn-hangzhou.aliyuncs.com')) ===
    JSON.stringify({ provider: 'aliyun', region: 'oss-cn-hangzhou', forcePathStyle: true }),
  '阿里云 S3 Endpoint 自动识别 Region'
);
assert(
  JSON.stringify(parseS3Endpoint('https://my-bucket.oss-cn-hangzhou.aliyuncs.com')) ===
    JSON.stringify({
      provider: 'aliyun',
      bucket: 'my-bucket',
      region: 'oss-cn-hangzhou',
      forcePathStyle: false,
    }),
  '阿里云虚拟主机 Endpoint 自动识别 Region 与 Bucket'
);
assert(
  Object.keys(parseS3Endpoint('https://example.com')).length === 0,
  '未知 Endpoint 不会误填 Region 与 Bucket'
);

const signed = await signS3Request(base, 'PUT', '{"schemaVersion":1}', { 'if-match': '"abc"' });
assert(signed.headers.authorization.startsWith('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/'), '签名头使用 SigV4 与 AccessKey');
assert(signed.headers.authorization.includes('if-match'), '条件头参与签名');
assert(/^[0-9a-f]{64}$/.test(signed.headers['x-amz-content-sha256']), '请求带 SHA256 payload hash');
assert(/^\d{8}T\d{6}Z$/.test(signed.headers['x-amz-date']), '请求带 x-amz-date');
assert(signed.url.includes('/my-bucket/valuecompass/notes.json'), '签名 URL 指向目标对象');

// 请求层状态处理（桩化 fetch）
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{"code":"NoSuchKey"}', { status: 404 });
assert((await getNotesObject(base)) === null, 'GET 404 NoSuchKey 视为远端暂无笔记');

globalThis.fetch = async () =>
  new Response('<Error><Code>NoSuchBucket</Code></Error>', { status: 404 });
let missingBucket = false;
try {
  await getNotesObject(base);
} catch (error) {
  missingBucket = error.message.includes('Bucket 不存在');
}
assert(missingBucket, 'GET 404 NoSuchBucket 会报 Bucket 错误，而不是误判为空');

globalThis.fetch = async () =>
  new Response('{"schemaVersion":1,"notes":[]}', { status: 200, headers: { etag: '"abc"' } });
const object = await getNotesObject(base);
assert(Boolean(object?.text.includes('schemaVersion') && object.etag === '"abc"'), 'GET 返回正文与 ETag');

globalThis.fetch = async () => new Response('', { status: 412 });
let conflict = false;
try {
  await putNotesObject(base, '{}', '"abc"');
} catch (error) {
  conflict = error instanceof S3ConflictError;
}
assert(conflict, 'PUT 412 转为冲突错误');

globalThis.fetch = async () => new Response('', { status: 403 });
let forbidden = false;
try {
  await getNotesObject(base);
} catch (error) {
  forbidden = error.message.includes('拒绝访问');
}
assert(forbidden, 'GET 403 给出权限错误');

globalThis.fetch = realFetch;
