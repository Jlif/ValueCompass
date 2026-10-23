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
import {
  createWatchlistBackup,
  parseWatchlistBackup,
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

interface ObjectStatusProps {
  title: string;
  objectKey: string;
  state: SyncState;
  lastSyncedAt: number | null;
  error: string | null;
  syncNow: () => Promise<void>;
  forcePush?: () => Promise<void>;
  enabled: boolean;
}

function ObjectStatus({
  title,
  objectKey,
  state,
  lastSyncedAt,
  error,
  syncNow,
  forcePush,
  enabled,
}: ObjectStatusProps) {
  return (
    <div className="sync-object-row">
      <div className="sync-object-copy">
        <div className="sync-object-title">
          <strong>{title}</strong>
          <span>{STATE_LABEL[state]} · {formatTime(lastSyncedAt)}</span>
        </div>
        <code>{objectKey}</code>
        {error && <p className="sync-hint sync-error-text">{error}</p>}
      </div>
      <div className="sync-object-actions">
        <button type="button" className="btn-small" disabled={!enabled} onClick={() => void syncNow()}>
          同步
        </button>
        {forcePush && (
          <button type="button" className="btn-small" disabled={!enabled} onClick={() => void forcePush()}>
            强制上传
          </button>
        )}
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
      const imported = parseWatchlistBackup(await file.text());
      const cloudHint = settings.config ? '导入后会自动同步到当前 OSS。' : '';
      if (
        (watchlist.length > 0 || groups.length > 0) &&
        !window.confirm(`导入会覆盖当前自选和分组。${cloudHint}\n\n继续导入吗？`)
      ) {
        return;
      }
      replaceAll(imported.watchlist, imported.groups);
      setBackupError(null);
      setBackupNotice(`已导入 ${imported.watchlist.length} 只自选、${imported.groups.length} 个分组`);
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
                <ObjectStatus
                  title="自选与分组"
                  objectKey={settings.config.watchlistKey}
                  state={watchlistSync.syncState}
                  lastSyncedAt={watchlistSync.lastSyncedAt}
                  error={watchlistSync.syncError}
                  syncNow={watchlistSync.syncNow}
                  forcePush={watchlistSync.forcePush}
                  enabled
                />
                <ObjectStatus
                  title="投资笔记"
                  objectKey={settings.config.notesKey}
                  state={notesSync.syncState}
                  lastSyncedAt={notesSync.lastSyncedAt}
                  error={notesSync.syncError}
                  syncNow={notesSync.syncNow}
                  enabled
                />
              </div>

              <div className="sync-actions">
                <button type="button" className="btn-small" onClick={handleSyncAll} disabled={busy}>
                  全部同步
                </button>
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
            <summary>本地自选备份</summary>
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
