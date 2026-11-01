import type { StockValuation } from '../services/valuation/types';

function ratio(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
  }).format(value);
}

export function formatMarketCap(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const yi = value / 1e8;
  if (Math.abs(yi) >= 10000) return `${(yi / 10000).toFixed(2)}万亿`;
  if (Math.abs(yi) >= 1000) return `${Math.round(yi).toLocaleString('zh-CN')}亿`;
  return `${yi.toFixed(yi >= 10 ? 1 : 2)}亿`;
}

export function formatValuationLine(valuation: StockValuation | undefined): string {
  if (!valuation) return '';
  const parts: string[] = [];
  if (valuation.pb != null) parts.push(`PB ${ratio(valuation.pb)}`);
  if (valuation.roeTtm != null) parts.push(`ROE ${ratio(valuation.roeTtm)}%`);
  if (parts.length === 0 && valuation.peTtm != null) parts.push(`PE ${ratio(valuation.peTtm)}`);
  return parts.join(' · ');
}

export function valuationTooltip(valuation: StockValuation | undefined): string {
  if (!valuation) return '暂无估值数据';
  const currency = valuation.currency === 'HKD' ? '港币' : '人民币';
  const industry = valuation.industry ? ` · ${valuation.industry}` : '';
  const source = valuation.source === 'tencent' ? '腾讯行情' : '东方财富';
  return `PE ${valuation.peTtm ?? '-'} · PB ${valuation.pb ?? '-'} · ROE ${valuation.roeTtm == null ? '-' : `${ratio(valuation.roeTtm)}%`}（按 PB/PE 推算） · 市值 ${formatMarketCap(valuation.marketCap)}（${currency}）${industry} · ${source}`;
}
