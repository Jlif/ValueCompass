import type { StockQuote } from '../types';

interface Props {
  quote: StockQuote | null;
  loading: boolean;
  error: string | null;
  exchange: string;
}

function price(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? '-' : value.toFixed(2);
}

function compactAmount(value: number): string {
  if (!Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(2)} 万`;
  return value.toFixed(0);
}

export function StockQuoteBar({ quote, loading, error, exchange }: Props) {
  if (loading && !quote) {
    return <div className="quote-bar quote-muted">实时行情加载中...</div>;
  }
  if (!quote) {
    return (
      <div className="quote-bar quote-muted">
        {error ? `实时行情暂不可用: ${error}` : '暂无实时行情'}
      </div>
    );
  }

  const direction = (quote.changeAmount ?? quote.changePct ?? 0) >= 0 ? 'up' : 'down';
  const changePct = quote.changePct == null ? null : quote.changePct * 100;
  const updateTime = new Date(quote.timestamp).toLocaleTimeString('zh-CN', {
    timeZone: exchange === 'HK' ? 'Asia/Hong_Kong' : 'Asia/Shanghai',
    hour12: false,
  });

  return (
    <div className="quote-bar">
      <span className={`quote-last ${direction}`}>{price(quote.lastPrice)}</span>
      <span className="quote-currency">{exchange === 'HK' ? 'HKD' : 'CNY'}</span>
      <span className={`quote-change ${direction}`}>
        {quote.changeAmount == null ? '-' : `${quote.changeAmount >= 0 ? '+' : ''}${price(quote.changeAmount)}`}
        {changePct == null ? '' : `  ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`}
      </span>
      <span className="quote-divider" />
      <span className="quote-stat">今开 <b>{price(quote.open)}</b></span>
      <span className="quote-stat">最高 <b>{price(quote.high)}</b></span>
      <span className="quote-stat">最低 <b>{price(quote.low)}</b></span>
      <span className="quote-stat">成交额 <b>{compactAmount(quote.amount)}</b></span>
      <span className="quote-time">{updateTime} 更新</span>
      {error && <span className="quote-warning" title={error}>刷新失败</span>}
    </div>
  );
}
