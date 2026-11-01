import type { Stock } from '../../types';
import { normalizeHkValuation } from './normalize';
import { requestEastmoney } from './request';
import { fetchHkIndustryMap } from './hkIndustry';
import { fetchTencentValuations } from './tencent';
import type { RawValuationItem, ValuationMarketResult } from './types';

const FIELDS = 'f2,f9,f12,f14,f20,f21,f23,f100,f114,f115';
const BATCH_SIZE = 100;
const CONCURRENCY = 4;
const UT = 'bd1d9ddb04089700cf9c27f6f7426281';

interface UlistResponse {
  data?: {
    diff?: RawValuationItem[];
  } | null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index]) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function requestBatch(
  batch: Stock[],
  signal?: AbortSignal
): Promise<RawValuationItem[]> {
  const payload = await requestEastmoney<UlistResponse>(
    '/api/qt/ulist.np/get',
    {
      secids: batch.map((stock) => `116.${stock.code}`).join(','),
      ut: UT,
      fields: FIELDS,
    },
    signal
  );
  const items = payload.data?.diff;
  if (!Array.isArray(items)) throw new Error('港股估值响应格式异常');
  return items;
}

async function fetchEastmoneyHkValuations(
  stocks: Stock[],
  signal?: AbortSignal
): Promise<ValuationMarketResult> {
  const byCode = new Map(stocks.map((stock) => [stock.code, stock]));
  const batches = chunks(stocks, BATCH_SIZE);
  const updatedAt = Date.now();

  // 先用首批探活；东财不可用时立即降级，避免几十个批次同时重试。
  const firstItems = batches[0] ? await requestBatch(batches[0], signal) : [];
  const results = await mapLimit(batches.slice(1), CONCURRENCY, (batch) =>
    requestBatch(batch, signal)
  );

  const values = new Map<string, ReturnType<typeof normalizeHkValuation>>();
  for (const item of firstItems) {
    const stock = byCode.get(String(item.f12 ?? ''));
    if (!stock) continue;
    const valuation = normalizeHkValuation(item, stock, updatedAt);
    values.set(valuation.key, valuation);
  }
  let failedBatches = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      if (result.reason instanceof DOMException && result.reason.name === 'AbortError') throw result.reason;
      failedBatches += 1;
      continue;
    }
    for (const item of result.value) {
      const stock = byCode.get(String(item.f12 ?? ''));
      if (!stock) continue;
      const valuation = normalizeHkValuation(item, stock, updatedAt);
      values.set(valuation.key, valuation);
    }
  }

  if (values.size === 0) {
    throw new Error('港股估值快照为空');
  }
  return {
    values: [...values.values()],
    warnings: failedBatches > 0 ? [`港股有 ${failedBatches} 个批次未更新`] : [],
  };
}

export async function fetchHkValuations(
  stocks: Stock[],
  signal?: AbortSignal
): Promise<ValuationMarketResult> {
  let result: ValuationMarketResult;
  try {
    result = await fetchEastmoneyHkValuations(stocks, signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    result = await fetchTencentValuations(stocks, signal);
  }

  try {
    const industries = await fetchHkIndustryMap(stocks);
    result = {
      ...result,
      values: result.values.map((valuation) => ({
        ...valuation,
        industry: industries[valuation.code] ?? valuation.industry,
      })),
    };
  } catch {
    result = {
      ...result,
      warnings: ['港股行业分类暂不可用', ...result.warnings],
    };
  }
  return result;
}
