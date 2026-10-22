import type { Stock, WatchGroup } from '../types';

// 股票主键：`code.exchange`（如 600519.SH / 00700.HK）。
// 自选与分组统一用它，避免 A 股/港股同代码互相污染。
export function stockKey(stock: Pick<Stock, 'code' | 'exchange'>): string {
  return `${stock.code}.${stock.exchange}`;
}

// 兼容旧版只存 code 的分组/备份：按当前自选列表补上交易所，已有 key 原样保留。
export function normalizeGroupCodes(groups: WatchGroup[], stocks: Stock[]): WatchGroup[] {
  if (!Array.isArray(groups)) return [];
  const byCode = new Map<string, string>();
  for (const stock of stocks) {
    if (!byCode.has(stock.code)) byCode.set(stock.code, stockKey(stock));
  }
  return groups.flatMap((group) => {
    if (!group || typeof group.id !== 'string' || !Array.isArray(group.codes)) return [];
    return [{
      ...group,
      codes: [
        ...new Set(
          group.codes
            .filter((code): code is string => typeof code === 'string')
            .map((code) => (code.includes('.') ? code : byCode.get(code) ?? code))
        ),
      ],
    }];
  });
}
