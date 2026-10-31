import assert from 'node:assert/strict';
import { selectFinancePeriods } from '../src/services/financePeriods.ts';

const report = (date, reportType) => ({ date, reportType });

const q3 = selectFinancePeriods([
  report('2021-12-31', '年报'),
  report('2022-12-31', '年报'),
  report('2023-12-31', '年报'),
  report('2024-12-31', '年报'),
  report('2025-12-31', '年报'),
  report('2025-09-30', '三季报'),
  report('2026-09-30', '三季报'),
]);
assert.deepEqual(
  q3.reports.map((item) => item.date),
  [
    '2021-12-31',
    '2022-12-31',
    '2023-12-31',
    '2024-12-31',
    '2025-12-31',
    '2025-09-30',
    '2026-09-30',
  ]
);
assert.equal(q3.latestPeriod, '2026-09-30');
assert.equal(q3.comparisonPeriod, '2025-09-30');

const annual = selectFinancePeriods([
  report('2024-12-31', '年报'),
  report('2025-12-31', '年报'),
]);
assert.deepEqual(annual.reports.map((item) => item.date), ['2024-12-31', '2025-12-31']);
assert.equal(annual.comparisonPeriod, null);

const sparse = selectFinancePeriods([
  report('2025-06-30', '中报'),
  report('2026-06-30', '中报'),
]);
assert.equal(sparse.latestPeriod, '2026-06-30');
assert.equal(sparse.comparisonPeriod, '2025-06-30');

const missingComparison = selectFinancePeriods([
  report('2024-06-30', '中报'),
  report('2025-12-31', '年报'),
  report('2026-06-30', '中报'),
]);
assert.equal(missingComparison.comparisonPeriod, null);
assert.equal(missingComparison.reports.at(-1)?.date, '2026-06-30');

console.log('PASS: finance period selection');
