import type { Stock } from '../types';
import type { IndustryInfo } from './tickflow';
import { getBoardInfo } from '../utils/markets.ts';
import { stockKey } from '../utils/stockKey.ts';
import type { StockValuation } from './valuation/types';

export type StockMarketFilter = 'ALL' | 'CN' | 'HK';

export interface StockFilters {
  market: StockMarketFilter;
  industry: string;
  peMin: number | null;
  peMax: number | null;
  pbMin: number | null;
  pbMax: number | null;
  roeMin: number | null;
  roeMax: number | null;
  marketCapMin: number | null;
  marketCapMax: number | null;
  hideST: boolean;
  hideDelisted: boolean;
  keyword: string;
}

export const DEFAULT_STOCK_FILTERS: StockFilters = {
  market: 'ALL',
  industry: '',
  peMin: null,
  peMax: null,
  pbMin: null,
  pbMax: null,
  roeMin: null,
  roeMax: null,
  marketCapMin: null,
  marketCapMax: null,
  hideST: true,
  hideDelisted: true,
  keyword: '',
};

function matchesRange(
  value: number | null | undefined,
  min: number | null,
  max: number | null
): boolean {
  if (min == null && max == null) return true;
  if (value == null || !Number.isFinite(value)) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

function matchesIndustry(
  stock: Stock,
  filters: StockFilters,
  industryMap: Record<string, IndustryInfo>,
  valuation: StockValuation | undefined
): boolean {
  if (!filters.industry) return true;
  if (filters.industry.startsWith('sw')) {
    const [level, name] = filters.industry.split(':');
    return industryMap[stockKey(stock)]?.[level as keyof IndustryInfo] === name;
  }
  if (filters.industry.startsWith('hk:')) {
    return valuation?.industry === filters.industry.slice(3);
  }
  return true;
}

export function filterStocks(
  stocks: Stock[],
  valuations: Record<string, StockValuation>,
  industryMap: Record<string, IndustryInfo>,
  filters: StockFilters
): Stock[] {
  const keyword = filters.keyword.trim();
  return stocks.filter((stock) => {
    if (filters.market === 'CN' && stock.exchange === 'HK') return false;
    if (filters.market === 'HK' && stock.exchange !== 'HK') return false;
    if (filters.hideST && stock.name.includes('ST')) return false;
    if (filters.hideDelisted && stock.delisted) return false;
    if (
      keyword &&
      !stock.code.includes(keyword) &&
      !stock.name.includes(keyword) &&
      !getBoardInfo(stock).label.includes(keyword)
    ) {
      return false;
    }

    const valuation = valuations[stockKey(stock)];
    if (!matchesIndustry(stock, filters, industryMap, valuation)) return false;
    if (!matchesRange(valuation?.peTtm, filters.peMin, filters.peMax)) return false;
    if (!matchesRange(valuation?.pb, filters.pbMin, filters.pbMax)) return false;
    if (!matchesRange(valuation?.roeTtm, filters.roeMin, filters.roeMax)) return false;
    const marketCapYi =
      valuation?.marketCap == null ? null : valuation.marketCap / 1e8;
    return matchesRange(marketCapYi, filters.marketCapMin, filters.marketCapMax);
  });
}
