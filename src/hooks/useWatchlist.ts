import { useCallback, useEffect, useState } from 'react';
import type { Stock } from '../types';

// ponytail: 自选列表存 localStorage，浏览器和 Tauri 通用，不再依赖 Rust/SQLite
const WATCHLIST_KEY = 'vc_watchlist';

function load(): Stock[] {
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
  } catch {
    return [];
  }
}

function save(stocks: Stock[]): void {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(stocks));
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<Stock[]>(load);

  useEffect(() => {
    save(watchlist);
  }, [watchlist]);

  const addToWatchlist = useCallback((stock: Stock) => {
    setWatchlist((prev) =>
      prev.some((s) => s.code === stock.code) ? prev : [...prev, stock]
    );
  }, []);

  const removeFromWatchlist = useCallback((code: string) => {
    setWatchlist((prev) => prev.filter((s) => s.code !== code));
  }, []);

  const isInWatchlist = useCallback(
    (code: string) => watchlist.some((s) => s.code === code),
    [watchlist]
  );

  return { watchlist, addToWatchlist, removeFromWatchlist, isInWatchlist };
}
