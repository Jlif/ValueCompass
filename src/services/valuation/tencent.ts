import type { Stock } from '../../types';
import { normalizeTencentValuation } from './normalize';
import { requestTencent } from './request';
import type { ValuationMarketResult } from './types';

const BATCH_SIZE = 100;
const CONCURRENCY = 5;

function prefix(stock: Stock): string {
  if (stock.exchange === 'HK') return 'hk';
  if (stock.exchange === 'SH') return 'sh';
  if (stock.exchange === 'BJ') return 'bj';
  return 'sz';
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function parseResponse(text: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const pattern = /v_[a-z]{2}(\d+)="([^"]*)"/g;
  for (const match of text.matchAll(pattern)) {
    result.set(match[1], match[2].split('~'));
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

export async function fetchTencentValuations(
  stocks: Stock[],
  signal?: AbortSignal
): Promise<ValuationMarketResult> {
  const updatedAt = Date.now();
  const results = await mapLimit(chunks(stocks, BATCH_SIZE), CONCURRENCY, (batch) =>
    requestTencent(batch.map((stock) => `${prefix(stock)}${stock.code}`), signal)
  );

  const values = new Map<string, ReturnType<typeof normalizeTencentValuation>>();
  let failedBatches = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      if (result.reason instanceof DOMException && result.reason.name === 'AbortError') throw result.reason;
      failedBatches += 1;
      continue;
    }
    const parsed = parseResponse(result.value);
    for (const stock of stocks) {
      const fields = parsed.get(stock.code);
      if (!fields) continue;
      const valuation = normalizeTencentValuation(fields, stock, updatedAt);
      values.set(valuation.key, valuation);
    }
  }

  if (values.size === 0) throw new Error('腾讯估值快照为空');
  return {
    values: [...values.values()],
    warnings: failedBatches > 0 ? [`腾讯行情有 ${failedBatches} 个批次未更新`] : [],
  };
}
