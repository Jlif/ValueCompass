export type ValuationMarket = 'CN' | 'HK';
export type ValuationExchange = 'SH' | 'SZ' | 'BJ' | 'HK';
export type ValuationCurrency = 'CNY' | 'HKD';

export interface StockValuation {
  key: string;
  code: string;
  exchange: ValuationExchange;
  peTtm: number | null;
  peStatic: number | null;
  pb: number | null;
  // PB / PE 推算的 ROE（百分数）；不额外请求财报接口。
  roeTtm: number | null;
  marketCap: number | null;
  floatMarketCap: number | null;
  industry: string | null;
  currency: ValuationCurrency;
  updatedAt: number;
  source: 'eastmoney' | 'tencent';
}

export interface RawValuationItem {
  [field: string]: unknown;
}

export interface ValuationMarketResult {
  values: StockValuation[];
  warnings: string[];
}

export interface ValuationSnapshot {
  byKey: Record<string, StockValuation>;
  updatedAt: number | null;
  failedMarkets: ValuationMarket[];
  warnings: string[];
}
