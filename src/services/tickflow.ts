import type { KlineData, Stock, StockQuote } from '../types';

// ponytail: API key 内置在客户端（本地个人应用），支持 localStorage 覆盖
const DEFAULT_API_KEY = 'tk_6dd2c6a6411c4c35846952ff2f02cd8f';
const BASE_URL = 'https://api.tickflow.org/v1';

function apiKey(): string {
  return localStorage.getItem('tickflow_api_key') || DEFAULT_API_KEY;
}

async function request<T>(
  path: string,
  params?: Record<string, string>,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const send = () =>
    fetch(url.toString(), {
      headers: { 'x-api-key': apiKey(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      method: body ? 'POST' : 'GET',
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  let res = await send();
  // klines 限频 10/min 触发 429 时，服务端 message 形如「…请 26446ms 后重试」，按提示等一次再试
  if (res.status === 429) {
    const text = await res.text().catch(() => '');
    // ponytail: 封顶 30s，超过就抛错让用户稍后手动重试
    const ms = Math.min(Number(text.match(/请 (\d+)ms 后重试/)?.[1] ?? 5000) + 500, 30500);
    await new Promise((r) => setTimeout(r, ms));
    res = await send();
  }
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
const STOCKS_CACHE_KEY = 'vc_stocks_cache_v3'; // v3: 新增港股
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
  const results = await Promise.allSettled(
    ['SH', 'SZ', 'BJ', 'HK'].map((ex) =>
      request<ExchangeInstruments>(`/exchanges/${ex}/instruments`, { type: 'stock' })
    )
  );
  const available = results
    .filter((r): r is PromiseFulfilledResult<ExchangeInstruments> => r.status === 'fulfilled')
    .map((r) => r.value);
  if (available.length === 0) {
    const firstError = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    throw firstError?.reason ?? new Error('股票列表加载失败');
  }
  const stocks = available.flatMap((r) => r.data.map(toStock));
  // 单个市场失败时仍展示可用数据，但不缓存残缺结果，下次启动会重新补齐。
  if (available.length === results.length) {
    localStorage.setItem(STOCKS_CACHE_KEY, JSON.stringify({ ts: Date.now(), stocks }));
  }
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

// 毫秒时间戳 -> YYYY-MM-DD（按标的所在市场取日期）
function tsToDate(ts: number, exchange: string): string {
  const timeZone = exchange === 'HK' ? 'Asia/Hong_Kong' : 'Asia/Shanghai';
  return new Date(ts).toLocaleDateString('sv-SE', { timeZone });
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
    date: tsToDate(ts, stock.exchange),
    open: data.open[i],
    high: data.high[i],
    low: data.low[i],
    close: data.close[i],
    volume: data.volume[i],
  }));
}

// ==================== 实时行情 ====================

interface QuoteResponse {
  symbol: string;
  last_price: number;
  prev_close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  timestamp: number;
  ext?: {
    name?: string | null;
    change_amount?: number | null;
    change_pct?: number | null;
    amplitude?: number | null;
    turnover_rate?: number | null;
  } | null;
}

export async function fetchQuote(stock: Stock, signal?: AbortSignal): Promise<StockQuote | null> {
  const { data } = await request<{ data: QuoteResponse[] }>(
    '/quotes',
    { symbols: `${stock.code}.${stock.exchange}` },
    undefined,
    signal
  );
  const quote = data[0];
  if (!quote) return null;
  return {
    symbol: quote.symbol,
    name: quote.ext?.name ?? null,
    lastPrice: quote.last_price,
    prevClose: quote.prev_close,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    volume: quote.volume,
    amount: quote.amount,
    changeAmount: quote.ext?.change_amount ?? null,
    changePct: quote.ext?.change_pct ?? null,
    amplitude: quote.ext?.amplitude ?? null,
    turnoverRate: quote.ext?.turnover_rate ?? null,
    timestamp: quote.timestamp,
  };
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
    lot_size?: number;
  };
}

export async function fetchInstrument(stock: Stock): Promise<Instrument> {
  const { data } = await request<{ data: Instrument[] }>('/instruments', {
    symbols: `${stock.code}.${stock.exchange}`,
  });
  return data[0];
}

// ponytail: SW 行业映射一次性全量拉取（1005 个池约 340KB），localStorage 缓存 7 天
const INDUSTRY_CACHE_KEY = 'vc_industry_map_v2';
const INDUSTRY_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

// 每只股票的申万行业（一/二/三级，去掉 SWx 前缀）
export interface IndustryInfo {
  sw1: string;
  sw2: string;
  sw3: string;
}

export async function fetchIndustryMap(): Promise<Record<string, IndustryInfo>> {
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
  const map: Record<string, IndustryInfo> = {};
  for (const [id, info] of Object.entries(details)) {
    // id 形如 CN_Equity_SW1_220000，name 形如 "SW1基础化工"
    const level = Number(id.split('_')[2].slice(2));
    const name = info.name.replace(/^SW\d/, '');
    for (const sym of info.symbols || []) {
      const item = (map[sym] = map[sym] || { sw1: '', sw2: '', sw3: '' });
      item[`sw${level}` as keyof IndustryInfo] = name;
    }
  }
  localStorage.setItem(INDUSTRY_CACHE_KEY, JSON.stringify({ ts: Date.now(), map }));
  return map;
}
