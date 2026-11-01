// 验证统一备份归档、模块注册、导入兼容性与原子校验
// 跑法: npm run check:backup
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { createAppBackup, restoreAppBackup } = await import(
  join(root, 'src', 'services', 'appBackup.ts')
);
const { BACKUP_VERSION, createBackupArchive, parseBackupArchive, restoreBackupArchive } = await import(
  join(root, 'src', 'services', 'backupArchive.ts')
);
const notes = await import(join(root, 'src', 'services', 'notesStore.ts'));
const { timestampForFilename } = await import(
  join(root, 'src', 'utils', 'watchlistBackup.ts')
);

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
notes.replaceNotesSnapshot({
  schemaVersion: 1,
  updatedAt: 300,
  notes: [
    {
      stockKey: '600519.SH',
      id: 'n1',
      text: '长期跟踪',
      createdAt: 100,
      updatedAt: 200,
      deletedAt: null,
    },
    {
      stockKey: '00700.HK',
      id: 'n2',
      text: '',
      createdAt: 100,
      updatedAt: 300,
      deletedAt: 300,
    },
  ],
});

let restoredStocks = [];
let restoredGroups = [];
const context = {
  watchlist: stocks,
  groups,
  replaceAll: (nextStocks, nextGroups) => {
    restoredStocks = nextStocks;
    restoredGroups = nextGroups;
  },
};

const exported = createAppBackup(context);
const parsed = parseBackupArchive(exported);
assert(parsed.version === BACKUP_VERSION, '统一备份使用当前归档版本');
assert(parsed.format === 'valuecompass-backup', '使用统一备份格式');
assert(Array.isArray(parsed.watchlist) && Array.isArray(parsed.groups), '归档包含自选模块');
assert(Array.isArray(parsed.notes) && parsed.notes.length === 2, '归档自动包含笔记模块');
assert(!exported.includes('token') && !exported.includes('gistId'), '导出不包含同步凭据');

let futureValue = null;
const futureArchive = createBackupArchive([
  {
    capture: () => ({ futureData: { enabled: true } }),
    hasData: (data) => Object.prototype.hasOwnProperty.call(data, 'futureData'),
    prepare: (data) => () => {
      futureValue = data.futureData;
    },
  },
]);
restoreBackupArchive(futureArchive, [
  {
    capture: () => ({}),
    hasData: (data) => Object.prototype.hasOwnProperty.call(data, 'futureData'),
    prepare: (data) => () => {
      futureValue = data.futureData;
    },
  },
]);
assert(futureValue?.enabled === true, '新增备份模块会被统一归档自动收纳');

notes.replaceNotesSnapshot({ schemaVersion: 1, updatedAt: 0, notes: [] });
restoreAppBackup(exported, context);
assert(restoredStocks.length === 2, '导入可恢复自选');
assert(restoredGroups[0].codes.length === 2, '导入可恢复分组');
assert(
  restoredGroups[0].codes.includes('00700.HK') && restoredGroups[0].codes.includes('600519.SH'),
  '旧版纯 code 分组会迁移为 code.exchange'
);
assert(notes.activeNotesFor('600519.SH')[0]?.text === '长期跟踪', '导入可恢复笔记');
assert(notes.getSnapshot().notesByStock['00700.HK'][0].deletedAt === 300, '笔记墓碑一并恢复');

notes.replaceNotesSnapshot({
  schemaVersion: 1,
  updatedAt: 400,
  notes: [
    {
      stockKey: '09988.HK',
      id: 'keep',
      text: '保留',
      createdAt: 400,
      updatedAt: 400,
      deletedAt: null,
    },
  ],
});
restoreAppBackup(
  JSON.stringify({
    stocks: [{ code: '09988', name: '阿里巴巴', exchange: 'HK' }],
    groups: [{ id: 'g2', name: '港股', codes: ['09988'] }],
  }),
  context
);
assert(restoredStocks[0].code === '09988', '兼容旧同步文件 stocks 格式');
assert(restoredGroups[0].codes[0] === '09988.HK', '旧分组同样完成 key 迁移');
assert(notes.activeNotesFor('09988.HK')[0]?.text === '保留', '旧备份不含笔记时不清空现有笔记');

restoredStocks = [];
let invalidNotesRejected = false;
try {
  restoreAppBackup(
    JSON.stringify({
      watchlist: stocks,
      groups,
      notes: 'invalid',
    }),
    context
  );
} catch {
  invalidNotesRejected = true;
}
assert(invalidNotesRejected, '笔记结构无效时拒绝导入');
assert(restoredStocks.length === 0, '校验失败时不发生部分数据写入');

let invalidRejected = false;
try {
  restoreAppBackup('{bad json', context);
} catch {
  invalidRejected = true;
}
assert(invalidRejected, '无效 JSON 会被拒绝');
