import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { NotesSyncApi } from '../hooks/useNotesSync';
import type { S3SyncSettingsApi } from '../hooks/useS3SyncSettings';
import type { WatchlistSyncApi } from '../hooks/useWatchlist';
import type { ObjectSyncConfig, Stock, SyncState, WatchGroup } from '../types';
import {
  defaultObjectSyncConfig,
  parseS3Endpoint,
  S3_PROVIDER_PRESETS,
} from '../services/s3';
import { replaceNotesSnapshot, toRemoteNotes } from '../services/notesStore';
import {
  createValueCompassBackup,
  parseValueCompassBackup,
  timestampForFilename,
} from '../utils/watchlistBackup';

interface Props {
  settings: S3SyncSettingsApi;
  watchlistSync: Pick<
    WatchlistSyncApi,
    'syncState' | 'syncError' | 'lastSyncedAt' | 'syncNow' | 'forcePush'
  >;
  notesSync: NotesSyncApi;
  watchlist: Stock[];
  groups: WatchGroup[];
  replaceAll: (stocks: Stock[], groups: WatchGroup[]) => void;
}

const STATE_LABEL: Record<SyncState, string> = {
  off: '未配置',
  synced: '已同步',
  pulling: '读取中...',
  pushing: '上传中...',
  error: '同步失败',
};

function combinedState(states: SyncState[]): SyncState {
  if (states.includes('error')) return 'error';
  if (states.includes('pushing')) return 'pushing';
  if (states.includes('pulling')) return 'pulling';
  if (states.every((state) => state === 'off')) return 'off';
  return 'synced';
}

function formatTime(value: number | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

interface CombinedSyncStatusProps {
  config: ObjectSyncConfig;
  state: SyncState;
  lastSyncedAt: number | null;
  error: string | null;
  busy: boolean;
  onSync: () => void;
}

function CombinedSyncStatus({
  config,
  state,
  lastSyncedAt,
  error,
  busy,
  onSync,
}: CombinedSyncStatusProps) {
  return (
    <div className="sync-object-row sync-object-row-combined">
      <div className="sync-object-copy">
        <div className="sync-object-title">
          <strong>自选与笔记</strong>
          <span>{STATE_LABEL[state]} · {formatTime(lastSyncedAt)}</span>
        </div>
        <div className="sync-key-list">
          <span className="sync-key-item">
            <b>自选</b>
            <code title={config.watchlistKey}>{config.watchlistKey}</code>
          </span>
          <span className="sync-key-item">
            <b>笔记</b>
            <code title={config.notesKey}>{config.notesKey}</code>
          </span>
        </div>
        {error && <p className="sync-hint sync-error-text">{error}</p>}
      </div>
      <div className="sync-object-actions">
        <button type="button" className="btn-small" disabled={busy} onClick={onSync}>
          同步
        </button>
      </div>
    </div>
  );
}

export function SyncPanel({
  settings,
  watchlistSync,
  notesSync,
  watchlist,
  groups,
  replaceAll,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(() => !settings.config);
  const [draft, setDraft] = useState<ObjectSyncConfig>(
    () => settings.config ?? defaultObjectSyncConfig()
  );
  const [setupError, setSetupError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const state = combinedState([watchlistSync.syncState, notesSync.syncState]);
  const lastSyncedAt = Math.max(watchlistSync.lastSyncedAt ?? 0, notesSync.lastSyncedAt ?? 0) || null;
  const syncError = [
    watchlistSync.syncError ? `自选：${watchlistSync.syncError}` : '',
    notesSync.syncError ? `笔记：${notesSync.syncError}` : '',
  ].filter(Boolean).join('；') || null;
  const parsed = parseS3Endpoint(draft.endpoint);
  const needsRegion = !parsed.region;
  const needsBucket = !parsed.bucket;

  useEffect(() => {
    if (!open) return;
    setDraft(settings.config ?? defaultObjectSyncConfig());
    setEditing(!settings.config);
    setSetupError(null);
    setNotice(null);
    setBackupError(null);
    setBackupNotice(null);

    const close = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, settings.config]);

  const update = (patch: Partial<ObjectSyncConfig>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
  };

  const updateEndpoint = (endpoint: string) => {
    update({ endpoint, ...parseS3Endpoint(endpoint) });
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setSetupError(null);
    setNotice(null);
    try {
      await task();
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleTest = () =>
    run(async () => {
      setNotice(await settings.testConfig(draft));
    });

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const message = await settings.testConfig(draft);
      await settings.saveConfig(draft);
      setEditing(false);
      setNotice(`${message}；配置已保存`);
    });
  };

  const handleSyncAll = () =>
    run(async () => {
      await Promise.all([watchlistSync.syncNow(), notesSync.syncNow()]);
      setNotice('自选和笔记同步已触发');
    });

  const handleForcePushWatchlist = () =>
    run(async () => {
      await watchlistSync.forcePush();
      setNotice('自选与分组已强制上传；投资笔记仍按正常合并规则同步');
    });

  const handleExport = () => {
    try {
      const timestamp = timestampForFilename();
      const allNotes = toRemoteNotes();
      const activeNoteCount = allNotes.filter((note) => note.deletedAt == null).length;
      const content = createValueCompassBackup(watchlist, groups, allNotes);
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const filename = `valuecompass-backup-${timestamp}.json`;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setBackupError(null);
      setBackupNotice(
        `已导出 ${filename}（${watchlist.length} 只自选、${groups.length} 个分组、${activeNoteCount} 条笔记）`
      );
    } catch (error) {
      setBackupNotice(null);
      setBackupError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('JSON 文件不能超过 5 MB');
      const imported = parseValueCompassBackup(await file.text());
      const importedNoteCount = imported.notes.notes.filter((note) => note.deletedAt == null).length;
      const currentNoteCount = toRemoteNotes().filter((note) => note.deletedAt == null).length;
      const cloudHint = settings.config ? '导入后会同步到当前 OSS，笔记继续按合并规则处理。' : '';
      const importTarget = imported.includesNotes ? '自选、分组和笔记' : '自选和分组';
      if (
        (watchlist.length > 0 || groups.length > 0 || currentNoteCount > 0) &&
        !window.confirm(`导入会覆盖当前${importTarget}。${cloudHint}\n\n继续导入吗？`)
      ) {
        return;
      }
      replaceAll(imported.watchlist, imported.groups);
      if (imported.includesNotes) replaceNotesSnapshot(imported.notes);
      setBackupError(null);
      setBackupNotice(
        imported.includesNotes
          ? `已导入 ${imported.watchlist.length} 只自选、${imported.groups.length} 个分组、${importedNoteCount} 条笔记`
          : `已导入 ${imported.watchlist.length} 只自选、${imported.groups.length} 个分组；备份不含笔记，现有笔记未改动`
      );
    } catch (error) {
      setBackupNotice(null);
      setBackupError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="sync-wrap" ref={wrapRef}>
      <button className="btn-small" onClick={() => setOpen((value) => !value)}>
        ☁ 远程同步: {STATE_LABEL[state]}
      </button>
      {open && (
        <div className="sync-panel remote-sync-panel">
          <div className="sync-panel-heading">
            <div>
              <p className="sync-subtitle">远程同步</p>
              <p className="sync-hint">自选与笔记共用 OSS 连接</p>
            </div>
            {settings.config && !editing && (
              <button type="button" className="btn-small" onClick={() => setEditing(true)}>
                编辑连接
              </button>
            )}
          </div>

          {settings.config && !editing ? (
            <>
              <div className="sync-connection-summary">
                <strong>{S3_PROVIDER_PRESETS[settings.config.provider].label}</strong>
                <span>{settings.config.bucket} · {settings.config.region}</span>
                <code title={settings.config.endpoint}>{shortEndpoint(settings.config.endpoint)}</code>
              </div>

              <div className="sync-object-list">
                <CombinedSyncStatus
                  config={settings.config}
                  state={state}
                  lastSyncedAt={lastSyncedAt}
                  error={syncError}
                  busy={busy}
                  onSync={() => void handleSyncAll()}
                />
              </div>

              <div className="sync-actions">
                <button
                  type="button"
                  className="btn-small btn-danger"
                  onClick={() => {
                    settings.disconnect();
                    setNotice('已断开远程同步，本地数据仍保留');
                  }}
                >
                  断开
                </button>
              </div>

              <details className="sync-advanced">
                <summary>高级同步操作</summary>
                <div className="sync-advanced-body">
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => void handleForcePushWatchlist()}
                    disabled={busy}
                  >
                    强制上传自选
                  </button>
                  <p className="sync-hint">仅覆盖远端自选文件；笔记继续按更新时间合并。</p>
                </div>
              </details>
            </>
          ) : (
            <form className="sync-config-form" onSubmit={handleSave}>
              <label className="notes-sync-field">
                <span>OSS Endpoint</span>
                <input
                  autoFocus
                  value={draft.endpoint}
                  onChange={(event) => updateEndpoint(event.target.value)}
                  placeholder="https://bucket.cos.ap-shanghai.myqcloud.com"
                  spellCheck={false}
                />
              </label>

              {parsed.provider && draft.bucket && draft.region && (
                <p className="sync-derived">
                  已识别：{S3_PROVIDER_PRESETS[parsed.provider].label} · {draft.region} · {draft.bucket}
                </p>
              )}

              {(needsRegion || needsBucket) && (
                <div className="notes-sync-row">
                  {needsRegion && (
                    <label className="notes-sync-field">
                      <span>Region</span>
                      <input
                        value={draft.region}
                        onChange={(event) => update({ region: event.target.value })}
                        placeholder="oss-cn-hangzhou"
                        spellCheck={false}
                      />
                    </label>
                  )}
                  {needsBucket && (
                    <label className="notes-sync-field">
                      <span>Bucket</span>
                      <input
                        value={draft.bucket}
                        onChange={(event) => update({ bucket: event.target.value })}
                        placeholder="my-bucket"
                        spellCheck={false}
                      />
                    </label>
                  )}
                </div>
              )}

              <div className="notes-sync-row">
                <label className="notes-sync-field">
                  <span>AccessKey ID</span>
                  <input
                    value={draft.accessKeyId}
                    onChange={(event) => update({ accessKeyId: event.target.value })}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="notes-sync-field">
                  <span>AccessKey Secret</span>
                  <input
                    type="password"
                    value={draft.secretAccessKey}
                    onChange={(event) => update({ secretAccessKey: event.target.value })}
                    placeholder="只保存在本机"
                    autoComplete="off"
                  />
                </label>
              </div>

              <details className="sync-advanced">
                <summary>高级设置</summary>
                <div className="sync-advanced-body">
                  <label className="notes-sync-field">
                    <span>自选对象 Key</span>
                    <input
                      value={draft.watchlistKey}
                      onChange={(event) => update({ watchlistKey: event.target.value })}
                      spellCheck={false}
                    />
                  </label>
                  <label className="notes-sync-field">
                    <span>笔记对象 Key</span>
                    <input
                      value={draft.notesKey}
                      onChange={(event) => update({ notesKey: event.target.value })}
                      spellCheck={false}
                    />
                  </label>
                  <label className="notes-sync-check">
                    <input
                      type="checkbox"
                      checked={draft.forcePathStyle}
                      onChange={(event) => update({ forcePathStyle: event.target.checked })}
                    />
                    Path-style
                  </label>
                  <label className="notes-sync-check">
                    <input
                      type="checkbox"
                      checked={draft.conditionalWrites}
                      onChange={(event) => update({ conditionalWrites: event.target.checked })}
                    />
                    条件写入
                  </label>
                </div>
              </details>

              <div className="sync-actions">
                <button type="submit" className="btn-small btn-primary" disabled={busy}>
                  {busy ? '处理中...' : settings.config ? '保存修改' : '测试连接并启用'}
                </button>
                <button type="button" className="btn-small" onClick={handleTest} disabled={busy}>
                  仅测试
                </button>
                {settings.config && (
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => {
                      setDraft(settings.config!);
                      setEditing(false);
                      setSetupError(null);
                      setNotice(null);
                    }}
                  >
                    取消
                  </button>
                )}
              </div>
            </form>
          )}

          {setupError && <p className="sync-hint sync-error-text">{setupError}</p>}
          {notice && <p className="sync-hint sync-success">{notice}</p>}

          <details className="sync-advanced">
            <summary>安全与调试说明</summary>
            <div className="sync-advanced-body">
              <p className="sync-hint">AK/SK 只保存在本机 localStorage，请使用仅授权该 Bucket 的子账号。</p>
              <p className="sync-hint">桌面端通过 Tauri HTTP 访问；浏览器调试需要 Bucket 配置 CORS。</p>
            </div>
          </details>

          <details className="sync-backup-details">
            <summary>本地完整备份</summary>
            <div className="sync-actions">
              <button type="button" className="btn-small" onClick={handleExport}>导出 JSON</button>
              <button type="button" className="btn-small" onClick={() => fileInputRef.current?.click()}>
                导入 JSON
              </button>
              <input
                ref={fileInputRef}
                className="sync-file-input"
                type="file"
                accept=".json,application/json"
                onChange={handleImport}
              />
            </div>
            <p className="sync-hint">一个 JSON 同时包含自选、分组和全部投资笔记。</p>
            {backupNotice && <p className="sync-hint sync-success">{backupNotice}</p>}
            {backupError && <p className="sync-hint sync-error-text">{backupError}</p>}
          </details>
        </div>
      )}
    </div>
  );
}

function shortEndpoint(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}
