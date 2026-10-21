import type { Stock } from '../types';

export interface BoardInfo {
  key: string;
  label: string;
  order: number;
}

export interface StockBoardGroup extends BoardInfo {
  stocks: Stock[];
}

export interface StockMarketGroup {
  key: string;
  label: string;
  order: number;
  count: number;
  boards: StockBoardGroup[];
}

const MARKET_INFO: Record<string, { label: string; order: number }> = {
  SH: { label: '上海', order: 1 },
  SZ: { label: '深圳', order: 2 },
  HK: { label: '港股', order: 3 },
  BJ: { label: '北京', order: 4 },
};

export function getBoardInfo(stock: Stock): BoardInfo {
  const { code, exchange } = stock;

  if (exchange === 'SH') {
    if (/^68[89]/.test(code)) return { key: 'star', label: '科创板', order: 2 };
    if (/^9/.test(code)) return { key: 'b-share', label: '沪市 B 股', order: 3 };
    return { key: 'main', label: '沪市主板', order: 1 };
  }

  if (exchange === 'SZ') {
    if (/^30[01]/.test(code)) return { key: 'chinext', label: '创业板', order: 2 };
    if (/^20/.test(code)) return { key: 'b-share', label: '深市 B 股', order: 3 };
    return { key: 'main', label: '深市主板', order: 1 };
  }

  if (exchange === 'BJ') {
    return { key: 'bse', label: '北交所', order: 1 };
  }

  if (exchange === 'HK') {
    if (/^08/.test(code)) return { key: 'gem', label: '港股 GEM', order: 2 };
    return { key: 'main', label: '港股主板', order: 1 };
  }

  return { key: 'other', label: '其他', order: 99 };
}

export function groupStocksByMarket(stocks: Stock[]): StockMarketGroup[] {
  const markets = new Map<string, Map<string, StockBoardGroup>>();

  for (const stock of stocks) {
    const board = getBoardInfo(stock);
    const boards = markets.get(stock.exchange) ?? new Map<string, StockBoardGroup>();
    const group = boards.get(board.key) ?? { ...board, stocks: [] };
    group.stocks.push(stock);
    boards.set(board.key, group);
    markets.set(stock.exchange, boards);
  }

  return [...markets.entries()]
    .map(([key, boards]) => {
      const market = MARKET_INFO[key] ?? { label: key || '其他', order: 99 };
      const boardGroups = [...boards.values()]
        .map((board) => ({
          ...board,
          stocks: board.stocks.sort((a, b) => a.code.localeCompare(b.code, 'zh-CN')),
        }))
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-CN'));
      return {
        key,
        label: market.label,
        order: market.order,
        count: boardGroups.reduce((sum, board) => sum + board.stocks.length, 0),
        boards: boardGroups,
      };
    })
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-CN'));
}
