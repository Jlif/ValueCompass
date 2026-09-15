import type { KlineData, Stock } from '../types';

// ponytail: API key 内置在客户端（本地个人应用），支持 localStorage 覆盖
const DEFAULT_API_KEY = 'tk_6dd2c6a6411c4c35846952ff2f02cd8f';
const BASE_URL = 'https://api.tickflow.org/v1';

function apiKey(): string {
  return localStorage.getItem('tickflow_api_key') || DEFAULT_API_KEY;
}

async function request<T>(path: string, params?: Record<string, string>, body?: unknown): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { 'x-api-key': apiKey(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TickFlow ${res.status}: ${body || res.statusText}`);
  }
  // ponytail: 各端点包裹层不一致（klines 有 {"data":...}，exchanges 顶层即数据），返回原始 JSON 由调用方取
  return res.json();
}

// ==================== 股票列表 ====================

// 交易所标的列表响应
interface ExchangeInstruments {
  exchange: string;
  count: number;
  data: Array<{
    symbol: string;
    exchange: string;
    code: string;
    name: string;
    type: string;
  }>;
}

function toStock(item: ExchangeInstruments['data'][number]): Stock {
  return {
    code: item.code,
    // 名称里的空格是数据源对齐填充的（如"万 科A"），清洗掉
    name: item.name.replace(/\s+/g, ''),
    exchange: item.exchange,
  };
}

// ponytail: 全量列表缓存在 localStorage，1 小时过期，避免每次启动拉 5000+ 条
const STOCKS_CACHE_KEY = 'vc_stocks_cache_v2'; // v2: 名称已清洗空格
const STOCKS_CACHE_TTL = 60 * 60 * 1000;

export async function fetchStockList(): Promise<Stock[]> {
  const cached = localStorage.getItem(STOCKS_CACHE_KEY);
  if (cached) {
    try {
      const { ts, stocks } = JSON.parse(cached);
      if (Date.now() - ts < STOCKS_CACHE_TTL && stocks?.length) return stocks;
    } catch {
      // 缓存损坏则重新拉取
    }
  }
  const results = await Promise.all(
    ['SH', 'SZ', 'BJ'].map((ex) =>
      request<ExchangeInstruments>(`/exchanges/${ex}/instruments`, { type: 'stock' })
    )
  );
  const stocks = results.flatMap((r) => r.data.map(toStock));
  localStorage.setItem(STOCKS_CACHE_KEY, JSON.stringify({ ts: Date.now(), stocks }));
  return stocks;
}

export function clearStockListCache(): void {
  localStorage.removeItem(STOCKS_CACHE_KEY);
}

// ==================== K 线 ====================

// 列式 K 线响应
interface KlinesResponse {
  timestamp: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export type KlinePeriod = 'daily' | 'weekly' | 'monthly';

const PERIOD_MAP: Record<KlinePeriod, string> = {
  daily: '1d',
  weekly: '1w',
  monthly: '1M',
};

// 毫秒时间戳 -> YYYY-MM-DD（按北京时间取日期）
function tsToDate(ts: number): string {
  return new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

export async function fetchKline(
  stock: Stock,
  period: KlinePeriod = 'daily',
  count = 500
): Promise<KlineData[]> {
  const { data } = await request<{ data: KlinesResponse }>('/klines', {
    symbol: `${stock.code}.${stock.exchange}`,
    period: PERIOD_MAP[period],
    count: String(count),
    adjust: 'forward',
  });
  return data.timestamp.map((ts, i) => ({
    date: tsToDate(ts),
    open: data.open[i],
    high: data.high[i],
    low: data.low[i],
    close: data.close[i],
    volume: data.volume[i],
  }));
}

// ==================== F10 资料 ====================

// 标的元数据（含上市日期、股本等 ext 信息）
export interface Instrument {
  symbol: string;
  code: string;
  name: string;
  exchange: string;
  type: string;
  ext: {
    listing_date?: string;
    total_shares?: number;
    float_shares?: number;
  };
}

export async function fetchInstrument(stock: Stock): Promise<Instrument> {
  const { data } = await request<{ data: Instrument[] }>('/instruments', {
    symbols: `${stock.code}.${stock.exchange}`,
  });
  return data[0];
}

// ponytail: SW 行业映射一次性全量拉取（1005 个池约 340KB），localStorage 缓存 7 天
const INDUSTRY_CACHE_KEY = 'vc_industry_map';
const INDUSTRY_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

export async function fetchIndustryMap(): Promise<Record<string, string>> {
  const cached = localStorage.getItem(INDUSTRY_CACHE_KEY);
  if (cached) {
    try {
      const { ts, map } = JSON.parse(cached);
      if (Date.now() - ts < INDUSTRY_CACHE_TTL) return map;
    } catch {
      // 缓存损坏则重新拉取
    }
  }
  const { data: universes } = await request<{ data: Array<{ id: string }> }>('/universes');
  const swIds = universes.map((u) => u.id).filter((id) => id.startsWith('CN_Equity_SW'));
  const { data: details } = await request<{ data: Record<string, { name: string; symbols: string[] }> }>(
    '/universes/batch',
    undefined,
    { ids: swIds }
  );
  // 构建 symbol -> 行业名，SW3（最细）优先
  const level = (id: string) => Number(id.split('_')[2].slice(2));
  const map: Record<string, string> = {};
  for (const [id, info] of Object.entries(details)) {
    for (const sym of info.symbols || []) {
      if (!map[sym] || level(id) > levelFromKey(map[sym])) {
        map[sym] = info.name;
      }
    }
  }
  localStorage.setItem(INDUSTRY_CACHE_KEY, JSON.stringify({ ts: Date.now(), map }));
  return map;
}

function levelFromKey(name: string): number {
  return name.startsWith('SW3') ? 3 : name.startsWith('SW2') ? 2 : 1;
}
