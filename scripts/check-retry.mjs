// 验证 tickflow.ts 的 429 重试逻辑（真实模块）：桩化 fetch，按服务端提示等待后重试
// 跑法: npm run check:retry
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'services', 'tickflow.ts'),
  'utf8'
);
const tmpTs = join(mkdtempSync(join(tmpdir(), 'vc-retry-')), 'tickflow.ts');
writeFileSync(tmpTs, src);

// ---- 桩 ----
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
let calls = 0;
let always429 = false;
globalThis.fetch = async () => {
  calls++;
  if (always429 || calls === 1) {
    return new Response('{"code":"RATE_LIMITED","message":"请求频率超限 (10/min)，请 100ms 后重试"}', {
      status: 429,
    });
  }
  return Response.json({
    data: { timestamp: [0], open: [1], high: [1], low: [1], close: [1], volume: [1] },
  });
};

const { fetchKline } = await import(tmpTs);
const assert = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!ok) process.exitCode = 1;
};
const stock = { code: '600519', name: '贵州茅台', exchange: 'SH' };

// 1) 首次 429：按提示等待后重试，拿到数据
const t0 = Date.now();
const k = await fetchKline(stock);
assert(calls === 2, `429 后自动重试一次（共 ${calls} 次请求）`);
assert(Date.now() - t0 >= 100, `按服务端提示等待了约 ${Date.now() - t0}ms`);
assert(k.length === 1 && k[0].close === 1, '重试后正常返回 K 线数据');

// 2) 持续 429：只重试一次，然后抛出原错误
always429 = true;
calls = 0;
try {
  await fetchKline(stock);
  assert(false, '持续 429 应抛错');
} catch (e) {
  assert(String(e).includes('TickFlow 429'), `持续 429 抛出原错误（${e.message.slice(0, 50)}…）`);
}
assert(calls === 2, `持续 429 只重试一次（共 ${calls} 次请求）`);

// 3) 429 等待期间取消：应立即中断，不再发第二次请求
calls = 0;
const controller = new AbortController();
const started = Date.now();
const pending = fetchKline(stock, 'daily', 500, controller.signal);
setTimeout(() => controller.abort(), 60);
try {
  await pending;
  assert(false, '429 等待期间取消应抛错');
} catch (e) {
  assert(e.name === 'AbortError', `取消后抛出 AbortError（${e.name}）`);
}
assert(calls === 1, `取消后不再重试（共 ${calls} 次请求）`);
assert(Date.now() - started < 1000, `取消立即生效（${Date.now() - started}ms）`);
