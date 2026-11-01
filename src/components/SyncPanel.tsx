import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { NotesSyncApi } from '../hooks/useNotesSync';
import type { S3SyncSettingsApi } from '../hooks/useS3SyncSettings';
import type { SyncScope } from '../hooks/useSyncScopes';
import type { WatchlistSyncApi } from '../hooks/useWatchlist';
import type { ObjectSyncConfig, Stock, SyncState, WatchGroup } from '../types';
import {
  defaultObjectSyncConfig,
  parseS3Endpoint,
  S3_PROVIDER_PRESETS,
} from '../services/s3';
import { LocalBackup } from './LocalBackup';

interface Props {
  settings: S3SyncSettingsApi;
  watchlistSync: Pick<
    WatchlistSyncApi,
    'syncState' | 'syncError' | 'lastSyncedAt' | 'syncNow' | 'forcePush'
  >;
  notesSync: NotesSyncApi;
  syncScopes: SyncScope[];
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
  scopes: SyncScope[];
  state: SyncState;
  lastSyncedAt: number | null;
  error: string | null;
  busy: boolean;
  onSync: () => void;
}

function CombinedSyncStatus({
  scopes,
  state,
  lastSyncedAt,
  error,
  busy,
  onSync,
}: CombinedSyncStatusProps) {
  return (
    <div className="sync-object-row">
      <div className="sync-object-copy">
        <div className="sync-object-title">
          <div className="sync-scope-list" aria-label="同步内容">
            {scopes.map((scope) => (
              <span className="sync-scope-item" key={scope.key}>
                {scope.label}
                <b>{scope.count}</b>
              </span>
            ))}
          </div>
          <span>{STATE_LABEL[state]} · {formatTime(lastSyncedAt)}</span>
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
  syncScopes,
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
  const wrapRef = useRef<HTMLDivElement>(null);
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
      setNotice('同步已触发');
    });

  const handleForcePushWatchlist = () =>
    run(async () => {
      await watchlistSync.forcePush();
      setNotice('已强制上传自选');
    });

  return (
    <div className="sync-wrap" ref={wrapRef}>
      <button className="btn-small" onClick={() => setOpen((value) => !value)}>
        ☁ 远程同步: {STATE_LABEL[state]}
      </button>
      {open && (
        <div className="sync-panel remote-sync-panel">
          <div className="sync-panel-heading">
            <p className="sync-subtitle">远程同步</p>
            {settings.config && !editing && (
              <button type="button" className="btn-small" onClick={() => setEditing(true)}>
                编辑连接
              </button>
            )}
          </div>

          {settings.config && !editing ? (
            <>
              <div className="sync-object-list">
                <CombinedSyncStatus
                  scopes={syncScopes}
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
                    setNotice('已断开，本地数据保留');
                  }}
                >
                  断开
                </button>
              </div>

              <details className="sync-advanced">
                <summary>高级操作</summary>
                <div className="sync-advanced-body">
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => void handleForcePushWatchlist()}
                    disabled={busy}
                  >
                    强制上传自选
                  </button>
                  <p className="sync-hint">覆盖远端自选；笔记继续合并。</p>
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
                  {busy ? '处理中...' : settings.config ? '保存' : '保存并启用'}
                </button>
                <button type="button" className="btn-small" onClick={handleTest} disabled={busy}>
                  测试
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
            <summary>安全说明</summary>
            <div className="sync-advanced-body">
              <p className="sync-hint">AK/SK 只保存在本机 localStorage，请使用仅授权该 Bucket 的子账号。</p>
              <p className="sync-hint">桌面端通过 Tauri HTTP 访问；浏览器调试需要 Bucket 配置 CORS。</p>
            </div>
          </details>

          <LocalBackup
            watchlist={watchlist}
            groups={groups}
            replaceAll={replaceAll}
            syncEnabled={Boolean(settings.config)}
          />
        </div>
      )}
    </div>
  );
}
