import { useCallback, useEffect, useRef, useState } from 'react';
import type { Stock } from '../types';
import { loadSyncConfig, pullWatchlist, pushWatchlist } from '../services/gist';

// ponytail: 自选列表存 localStorage；配置了 GitHub 同步时，变更防抖上传，启动时拉取合并
const WATCHLIST_KEY = 'vc_watchlist';
const PUSH_DEBOUNCE = 3000;

export type SyncState = 'off' | 'synced' | 'pulling' | 'pushing' | 'error';

function load(): Stock[] {
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
  } catch {
    return [];
  }
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<Stock[]>(load);
  const [syncState, setSyncState] = useState<SyncState>(loadSyncConfig() ? 'synced' : 'off');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  // 跳过 pull 落地后触发的多余 push（内容相同，纯省请求）
  const suppressPushRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  // 本地变更 -> 防抖上传
  useEffect(() => {
    if (suppressPushRef.current) {
      suppressPushRef.current = false;
      return;
    }
    const cfg = loadSyncConfig();
    if (!cfg) return;
    const timer = setTimeout(async () => {
      setSyncState('pushing');
      try {
        await pushWatchlist(cfg, watchlist);
        localStorage.setItem('vc_watchlist_updated', String(Date.now()));
        setSyncState('synced');
        setSyncError(null);
        setLastSyncedAt(Date.now());
      } catch (e) {
        setSyncState('error');
        setSyncError(e instanceof Error ? e.message : String(e));
      }
    }, PUSH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [watchlist]);

  // 启动时拉取远端，与本地按更新时间取新的一方
  const pull = useCallback(async () => {
    const cfg = loadSyncConfig();
    if (!cfg) return;
    setSyncState('pulling');
    try {
      const remote = await pullWatchlist(cfg);
      if (remote) {
        const localUpdated = Number(localStorage.getItem('vc_watchlist_updated') || 0);
        if (remote.updated > localUpdated) {
          suppressPushRef.current = true;
          setWatchlist(remote.stocks);
        }
      }
      setSyncState('synced');
      setSyncError(null);
      setLastSyncedAt(Date.now());
    } catch (e) {
      setSyncState('error');
      setSyncError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 手动上传本地（以本地为准强制覆盖远端）
  const forcePush = useCallback(async () => {
    const cfg = loadSyncConfig();
    if (!cfg) return;
    setSyncState('pushing');
    try {
      await pushWatchlist(cfg, watchlist);
      localStorage.setItem('vc_watchlist_updated', String(Date.now()));
      setSyncState('synced');
      setSyncError(null);
      setLastSyncedAt(Date.now());
    } catch (e) {
      setSyncState('error');
      setSyncError(e instanceof Error ? e.message : String(e));
    }
  }, [watchlist]);

  useEffect(() => {
    pull();
    // 仅启动时拉取一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addToWatchlist = useCallback((stock: Stock) => {
    setWatchlist((prev) => (prev.some((s) => s.code === stock.code) ? prev : [...prev, stock]));
  }, []);

  const removeFromWatchlist = useCallback((code: string) => {
    setWatchlist((prev) => prev.filter((s) => s.code !== code));
  }, []);

  const isInWatchlist = useCallback((code: string) => watchlist.some((s) => s.code === code), [watchlist]);

  return { watchlist, addToWatchlist, removeFromWatchlist, isInWatchlist, syncState, syncError, lastSyncedAt, pull, forcePush };
}
