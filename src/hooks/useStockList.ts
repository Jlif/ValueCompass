import { useCallback, useEffect, useState } from 'react';
import type { Stock } from '../types';
import {
  clearStockListCache,
  fetchIndustryMap,
  fetchStockList,
  type IndustryInfo,
} from '../services/tickflow';

// 股票池 + 申万行业映射。行业映射异步补充，失败不影响列表。
export function useStockList() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [industryMap, setIndustryMap] = useState<Record<string, IndustryInfo>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    setLoading(true);
    setError(null);
    try {
      if (force) clearStockListCache();
      const data = await fetchStockList();
      setStocks(data);
      fetchIndustryMap().then(setIndustryMap).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      if (force) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => {
    load(true);
  }, [load]);

  return { stocks, industryMap, loading, refreshing, error, refresh };
}
