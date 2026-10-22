import { useEffect, useRef, useState } from 'react';
import type { WatchGroup } from '../types';

interface Props {
  groups: WatchGroup[];
  watchlistKeys: Set<string>;
  createGroup: (name: string) => void;
  renameGroup: (id: string, name: string) => void;
  removeGroup: (id: string) => void;
  moveGroup: (fromId: string, toId: string) => void;
}

// 分组管理面板：拖拽排序、重命名、删除、新建
export function GroupManager({ groups, watchlistKeys, createGroup, renameGroup, removeGroup, moveGroup }: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  // 删除两段式确认：第一次点变红显示「确认删除」，再点才真删，防手滑
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // 拖拽：mousedown 手柄时才让整行 draggable，避免和行内重命名输入框的文本选择冲突
  const [dragId, setDragId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击面板外任意位置关闭（同 SyncPanel）
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const commitRename = () => {
    if (editingId && draft.trim()) renameGroup(editingId, draft.trim());
    setEditingId(null);
  };

  return (
    <div className="gm-wrap" ref={wrapRef}>
      <button
        className="gm-btn"
        title="分组管理"
        onClick={() => {
          setOpen(!open);
          setConfirmId(null);
        }}
      >
        ✎
      </button>
      {open && (
        <div className="gm-panel">
          <p className="gm-title">分组管理</p>
          {groups.map((g) => (
            <div
              key={g.id}
              className={`gm-row ${dragId === g.id ? 'dragging' : ''}`}
              draggable={dragId === g.id}
              onDragStart={() => setDragId(g.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragId && dragId !== g.id) moveGroup(dragId, g.id);
              }}
            >
              <span
                className="gm-handle"
                title="拖动排序"
                onMouseDown={() => setDragId(g.id)}
                onMouseUp={() => setDragId(null)}
              >
                ≡
              </span>
              {editingId === g.id ? (
                <input
                  className="gm-input"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    else if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <span className="gm-name">{g.name}</span>
              )}
              <span className="gm-count">{g.codes.filter((c) => watchlistKeys.has(c)).length} 只</span>
              <button
                className="gm-icon"
                title="重命名"
                onClick={() => {
                  setEditingId(g.id);
                  setDraft(g.name);
                }}
              >
                ✎
              </button>
              {confirmId === g.id ? (
                <button
                  className="gm-del-confirm"
                  title="再点一次确认删除"
                  onMouseLeave={() => setConfirmId(null)}
                  onClick={() => {
                    removeGroup(g.id);
                    setConfirmId(null);
                  }}
                >
                  确认删除
                </button>
              ) : (
                <button
                  className="gm-icon gm-del"
                  title="删除分组（不影响自选）"
                  onClick={() => setConfirmId(g.id)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {creating ? (
            <input
              className="gm-input"
              autoFocus
              placeholder="分组名，回车确认"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => setCreating(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  createGroup(newName.trim());
                  setNewName('');
                  setCreating(false);
                } else if (e.key === 'Escape') {
                  setCreating(false);
                }
              }}
            />
          ) : (
            <button className="gm-add" onClick={() => setCreating(true)}>
              ＋ 新建分组
            </button>
          )}
        </div>
      )}
    </div>
  );
}
