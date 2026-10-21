import { useEffect, useState } from 'react';
import { fetchIndustryMap, fetchInstrument, Instrument } from '../services/tickflow';
import { fetchFinance, METRIC_GROUPS, FinanceData, MetricGroup } from '../services/finance';
import { fetchHkFinance, HK_METRIC_GROUPS } from '../services/hkFinance';
import type { Stock } from '../types';

interface Props {
  stock: Stock;
}

function fmtNum(v: number | null | undefined, pct?: boolean, decimals = 2): string {
  if (v == null || Number.isNaN(v)) return '-';
  return pct ? `${v.toFixed(1)}%` : v.toFixed(decimals);
}

// A 股按日期推断，港股按接口返回的报告类型标注，兼容 3 月等非自然年财年。
function periodLabel(p: string, reportType?: string): string {
  const [y, m] = p.split('-');
  if (reportType === '年报') return `${y}A`;
  if (reportType === '中报') return `${y}H`;
  if (reportType === '一季报') return `${y}Q1`;
  if (reportType === '三季报') return `${y}Q3`;
  return m === '12' ? `${y}A` : m === '06' ? `${y}H` : `${y}${m}`;
}

function currencyLabel(currency?: string): string {
  if (!currency) return '';
  if (currency.includes('人民币')) return 'CNY';
  if (currency.includes('美元')) return 'USD';
  if (currency.includes('港')) return 'HKD';
  return currency;
}

export function StockF10({ stock }: Props) {
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [industry, setIndustry] = useState<string | null>(null);
  const [finance, setFinance] = useState<FinanceData | null>(null);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isHongKong = stock.exchange === 'HK';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setInstrument(null);
    setIndustry(null);
    setFinance(null);
    setFinanceError(null);

    const symbol = `${stock.code}.${stock.exchange}`;
    Promise.all([
      fetchInstrument(stock).catch(() => null),
      fetchIndustryMap()
        .then((map) => {
          const info = map[symbol];
          return info ? info.sw3 || info.sw2 || info.sw1 : null;
        })
        .catch(() => null),
      isHongKong
        ? fetchHkFinance(stock).catch((e) => {
            setFinanceError(String(e.message || e));
            return null;
          })
        : fetchFinance(stock).catch((e) => {
            setFinanceError(String(e.message || e));
            return null;
          }),
    ]).then(([inst, ind, fin]) => {
      if (cancelled) return;
      setInstrument(inst);
      setIndustry(ind);
      setFinance(fin);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [stock.code, stock.exchange, isHongKong]);

  // A 股固定取 5 年报 + 2 中报；港股使用适配器选出的实际财年。
  const allPeriods = finance ? Object.keys(finance.indicator).sort() : [];
  const periods = finance?.periodOrder ?? [
    ...allPeriods.filter((p) => p.endsWith('-12-31')).slice(-5),
    ...allPeriods.filter((p) => p.endsWith('-06-30')).slice(-2),
  ];
  const metricGroups = isHongKong ? HK_METRIC_GROUPS : METRIC_GROUPS;
  const currencies = [
    ...new Set(Object.values(finance?.periods ?? {}).map((meta) => currencyLabel(meta.currency))),
  ].filter(Boolean);
  const standards = [
    ...new Set(Object.values(finance?.periods ?? {}).map((meta) => meta.accountingStandard)),
  ].filter(Boolean);

  const fmtShares = (v?: number) =>
    v == null ? '-' : `${(v / 1e8).toFixed(2)} 亿股`;

  return (
    <div className="f10">
      {loading && <div className="f10-loading">加载中...</div>}
      {!loading && (
        <>
          <div className="f10-section">
            <h3>公司概要</h3>
            <div className="f10-grid">
              <div className="f10-item"><span className="f10-label">市场</span><span className="f10-value">{isHongKong ? '港股' : 'A股'}</span></div>
              <div className="f10-item"><span className="f10-label">行业</span><span className="f10-value">{industry || '-'}</span></div>
              <div className="f10-item"><span className="f10-label">上市日期</span><span className="f10-value">{instrument?.ext.listing_date || '-'}</span></div>
              <div className="f10-item"><span className="f10-label">总股本</span><span className="f10-value">{fmtShares(instrument?.ext.total_shares)}</span></div>
              <div className="f10-item"><span className="f10-label">流通股本</span><span className="f10-value">{fmtShares(instrument?.ext.float_shares)}</span></div>
              {isHongKong && (
                <>
                  <div className="f10-item">
                    <span className="f10-label">每手股数</span>
                    <span className="f10-value">{instrument?.ext.lot_size ?? '-'}</span>
                  </div>
                  <div className="f10-item">
                    <span className="f10-label">财报币种</span>
                    <span className="f10-value">{currencies.join(' / ') || '-'}</span>
                  </div>
                  <div className="f10-item">
                    <span className="f10-label">会计准则</span>
                    <span className="f10-value">{standards.join(' / ') || '-'}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="f10-section">
            <h3>
              关键财务数据
              <span className="f10-source">
                {isHongKong ? '数据源: 东方财富港股 F10' : '数据源: 东方财富'}
              </span>
            </h3>
            {financeError ? (
              <div className="f10-permission-tip">财务数据加载失败: {financeError}</div>
            ) : !finance ? (
              <div className="f10-loading">加载中...</div>
            ) : periods.length === 0 ? (
              <div className="f10-permission-tip">暂无财务数据</div>
            ) : (
              <div className="f10-table-wrap">
                <table className="f10-table">
                  <thead>
                    <tr>
                      <th>指标</th>
                      {periods.map((p) => {
                        const meta = finance.periods?.[p];
                        return (
                          <th key={p}>
                            <span>{periodLabel(p, meta?.reportType)}</span>
                            {meta && (
                              <span className="f10-period-meta">
                                {currencyLabel(meta.currency)} · {meta.reportType}
                              </span>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {metricGroups.map((group) => (
                      <FragmentGroup key={group.title} title={group.title} group={group} periods={periods} finance={finance} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FragmentGroup({
  title,
  group,
  periods,
  finance,
}: {
  title: string;
  group: MetricGroup;
  periods: string[];
  finance: FinanceData;
}) {
  return (
    <>
      <tr className="f10-group-row">
        <td colSpan={periods.length + 1}>{title}</td>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.label}>
          <td className="f10-metric-label">{row.label}</td>
          {periods.map((p) => {
            const ds = finance[row.src][p];
            const val = (k: string) =>
              row.transform ? row.transform(ds?.[k] ?? null) : ds?.[k] ?? null;
            const v1 = fmtNum(val(row.key), row.pct);
            return (
              <td key={p}>{row.alt ? `${v1} / ${fmtNum(val(row.alt), row.pct)}` : v1}</td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
