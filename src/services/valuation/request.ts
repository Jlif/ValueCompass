import { isTauriRuntime, request } from '../http';

const EASTMONEY_API = 'https://push2.eastmoney.com';
const TENCENT_API = 'https://qt.gtimg.cn';
const MAX_ATTEMPTS = 3;

function abortError(): DOMException {
  return new DOMException('请求已取消', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function endpoint(base: string, proxyPrefix: string, path: string, params?: Record<string, string>): string {
  const target = isTauriRuntime()
    ? `${base}${path}`
    : `${window.location.origin}${proxyPrefix}${path}`;
  const url = new URL(target);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  // 避免中间层把行情快照缓存过久。
  url.searchParams.set('_', String(Date.now()));
  return url.toString();
}

async function requestText(url: string, label: string, signal?: AbortSignal): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await request(url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.text.trim()) throw new Error('接口返回空响应');
      return response.text;
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1) {
        await wait(400 * 2 ** attempt + Math.floor(Math.random() * 200), signal);
      }
    }
  }
  throw new Error(
    `${label}请求失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

export async function requestEastmoney<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<T> {
  const text = await requestText(
    endpoint(EASTMONEY_API, '/push2', path, params),
    '东方财富估值接口',
    signal
  );
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('东方财富估值接口返回了无效 JSON');
  }
}

export async function requestTencent(
  symbols: string[],
  signal?: AbortSignal
): Promise<string> {
  return requestText(
    endpoint(TENCENT_API, '/tencent', `/q=${symbols.join(',')}`),
    '腾讯行情接口',
    signal
  );
}
