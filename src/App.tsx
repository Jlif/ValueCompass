import { useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { StockDetail } from './components/StockDetail';
import { SyncPanel } from './components/SyncPanel';
import { useKline } from './hooks/useKline';
import { useNotesSync } from './hooks/useNotesSync';
import { useS3SyncSettings } from './hooks/useS3SyncSettings';
import { useStockList } from './hooks/useStockList';
import { useStockQuote } from './hooks/useStockQuote';
import { useWatchlist } from './hooks/useWatchlist';
import { stockKey } from './utils/stockKey';
import './App.css';

function App() {
  const syncSettings = useS3SyncSettings();
  const { stocks, industryMap, loading: listLoading, refreshing, error: listError, refresh } = useStockList();
  const {
    stock: selectedStock,
    period,
    data: klineData,
    loading: klineLoading,
    error: klineError,
    selectStock,
    selectPeriod,
  } = useKline();
  const {
    watchlist,
    groups,
    addToWatchlist,
    removeFromWatchlist,
    toggleWatchlist,
    replaceAll,
    createGroup,
    removeGroup,
    renameGroup,
    moveGroup,
    addToGroup,
    removeFromGroup,
    syncState,
    syncError,
    lastSyncedAt,
    syncNow,
    forcePush,
  } = useWatchlist({ config: syncSettings.config });
  const notesSync = useNotesSync({ config: syncSettings.config });
  const { quote, loading: quoteLoading, error: quoteError } = useStockQuote(selectedStock);

  const watchlistKeys = useMemo(() => new Set(watchlist.map((stock) => stockKey(stock))), [watchlist]);
  const selectedInWatchlist = selectedStock ? watchlistKeys.has(stockKey(selectedStock)) : false;

  return (
    <div className="app">
      <header className="app-header">
        <h1>价值罗盘</h1>
        <div className="status-bar">
          <SyncPanel
            settings={syncSettings}
            watchlistSync={{ syncState, syncError, lastSyncedAt, syncNow, forcePush }}
            notesSync={notesSync}
            watchlist={watchlist}
            groups={groups}
            replaceAll={replaceAll}
          />
        </div>
      </header>

      <main className="app-main">
        <Sidebar
          stocks={stocks}
          industryMap={industryMap}
          loading={listLoading}
          error={listError}
          refreshing={refreshing}
          onRefresh={refresh}
          watchlist={watchlist}
          groups={groups}
          watchlistKeys={watchlistKeys}
          selectedStock={selectedStock}
          onSelectStock={selectStock}
          onAddToWatchlist={addToWatchlist}
          onRemoveFromWatchlist={removeFromWatchlist}
          onAddToGroup={addToGroup}
          onRemoveFromGroup={removeFromGroup}
          onCreateGroup={createGroup}
          onRemoveGroup={removeGroup}
          onRenameGroup={renameGroup}
          onMoveGroup={moveGroup}
        />

        <div className="content">
          {selectedStock ? (
            <StockDetail
              stock={selectedStock}
              quote={quote}
              quoteLoading={quoteLoading}
              quoteError={quoteError}
              period={period}
              klineData={klineData}
              klineLoading={klineLoading}
              klineError={klineError}
              onPeriodChange={selectPeriod}
              inWatchlist={selectedInWatchlist}
              onToggleWatchlist={toggleWatchlist}
            />
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
