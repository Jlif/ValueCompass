// 图表颜色统一从 CSS token 读取，避免 App.css 与 lightweight-charts 各维护一套色值。
export interface ChartTheme {
  background: string;
  text: string;
  grid: string;
  crosshair: string;
  crosshairLabel: string;
  up: string;
  down: string;
  primary: string;
  warn: string;
  accent: string;
}

const FALLBACK: ChartTheme = {
  background: '#faf7f1',
  text: '#61594e',
  grid: '#d5ccbe',
  crosshair: '#7c7265',
  crosshairLabel: '#4f6874',
  up: '#b04f44',
  down: '#3f7a58',
  primary: '#4f6874',
  warn: '#7a5d31',
  accent: '#8a7f9a',
};

function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function chartTheme(): ChartTheme {
  return {
    background: token('--surface', FALLBACK.background),
    text: token('--text-muted', FALLBACK.text),
    grid: token('--border', FALLBACK.grid),
    crosshair: token('--text-faint', FALLBACK.crosshair),
    crosshairLabel: token('--primary', FALLBACK.crosshairLabel),
    up: token('--up', FALLBACK.up),
    down: token('--down', FALLBACK.down),
    primary: token('--primary-text', FALLBACK.primary),
    warn: token('--warn', FALLBACK.warn),
    accent: token('--chart-accent', FALLBACK.accent),
  };
}
