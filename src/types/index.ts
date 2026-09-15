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
