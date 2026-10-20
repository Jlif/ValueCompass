import { useCallback, useEffect, useRef, useState } from 'react';
import type { Stock } from '../types';
import { clearSyncConfig, loadSyncConfig, pullWatchlist, pushWatchlist } from '../services/gist';

// ponytail: 自选列表存 localStorage；配置了 GitHub 同步时，变更防抖上传，启动时拉取合并
const WATCHLIST_KEY = 'vc_watchlist';
const PUSH_DEBOUNCE = 3000;

export type SyncState = 'off' | 'synced' | 'pulling' | 'pushing' | 'error';

// 分组只是 code 集合，引用 watchlist 里的股票；一个股票可在多个分组
export interface WatchGroup {
  id: string;
  name: string;
  codes: string[];
}

const GROUPS_KEY = 'vc_watchlist_groups';

function loadGroups(): WatchGroup[] {
  try {
    return JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]');
  } catch {
    return [];
  }
}

function load(): Stock[] {
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
  } catch {
    return [];
  }
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<Stock[]>(load);
  const [groups, setGroups] = useState<WatchGroup[]>(loadGroups);
  const [syncState, setSyncState] = useState<SyncState>(loadSyncConfig() ? 'synced' : 'off');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  // 跳过 pull 落地后触发的多余 push（内容相同，纯省请求）
  const suppressPushRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  }, [groups]);

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
        await pushWatchlist(cfg, watchlist, groups);
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
  }, [watchlist, groups]);

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
          setGroups(remote.groups);
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
      await pushWatchlist(cfg, watchlist, groups);
      localStorage.setItem('vc_watchlist_updated', String(Date.now()));
      setSyncState('synced');
      setSyncError(null);
      setLastSyncedAt(Date.now());
    } catch (e) {
      setSyncState('error');
      setSyncError(e instanceof Error ? e.message : String(e));
    }
  }, [watchlist, groups]);

  // 断开同步：清配置并把状态复位，否则按钮还挂着上一次的「已同步」
  const disconnect = useCallback(() => {
    clearSyncConfig();
    setSyncState('off');
    setSyncError(null);
    setLastSyncedAt(null);
  }, []);

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
    // 分组里的残留 code 渲染时按 watchlist 过滤，无需清理
  }, []);

  const isInWatchlist = useCallback((code: string) => watchlist.some((s) => s.code === code), [watchlist]);

  const createGroup = useCallback((name: string) => {
    setGroups((prev) => [...prev, { id: crypto.randomUUID(), name, codes: [] }]);
  }, []);

  const removeGroup = useCallback((id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const renameGroup = useCallback((id: string, name: string) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
  }, []);

  // 拖拽排序：把 from 分组挪到 to 分组的位置（移动后 from===to，天然幂等）
  const moveGroup = useCallback((fromId: string, toId: string) => {
    setGroups((prev) => {
      const from = prev.findIndex((g) => g.id === fromId);
      const to = prev.findIndex((g) => g.id === toId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const addToGroup = useCallback((id: string, code: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id && !g.codes.includes(code) ? { ...g, codes: [...g.codes, code] } : g))
    );
  }, []);

  const removeFromGroup = useCallback((id: string, code: string) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, codes: g.codes.filter((c) => c !== code) } : g)));
  }, []);

  return {
    watchlist, groups, addToWatchlist, removeFromWatchlist, isInWatchlist,
    createGroup, removeGroup, renameGroup, moveGroup, addToGroup, removeFromGroup,
    syncState, syncError, lastSyncedAt, pull, forcePush, disconnect,
  };
}
