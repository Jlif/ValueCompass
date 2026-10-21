// 股票基础信息
export interface Stock {
  code: string;
  name: string;
  exchange: string;
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
