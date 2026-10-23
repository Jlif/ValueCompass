import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObjectSyncConfig, Stock, SyncState, WatchGroup } from '../types';
import { S3ConflictError } from '../services/s3';
import {
  createWatchlistSyncSnapshot,
  readWatchlistSnapshot,
  WATCHLIST_SYNC_UPDATED_KEY,
  writeWatchlistSnapshot,
  type WatchlistSyncSnapshot,
} from '../services/watchlistSync';
import { normalizeGroupCodes, stockKey } from '../utils/stockKey';

const WATCHLIST_KEY = 'vc_watchlist';
const GROUPS_KEY = 'vc_watchlist_groups';
const LAST_SYNC_KEY = 'vc_watchlist_last_synced';
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

function localPayload(stocks: Stock[], groups: WatchGroup[]): string {
  return JSON.stringify({ stocks, groups });
}

interface Options {
  config: ObjectSyncConfig | null;
}

export function useWatchlist({ config }: Options) {
  const [watchlist, setWatchlist] = useState<Stock[]>(load);
  const [groups, setGroups] = useState<WatchGroup[]>(loadGroups);
  const [syncState, setSyncState] = useState<SyncState>(config ? 'synced' : 'off');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => {
    const value = Number(localStorage.getItem(LAST_SYNC_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const configRef = useRef(config);
  const watchlistRef = useRef(watchlist);
  const groupsRef = useRef(groups);
  const syncedPayloadRef = useRef<string | null>(localPayload(watchlist, groups));
  const suppressPushRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  watchlistRef.current = watchlist;
  groupsRef.current = groups;

  useEffect(() => {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  }, [groups]);

  const applyRemote = useCallback((snapshot: WatchlistSyncSnapshot) => {
    const nextStocks = normalizeStocks(snapshot.stocks);
    const nextGroups = normalizeGroupCodes(snapshot.groups, nextStocks);
    suppressPushRef.current = true;
    setWatchlist(nextStocks);
    setGroups(nextGroups);
    localStorage.setItem(WATCHLIST_SYNC_UPDATED_KEY, String(snapshot.updatedAt));
    syncedPayloadRef.current = localPayload(nextStocks, nextGroups);
  }, []);

  const doSync = useCallback(async () => {
    const current = configRef.current;
    if (!current) return;
    setSyncState('pulling');
    setSyncError(null);
    try {
      const localUpdated = Number(localStorage.getItem(WATCHLIST_SYNC_UPDATED_KEY) || 0);
      const stocks = watchlistRef.current;
      const groupsNow = groupsRef.current;
      const hasLocalData = stocks.length > 0 || groupsNow.length > 0;
      const localDirty = syncedPayloadRef.current !== localPayload(stocks, groupsNow);
      let remote = await readWatchlistSnapshot(current, current.watchlistKey);
      const remoteMatchesLocal = Boolean(
        remote.snapshot &&
        localPayload(stocks, groupsNow) ===
          localPayload(remote.snapshot.stocks, remote.snapshot.groups)
      );

      if (remote.snapshot && remote.snapshot.updatedAt > localUpdated) {
        applyRemote(remote.snapshot);
      } else if (remote.snapshot && remoteMatchesLocal && !localDirty) {
        localStorage.setItem(WATCHLIST_SYNC_UPDATED_KEY, String(remote.snapshot.updatedAt));
      } else if (remote.snapshot || hasLocalData || localDirty) {
        const snapshot = createWatchlistSyncSnapshot(
          stocks,
          groupsNow,
          Math.max(Date.now(), (remote.snapshot?.updatedAt ?? 0) + 1)
        );
        setSyncState('pushing');
        try {
          await writeWatchlistSnapshot(current, current.watchlistKey, snapshot, remote.etag);
          localStorage.setItem(WATCHLIST_SYNC_UPDATED_KEY, String(snapshot.updatedAt));
          syncedPayloadRef.current = localPayload(stocks, groupsNow);
        } catch (error) {
          if (!(error instanceof S3ConflictError)) throw error;
          remote = await readWatchlistSnapshot(current, current.watchlistKey);
          if (remote.snapshot && remote.snapshot.updatedAt > snapshot.updatedAt) {
            applyRemote(remote.snapshot);
          } else {
            const retry = createWatchlistSyncSnapshot(
              stocks,
              groupsNow,
              Math.max(Date.now(), (remote.snapshot?.updatedAt ?? 0) + 1)
            );
            await writeWatchlistSnapshot(current, current.watchlistKey, retry, remote.etag);
            localStorage.setItem(WATCHLIST_SYNC_UPDATED_KEY, String(retry.updatedAt));
            syncedPayloadRef.current = localPayload(stocks, groupsNow);
          }
        }
      }

      if (configRef.current !== current) return;
      const syncedAt = Date.now();
      localStorage.setItem(LAST_SYNC_KEY, String(syncedAt));
      setLastSyncedAt(syncedAt);
      setSyncState('synced');
      setSyncError(null);
    } catch (error) {
      if (configRef.current !== current) return;
      setSyncState('error');
      setSyncError(error instanceof Error ? error.message : String(error));
    }
  }, [applyRemote]);

  const enqueueSync = useCallback(() => {
    const run = () => doSync();
    queueRef.current = queueRef.current.then(run, run);
    return queueRef.current;
  }, [doSync]);

  useEffect(() => {
    configRef.current = config;
    if (!config) {
      setSyncState('off');
      setSyncError(null);
      return;
    }
    setSyncState('synced');
    void enqueueSync();
  }, [config, enqueueSync]);

  // 本地变更 -> 标记更新时间并防抖同步。
  useEffect(() => {
    const payload = localPayload(watchlist, groups);
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
    localStorage.setItem(WATCHLIST_SYNC_UPDATED_KEY, String(Date.now()));
    if (!configRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void enqueueSync(), PUSH_DEBOUNCE);
  }, [watchlist, groups, enqueueSync]);

  useEffect(() => {
    if (!config) return;
    const timer = setInterval(() => void enqueueSync(), 60_000);
    const onFocus = () => void enqueueSync();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [config, enqueueSync]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const syncNow = useCallback(() => enqueueSync(), [enqueueSync]);

  const forcePush = useCallback(async () => {
    const current = configRef.current;
    if (!current) return;
    setSyncState('pushing');
    try {
      const snapshot = createWatchlistSyncSnapshot(
        watchlistRef.current,
        groupsRef.current,
        Date.now()
      );
      await writeWatchlistSnapshot(current, current.watchlistKey, snapshot);
      localStorage.setItem(WATCHLIST_SYNC_UPDATED_KEY, String(snapshot.updatedAt));
      syncedPayloadRef.current = localPayload(watchlistRef.current, groupsRef.current);
      const syncedAt = Date.now();
      localStorage.setItem(LAST_SYNC_KEY, String(syncedAt));
      setLastSyncedAt(syncedAt);
      setSyncState('synced');
      setSyncError(null);
    } catch (error) {
      setSyncState('error');
      setSyncError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const addToWatchlist = useCallback((stock: Stock) => {
    const key = stockKey(stock);
    setWatchlist((prev) => (prev.some((s) => stockKey(s) === key) ? prev : [...prev, stock]));
  }, []);

  const removeFromWatchlist = useCallback((key: string) => {
    setWatchlist((prev) => prev.filter((s) => stockKey(s) !== key));
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
    localStorage.setItem(WATCHLIST_SYNC_UPDATED_KEY, String(Date.now()));
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
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, codes: g.codes.filter((c) => c !== key) } : g))
    );
  }, []);

  return {
    watchlist,
    groups,
    addToWatchlist,
    removeFromWatchlist,
    toggleWatchlist,
    replaceAll,
    createGroup,
    removeGroup,
    renameGroup,
    moveGroup,
    addToGroup,
    removeFromGroup,
    syncState,
    syncError,
    lastSyncedAt,
    syncNow,
    forcePush,
  };
}

export type WatchlistSyncApi = ReturnType<typeof useWatchlist>;
