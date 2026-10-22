import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { findOrCreateGist, loadSyncConfig, saveSyncConfig } from '../services/gist';
import type { Stock, SyncState, WatchGroup } from '../types';
import {
  createWatchlistBackup,
  parseWatchlistBackup,
  timestampForFilename,
} from '../utils/watchlistBackup';

interface Props {
  syncState: SyncState;
  syncError: string | null;
  lastSyncedAt: number | null;
  pull: () => Promise<void>;
  forcePush: () => Promise<void>;
  disconnect: () => void;
  watchlist: Stock[];
  groups: WatchGroup[];
  replaceAll: (stocks: Stock[], groups: WatchGroup[]) => void;
}

const STATE_LABEL: Record<SyncState, string> = {
  off: '未启用',
  synced: '已同步',
  pulling: '拉取中...',
  pushing: '上传中...',
  error: '同步失败',
};

export function SyncPanel({
  syncState,
  syncError,
  lastSyncedAt,
  pull,
  forcePush,
  disconnect,
  watchlist,
  groups,
  replaceAll,
}: Props) {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState(() => !!loadSyncConfig());
  const [token, setToken] = useState('');
  const [gistId, setGistId] = useState(() => loadSyncConfig()?.gistId || '');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 点击面板外任意位置关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleCreate = async () => {
    setSetupError(null);
    try {
      const id = await findOrCreateGist(token);
      saveSyncConfig({ token, gistId: id });
      setConfigured(true);
      pull();
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUseExisting = () => {
    if (!token || !gistId) {
      setSetupError('请填写 Token 和 Gist ID');
      return;
    }
    saveSyncConfig({ token, gistId });
    setConfigured(true);
    setSetupError(null);
    pull();
  };

  const handleDisconnect = () => {
    disconnect();
    setConfigured(false);
    setGistId('');
    setOpen(false);
  };

  const handleExport = () => {
    try {
      const timestamp = timestampForFilename();
      const content = createWatchlistBackup(watchlist, groups);
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const filename = `${timestamp}.json`;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setBackupError(null);
      setBackupNotice(`已导出 ${filename}`);
    } catch (e) {
      setBackupNotice(null);
      setBackupError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('JSON 文件不能超过 5 MB');
      const imported = parseWatchlistBackup(await file.text());
      const cloudHint = configured ? '导入后会自动上传到当前云端同步。' : '';
      if (
        (watchlist.length > 0 || groups.length > 0) &&
        !window.confirm(`导入会覆盖当前自选和分组。${cloudHint}\n\n继续导入吗？`)
      ) {
        return;
      }
      replaceAll(imported.watchlist, imported.groups);
      setBackupError(null);
      setBackupNotice(`已导入 ${imported.watchlist.length} 只自选、${imported.groups.length} 个分组`);
    } catch (e) {
      setBackupNotice(null);
      setBackupError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="sync-wrap" ref={wrapRef}>
      <button className="btn-small" onClick={() => setOpen(!open)}>
        ☁ 云同步: {STATE_LABEL[syncState]}
      </button>
      {open && (
        <div className="sync-panel">
          {!configured ? (
            <>
              <p className="sync-hint">
                1. 在 GitHub 生成 Personal Access Token（勾选 gist 权限）：<br />
                <span className="sync-url">github.com/settings/tokens</span>
              </p>
              <input
                type="password"
                placeholder="粘贴 Token (ghp_...)"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button className="btn-small btn-primary" onClick={handleCreate} disabled={!token}>
                连接同步 Gist
              </button>
              <p className="sync-hint">已有同步 Gist 会自动复用，没有才新建。</p>
              <p className="sync-hint">或使用已有的同步 Gist：</p>
              <input placeholder="Gist ID" value={gistId} onChange={(e) => setGistId(e.target.value)} />
              <button className="btn-small" onClick={handleUseExisting}>绑定已有 Gist</button>
              {setupError && <p className="sync-hint sync-error-text">{setupError}</p>}
            </>
          ) : (
            <>
              <p className="sync-hint">
                状态: {STATE_LABEL[syncState]}
                {syncError ? ` (${syncError})` : ''}
                {lastSyncedAt ? ` · ${new Date(lastSyncedAt).toLocaleTimeString()}` : ''}
              </p>
              <div className="sync-actions">
                <button className="btn-small" onClick={pull}>从云端拉取</button>
                <button className="btn-small" onClick={forcePush}>以本地为准上传</button>
                <button className="btn-small btn-danger" onClick={handleDisconnect}>断开同步</button>
              </div>
            </>
          )}

          <div className="sync-backup">
            <p className="sync-subtitle">本地备份</p>
            <div className="sync-actions">
              <button className="btn-small" onClick={handleExport}>导出 JSON</button>
              <button className="btn-small" onClick={() => fileInputRef.current?.click()}>导入 JSON</button>
              <input
                ref={fileInputRef}
                className="sync-file-input"
                type="file"
                accept=".json,application/json"
                onChange={handleImport}
              />
            </div>
            <p className="sync-hint">包含自选和分组，不包含 GitHub Token。</p>
            {backupNotice && <p className="sync-hint sync-success">{backupNotice}</p>}
            {backupError && <p className="sync-hint sync-error-text">{backupError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
