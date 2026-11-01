import { useCallback, useEffect, useRef, useState } from 'react';
import type { Stock } from '../types';
import {
  fetchValuationSnapshot,
  readCachedValuationSnapshot,
  VALUATION_CACHE_TTL,
} from '../services/valuation/snapshot';
import type { StockValuation } from '../services/valuation/types';

export function useValuationSnapshot(stocks: Stock[]) {
  const [valuations, setValuations] = useState<Record<string, StockValuation>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (stocks.length === 0) return;
      const currentRequest = requestId.current + 1;
      requestId.current = currentRequest;

      const cached = readCachedValuationSnapshot(stocks);
      if (cached && !force) {
        setValuations(cached.byKey);
        setUpdatedAt(cached.updatedAt);
      }

      setLoading(true);
      setError(null);
      try {
        const snapshot = await fetchValuationSnapshot(stocks, { force });
        if (requestId.current !== currentRequest) return;
        setValuations(snapshot.byKey);
        setUpdatedAt(snapshot.updatedAt);
        setError(snapshot.warnings.length > 0 ? snapshot.warnings.join('；') : null);
      } catch (err) {
        if (requestId.current !== currentRequest) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestId.current === currentRequest) setLoading(false);
      }
    },
    [stocks]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (stocks.length === 0) {
      setValuations({});
      setUpdatedAt(null);
      setError(null);
      setLoading(false);
    }
  }, [stocks.length]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  return {
    valuations,
    loading,
    error,
    updatedAt,
    refresh,
    cacheTtl: VALUATION_CACHE_TTL,
  };
}
