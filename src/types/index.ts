// 股票基础信息
export interface Stock {
  code: string;
  name: string;
  exchange: string;
}

// 股票笔记：按 stockKey（`code.exchange`）归属到单只股票
// deletedAt 非空表示墓碑，保留到远端合并完成，避免旧设备把已删笔记带回来
export interface StockNote {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

// 笔记同步：S3 兼容对象存储（阿里云 OSS / 腾讯云 COS / 自定义）
export type S3Provider = 'aliyun' | 'tencent' | 'custom';

export interface NotesSyncConfig {
  provider: S3Provider;
  endpoint: string;
  region: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  conditionalWrites: boolean;
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
