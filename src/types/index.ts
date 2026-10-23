// 股票基础信息
export interface Stock {
  code: string;
  name: string;
  exchange: string;
}

// 股票笔记：按 stockKey（`code.exchange`）归属到单只股票
export interface StockNote {
  id: string;
  text: string;
  createdAt: number;
}

// K线数据
export interface KlineData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 自选分组：codes 存 stockKey（`code.exchange`），引用 watchlist 里的股票
export interface WatchGroup {
  id: string;
  name: string;
  codes: string[];
}

// Gist 同步状态
export type SyncState = 'off' | 'synced' | 'pulling' | 'pushing' | 'error';

// 实时行情（TickFlow，A 股和港股共用）
export interface StockQuote {
  symbol: string;
  name: string | null;
  lastPrice: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  changeAmount: number | null;
  changePct: number | null;
  amplitude: number | null;
  turnoverRate: number | null;
  timestamp: number;
}
