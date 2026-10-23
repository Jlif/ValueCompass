import type { KlineData, Stock, StockQuote } from '../types';
import type { KlinePeriod } from '../services/tickflow';
import { PERIODS, PERIOD_LABELS } from '../utils/periods';
import { KlineChart } from './KlineChart';
import { StockF10 } from './StockF10';
import { StockNotes } from './StockNotes';
import { StockQuoteBar } from './StockQuoteBar';

interface Props {
  stock: Stock;
  quote: StockQuote | null;
  quoteLoading: boolean;
  quoteError: string | null;
  period: KlinePeriod;
  klineData: KlineData[];
  klineLoading: boolean;
  klineError: string | null;
  onPeriodChange: (period: KlinePeriod) => void;
  inWatchlist: boolean;
  onToggleWatchlist: (stock: Stock) => void;
}

export function StockDetail({
  stock,
  quote,
  quoteLoading,
  quoteError,
  period,
  klineData,
  klineLoading,
  klineError,
  onPeriodChange,
  inWatchlist,
  onToggleWatchlist,
}: Props) {
  return (
    <div className="stock-detail">
      <div className="stock-heading">
        <h2>
          {stock.name}
          <span className={`exchange ${stock.exchange === 'HK' ? 'hk' : ''}`}>
            {stock.code} · {stock.exchange === 'HK' ? '港股' : stock.exchange}
          </span>
        </h2>
        <div className="stock-heading-actions">
          <button
            type="button"
            className={`watchlist-btn-large ${inWatchlist ? 'in-watchlist' : ''}`}
            onClick={() => onToggleWatchlist(stock)}
          >
            {inWatchlist ? '★ 已自选' : '☆ 加自选'}
          </button>
          <StockNotes stock={stock} />
        </div>
      </div>

      <StockQuoteBar
        quote={quote}
        loading={quoteLoading}
        error={quoteError}
        exchange={stock.exchange}
      />

      <div className="kline-wrapper">
        <div className="kline-header">
          <h3>K线走势</h3>
          <div className="period-tabs">
            {PERIODS.map((item) => (
              <button
                key={item}
                className={`period-tab ${period === item ? 'active' : ''}`}
                onClick={() => onPeriodChange(item)}
              >
                {PERIOD_LABELS[item]}
              </button>
            ))}
          </div>
        </div>
        <div className="kline-body">
          {klineError ? (
            <div className="kline-error">{klineError}</div>
          ) : klineLoading || klineData.length === 0 ? (
            <div className="loading">{klineLoading ? '加载中...' : '暂无K线数据'}</div>
          ) : (
            <KlineChart data={klineData} height={480} />
          )}
        </div>
      </div>

      <StockF10 stock={stock} quote={quote} />
    </div>
  );
}
