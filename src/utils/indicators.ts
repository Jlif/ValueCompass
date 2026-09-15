import { KlineData } from '../types';

export interface MACDData {
  time: string;
  dif: number;
  dea: number;
  macd: number;
}

export interface KDJData {
  time: string;
  k: number;
  d: number;
  j: number;
}

export interface RSIData {
  time: string;
  value: number;
}

export type IndicatorType = 'macd' | 'kdj' | 'rsi';

// EMA 计算
function calculateEMA(values: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      ema.push(values[0]);
    } else {
      ema.push((values[i] - ema[i - 1]) * multiplier + ema[i - 1]);
    }
  }

  return ema;
}

// MACD: DIF = EMA(12) - EMA(26), DEA = EMA(DIF, 9), MACD = 2*(DIF-DEA)
export function calculateMACD(data: KlineData[]): MACDData[] {
  if (data.length < 26) return [];

  const closes = data.map((d) => d.close);
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);

  const dif: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    dif.push(ema12[i] - ema26[i]);
  }

  const dea = calculateEMA(dif, 9);

  const result: MACDData[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < 33) {
      result.push({ time: data[i].date, dif: NaN, dea: NaN, macd: NaN });
    } else {
      const macdValue = 2 * (dif[i] - dea[i]);
      result.push({
        time: data[i].date,
        dif: dif[i],
        dea: dea[i],
        macd: macdValue,
      });
    }
  }

  return result;
}

// KDJ: RSV = (Close - LLV9) / (HHV9 - LLV9) * 100
// K = 2/3*K_prev + 1/3*RSV, D = 2/3*D_prev + 1/3*K, J = 3K - 2D
export function calculateKDJ(data: KlineData[]): KDJData[] {
  if (data.length < 9) return [];

  const result: KDJData[] = [];
  let k = 50;
  let d = 50;

  for (let i = 0; i < data.length; i++) {
    if (i < 8) {
      result.push({ time: data[i].date, k: NaN, d: NaN, j: NaN });
      continue;
    }

    let lowest = data[i].low;
    let highest = data[i].high;
    for (let j = 1; j < 9; j++) {
      lowest = Math.min(lowest, data[i - j].low);
      highest = Math.max(highest, data[i - j].high);
    }

    const range = highest - lowest;
    const rsv = range === 0 ? 50 : ((data[i].close - lowest) / range) * 100;

    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    const j = 3 * k - 2 * d;

    result.push({
      time: data[i].date,
      k: Math.min(100, Math.max(0, k)),
      d: Math.min(100, Math.max(0, d)),
      j: Math.min(100, Math.max(0, j)),
    });
  }

  return result;
}

// RSI: 100 - 100/(1 + RS), RS = avg_gain / avg_loss
export function calculateRSI(data: KlineData[], period: number = 14): RSIData[] {
  if (data.length < period + 1) return [];

  const changes: number[] = [];
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i].close - data[i - 1].close);
  }

  let avgGain = 0;
  let avgLoss = 0;

  // 初始平均
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  const result: RSIData[] = [{ time: data[0].date, value: NaN }];

  for (let i = period; i < data.length; i++) {
    const change = changes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result.push({ time: data[i].date, value: 100 });
    } else {
      const rs = avgGain / avgLoss;
      result.push({ time: data[i].date, value: 100 - 100 / (1 + rs) });
    }
  }

  // 填充前面的 NaN
  for (let i = 1; i < period; i++) {
    result[i] = { time: data[i].date, value: NaN };
  }

  return result;
}
