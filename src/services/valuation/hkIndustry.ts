import type { Stock } from '../../types';
import { getJson } from '../http';

const API = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';
const CACHE_KEY = 'vc_hk_industry_map_v1';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 500;
const CONCURRENCY = 4;

interface IndustryResponse {
  success?: boolean;
  message?: string;
  result?: {
    pages?: number;
    data?: Array<{
      SECURITY_CODE?: string;
      BELONG_INDUSTRY?: string;
    }>;
  } | null;
}

function readCache(): Record<string, string> | null {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw) as { ts?: number; map?: Record<string, string> };
    if (!cached.ts || !cached.map || Date.now() - cached.ts >= CACHE_TTL) return null;
    return cached.map;
  } catch {
    return null;
  }
}

async function fetchPage(page: number): Promise<IndustryResponse> {
  const url = new URL(API);
  url.searchParams.set('reportName', 'RPT_HKF10_INFO_ORGPROFILE');
  url.searchParams.set('columns', 'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,BELONG_INDUSTRY');
  url.searchParams.set('pageNumber', String(page));
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  url.searchParams.set('source', 'F10');
  url.searchParams.set('client', 'PC');
  return getJson(url.toString(), '东财港股行业接口');
}

async function fetchAllRows(): Promise<Array<{ SECURITY_CODE?: string; BELONG_INDUSTRY?: string }>> {
  const first = await fetchPage(1);
  if (first.success === false) throw new Error(first.message || '港股行业接口请求失败');
  const pages = Math.max(1, Number(first.result?.pages ?? 1));
  const rows = [...(first.result?.data ?? [])];
  let nextPage = 2;

  async function worker() {
    while (nextPage <= pages) {
      const page = nextPage;
      nextPage += 1;
      try {
        const response = await fetchPage(page);
        if (response.success === false || !response.result?.data) continue;
        rows.push(...response.result.data);
      } catch {
        // 单页失败时保留其他页面，避免整个行业筛选不可用。
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pages - 1) }, worker)
  );
  return rows;
}

export async function fetchHkIndustryMap(stocks: Stock[]): Promise<Record<string, string>> {
  const wanted = new Set(stocks.map((stock) => stock.code));
  const cached = readCache();
  if (cached) {
    const usable = Object.fromEntries(
      Object.entries(cached).filter(([code, industry]) => wanted.has(code) && industry)
    );
    if (Object.keys(usable).length >= wanted.size * 0.8) return usable;
  }

  const rows = await fetchAllRows();
  const map: Record<string, string> = {};
  for (const row of rows) {
    const code = row.SECURITY_CODE;
    const industry = row.BELONG_INDUSTRY?.trim();
    if (code && industry && wanted.has(code)) map[code] = industry;
  }
  if (Object.keys(map).length === 0) throw new Error('港股行业快照为空');

  const existing = readCache() ?? {};
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ts: Date.now(), map: { ...existing, ...map } })
    );
  } catch {
    // 行业缓存失败不影响本次筛选。
  }
  return map;
}
