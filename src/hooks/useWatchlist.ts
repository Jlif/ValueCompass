import { useCallback, useEffect, useRef, useState } from 'react';
import type { Stock, SyncState, WatchGroup } from '../types';
import {
  clearSyncConfig,
  loadSyncConfig,
  pullWatchlistWithRecovery,
  pushWatchlist,
} from '../services/gist';
import { normalizeGroupCodes, stockKey } from '../utils/stockKey';

// ponytail: 自选列表存 localStorage；配置了 GitHub 同步时，变更防抖上传，启动时拉取合并
const WATCHLIST_KEY = 'vc_watchlist';
const GROUPS_KEY = 'vc_watchlist_groups';
const PUSH_DEBOUNCE = 3000;

function normalizeStocks(stocks: Stock[]): Stock[] {
  if (!Array.isArray(stocks)) return [];
  const seen = new Set<string>();
  return stocks.filter((stock) => {
    if (!stock || typeof stock.code !== 'string' || typeof stock.name !== 'string' || typeof stock.exchange !== 'string') {
      return false;
    }
    const key = stockKey(stock);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function load(): Stock[] {
  try {
    return normalizeStocks(JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]'));
  } catch {
    return [];
  }
}

// 旧版分组只存 code，读取时按自选列表补成 `code.exchange`
function loadGroups(): WatchGroup[] {
  try {
    const groups = JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]') as WatchGroup[];
    return normalizeGroupCodes(groups, load());
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
  // 上次已同步的内容快照：避免启动/StrictMode 重放时无脑上传一次
  const syncedPayloadRef = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  }, [groups]);

  // 本地变更 -> 防抖上传
  useEffect(() => {
    const payload = JSON.stringify({ watchlist, groups });
    if (syncedPayloadRef.current === null) {
      syncedPayloadRef.current = payload;
      return;
    }
    if (syncedPayloadRef.current === payload) return;
    if (suppressPushRef.current) {
      suppressPushRef.current = false;
      syncedPayloadRef.current = payload;
      return;
    }
    const cfg = loadSyncConfig();
    if (!cfg) return;
    const timer = setTimeout(async () => {
      setSyncState('pushing');
      try {
        await pushWatchlist(cfg, watchlist, groups);
        syncedPayloadRef.current = payload;
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
      const localUpdated = Number(localStorage.getItem('vc_watchlist_updated') || 0);
      const result = await pullWatchlistWithRecovery(cfg, {
        localUpdated,
        hasLocalData: load().length > 0 || loadGroups().length > 0,
      });
      const remote = result.snapshot;
      if (remote) {
        if (remote.updated > localUpdated) {
          suppressPushRef.current = true;
          setWatchlist(normalizeStocks(remote.stocks));
          setGroups(normalizeGroupCodes(remote.groups, remote.stocks));
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
      syncedPayloadRef.current = JSON.stringify({ watchlist, groups });
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
    const key = stockKey(stock);
    setWatchlist((prev) => (prev.some((s) => stockKey(s) === key) ? prev : [...prev, stock]));
  }, []);

  const removeFromWatchlist = useCallback((key: string) => {
    setWatchlist((prev) => prev.filter((s) => stockKey(s) !== key));
    // 分组里的残留 key 渲染时按 watchlist 过滤，无需清理
  }, []);

  const toggleWatchlist = useCallback((stock: Stock) => {
    const key = stockKey(stock);
    setWatchlist((prev) =>
      prev.some((s) => stockKey(s) === key)
        ? prev.filter((s) => stockKey(s) !== key)
        : [...prev, stock]
    );
  }, []);

  const replaceAll = useCallback((stocks: Stock[], nextGroups: WatchGroup[]) => {
    const nextStocks = normalizeStocks(stocks);
    setWatchlist(nextStocks);
    setGroups(normalizeGroupCodes(nextGroups, nextStocks));
  }, []);

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

  const addToGroup = useCallback((id: string, key: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id && !g.codes.includes(key) ? { ...g, codes: [...g.codes, key] } : g))
    );
  }, []);

  const removeFromGroup = useCallback((id: string, key: string) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, codes: g.codes.filter((c) => c !== key) } : g)));
  }, []);

  return {
    watchlist, groups, addToWatchlist, removeFromWatchlist, toggleWatchlist, replaceAll,
    createGroup, removeGroup, renameGroup, moveGroup, addToGroup, removeFromGroup,
    syncState, syncError, lastSyncedAt, pull, forcePush, disconnect,
  };
}
