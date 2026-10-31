export interface ReportPeriod {
  date: string;
  reportType: string;
}

export interface ReportPeriodSelection<T extends ReportPeriod> {
  reports: T[];
  latestPeriod: string | null;
  comparisonPeriod: string | null;
}

function normalizeDate(date: string): string {
  return date.slice(0, 10);
}

function previousYearDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(year) - 1}-${month}-${day}`;
}

// Keep annual history together, then place the latest report beside its same-period prior year.
export function selectFinancePeriods<T extends ReportPeriod>(
  reports: T[],
  annualLimit = 5
): ReportPeriodSelection<T> {
  const byDate = new Map<string, T>();
  for (const report of reports) {
    const date = normalizeDate(report.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !report.reportType) continue;
    byDate.set(date, { ...report, date });
  }

  const ordered = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const latest = ordered[ordered.length - 1];
  if (!latest) {
    return { reports: [], latestPeriod: null, comparisonPeriod: null };
  }

  const annual = ordered
    .filter((report) => report.reportType === '年报')
    .slice(-annualLimit);
  const isLatestAnnual = latest.reportType === '年报';
  const comparison = isLatestAnnual
    ? undefined
    : byDate.get(previousYearDate(latest.date));

  const selected: T[] = [];
  const seen = new Set<string>();
  for (const report of [...annual, comparison, latest]) {
    if (!report || seen.has(report.date)) continue;
    seen.add(report.date);
    selected.push(report);
  }

  return {
    reports: selected,
    latestPeriod: latest.date,
    comparisonPeriod: comparison?.date ?? null,
  };
}
