import { useRef, useState, type ChangeEvent } from 'react';
import type { Stock, WatchGroup } from '../types';
import { createAppBackup, restoreAppBackup } from '../services/appBackup';
import { toRemoteNotes } from '../services/notesStore';
import { timestampForFilename } from '../utils/watchlistBackup';

interface Props {
  watchlist: Stock[];
  groups: WatchGroup[];
  replaceAll: (stocks: Stock[], groups: WatchGroup[]) => void;
  syncEnabled: boolean;
}

export function LocalBackup({ watchlist, groups, replaceAll, syncEnabled }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const context = { watchlist, groups, replaceAll };

  const handleExport = () => {
    try {
      const content = createAppBackup(context);
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `valuecompass-backup-${timestampForFilename()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setError(null);
      setNotice('已导出');
    } catch (exportError) {
      setNotice(null);
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件不能超过 5 MB');
      const text = await file.text();
      const hasCurrentData =
        watchlist.length > 0 || groups.length > 0 || toRemoteNotes().length > 0;
      const cloudHint = syncEnabled ? '，并同步到云端' : '';
      if (
        hasCurrentData &&
        !window.confirm(`导入会覆盖当前本地数据${cloudHint}。\n\n继续导入吗？`)
      ) {
        return;
      }
      restoreAppBackup(text, context);
      setError(null);
      setNotice('已导入');
    } catch (importError) {
      setNotice(null);
      setError(importError instanceof Error ? importError.message : String(importError));
    }
  };

  return (
    <details className="sync-backup-details">
      <summary>本地备份</summary>
      <div className="sync-actions">
        <button type="button" className="btn-small" onClick={handleExport}>
          导出
        </button>
        <button type="button" className="btn-small" onClick={() => fileInputRef.current?.click()}>
          导入
        </button>
        <input
          ref={fileInputRef}
          className="sync-file-input"
          type="file"
          accept=".json,application/json"
          onChange={handleImport}
        />
      </div>
      {notice && <p className="sync-hint sync-success">{notice}</p>}
      {error && <p className="sync-hint sync-error-text">{error}</p>}
    </details>
  );
}
