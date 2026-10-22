import type { KlinePeriod } from '../services/tickflow';

export const PERIODS: KlinePeriod[] = ['daily', 'weekly', 'monthly'];

export const PERIOD_LABELS: Record<KlinePeriod, string> = {
  daily: '日K',
  weekly: '周K',
  monthly: '月K',
};
