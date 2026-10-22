import { useCallback, useEffect, useRef, useState } from 'react';
import type { KlineData, Stock } from '../types';
import { fetchKline, type KlinePeriod } from '../services/tickflow';
import { PERIOD_LABELS } from '../utils/periods';

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : (error as { name?: string } | null)?.name === 'AbortError';
}

// 选中股票 + K 线加载。切股票/切周期会中止上一次请求，避免先发后到的响应覆盖当前图表。
export function useKline() {
  const [stock, setStock] = useState<Stock | null>(null);
  const [period, setPeriod] = useState<KlinePeriod>('daily');
  const [data, setData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (target: Stock, targetPeriod: KlinePeriod) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setLoading(true);
    try {
      const next = await fetchKline(target, targetPeriod, 500, controller.signal);
      if (controller.signal.aborted) return;
      setData(next);
      if (next.length === 0) setError('该周期暂无数据，请尝试其他周期');
    } catch (e) {
      if (controller.signal.aborted || isAbortError(e)) return;
      const message = e instanceof Error ? e.message : String(e);
      console.error('Failed to fetch kline:', message);
      setData([]);
      setError(`获取${PERIOD_LABELS[targetPeriod]}数据失败: ${message}`);
    } finally {
      // 只有最新一次请求能结束 loading，旧请求的 finally 不能关掉新请求的加载态
      if (requestRef.current === controller) setLoading(false);
    }
  }, []);

  const selectStock = useCallback(
    (next: Stock) => {
      setStock(next);
      setPeriod('daily');
      setData([]);
      load(next, 'daily');
    },
    [load]
  );

  const selectPeriod = useCallback(
    (nextPeriod: KlinePeriod) => {
      setPeriod(nextPeriod);
      if (stock) load(stock, nextPeriod);
    },
    [load, stock]
  );

  useEffect(() => () => requestRef.current?.abort(), []);

  return { stock, period, data, loading, error, selectStock, selectPeriod };
}
