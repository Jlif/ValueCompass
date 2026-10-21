// 验证市场与板块归类、折叠树分组顺序
// 跑法: npm run check:markets
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { getBoardInfo, groupStocksByMarket } = await import(join(root, 'src', 'utils', 'markets.ts'));

const assert = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`);
  if (!ok) process.exitCode = 1;
};
const board = (code, exchange) => getBoardInfo({ code, exchange, name: code }).label;

assert(board('600519', 'SH') === '沪市主板', '沪市 600 归入主板');
assert(board('688981', 'SH') === '科创板', '沪市 688 归入科创板');
assert(board('900901', 'SH') === '沪市 B 股', '沪市 900 归入 B 股');
assert(board('000001', 'SZ') === '深市主板', '深市 000 归入主板');
assert(board('300750', 'SZ') === '创业板', '深市 300 归入创业板');
assert(board('301269', 'SZ') === '创业板', '深市 301 归入创业板');
assert(board('200002', 'SZ') === '深市 B 股', '深市 200 归入 B 股');
assert(board('830799', 'BJ') === '北交所', '北交所代码归入北交所');
assert(board('00700', 'HK') === '港股主板', '港股主板归类正确');
assert(board('08001', 'HK') === '港股 GEM', '港股 GEM 归类正确');

const stocks = [
  { code: '00700', name: '腾讯控股', exchange: 'HK' },
  { code: '600519', name: '贵州茅台', exchange: 'SH' },
  { code: '300750', name: '宁德时代', exchange: 'SZ' },
  { code: '688981', name: '中芯国际', exchange: 'SH' },
  { code: '830799', name: '艾融软件', exchange: 'BJ' },
];
const groups = groupStocksByMarket(stocks);
assert(groups.map((group) => group.key).join(',') === 'SH,SZ,HK,BJ', '市场按上海、深圳、港股、北京排序');
assert(groups[0].boards.map((item) => item.label).join(',') === '沪市主板,科创板', '上海板块排序正确');
assert(groups.reduce((sum, group) => sum + group.count, 0) === stocks.length, '分组后股票总数不丢失');
