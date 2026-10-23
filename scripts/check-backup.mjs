// 验证自选备份 JSON、时间戳和导入兼容性
// 跑法: npm run check:backup
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  createWatchlistBackup,
  parseWatchlistBackup,
  timestampForFilename,
} = await import(join(root, 'src', 'utils', 'watchlistBackup.ts'));

const assert = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`);
  if (!ok) process.exitCode = 1;
};

const date = new Date(2026, 9, 21, 15, 13, 57);
assert(timestampForFilename(date) === '20261021-151357', '文件名时间戳精确到秒');

const stocks = [
  { code: '00700', name: '腾讯控股', exchange: 'HK' },
  { code: '600519', name: '贵州茅台', exchange: 'SH' },
];
const groups = [
  { id: 'g1', name: '核心持仓', codes: ['00700', '600519'] },
];
const exported = createWatchlistBackup(stocks, groups);
assert(JSON.parse(exported).version === 2, '导出格式版本为 2');
const roundTrip = parseWatchlistBackup(exported);
assert(roundTrip.watchlist.length === 2, '导出后可完整导入自选');
assert(roundTrip.groups[0].codes.length === 2, '导出后可完整导入分组');
assert(
  roundTrip.groups[0].codes.includes('00700.HK') && roundTrip.groups[0].codes.includes('600519.SH'),
  '旧版纯 code 分组会迁移为 code.exchange'
);
assert(!exported.includes('token') && !exported.includes('gistId'), '导出不包含同步凭据');

const legacyFormat = parseWatchlistBackup(JSON.stringify({
  stocks: [{ code: '09988', name: '阿里巴巴', exchange: 'HK' }],
  groups: [{ id: 'g2', name: '港股', codes: ['09988'] }],
}));
assert(legacyFormat.watchlist[0].code === '09988', '兼容旧同步文件 stocks 格式');
assert(legacyFormat.groups[0].codes[0] === '09988.HK', '旧分组同样完成 key 迁移');

let invalidRejected = false;
try {
  parseWatchlistBackup('{bad json');
} catch {
  invalidRejected = true;
}
assert(invalidRejected, '无效 JSON 会被拒绝');
