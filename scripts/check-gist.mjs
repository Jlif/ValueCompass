import assert from 'node:assert/strict';
import {
  findOrCreateGist,
  pullWatchlistWithRecovery,
} from '../src/services/gist.ts';

const SYNC_FILE = 'valuecompass-watchlist.json';
const legacyId = 'legacy-populated';
const emptyId = 'new-empty';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const gists = [
  {
    id: emptyId,
    description: 'ValueCompass2 自选列表同步',
    files: { [SYNC_FILE]: {} },
  },
  {
    id: legacyId,
    description: '我的投资配置',
    files: { [SYNC_FILE]: {} },
  },
];

const snapshots = {
  [emptyId]: { updated: 0, stocks: [] },
  [legacyId]: {
    updated: 1792569127500,
    stocks: [{ code: '600827', name: '百联股份', exchange: 'SH' }],
    groups: [],
  },
};

let writes = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (init.method && init.method !== 'GET') writes += 1;
  if (url.pathname === '/gists') return jsonResponse(gists);

  const gistId = url.pathname.replace('/gists/', '');
  const content = JSON.stringify(snapshots[gistId]);
  return jsonResponse({ files: { [SYNC_FILE]: { content } } });
};

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};

assert.equal(await findOrCreateGist('test-token'), legacyId, '应优先复用改名后的有效 Gist');
assert.equal(writes, 0, '存在可复用 Gist 时不应创建新 Gist');

const result = await pullWatchlistWithRecovery(
  { token: 'test-token', gistId: emptyId },
  { localUpdated: 0, hasLocalData: false }
);

assert.equal(result.recovered, true, '应识别并修复空 Gist 配置');
assert.equal(result.config.gistId, legacyId, '应自动改绑到有数据的旧 Gist');
assert.equal(result.snapshot?.stocks.length, 1, '应返回旧 Gist 中的自选数据');
assert.equal(
  JSON.parse(values.get('vc_sync_config')).gistId,
  legacyId,
  '修复后的 Gist ID 应写回本地配置'
);

console.log('gist compatibility checks passed');
