import type { S3ConnectionConfig, Stock, WatchGroup } from '../types';
import { normalizeGroupCodes, stockKey } from '../utils/stockKey.ts';
import {
  getNotesObject,
  putNotesObject,
  withObjectKey,
} from './s3.ts';

export const WATCHLIST_SYNC_UPDATED_KEY = 'vc_watchlist_updated';

export interface WatchlistSyncSnapshot {
  schemaVersion: 2;
  updatedAt: number;
  stocks: Stock[];
  groups: WatchGroup[];
}

function normalizeStocks(value: unknown): Stock[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.code !== 'string' ||
      typeof raw.name !== 'string' ||
      typeof raw.exchange !== 'string'
    ) {
      return [];
    }
    const stock: Stock = {
      code: raw.code.trim(),
      name: raw.name.trim(),
      exchange: raw.exchange.trim().toUpperCase(),
    };
    if (!stock.code || !stock.name || !stock.exchange) return [];
    const key = stockKey(stock);
    if (seen.has(key)) return [];
    seen.add(key);
    return [stock];
  });
}

export function createWatchlistSyncSnapshot(
  stocks: Stock[],
  groups: WatchGroup[],
  updatedAt = Date.now()
): WatchlistSyncSnapshot {
  return {
    schemaVersion: 2,
    updatedAt,
    stocks,
    groups: normalizeGroupCodes(groups, stocks),
  };
}

export function normalizeWatchlistSnapshot(value: unknown): WatchlistSyncSnapshot {
  if (!value || typeof value !== 'object') throw new Error('自选同步文件结构无效');
  const raw = value as Record<string, unknown>;
  const stocks = normalizeStocks(raw.stocks);
  const groups = Array.isArray(raw.groups)
    ? normalizeGroupCodes(raw.groups as WatchGroup[], stocks)
    : [];
  const updatedAt = Number(raw.updatedAt ?? raw.updated);
  return {
    schemaVersion: 2,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    stocks,
    groups,
  };
}

export function parseWatchlistSnapshot(text: string): WatchlistSyncSnapshot {
  try {
    return normalizeWatchlistSnapshot(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('自选同步文件不是有效 JSON');
    throw error;
  }
}

export async function readWatchlistSnapshot(
  config: S3ConnectionConfig,
  objectKey: string
): Promise<{ snapshot: WatchlistSyncSnapshot | null; etag: string | null }> {
  const object = await getNotesObject(withObjectKey(config, objectKey));
  return {
    snapshot: object ? parseWatchlistSnapshot(object.text) : null,
    etag: object?.etag ?? null,
  };
}

export async function writeWatchlistSnapshot(
  config: S3ConnectionConfig,
  objectKey: string,
  snapshot: WatchlistSyncSnapshot,
  etag?: string | null
): Promise<void> {
  await putNotesObject(withObjectKey(config, objectKey), JSON.stringify(snapshot), etag);
}
