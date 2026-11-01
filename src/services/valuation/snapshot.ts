import type { Stock } from '../../types';
import { stockKey } from '../../utils/stockKey';
import { fetchCnValuations } from './cn';
import { fetchHkValuations } from './hk';
import { deriveRoe } from './normalize';
import type { StockValuation, ValuationMarket, ValuationSnapshot } from './types';

const CACHE_KEY = 'vc_valuation_snapshot_v1';
// 估值只随定期财报明显变化，与股票池一样缓存 7 天，避免频繁触发上游限流。
export const VALUATION_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

interface StoredSnapshot {
  version: 1;
  byKey: Record<string, StockValuation>;
  markets: Partial<Record<ValuationMarket, number>>;
}

function readStored(): StoredSnapshot | null {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSnapshot;
    if (parsed?.version !== 1 || !parsed.byKey || !parsed.markets) return null;
    return parsed;
  } catch {
    return null;
  }
}

function filterForStocks(
  byKey: Record<string, StockValuation>,
  stocks: Stock[]
): Record<string, StockValuation> {
  const wanted = new Set(stocks.map(stockKey));
  return Object.fromEntries(
    Object.entries(byKey)
      .filter(([key]) => wanted.has(key))
      .map(([key, valuation]) => [
        key,
        {
          ...valuation,
          // 兼容上一版缓存：ROE 可由已有 PE/PB 推导，无需重新请求上游。
          roeTtm: valuation.roeTtm ?? deriveRoe(valuation.pb, valuation.peTtm),
        },
      ])
  );
}

function toSnapshot(stored: StoredSnapshot, stocks: Stock[]): ValuationSnapshot {
  const markets = Object.values(stored.markets).filter(
    (value): value is number => typeof value === 'number'
  );
  return {
    byKey: filterForStocks(stored.byKey, stocks),
    updatedAt: markets.length > 0 ? Math.min(...markets) : null,
    failedMarkets: [],
    warnings: [],
  };
}

export function readCachedValuationSnapshot(stocks: Stock[]): ValuationSnapshot | null {
  const stored = readStored();
  return stored ? toSnapshot(stored, stocks) : null;
}

function requiredMarkets(stocks: Stock[]): ValuationMarket[] {
  const markets = new Set<ValuationMarket>();
  if (stocks.some((stock) => stock.exchange !== 'HK')) markets.add('CN');
  if (stocks.some((stock) => stock.exchange === 'HK')) markets.add('HK');
  return [...markets];
}

export async function fetchValuationSnapshot(
  stocks: Stock[],
  options: { force?: boolean; signal?: AbortSignal } = {}
): Promise<ValuationSnapshot> {
  const stored = readStored() ?? { version: 1 as const, byKey: {}, markets: {} };
  const now = Date.now();
  const staleMarkets = requiredMarkets(stocks).filter(
    (market) =>
      options.force ||
      typeof stored.markets[market] !== 'number' ||
      now - (stored.markets[market] as number) >= VALUATION_CACHE_TTL
  );

  if (staleMarkets.length === 0) return toSnapshot(stored, stocks);

  const cnStocks = staleMarkets.includes('CN')
    ? stocks.filter((stock) => stock.exchange !== 'HK')
    : [];
  const hkStocks = staleMarkets.includes('HK')
    ? stocks.filter((stock) => stock.exchange === 'HK')
    : [];
  const [cnResult, hkResult] = await Promise.allSettled([
    cnStocks.length > 0 ? fetchCnValuations(cnStocks, options.signal) : Promise.resolve(null),
    hkStocks.length > 0 ? fetchHkValuations(hkStocks, options.signal) : Promise.resolve(null),
  ]);

  const merged: StoredSnapshot = {
    version: 1,
    byKey: { ...stored.byKey },
    markets: { ...stored.markets },
  };
  const failedMarkets: ValuationMarket[] = [];
  const warnings: string[] = [];
  let changed = false;

  if (cnStocks.length > 0) {
    if (cnResult.status === 'fulfilled' && cnResult.value) {
      for (const valuation of cnResult.value.values) merged.byKey[valuation.key] = valuation;
      merged.markets.CN = now;
      warnings.push(...cnResult.value.warnings);
      changed = true;
    } else {
      failedMarkets.push('CN');
      if (cnResult.status === 'rejected') warnings.push(String(cnResult.reason));
    }
  }

  if (hkStocks.length > 0) {
    if (hkResult.status === 'fulfilled' && hkResult.value) {
      for (const valuation of hkResult.value.values) merged.byKey[valuation.key] = valuation;
      merged.markets.HK = now;
      warnings.push(...hkResult.value.warnings);
      changed = true;
    } else {
      failedMarkets.push('HK');
      if (hkResult.status === 'rejected') warnings.push(String(hkResult.reason));
    }
  }

  merged.byKey = filterForStocks(merged.byKey, stocks);
  if (changed) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(merged));
    } catch {
      // 估值缓存写满时忽略，内存中的快照仍可正常使用。
    }
  }

  const snapshot = toSnapshot(merged, stocks);
  return { ...snapshot, failedMarkets, warnings };
}
