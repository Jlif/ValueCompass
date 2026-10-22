import { useMemo, useState } from 'react';
import type { Stock, WatchGroup } from '../types';
import type { IndustryInfo } from '../services/tickflow';
import { stockKey } from '../utils/stockKey';
import { getBoardInfo, groupStocksByMarket } from '../utils/markets';
import { GroupManager } from './GroupManager';
import { IndustrySelect } from './IndustrySelect';
import { StockGroupMenu } from './StockGroupMenu';

// 自选 tab 内拖拽股票时的载体（HTML5 DnD 只能存 string）
const DRAG_MIME = 'application/x-vc-stock';

type Tab = 'all' | 'watchlist';
type Market = 'ALL' | 'CN' | 'HK';

interface Props {
  stocks: Stock[];
  industryMap: Record<string, IndustryInfo>;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;

  watchlist: Stock[];
  groups: WatchGroup[];
  watchlistKeys: Set<string>;
  selectedStock: Stock | null;
  onSelectStock: (stock: Stock) => void;

  onAddToWatchlist: (stock: Stock) => void;
  onRemoveFromWatchlist: (key: string) => void;
  onAddToGroup: (groupId: string, key: string) => void;
  onRemoveFromGroup: (groupId: string, key: string) => void;
  onCreateGroup: (name: string) => void;
  onRemoveGroup: (id: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onMoveGroup: (fromId: string, toId: string) => void;
}

export function Sidebar({
  stocks,
  industryMap,
  loading,
  error,
  refreshing,
  onRefresh,
  watchlist,
  groups,
  watchlistKeys,
  selectedStock,
  onSelectStock,
  onAddToWatchlist,
  onRemoveFromWatchlist,
  onAddToGroup,
  onRemoveFromGroup,
  onCreateGroup,
  onRemoveGroup,
  onRenameGroup,
  onMoveGroup,
}: Props) {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [industryFilter, setIndustryFilter] = useState('');
  const [marketFilter, setMarketFilter] = useState<Market>('ALL');
  const [hideST, setHideST] = useState(true);
  const [expandedMarkets, setExpandedMarkets] = useState<Set<string>>(() => new Set());
  const [expandedBoards, setExpandedBoards] = useState<Set<string>>(() => new Set());
  // 自选分组：null = 全部；newGroupName 为 null 关闭输入，'' 打开空输入
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  // 展示的股票列表：搜索 + 行业 + ST 过滤（前端本地过滤，列表已在内存中）
  const displayStocks = useMemo(() => {
    const kw = searchKeyword.trim();
    // industryFilter 格式 'sw1:食品饮料' / 'sw2:饮料乳品' / 'sw3:乳品'
    const [level, name] = industryFilter ? industryFilter.split(':') : [];
    return stocks.filter((s) => {
      if (marketFilter === 'CN' && s.exchange === 'HK') return false;
      if (marketFilter === 'HK' && s.exchange !== 'HK') return false;
      if (kw && !s.code.includes(kw) && !s.name.includes(kw) && !getBoardInfo(s).label.includes(kw)) return false;
      if (hideST && s.name.includes('ST')) return false;
      if (level && industryMap[`${s.code}.${s.exchange}`]?.[level as keyof IndustryInfo] !== name) return false;
      return true;
    });
  }, [stocks, searchKeyword, hideST, industryFilter, industryMap, marketFilter]);

  const marketGroups = useMemo(() => groupStocksByMarket(displayStocks), [displayStocks]);
  const forceExpandGroups = searchKeyword.trim().length > 0 || industryFilter.length > 0;

  const toggleMarket = (key: string) => {
    setExpandedMarkets((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleBoard = (key: string) => {
    setExpandedBoards((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 行业层级树：sw1 -> sw2 -> [sw3]
  const industryTree = useMemo(() => {
    const tree: Record<string, Record<string, Set<string>>> = {};
    for (const info of Object.values(industryMap)) {
      if (!info.sw1) continue;
      const l1 = (tree[info.sw1] = tree[info.sw1] || {});
      if (info.sw2) {
        const l2 = (l1[info.sw2] = l1[info.sw2] || new Set());
        if (info.sw3) l2.add(info.sw3);
      }
    }
    return tree;
  }, [industryMap]);

  // 自选 tab 当前显示的列表：分组视图按分组 keys 顺序映射回 Stock（孤儿 key 剔除）
  const groupStocks = useMemo(() => {
    if (!activeGroup) return watchlist;
    const group = groups.find((item) => item.id === activeGroup);
    if (!group) return watchlist;
    const byKey = new Map(watchlist.map((stock) => [stockKey(stock), stock]));
    return group.codes.map((key) => byKey.get(key)).filter((stock): stock is Stock => !!stock);
  }, [activeGroup, groups, watchlist]);

  // 删掉当前正在看的分组要退回「全部」（chip 上的 × 和管理面板共用）
  const handleRemoveGroup = (id: string) => {
    onRemoveGroup(id);
    if (activeGroup === id) setActiveGroup(null);
  };

  const toggleWatchlist = (stock: Stock, e: React.MouseEvent) => {
    e.stopPropagation();
    const key = stockKey(stock);
    if (watchlistKeys.has(key)) onRemoveFromWatchlist(key);
    else onAddToWatchlist(stock);
  };

  return (
    <div className="sidebar">
      <div className="toolbar">
        <div className="search-box">
          <input
            type="text"
            placeholder="搜索股票代码或名称..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
          />
          <button onClick={onRefresh} disabled={refreshing}>
            {refreshing ? '刷新中...' : '刷新列表'}
          </button>
        </div>
        <div className="market-filter" aria-label="市场筛选">
          {([
            ['ALL', '全部市场'],
            ['CN', 'A股'],
            ['HK', '港股'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              className={marketFilter === value ? 'active' : ''}
              onClick={() => {
                setMarketFilter(value);
                if (value === 'HK') setIndustryFilter('');
                if (value === 'HK') setExpandedMarkets(new Set(['HK']));
                else if (value === 'CN') setExpandedMarkets(new Set(['SH', 'SZ', 'BJ']));
                else setExpandedMarkets(new Set());
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="filter-bar">
          <IndustrySelect tree={industryTree} value={industryFilter} onChange={setIndustryFilter} />
          <label className="filter-check">
            <input type="checkbox" checked={hideST} onChange={(e) => setHideST(e.target.checked)} />
            隐藏 ST
          </label>
        </div>
      </div>

      <div className="tab-bar">
        <button
          className={`tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          全部股票 ({displayStocks.length})
        </button>
        <button
          className={`tab ${activeTab === 'watchlist' ? 'active' : ''}`}
          onClick={() => setActiveTab('watchlist')}
        >
          自选 ({watchlist.length})
        </button>
      </div>

      {activeTab === 'watchlist' && (
        <div className="group-bar">
          <button
            className={`group-chip ${activeGroup === null ? 'active' : ''}`}
            onClick={() => setActiveGroup(null)}
          >
            全部
          </button>
          {groups.map((group) => (
            <button
              key={group.id}
              className={`group-chip ${activeGroup === group.id ? 'active' : ''} ${dragOverGroup === group.id ? 'drag-over' : ''}`}
              onClick={() => setActiveGroup(group.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverGroup(group.id);
              }}
              onDragLeave={() => setDragOverGroup(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverGroup(null);
                const key = e.dataTransfer.getData(DRAG_MIME);
                if (key) onAddToGroup(group.id, key);
              }}
            >
              {group.name}
              <span className="group-count">
                {group.codes.filter((key) => watchlistKeys.has(key)).length}
              </span>
            </button>
          ))}
          {newGroupName === null ? (
            <button className="group-add" title="新建分组" onClick={() => setNewGroupName('')}>
              +
            </button>
          ) : (
            <input
              className="group-input"
              autoFocus
              placeholder="分组名，回车确认"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onBlur={() => setNewGroupName(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newGroupName.trim()) {
                  onCreateGroup(newGroupName.trim());
                  setNewGroupName(null);
                } else if (e.key === 'Escape') {
                  setNewGroupName(null);
                }
              }}
            />
          )}
          <GroupManager
            groups={groups}
            watchlistKeys={watchlistKeys}
            createGroup={onCreateGroup}
            renameGroup={onRenameGroup}
            removeGroup={handleRemoveGroup}
            moveGroup={onMoveGroup}
          />
        </div>
      )}

      <div className="stock-list">
        {error && <div className="error">错误: {error}</div>}
        {activeTab === 'all' ? (
          <>
            {loading && <div className="empty">加载中...</div>}
            {!loading && displayStocks.length === 0 && (
              <div className="empty">暂无股票数据，请点击"刷新列表"</div>
            )}
            <div className="market-tree">
              {marketGroups.map((market) => {
                const marketOpen = forceExpandGroups || expandedMarkets.has(market.key);
                return (
                  <section key={market.key} className="market-group">
                    <button
                      className={`market-group-header ${marketOpen ? 'open' : ''}`}
                      onClick={() => toggleMarket(market.key)}
                      aria-expanded={marketOpen}
                    >
                      <span className="tree-caret">{marketOpen ? '▾' : '▸'}</span>
                      <span className="market-group-name">{market.label}</span>
                      <span className="tree-count">{market.count}</span>
                    </button>
                    {marketOpen && market.boards.map((board) => {
                      const boardKey = `${market.key}:${board.key}`;
                      const boardOpen = forceExpandGroups || expandedBoards.has(boardKey);
                      return (
                        <div key={board.key} className="board-group">
                          <button
                            className={`board-group-header ${boardOpen ? 'open' : ''}`}
                            onClick={() => toggleBoard(boardKey)}
                            aria-expanded={boardOpen}
                          >
                            <span className="tree-caret">{boardOpen ? '▾' : '▸'}</span>
                            <span>{board.label}</span>
                            <span className="tree-count">{board.stocks.length}</span>
                          </button>
                          {boardOpen && board.stocks.map((stock) => {
                            const key = stockKey(stock);
                            const active = selectedStock?.code === stock.code && selectedStock?.exchange === stock.exchange;
                            return (
                              <div
                                key={key}
                                className={`stock-item ${active ? 'active' : ''}`}
                                onClick={() => onSelectStock(stock)}
                              >
                                <div className="stock-identity">
                                  <span className="stock-name">{stock.name}</span>
                                  <div className="stock-meta">
                                    <span className="stock-code">{stock.code}</span>
                                    <span className="stock-board">{board.label}</span>
                                  </div>
                                </div>
                                <span className={`stock-exchange ${stock.exchange === 'HK' ? 'hk' : ''}`}>{stock.exchange}</span>
                                <StockGroupMenu
                                  stock={stock}
                                  groups={groups}
                                  inWatchlist={watchlistKeys.has(key)}
                                  addToWatchlist={onAddToWatchlist}
                                  addToGroup={onAddToGroup}
                                />
                                <button
                                  className={`watchlist-btn ${watchlistKeys.has(key) ? 'in-watchlist' : ''}`}
                                  onClick={(e) => toggleWatchlist(stock, e)}
                                  title={watchlistKeys.has(key) ? '移除自选' : '添加自选'}
                                >
                                  {watchlistKeys.has(key) ? '★' : '☆'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </>
        ) : (
          <>
            {groupStocks.length === 0 && (
              <div className="empty">
                {activeGroup ? '分组为空，把股票拖到分组名上即可加入' : '暂无自选股票，在"全部股票"中添加'}
              </div>
            )}
            {groupStocks.map((stock) => {
              const key = stockKey(stock);
              const active = selectedStock?.code === stock.code && selectedStock?.exchange === stock.exchange;
              return (
                <div
                  key={key}
                  className={`stock-item ${active ? 'active' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, key);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onSelectStock(stock)}
                >
                  <div className="stock-identity">
                    <span className="stock-name">{stock.name}</span>
                    <div className="stock-meta">
                      <span className="stock-code">{stock.code}</span>
                      <span className="stock-board">{getBoardInfo(stock).label}</span>
                    </div>
                  </div>
                  <span className={`stock-exchange ${stock.exchange === 'HK' ? 'hk' : ''}`}>{stock.exchange}</span>
                  {activeGroup && (
                    <button
                      className="group-remove-btn"
                      title="移出该分组"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveFromGroup(activeGroup, key);
                      }}
                    >
                      ✕
                    </button>
                  )}
                  <StockGroupMenu
                    stock={stock}
                    groups={groups}
                    inWatchlist={watchlistKeys.has(key)}
                    addToWatchlist={onAddToWatchlist}
                    addToGroup={onAddToGroup}
                  />
                  <button
                    className="watchlist-btn in-watchlist"
                    onClick={(e) => toggleWatchlist(stock, e)}
                    title="移除自选"
                  >
                    ★
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
