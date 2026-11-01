import type { Stock } from '../../types';
import { stockKey } from '../../utils/stockKey.ts';
import type { RawValuationItem, StockValuation, ValuationExchange } from './types';

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/,/g, '');
  if (!text || text === '-' || text === '--') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function ratio(value: unknown, divisor = 1): number | null {
  const parsed = numberOrNull(value);
  return parsed == null ? null : parsed / divisor;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return !text || text === '-' || text === '--' ? null : text;
}

export function deriveRoe(pb: number | null, pe: number | null): number | null {
  if (pb == null || pe == null || pb <= 0 || pe <= 0) return null;
  if (!Number.isFinite(pb) || !Number.isFinite(pe)) return null;
  return (pb / pe) * 100;
}

function baseValuation(
  stock: Stock,
  exchange: ValuationExchange,
  currency: StockValuation['currency'],
  updatedAt: number,
  source: StockValuation['source']
): Omit<StockValuation, 'peTtm' | 'peStatic' | 'pb' | 'roeTtm' | 'marketCap' | 'floatMarketCap' | 'industry'> {
  return {
    key: stockKey(stock),
    code: stock.code,
    exchange,
    currency,
    updatedAt,
    source,
  };
}

// A 股列表接口使用 fltt=2，比率字段已是普通小数。
export function normalizeCnValuation(
  item: RawValuationItem,
  stock: Stock,
  updatedAt = Date.now()
): StockValuation {
  const peTtm = ratio(item.f115) ?? ratio(item.f9);
  const peStatic = ratio(item.f114);
  const pb = ratio(item.f23);
  return {
    ...baseValuation(stock, stock.exchange as ValuationExchange, 'CNY', updatedAt, 'eastmoney'),
    peTtm,
    peStatic,
    pb,
    roeTtm: deriveRoe(pb, peTtm),
    marketCap: numberOrNull(item.f20),
    floatMarketCap: numberOrNull(item.f21),
    industry: textOrNull(item.f100),
  };
}

// 港股 ulist 接口的 PE/PB 为放大 100 倍后的值，市值本身已是港币元。
export function normalizeHkValuation(
  item: RawValuationItem,
  stock: Stock,
  updatedAt = Date.now()
): StockValuation {
  const peTtm = ratio(item.f115, 100) ?? ratio(item.f9, 100);
  const peStatic = ratio(item.f114, 100);
  const pb = ratio(item.f23, 100);
  return {
    ...baseValuation(stock, 'HK', 'HKD', updatedAt, 'eastmoney'),
    peTtm,
    peStatic,
    pb,
    roeTtm: deriveRoe(pb, peTtm),
    marketCap: numberOrNull(item.f20),
    floatMarketCap: numberOrNull(item.f21),
    industry: textOrNull(item.f100),
  };
}

// 腾讯行情：A 股 PE/PB 在 39/46，港股 PB 在 58；44/45 为流通/总市值（亿元）。
export function normalizeTencentValuation(
  fields: string[],
  stock: Stock,
  updatedAt = Date.now()
): StockValuation {
  const isHk = stock.exchange === 'HK';
  const marketCapYi = numberOrNull(fields[45]);
  const floatMarketCapYi = numberOrNull(fields[44]);
  const peTtm = numberOrNull(fields[39]);
  const pb = numberOrNull(fields[isHk ? 58 : 46]);
  return {
    ...baseValuation(
      stock,
      stock.exchange as ValuationExchange,
      isHk ? 'HKD' : 'CNY',
      updatedAt,
      'tencent'
    ),
    peTtm,
    peStatic: null,
    pb,
    roeTtm: deriveRoe(pb, peTtm),
    marketCap: marketCapYi == null ? null : marketCapYi * 1e8,
    floatMarketCap: floatMarketCapYi == null ? null : floatMarketCapYi * 1e8,
    industry: null,
  };
}
