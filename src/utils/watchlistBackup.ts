import type { Stock, WatchGroup } from '../types';
import { normalizeGroupCodes, stockKey } from './stockKey.ts';

export type BackupGroup = WatchGroup;

export interface WatchlistBackup {
  format: 'valuecompass-watchlist';
  version: 2; // v2: 分组 codes 使用 code.exchange，导入 v1 时自动迁移
  exportedAt: string;
  watchlist: Stock[];
  groups: BackupGroup[];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// 文件名时间戳：YYYYMMDD-HHmmss，精确到秒。
export function timestampForFilename(date = new Date()): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

export function createWatchlistBackup(watchlist: Stock[], groups: BackupGroup[]): string {
  const backup: WatchlistBackup = {
    format: 'valuecompass-watchlist',
    version: 2,
    exportedAt: new Date().toISOString(),
    watchlist,
    groups,
  };
  return JSON.stringify(backup, null, 2);
}

function cleanStocks(value: unknown): Stock[] {
  if (!Array.isArray(value)) throw new Error('JSON 缺少自选股票列表');
  const seen = new Set<string>();
  const stocks: Stock[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.code !== 'string' ||
      typeof row.name !== 'string' ||
      typeof row.exchange !== 'string'
    ) {
      continue;
    }
    const stock = {
      code: row.code.trim(),
      name: row.name.trim(),
      exchange: row.exchange.trim().toUpperCase(),
    };
    if (!stock.code || !stock.name || !stock.exchange) continue;
    const key = stockKey(stock);
    if (seen.has(key)) continue;
    seen.add(key);
    stocks.push(stock);
  }
  return stocks;
}

function cleanGroups(value: unknown): BackupGroup[] {
  if (!Array.isArray(value)) throw new Error('JSON 缺少自选分组');
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== 'string' ||
      typeof row.name !== 'string' ||
      !Array.isArray(row.codes)
    ) {
      return [];
    }
    const id = row.id.trim();
    const name = row.name.trim();
    if (!id || !name) return [];
    return [{
      id,
      name,
      codes: [...new Set(row.codes.filter((code): code is string => typeof code === 'string'))],
    }];
  });
}

export function parseWatchlistBackup(text: string): { watchlist: Stock[]; groups: BackupGroup[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('JSON 结构无效');

  const root = parsed as Record<string, unknown>;
  // 同时兼容本应用导出格式和 GitHub Gist 同步文件中的 stocks 字段。
  const stockValue = root.watchlist ?? root.stocks;
  const watchlist = cleanStocks(stockValue);
  return {
    watchlist,
    // 旧备份的分组 code 没有交易所后缀，按导入的自选列表补全
    groups: normalizeGroupCodes(cleanGroups(root.groups), watchlist),
  };
}
