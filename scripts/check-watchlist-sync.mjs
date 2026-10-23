// 验证自选 S3 快照格式、旧数据兼容和独立对象 Key
// 跑法: npm run check:watchlist-sync
import {
  createWatchlistSyncSnapshot,
  normalizeWatchlistSnapshot,
  readWatchlistSnapshot,
  writeWatchlistSnapshot,
} from '../src/services/watchlistSync.ts';
import {
  defaultObjectSyncConfig,
  normalizeObjectSyncConfig,
} from '../src/services/s3.ts';

const assert = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`);
  if (!ok) process.exitCode = 1;
};

const stocks = [
  { code: '00700', name: '腾讯控股', exchange: 'HK' },
  { code: '600519', name: '贵州茅台', exchange: 'SH' },
];
const groups = [{ id: 'g1', name: '核心', codes: ['00700', '600519.SH'] }];
const snapshot = createWatchlistSyncSnapshot(stocks, groups, 123456);
assert(snapshot.schemaVersion === 2, '自选快照使用新 schemaVersion');
assert(snapshot.groups[0].codes.join(',') === '00700.HK,600519.SH', '分组代码迁移为包含交易所的主键');

const legacy = normalizeWatchlistSnapshot({
  updated: 99,
  stocks,
  groups,
});
assert(legacy.updatedAt === 99, '兼容旧版 updated 字段');

const defaults = defaultObjectSyncConfig('tencent');
assert(defaults.watchlistKey === 'valuecompass/watchlist.json', '自选使用独立默认 Key');
assert(defaults.notesKey === 'valuecompass/notes.json', '笔记使用独立默认 Key');
const config = {
  provider: 'custom',
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  bucket: 'bucket',
  accessKeyId: 'test-id',
  secretAccessKey: 'test-secret',
  forcePathStyle: true,
  conditionalWrites: false,
};
assert(
  normalizeObjectSyncConfig({ ...config, watchlistKey: '', notesKey: '' })?.watchlistKey ===
    'valuecompass/watchlist.json',
  '共享配置会补齐默认对象 Key'
);

let lastPutUrl = '';
globalThis.fetch = async (input, init = {}) => {
  if (init.method === 'PUT') {
    lastPutUrl = String(input);
    return new Response('', { status: 200 });
  }
  return Response.json(snapshot, { status: 200 });
};

await writeWatchlistSnapshot(config, defaults.watchlistKey, snapshot);
assert(lastPutUrl.includes('/bucket/valuecompass/watchlist.json'), '自选写入独立 watchlist Key');
const remote = await readWatchlistSnapshot(config, defaults.watchlistKey);
assert(remote.snapshot?.stocks.length === 2, '自选快照可从对象存储读取');
