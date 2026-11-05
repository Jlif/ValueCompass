import type { Stock } from '../../types';
import { normalizeCnValuation } from './normalize';
import { requestEastmoney } from './request';
import { fetchTencentValuations } from './tencent';
import type { RawValuationItem, ValuationMarketResult } from './types';

const FIELDS = 'f12,f13,f14,f9,f23,f20,f21,f100,f114,f115';
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

function secid(stock: Stock): string {
  return `${stock.exchange === 'SH' ? '1' : '0'}.${stock.code}`;
}

async function requestBatch(
  batch: Stock[],
  signal?: AbortSignal
): Promise<RawValuationItem[]> {
  const payload = await requestEastmoney<UlistResponse>(
    '/api/qt/ulist.np/get',
    {
      secids: batch.map(secid).join(','),
      ut: UT,
      fltt: '2',
      invt: '2',
      fields: FIELDS,
    },
    signal
  );
  const items = payload.data?.diff;
  if (!Array.isArray(items)) throw new Error('A 股估值响应格式异常');
  return items;
}

async function fetchEastmoneyCnValuations(
  stocks: Stock[],
  signal?: AbortSignal
): Promise<ValuationMarketResult> {
  const byCode = new Map(stocks.map((stock) => [stock.code, stock]));
  const updatedAt = Date.now();
  const values = new Map<string, ReturnType<typeof normalizeCnValuation>>();
  const results = await mapLimit(chunks(stocks, BATCH_SIZE), CONCURRENCY, (batch) =>
    requestBatch(batch, signal)
  );
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
      const valuation = normalizeCnValuation(item, stock, updatedAt);
      values.set(valuation.key, valuation);
    }
  }

  if (values.size === 0) {
    throw new Error('A 股估值快照为空');
  }
  return {
    values: [...values.values()],
    warnings: failedBatches > 0 ? [`A 股有 ${failedBatches} 个批次未更新`] : [],
  };
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
