import type { Stock } from '../../types';
import { normalizeCnValuation } from './normalize';
import { requestEastmoney } from './request';
import { fetchTencentValuations } from './tencent';
import type { RawValuationItem, ValuationMarketResult } from './types';

const FIELDS = 'f12,f13,f14,f9,f23,f20,f21,f100,f114,f115';
const MARKET_FILTER = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

interface ClistResponse {
  data?: {
    total?: number;
    diff?: RawValuationItem[];
  } | null;
}

function inferExchange(item: RawValuationItem): Stock['exchange'] | null {
  const market = String(item.f13 ?? '');
  const code = String(item.f12 ?? '');
  if (/^[48]/.test(code) || /^92/.test(code)) return 'BJ';
  if (market === '1') return 'SH';
  if (market === '0') return 'SZ';
  if (/^6/.test(code)) return 'SH';
  if (/^[03]/.test(code)) return 'SZ';
  return null;
}

async function fetchEastmoneyCnValuations(
  stocks: Stock[],
  signal?: AbortSignal
): Promise<ValuationMarketResult> {
  const candidates = new Map<string, Stock[]>();
  for (const stock of stocks) {
    const list = candidates.get(stock.code) ?? [];
    list.push(stock);
    candidates.set(stock.code, list);
  }

  const updatedAt = Date.now();
  const values = new Map<string, ReturnType<typeof normalizeCnValuation>>();
  let total: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await requestEastmoney<ClistResponse>(
      '/api/qt/clist/get',
      {
        pn: String(page),
        pz: String(PAGE_SIZE),
        po: '1',
        np: '1',
        fltt: '2',
        invt: '2',
        fid: 'f3',
        fs: MARKET_FILTER,
        fields: FIELDS,
      },
      signal
    );
    const items = payload.data?.diff;
    if (!Array.isArray(items) || items.length === 0) break;
    if (total == null && Number.isFinite(Number(payload.data?.total))) {
      total = Number(payload.data?.total);
    }

    for (const item of items) {
      const code = String(item.f12 ?? '');
      const exchange = inferExchange(item);
      const matches = candidates.get(code) ?? [];
      const stock =
        matches.find((candidate) => candidate.exchange === exchange) ??
        (matches.length === 1 ? matches[0] : undefined);
      if (!stock) continue;
      const valuation = normalizeCnValuation(item, stock, updatedAt);
      values.set(valuation.key, valuation);
    }

    if (total != null && page * PAGE_SIZE >= total) break;
    if (total == null && items.length < PAGE_SIZE) break;
  }

  if (values.size === 0) {
    throw new Error('A 股估值快照为空');
  }
  return { values: [...values.values()], warnings: [] };
}

export async function fetchCnValuations(
  stocks: Stock[],
  signal?: AbortSignal
): Promise<ValuationMarketResult> {
  try {
    return await fetchEastmoneyCnValuations(stocks, signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return fetchTencentValuations(stocks, signal);
  }
}
