import { useEffect, useState } from 'react';
import { fetchQuote } from '../services/tickflow';
import type { Stock, StockQuote } from '../types';

const QUOTE_REFRESH_MS = 15_000;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useStockQuote(stock: Stock | null) {
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuote(null);
    setError(null);

    if (!stock) {
      setLoading(false);
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const poll = async () => {
      if (disposed) return;
      try {
        const next = await fetchQuote(stock, controller.signal);
        if (!disposed) {
          setQuote(next);
          setError(null);
        }
      } catch (e) {
        if (!disposed && !isAbortError(e)) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(poll, QUOTE_REFRESH_MS);
        }
      }
    };

    setLoading(true);
    poll();
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [stock]);

  return { quote, loading, error };
}
