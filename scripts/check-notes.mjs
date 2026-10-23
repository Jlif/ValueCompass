// 验证笔记本地存储、墓碑、按 id 合并与远端快照格式
// 跑法: npm run check:notes
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const notes = await import(join(root, 'src', 'services', 'notesStore.ts'));
const assert = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`);
  if (!ok) process.exitCode = 1;
};

// 1) 新增 + 删除墓碑
const added = notes.addNote('600000.SH', '估值偏低，关注息差');
assert(Boolean(added && added.id), '新增笔记生成 id');
assert(notes.getSnapshot().notesByStock['600000.SH']?.length === 1, '笔记按 stockKey 归属');
notes.removeNote('600000.SH', added.id);
const afterDelete = notes.getSnapshot().notesByStock['600000.SH'][0];
assert(afterDelete.deletedAt !== null, '删除保留墓碑，不直接移除');
assert(notes.activeNotesFor('600000.SH').length === 0, 'UI 只看到未删除笔记');

// 2) 快照格式
const snapshot = notes.createSnapshot();
assert(snapshot.schemaVersion === 1, '快照带 schemaVersion');
assert(snapshot.notes.length === 1 && snapshot.notes[0].stockKey === '600000.SH', '快照扁平化并带 stockKey');
assert(notes.parseSnapshot(JSON.stringify(snapshot)).notes.length === 1, '快照可回读');

// 3) 合并：updatedAt 新的赢；墓碑优先；远端新增保留
const base = { stockKey: '600000.SH', createdAt: 100, deletedAt: null };
const mergedSameId = notes.mergeNoteLists(
  [{ ...base, id: 'a', text: '旧', updatedAt: 100 }],
  [{ ...base, id: 'a', text: '新', updatedAt: 200 }]
);
assert(mergedSameId.find((note) => note.id === 'a')?.text === '新', '同 id 取 updatedAt 较新的文本');
const mergedTombstone = notes.mergeNoteLists(
  [{ ...base, id: 'b', text: '删了', updatedAt: 300, deletedAt: 300 }],
  [{ ...base, id: 'b', text: '旧设备又写', updatedAt: 200 }]
);
assert(mergedTombstone.find((note) => note.id === 'b')?.deletedAt === 300, '墓碑比旧编辑优先，避免笔记复活');
const mergedNew = notes.mergeNoteLists([], [{ ...base, id: 'c', text: '远端独有', updatedAt: 150 }]);
assert(mergedNew.some((note) => note.id === 'c'), '远端独有笔记会合入本地');

// 4) 合并落地到 store
const remote = {
  schemaVersion: 1,
  updatedAt: 400,
  notes: [
    { ...base, id: 'c', text: '远端独有', updatedAt: 150 },
    { ...base, id: 'd', stockKey: '00700.HK', text: '腾讯', updatedAt: 400 },
  ],
};
const result = notes.mergeRemoteNotes(remote);
assert(result.changed, '远端有新笔记时标记 changed');
assert(notes.getSnapshot().notesByStock['00700.HK']?.[0]?.text === '腾讯', '远端笔记写入本地缓存');
assert(notes.hasAnyNotes(), '存在未删除笔记');

let invalidRejected = false;
try {
  notes.parseSnapshot('{bad json');
} catch {
  invalidRejected = true;
}
assert(invalidRejected, '无效 JSON 会被拒绝');
