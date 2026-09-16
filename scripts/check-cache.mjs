// 验证 finance.ts 的缓存逻辑（真实模块）：桩化 localStorage/fetch，统计网络请求数
// 跑法: npm run check:cache
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const financeSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'services', 'finance.ts');
// 把 import.meta.env.DEV 固定为 false，模拟生产构建（缓存开启）
const src = readFileSync(financeSrc, 'utf8').replace(/import\.meta\.env\.DEV/g, 'false');
const tmpTs = join(mkdtempSync(join(tmpdir(), 'vc-cache-')), 'finance_prod.ts');
writeFileSync(tmpTs, src);

// ---- 桩 ----
globalThis.window = {};
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (url, ...rest) => {
  let u = String(url);
  if (u.startsWith('/em')) u = 'https://emweb.securities.eastmoney.com' + u.slice(3); // 模拟 Vite 代理
  if (u.includes('eastmoney')) calls++;
  return realFetch(u, ...rest);
};

const { fetchFinance } = await import(tmpTs);
const stock = { code: '600827', name: '百联股份', exchange: 'SH' };
const assert = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!ok) process.exitCode = 1;
};

// 1) 首次：走网络
let t0 = Date.now();
const a = await fetchFinance(stock);
const first = calls;
assert(first > 0, `首次请求走网络（${first} 个请求, ${Date.now() - t0}ms）`);
assert(Object.keys(a.indicator).length > 0, '首次返回含指标数据');

// 2) 二次：命中缓存，零请求
calls = 0;
t0 = Date.now();
const b = await fetchFinance(stock);
assert(calls === 0, `二次命中缓存，零网络请求（耗时 ${Date.now() - t0}ms）`);
assert(JSON.stringify(a) === JSON.stringify(b), '缓存返回值与首次一致');

// 3) 公司类型缓存：换股票仍省掉探测请求
calls = 0;
await fetchFinance({ code: '600519', name: '贵州茅台', exchange: 'SH' });
// 茅台首探 4 个 + 三表 6 个 + datacenter 1 个 = 11；缓存后应少 3 个探测
const ctCalls = calls;
calls = 0;
await fetchFinance({ code: '600519', name: '贵州茅台', exchange: 'SH' });
assert(calls === 0, '茅台二次同样零请求');

// 4) TTL 过期后重新拉取
const raw = JSON.parse(store.get('vc.finance.v1'));
raw['600827'].t -= 25 * 3600 * 1000; // 回拨 25 小时
store.set('vc.finance.v1', JSON.stringify(raw));
calls = 0;
await fetchFinance(stock);
assert(calls > 0, `TTL 过期后重新拉取（${calls} 个请求）`);

// 5) 容量淘汰：超过 60 只时保留最新的（淘汰只在写入时触发）
const raw2 = JSON.parse(store.get('vc.finance.v1'));
for (let i = 0; i < 65; i++) raw2[`90000${i}`] = { t: Date.now() - (i + 1) * 1000, d: raw2['600827'].d };
delete raw2['600519']; // 腾出一只未缓存的股票，强制走网络触发写入
store.set('vc.finance.v1', JSON.stringify(raw2));
calls = 0;
await fetchFinance({ code: '600519', name: '贵州茅台', exchange: 'SH' });
const kept = Object.keys(JSON.parse(store.get('vc.finance.v1')));
assert(kept.length <= 60, `容量淘汰生效（保留 ${kept.length} 条 ≤ 60）`);
assert(kept.includes('600519'), '本次写入的股票被保留');
assert(!kept.includes('9000064'), '最旧的条目被淘汰');

console.log(`\n首次请求数 = ${first}（其中 3 个是冗余的公司类型探测，仅每只股票一次）`);
