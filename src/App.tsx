import { useMemo, useState, useEffect } from 'react';
import { KlineChart } from './components/KlineChart';
import { StockF10 } from './components/StockF10';
import { SyncPanel } from './components/SyncPanel';
import { IndustrySelect } from './components/IndustrySelect';
import { useWatchlist } from './hooks/useWatchlist';
import { fetchIndustryMap, fetchKline, fetchStockList, clearStockListCache, KlinePeriod, IndustryInfo } from './services/tickflow';
import type { Stock, KlineData } from './types';
import './App.css';

type Period = KlinePeriod;
type Tab = 'all' | 'watchlist';

const PERIOD_LABELS: Record<Period, string> = {
  daily: '日K',
  weekly: '周K',
  monthly: '月K',
};

function App() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [klineData, setKlineData] = useState<KlineData[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [klineLoading, setKlineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [klineError, setKlineError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<Period>('daily');
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [industryMap, setIndustryMap] = useState<Record<string, IndustryInfo>>({});
  const [industryFilter, setIndustryFilter] = useState('');
  const [hideST, setHideST] = useState(true);

  const {
    watchlist,
    addToWatchlist,
    removeFromWatchlist,
    isInWatchlist,
    syncState,
    syncError,
    lastSyncedAt,
    pull,
    forcePush,
    disconnect,
  } = useWatchlist();

  const watchlistCodes = useMemo(
    () => new Set(watchlist.map((s) => s.code)),
    [watchlist]
  );

  // 加载股票列表（行业映射异步补充，失败不影响列表）
  const loadStocks = async (force = false) => {
    if (force) setRefreshing(true);
    setListLoading(true);
    setError(null);
    try {
      if (force) clearStockListCache();
      const data = await fetchStockList();
      setStocks(data);
      fetchIndustryMap().then(setIndustryMap).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setListLoading(false);
      if (force) setRefreshing(false);
    }
  };

  // 获取 K 线数据
  const fetchKlineData = async (stock: Stock, targetPeriod: Period = period) => {
    setSelectedStock(stock);
    setKlineError(null);
    setKlineLoading(true);
    try {
      const data = await fetchKline(stock, targetPeriod);
      setKlineData(data);
      if (data.length === 0) {
        setKlineError('该周期暂无数据，请尝试其他周期');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Failed to fetch kline:', msg);
      setKlineError(`获取${PERIOD_LABELS[targetPeriod]}数据失败: ${msg}`);
      setKlineData([]);
    } finally {
      setKlineLoading(false);
    }
  };

  // 切换自选
  const toggleWatchlist = (stock: Stock, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInWatchlist(stock.code)) {
      removeFromWatchlist(stock.code);
    } else {
      addToWatchlist(stock);
    }
  };

  useEffect(() => {
    loadStocks();
  }, []);

  // 展示的股票列表：搜索 + 行业 + ST 过滤（前端本地过滤，列表已在内存中）
  const displayStocks = useMemo(() => {
    const kw = searchKeyword.trim();
    // industryFilter 格式 'sw1:食品饮料' / 'sw2:饮料乳品' / 'sw3:乳品'
    const [level, name] = industryFilter ? industryFilter.split(':') : [];
    return stocks.filter((s) => {
      if (kw && !s.code.includes(kw) && !s.name.includes(kw)) return false;
      if (hideST && s.name.includes('ST')) return false;
      if (level && industryMap[`${s.code}.${s.exchange}`]?.[level as keyof IndustryInfo] !== name) return false;
      return true;
    });
  }, [stocks, searchKeyword, hideST, industryFilter, industryMap]);

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

  return (
    <div className="app">
      <header className="app-header">
        <h1>价值罗盘</h1>
        <div className="status-bar">
          <span>数据源: TickFlow</span>
          <SyncPanel
            syncState={syncState}
            syncError={syncError}
            lastSyncedAt={lastSyncedAt}
            pull={pull}
            forcePush={forcePush}
            disconnect={disconnect}
          />
        </div>
      </header>

      <main className="app-main">
        <div className="sidebar">
          <div className="toolbar">
            <div className="search-box">
              <input
                type="text"
                placeholder="搜索股票代码或名称..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
              />
              <button onClick={() => loadStocks(true)} disabled={refreshing} className="btn-primary">
                {refreshing ? '刷新中...' : '刷新列表'}
              </button>
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

          <div className="stock-list">
            {error && <div className="error">错误: {error}</div>}
            {activeTab === 'all' ? (
              <>
                {listLoading && <div className="empty">加载中...</div>}
                {!listLoading && displayStocks.length === 0 && (
                  <div className="empty">暂无股票数据，请点击"刷新列表"</div>
                )}
                {displayStocks.map((stock) => (
                  <div
                    key={stock.code}
                    className={`stock-item ${selectedStock?.code === stock.code ? 'active' : ''}`}
                    onClick={() => {
                      setPeriod('daily');
                      fetchKlineData(stock, 'daily');
                    }}
                  >
                    <span className="stock-code">{stock.code}</span>
                    <span className="stock-name">{stock.name}</span>
                    <span className="stock-exchange">{stock.exchange}</span>
                    <button
                      className={`watchlist-btn ${watchlistCodes.has(stock.code) ? 'in-watchlist' : ''}`}
                      onClick={(e) => toggleWatchlist(stock, e)}
                      title={watchlistCodes.has(stock.code) ? '移除自选' : '添加自选'}
                    >
                      {watchlistCodes.has(stock.code) ? '★' : '☆'}
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <>
                {watchlist.length === 0 && (
                  <div className="empty">暂无自选股票，在"全部股票"中添加</div>
                )}
                {watchlist.map((stock) => (
                  <div
                    key={stock.code}
                    className={`stock-item ${selectedStock?.code === stock.code ? 'active' : ''}`}
                    onClick={() => {
                      setPeriod('daily');
                      fetchKlineData(stock, 'daily');
                    }}
                  >
                    <span className="stock-code">{stock.code}</span>
                    <span className="stock-name">{stock.name}</span>
                    <span className="stock-exchange">{stock.exchange}</span>
                    <button
                      className="watchlist-btn in-watchlist"
                      onClick={(e) => toggleWatchlist(stock, e)}
                      title="移除自选"
                    >
                      ★
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="content">
          {selectedStock ? (
            <div className="stock-detail">
              <h2>
                {selectedStock.name}
                <span className="exchange">{selectedStock.code} · {selectedStock.exchange}</span>
                <button
                  className={`watchlist-btn-large ${watchlistCodes.has(selectedStock.code) ? 'in-watchlist' : ''}`}
                  onClick={(e) => toggleWatchlist(selectedStock, e)}
                >
                  {watchlistCodes.has(selectedStock.code) ? '★ 已自选' : '☆ 加自选'}
                </button>
              </h2>

              {klineError ? (
                <div className="kline-error">{klineError}</div>
              ) : klineLoading || klineData.length === 0 ? (
                <div className="loading">{klineLoading ? '加载中...' : '暂无K线数据'}</div>
              ) : (
                <div className="kline-wrapper">
                  <div className="kline-header">
                    <h3>K线走势</h3>
                    <div className="period-tabs">
                        {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
                          <button
                            key={p}
                            className={`period-tab ${period === p ? 'active' : ''}`}
                            onClick={() => {
                              setPeriod(p);
                              if (selectedStock) {
                                fetchKlineData(selectedStock, p);
                              }
                            }}
                          >
                            {PERIOD_LABELS[p]}
                          </button>
                        ))}
                      </div>
                  </div>
                  <KlineChart
                    data={klineData}
                    height={480}
                    period={period}
                  />
                </div>
              )}

              <StockF10 stock={selectedStock} />
            </div>
          ) : (
            <div className="empty-state">
              <p>请选择左侧股票查看详情</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
