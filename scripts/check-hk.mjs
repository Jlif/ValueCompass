// 验证港股股票池、实时行情和 K 线归一化（真实服务模块 + 桩化 fetch）
// 跑法: npm run check:hk
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'services', 'tickflow.ts'),
  'utf8'
);
const tempTs = join(mkdtempSync(join(tmpdir(), 'vc-hk-')), 'tickflow.ts');
writeFileSync(tempTs, source);

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

let requestedUrls = [];
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  requestedUrls.push(url.pathname + url.search);

  const exchangeMatch = url.pathname.match(/\/exchanges\/(\w+)\/instruments$/);
  if (exchangeMatch) {
    const exchange = exchangeMatch[1];
    return Response.json({
      exchange,
      count: 1,
      data: [{
        symbol: exchange === 'HK' ? '00700.HK' : '600519.SH',
        exchange,
        code: exchange === 'HK' ? '00700' : '600519',
        name: exchange === 'HK' ? '腾 讯控股' : '贵州茅台',
        type: 'stock',
      }],
    });
  }

  if (url.pathname === '/v1/quotes') {
    return Response.json({
      data: [{
        symbol: '00700.HK',
        last_price: 400.6,
        prev_close: 410.4,
        open: 412,
        high: 413.4,
        low: 400,
        volume: 19122472,
        amount: 7731027594.9,
        timestamp: 1792563068000,
        ext: {
          name: '腾讯控股',
          change_amount: -9.8,
          change_pct: -0.023879142300194823,
          amplitude: 0.032651072124756285,
          turnover_rate: 0.0021030703782700232,
        },
      }],
    });
  }

  if (url.pathname === '/v1/klines') {
    return Response.json({
      data: {
        timestamp: [Date.UTC(2026, 9, 20, 16, 0)],
        open: [412],
        high: [413.4],
        low: [400],
        close: [400.6],
        volume: [19122472],
      },
    });
  }

  throw new Error(`Unexpected request: ${url}`);
};

const { fetchStockList, fetchQuote, fetchKline } = await import(tempTs);
const assert = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`);
  if (!ok) process.exitCode = 1;
};
const stock = { code: '00700', name: '腾讯控股', exchange: 'HK' };

const stocks = await fetchStockList();
assert(stocks.some((item) => item.code === '00700' && item.exchange === 'HK'), '股票池包含港股');
assert(stocks.some((item) => item.name === '腾讯控股'), '股票名称空格已清洗');
assert(['SH', 'SZ', 'BJ', 'HK'].every((market) => stocks.some((item) => item.exchange === market)), '股票池包含全部市场');

requestedUrls = [];
await fetchStockList();
assert(requestedUrls.length === 0, '股票池缓存可复用');

const quote = await fetchQuote(stock);
assert(quote?.lastPrice === 400.6 && quote?.name === '腾讯控股', '港股实时行情字段归一化正确');
assert(requestedUrls.at(-1) === '/v1/quotes?symbols=00700.HK', '实时行情使用 00700.HK 标的代码');

const klines = await fetchKline(stock);
assert(klines.length === 1 && klines[0].close === 400.6, '港股 K 线返回并归一化正确');
assert(klines[0].date === '2026-10-21', '港股 K 线日期按香港时区换算');
