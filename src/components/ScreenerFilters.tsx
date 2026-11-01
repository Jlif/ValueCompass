import { useEffect, useState } from 'react';
import type { StockFilters } from '../services/stockScreener';

interface Props {
  filters: StockFilters;
  onChange: (patch: Partial<StockFilters>) => void;
  onReset: () => void;
  loading: boolean;
  error: string | null;
  coverage: number;
  total: number;
  updatedAt: number | null;
  onRefresh: () => void;
}

interface RangeFieldProps {
  label: string;
  min: number | null;
  max: number | null;
  onMinChange: (value: number | null) => void;
  onMaxChange: (value: number | null) => void;
  wide?: boolean;
}

function BoundInput({
  value,
  placeholder,
  label,
  onChange,
}: {
  value: number | null;
  placeholder: string;
  label: string;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));

  useEffect(() => {
    setText(value == null ? '' : String(value));
  }, [value]);

  const handleChange = (next: string) => {
    setText(next);
    const trimmed = next.trim();
    if (!trimmed) {
      onChange(null);
      return;
    }
    if (trimmed === '-' || trimmed === '.') return;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) onChange(parsed);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(event) => handleChange(event.target.value)}
    />
  );
}

function RangeField({
  label,
  min,
  max,
  onMinChange,
  onMaxChange,
  wide = false,
}: RangeFieldProps) {
  return (
    <label className={`screener-field ${wide ? 'wide' : ''}`}>
      <span className="screener-label">{label}</span>
      <span className="screener-range">
        <BoundInput
          value={min}
          placeholder="不限"
          label={`${label}最小值`}
          onChange={onMinChange}
        />
        <span className="screener-dash">-</span>
        <BoundInput
          value={max}
          placeholder="不限"
          label={`${label}最大值`}
          onChange={onMaxChange}
        />
      </span>
    </label>
  );
}

function formatTime(value: number | null): string {
  if (value == null) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

export function ScreenerFilters({
  filters,
  onChange,
  onReset,
  loading,
  error,
  coverage,
  total,
  updatedAt,
  onRefresh,
}: Props) {
  const [open, setOpen] = useState(false);
  const activeCount = [
    filters.peMin,
    filters.peMax,
    filters.pbMin,
    filters.pbMax,
    filters.roeMin,
    filters.roeMax,
    filters.marketCapMin,
    filters.marketCapMax,
  ].filter((value) => value != null).length;
  const presetActive =
    filters.peMin === 0 &&
    filters.peMax === null &&
    filters.pbMin === 0.01 &&
    filters.pbMax === 1.5 &&
    filters.roeMin === 12 &&
    filters.roeMax === null &&
    filters.marketCapMin === null &&
    filters.marketCapMax === null;

  const status = loading
    ? '估值数据更新中…'
    : error
      ? `估值覆盖 ${coverage}/${total} · 部分缺失`
      : total > 0
        ? `估值覆盖 ${coverage}/${total}${updatedAt ? ` · ${formatTime(updatedAt)}` : ''}`
        : '等待股票池加载';

  return (
    <div className="screener">
      <button
        className={`screener-toggle ${open ? 'open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span>选股条件</span>
        <span className="screener-summary">
          {activeCount > 0
            ? `已设置 ${activeCount} 项`
            : loading
              ? '估值更新中'
              : total > 0
                ? `估值 ${coverage}/${total}`
                : 'PE · PB · 市值'}
        </span>
        <span className="screener-caret">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="screener-panel">
          <div className="screener-grid">
            <RangeField
              label="PE"
              min={filters.peMin}
              max={filters.peMax}
              onMinChange={(value) => onChange({ peMin: value })}
              onMaxChange={(value) => onChange({ peMax: value })}
            />
            <RangeField
              label="PB"
              min={filters.pbMin}
              max={filters.pbMax}
              onMinChange={(value) => onChange({ pbMin: value })}
              onMaxChange={(value) => onChange({ pbMax: value })}
            />
            <RangeField
              label="ROE (%)"
              min={filters.roeMin}
              max={filters.roeMax}
              onMinChange={(value) => onChange({ roeMin: value })}
              onMaxChange={(value) => onChange({ roeMax: value })}
              wide
            />
            <RangeField
              label="总市值（亿，本币）"
              min={filters.marketCapMin}
              max={filters.marketCapMax}
              onMinChange={(value) => onChange({ marketCapMin: value })}
              onMaxChange={(value) => onChange({ marketCapMax: value })}
              wide
            />
          </div>

          <div className="screener-preset-row">
            <button
              className={`screener-preset ${presetActive ? 'active' : ''}`}
              aria-pressed={presetActive}
              onClick={() => {
                onChange({
                  peMin: 0,
                  peMax: null,
                  pbMin: 0.01,
                  pbMax: 1.5,
                  roeMin: 12,
                  roeMax: null,
                  marketCapMin: null,
                  marketCapMax: null,
                });
                setOpen(false);
              }}
              title="低 PB-ROE 预设：0 < PB ≤ 1.5、ROE ≥ 12%、PE > 0，可继续调整"
            >
              低 PB-ROE
            </button>
            <span>0 &lt; PB ≤ 1.5 · ROE ≥ 12% · PE &gt; 0</span>
          </div>

          <div className="screener-footer">
            <span className={`screener-status ${error ? 'has-error' : ''}`} title={error ?? undefined}>
              {status}
            </span>
            <span className="screener-actions">
              <button className="screener-link screener-collapse" onClick={() => setOpen(false)}>
                收起
              </button>
              <button className="screener-link" onClick={onRefresh} disabled={loading}>
                刷新
              </button>
              <button className="screener-link" onClick={onReset} disabled={activeCount === 0}>
                重置
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
