import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { NotesSyncConfig, S3Provider, SyncState } from '../types';
import type { NotesSyncApi } from '../hooks/useNotesSync';
import { NOTES_OBJECT_KEY, S3_PROVIDER_PRESETS } from '../services/s3';

const STATE_LABEL: Record<SyncState, string> = {
  off: '未启用',
  synced: '已同步',
  pulling: '读取中...',
  pushing: '上传中...',
  error: '同步失败',
};

function presetConfig(provider: S3Provider): NotesSyncConfig {
  const preset = S3_PROVIDER_PRESETS[provider];
  return {
    provider,
    endpoint: preset.endpoint,
    region: preset.region,
    bucket: '',
    key: NOTES_OBJECT_KEY,
    accessKeyId: '',
    secretAccessKey: '',
    forcePathStyle: preset.forcePathStyle,
    conditionalWrites: preset.conditionalWrites,
  };
}

interface Props extends NotesSyncApi {}

function formatTime(value: number | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export function NotesSyncPanel({
  config,
  syncState,
  syncError,
  lastSyncedAt,
  saveConfig,
  testConfig,
  syncNow,
  disconnect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NotesSyncConfig>(() => (config ? { ...config } : presetConfig('aliyun')));
  const [setupError, setSetupError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(config ? { ...config } : presetConfig('aliyun'));
    setSetupError(null);
    setNotice(null);
  }, [open, config]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const update = (patch: Partial<NotesSyncConfig>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
  };

  const changeProvider = (provider: S3Provider) => {
    const preset = S3_PROVIDER_PRESETS[provider];
    setDraft((previous) => ({
      ...previous,
      provider,
      endpoint: preset.endpoint,
      region: preset.region,
      forcePathStyle: preset.forcePathStyle,
      conditionalWrites: preset.conditionalWrites,
    }));
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
      setNotice(await testConfig(draft));
    });

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const message = await testConfig(draft);
      await saveConfig(draft);
      setNotice(`${message}，已保存并开始同步`);
    });
  };

  const handleSync = () =>
    run(async () => {
      await syncNow();
      setNotice('同步已触发，结果见同步状态');
    });

  return (
    <div className="sync-wrap" ref={wrapRef}>
      <button className="btn-small" onClick={() => setOpen((value) => !value)}>
        ☁ 笔记: {STATE_LABEL[syncState]}
      </button>
      {open && (
        <form className="sync-panel notes-sync-panel" onSubmit={handleSave}>
          <p className="sync-subtitle">笔记同步（S3 兼容）</p>
          <p className="sync-hint">
            单文件 <code>{draft.key || NOTES_OBJECT_KEY}</code>，按笔记 id 合并；阿里云/腾讯云请使用 S3 兼容 Endpoint。
          </p>

          <label className="notes-sync-field">
            <span>服务商</span>
            <select value={draft.provider} onChange={(event) => changeProvider(event.target.value as S3Provider)}>
              {(['aliyun', 'tencent'] as S3Provider[]).map((value) => (
                <option key={value} value={value}>{S3_PROVIDER_PRESETS[value].label}</option>
              ))}
            </select>
          </label>

          <label className="notes-sync-field">
            <span>Endpoint</span>
            <input
              value={draft.endpoint}
              onChange={(event) => update({ endpoint: event.target.value })}
              placeholder="https://s3.oss-cn-hangzhou.aliyuncs.com"
              spellCheck={false}
            />
          </label>

          <div className="notes-sync-row">
            <label className="notes-sync-field">
              <span>Region</span>
              <input
                value={draft.region}
                onChange={(event) => update({ region: event.target.value })}
                placeholder="oss-cn-hangzhou"
                spellCheck={false}
              />
            </label>
            <label className="notes-sync-field">
              <span>Bucket</span>
              <input
                value={draft.bucket}
                onChange={(event) => update({ bucket: event.target.value })}
                placeholder="my-bucket"
                spellCheck={false}
              />
            </label>
          </div>

          {draft.provider === 'tencent' && (
            <p className="sync-hint">腾讯 COS 的 Bucket 需填写带 APPID 的完整名称，如 my-bucket-1250000000。</p>
          )}

          <label className="notes-sync-field">
            <span>对象 Key</span>
            <input
              value={draft.key}
              onChange={(event) => update({ key: event.target.value })}
              placeholder={NOTES_OBJECT_KEY}
              spellCheck={false}
            />
          </label>

          <label className="notes-sync-field">
            <span>AccessKey ID</span>
            <input
              value={draft.accessKeyId}
              onChange={(event) => update({ accessKeyId: event.target.value })}
              placeholder="LTAI..."
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

          <p className="sync-hint">
            桌面端走 Tauri HTTP；浏览器调试需给 Bucket 配置 CORS（GET/PUT/HEAD，允许 Authorization 等头）。403/404 时可切换 Path-style 或检查 Bucket 地域。
          </p>

          <div className="notes-sync-checks">
            <label className="notes-sync-check">
              <input
                type="checkbox"
                checked={draft.forcePathStyle}
                onChange={(event) => update({ forcePathStyle: event.target.checked })}
              />
              Path-style（阿里云/腾讯云/自建通常开启）
            </label>
            <label className="notes-sync-check">
              <input
                type="checkbox"
                checked={draft.conditionalWrites}
                onChange={(event) => update({ conditionalWrites: event.target.checked })}
              />
              条件写入（默认关闭，服务支持时再开启）
            </label>
          </div>

          <div className="sync-actions">
            <button type="submit" className="btn-small btn-primary" disabled={busy}>
              {busy ? '处理中...' : '测试并保存'}
            </button>
            <button type="button" className="btn-small" onClick={handleTest} disabled={busy}>
              仅测试
            </button>
            <button type="button" className="btn-small" onClick={handleSync} disabled={busy || !config}>
              立即同步
            </button>
            {config && (
              <button
                type="button"
                className="btn-small btn-danger"
                onClick={() => {
                  disconnect();
                  setNotice('已断开笔记同步，本地笔记仍保留');
                }}
              >
                断开
              </button>
            )}
          </div>

          {setupError && <p className="sync-hint sync-error-text">{setupError}</p>}
          {notice && <p className="sync-hint sync-success">{notice}</p>}
          {syncError && <p className="sync-hint sync-error-text">{syncError}</p>}
          <p className="sync-hint">上次同步: {formatTime(lastSyncedAt)}</p>
          <p className="sync-hint">
            AK/SK 只保存在本机 localStorage，请使用只授权该 Bucket 的子账号；不要用主账号密钥。
          </p>
        </form>
      )}
    </div>
  );
}
