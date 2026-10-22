import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts';
import { KlineData } from '../types';
import { IndicatorType, calculateMACD, calculateKDJ, calculateRSI } from '../utils/indicators';
import { chartTheme, type ChartTheme } from '../theme';

interface KlineChartProps {
  data: KlineData[];
  height?: number;
  indicators?: IndicatorType[];
}

interface TooltipData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  date: string;
  indicatorValues?: Array<[string, number]>;
}

// 指标副图定义：一组线/柱系列 + 计算函数，统一创建、销毁与取值
interface IndicatorSeriesDef {
  key: string;
  kind: 'line' | 'hist';
  label: string;
  color?: string;
  lineStyle?: number;
  lastValueVisible?: boolean;
}

interface IndicatorDef {
  priceScaleId: string;
  series: IndicatorSeriesDef[];
  // 返回每根 K 线对应各 key 的值（undefined 表示该点无值）
  compute: (data: KlineData[]) => Record<string, Array<number | undefined>>;
}

function indicatorDefs(theme: ChartTheme): Record<IndicatorType, IndicatorDef> {
  return {
    macd: {
      priceScaleId: 'macd',
      series: [
        { key: 'dif', kind: 'line', label: 'DIF', color: theme.primary },
        { key: 'dea', kind: 'line', label: 'DEA', color: theme.warn },
        { key: 'macd', kind: 'hist', label: 'MACD' },
      ],
      compute: (data) => {
        const macd = calculateMACD(data);
        return {
          dif: macd.map((d) => (Number.isNaN(d.dif) ? undefined : d.dif)),
          dea: macd.map((d) => (Number.isNaN(d.dea) ? undefined : d.dea)),
          macd: macd.map((d) => (Number.isNaN(d.macd) ? undefined : d.macd)),
        };
      },
    },
    kdj: {
      priceScaleId: 'kdj',
      series: [
        { key: 'k', kind: 'line', label: 'K', color: theme.primary },
        { key: 'd', kind: 'line', label: 'D', color: theme.warn },
        { key: 'j', kind: 'line', label: 'J', color: theme.accent },
      ],
      compute: (data) => {
        const kdj = calculateKDJ(data);
        return {
          k: kdj.map((d) => (Number.isNaN(d.k) ? undefined : d.k)),
          d: kdj.map((d) => (Number.isNaN(d.d) ? undefined : d.d)),
          j: kdj.map((d) => (Number.isNaN(d.j) ? undefined : d.j)),
        };
      },
    },
    rsi: {
      priceScaleId: 'rsi',
      series: [
        { key: 'value', kind: 'line', label: 'RSI', color: theme.primary },
        { key: 'upper', kind: 'line', label: '80', color: theme.up, lineStyle: 2, lastValueVisible: false },
        { key: 'lower', kind: 'line', label: '20', color: theme.down, lineStyle: 2, lastValueVisible: false },
      ],
      compute: (data) => {
        const rsi = calculateRSI(data);
        return {
          value: rsi.map((d) => (Number.isNaN(d.value) ? undefined : d.value)),
          upper: data.map(() => 80),
          lower: data.map(() => 20),
        };
      },
    },
  };
}

export function KlineChart({ data, height = 400, indicators = [] }: KlineChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  // 当前活跃副图指标: 指标类型 -> 已创建的 series + tooltip 标签
  const indicatorSeriesRef = useRef<Map<IndicatorType, Array<{ api: ISeriesApi<'Line' | 'Histogram'>; label: string }>>>(new Map());
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const theme = chartTheme();

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: theme.background },
        textColor: theme.text,
      },
      grid: {
        vertLines: { color: theme.grid },
        horzLines: { color: theme.grid },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: theme.crosshair, width: 1, style: 2, labelBackgroundColor: theme.crosshairLabel },
        horzLine: { color: theme.crosshair, width: 1, style: 2, labelBackgroundColor: theme.crosshairLabel },
      },
      localization: {
        // crosshair 悬浮的日期 label，格式 YY/MM/DD
        timeFormatter: (time: string | number) => {
          const dateStr = typeof time === 'string'
            ? time
            : new Date(time * 1000).toISOString().split('T')[0];
          const [y, m, d] = dateStr.split('-');
          return `${y.slice(2)}/${m}/${d}`;
        },
      },
      rightPriceScale: {
        borderColor: theme.grid,
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      // 滚轮交还给页面滚动（看下面的财务数据），缩放/平移用拖拽和坐标轴
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
      timeScale: {
        borderColor: theme.grid,
        timeVisible: false,
        tickMarkFormatter: (time: string | number) => {
          const dateStr = typeof time === 'string'
            ? time
            : new Date(time * 1000).toISOString().split('T')[0];
          const [y, m] = dateStr.split('-');
          // 横轴统一显示年月，避免跨年 K 线只能看到月-日。
          return `${y.slice(2)}/${m}`;
        },
      },
      autoSize: true,
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: theme.up,
      downColor: theme.down,
      borderVisible: true,
      borderUpColor: theme.up,
      borderDownColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
    });
    candlestickSeriesRef.current = candlestickSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: theme.down,
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !candlestickSeries) {
        setTooltip(null);
        return;
      }

      const dataPoint = param.seriesData.get(candlestickSeries) as CandlestickData;
      if (!dataPoint) return;
      const volumeData = param.seriesData.get(volumeSeries) as HistogramData;

      const indicatorValues: Array<[string, number]> = [];
      for (const seriesList of indicatorSeriesRef.current.values()) {
        for (const { api, label } of seriesList) {
          const v = param.seriesData.get(api) as LineData | undefined;
          if (v) indicatorValues.push([label, v.value]);
        }
      }

      setTooltip({
        open: dataPoint.open,
        high: dataPoint.high,
        low: dataPoint.low,
        close: dataPoint.close,
        volume: volumeData?.value || 0,
        date: String(param.time),
        indicatorValues: indicatorValues.length > 0 ? indicatorValues : undefined,
      });
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      indicatorSeriesRef.current.clear();
    };
  }, []);

  // Update candlestick + volume data
  useEffect(() => {
    if (!candlestickSeriesRef.current || !volumeSeriesRef.current || data.length === 0) return;
    const theme = chartTheme();

    candlestickSeriesRef.current.setData(
      data.map((item) => ({
        time: item.date,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
      }))
    );
    volumeSeriesRef.current.setData(
      data.map((item) => ({
        time: item.date,
        value: item.volume,
        color: item.close >= item.open ? theme.up : theme.down,
      }))
    );
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  // Sync indicator series with props
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || data.length === 0) return;

    const active = indicatorSeriesRef.current;

    // 移除不再请求的指标
    for (const type of [...active.keys()]) {
      if (!indicators.includes(type)) {
        for (const { api } of active.get(type)!) chart.removeSeries(api);
        active.delete(type);
      }
    }

    // 创建新请求的指标并填数
    const defs = indicatorDefs(chartTheme());
    for (const type of indicators) {
      if (active.has(type)) continue;
      const def = defs[type];
      const values = def.compute(data);
      const times = data.map((d) => d.date);

      const created = def.series.map((s) => {
        const api =
          s.kind === 'line'
            ? chart.addSeries(LineSeries, {
                color: s.color,
                lineWidth: 1,
                title: s.label,
                priceScaleId: def.priceScaleId,
                lineStyle: s.lineStyle,
                lastValueVisible: s.lastValueVisible,
              })
            : chart.addSeries(HistogramSeries, { priceScaleId: def.priceScaleId });
        api.setData(
          times.map((time, i) => ({ time, value: values[s.key][i] })).filter((d) => d.value !== undefined) as never
        );
        return { api, label: s.label };
      });

      chart.priceScale(def.priceScaleId).applyOptions({ scaleMargins: { top: 0.7, bottom: 0.05 } });
      active.set(type, created);
    }

    chart.timeScale().fitContent();
  }, [data, indicators]);

  return (
    <div className="kline-chart-wrapper" style={{ position: 'relative' }}>
      <div ref={chartContainerRef} style={{ height: `${height}px`, width: '100%' }} />
      {tooltip && (
        <div className="kline-tooltip">
          <div className="kline-tooltip-date">{tooltip.date}</div>
          <div className="kline-tooltip-grid">
            <span className="kline-tooltip-label">开:</span>
            <span className={`kline-tooltip-value ${tooltip.open <= tooltip.close ? 'up' : 'down'}`}>
              {tooltip.open.toFixed(2)}
            </span>
            <span className="kline-tooltip-label">高:</span>
            <span className="kline-tooltip-value">{tooltip.high.toFixed(2)}</span>
            <span className="kline-tooltip-label">低:</span>
            <span className="kline-tooltip-value">{tooltip.low.toFixed(2)}</span>
            <span className="kline-tooltip-label">收:</span>
            <span className={`kline-tooltip-value ${tooltip.close >= tooltip.open ? 'up' : 'down'}`}>
              {tooltip.close.toFixed(2)}
            </span>
            <span className="kline-tooltip-label">量:</span>
            <span className="kline-tooltip-value">{(tooltip.volume / 10000).toFixed(2)}万</span>
          </div>
          {tooltip.indicatorValues && (
            <div className="kline-tooltip-indicators">
              {tooltip.indicatorValues.map(([label, value]) => (
                <div key={label} className="kline-tooltip-grid">
                  <span className="kline-tooltip-label">{label}:</span>
                  <span className="kline-tooltip-value">{value.toFixed(3)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
