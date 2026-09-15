import { useEffect, useState } from 'react';
import { fetchIndustryMap, fetchInstrument, Instrument } from '../services/tickflow';
import { fetchSinaFinance, METRIC_GROUPS, SinaData } from '../services/sina';
import type { Stock } from '../types';

interface Props {
  stock: Stock;
}

function fmtNum(v: number | null | undefined, pct?: boolean, decimals = 2): string {
  if (v == null || Number.isNaN(v)) return '-';
  return pct ? `${v.toFixed(1)}%` : v.toFixed(decimals);
}

// 列头格式：2025A / 2025H
function periodLabel(p: string): string {
  const [y, m] = p.split('-');
  return m === '12' ? `${y}A` : m === '06' ? `${y}H` : `${y}${m}`;
}

export function StockF10({ stock }: Props) {
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [industry, setIndustry] = useState<string | null>(null);
  const [finance, setFinance] = useState<SinaData | null>(null);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setInstrument(null);
    setIndustry(null);
    setFinance(null);
    setFinanceError(null);

    const symbol = `${stock.code}.${stock.exchange}`;
    Promise.all([
      fetchInstrument(stock),
      fetchIndustryMap().then((map) => map[symbol] || null).catch(() => null),
      fetchSinaFinance(stock).catch((e) => {
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
  }, [stock.code, stock.exchange]);

  // 列 = 最近 5 个年报（升序）+ 最近 2 个半年报（升序），参考雪球 F10 格式
  const allPeriods = finance ? Object.keys(finance.indicator).sort() : [];
  const periods = [
    ...allPeriods.filter((p) => p.endsWith('-12-31')).slice(-5),
    ...allPeriods.filter((p) => p.endsWith('-06-30')).slice(-2),
  ];

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
              <div className="f10-item"><span className="f10-label">行业</span><span className="f10-value">{industry || '-'}</span></div>
              <div className="f10-item"><span className="f10-label">上市日期</span><span className="f10-value">{instrument?.ext.listing_date || '-'}</span></div>
              <div className="f10-item"><span className="f10-label">总股本</span><span className="f10-value">{fmtShares(instrument?.ext.total_shares)}</span></div>
              <div className="f10-item"><span className="f10-label">流通股本</span><span className="f10-value">{fmtShares(instrument?.ext.float_shares)}</span></div>
            </div>
          </div>

          <div className="f10-section">
            <h3>关键财务数据 <span className="f10-source">数据源: 新浪财经</span></h3>
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
                      {periods.map((p) => (
                        <th key={p}>{periodLabel(p)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {METRIC_GROUPS.map((group) => (
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
  group: (typeof METRIC_GROUPS)[number];
  periods: string[];
  finance: SinaData;
}) {
  return (
    <>
      <tr className="f10-group-row">
        <td colSpan={periods.length + 1}>{title}</td>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.label}>
          <td className="f10-metric-label">{row.label}</td>
          {periods.map((p) => (
            <td key={p}>
              {fmtNum(
                row.transform ? row.transform(finance[row.src][p]?.[row.key] ?? null) : finance[row.src][p]?.[row.key] ?? null,
                row.pct
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
