// 验证自选备份 JSON、时间戳和导入兼容性
// 跑法: npm run check:backup
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  createValueCompassBackup,
  parseValueCompassBackup,
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
const backupNotes = [
  {
    id: 'n1',
    stockKey: '600519.SH',
    text: '长期跟踪',
    createdAt: 100,
    updatedAt: 200,
    deletedAt: null,
  },
  {
    id: 'n2',
    stockKey: '00700.HK',
    text: '',
    createdAt: 100,
    updatedAt: 300,
    deletedAt: 300,
  },
];
const exported = createValueCompassBackup(stocks, groups, backupNotes);
assert(JSON.parse(exported).version === 3, '导出格式版本为 3');
assert(JSON.parse(exported).notes.length === 2, '单个 JSON 包含全部笔记');
const roundTrip = parseValueCompassBackup(exported);
assert(roundTrip.watchlist.length === 2, '导出后可完整导入自选');
assert(roundTrip.groups[0].codes.length === 2, '导出后可完整导入分组');
assert(roundTrip.includesNotes && roundTrip.notes.notes.length === 2, '导出后可完整导入笔记与墓碑');
assert(
  roundTrip.groups[0].codes.includes('00700.HK') && roundTrip.groups[0].codes.includes('600519.SH'),
  '旧版纯 code 分组会迁移为 code.exchange'
);
assert(!exported.includes('token') && !exported.includes('gistId'), '导出不包含同步凭据');

const legacyFormat = parseValueCompassBackup(JSON.stringify({
  stocks: [{ code: '09988', name: '阿里巴巴', exchange: 'HK' }],
  groups: [{ id: 'g2', name: '港股', codes: ['09988'] }],
}));
assert(legacyFormat.watchlist[0].code === '09988', '兼容旧同步文件 stocks 格式');
assert(legacyFormat.groups[0].codes[0] === '09988.HK', '旧分组同样完成 key 迁移');
assert(!legacyFormat.includesNotes && legacyFormat.notes.notes.length === 0, '旧备份不包含笔记时不会误覆盖');

let invalidNotesRejected = false;
try {
  parseValueCompassBackup(JSON.stringify({
    watchlist: stocks,
    groups,
    notes: 'invalid',
  }));
} catch {
  invalidNotesRejected = true;
}
assert(invalidNotesRejected, '包含笔记字段但结构无效时拒绝导入');

let invalidRejected = false;
try {
  parseValueCompassBackup('{bad json');
} catch {
  invalidRejected = true;
}
assert(invalidRejected, '无效 JSON 会被拒绝');
