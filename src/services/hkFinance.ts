import type { Stock } from '../types';
import type {
  FinanceData,
  FinancePeriodMeta,
  MetricGroup,
  MetricRow,
} from './finance';

const DC_HOST = 'https://datacenter.eastmoney.com';
const DATA_KEY = 'vc.hk_finance.v1';
const DATA_TTL = 24 * 3600 * 1000;
const DATA_KEEP = 40;
const CACHE_ON = !import.meta.env.DEV;
const isTauri = '__TAURI_INTERNALS__' in window;

const REPORT_LIST_NAME = 'RPT_CUSTOM_HKSK_APPFN_CASHFLOW_SUMMARY';
const BALANCE_REPORT = 'RPT_HKF10_FN_BALANCE_PC';
const INCOME_REPORT = 'RPT_HKF10_FN_INCOME_PC';
const CASHFLOW_REPORT = 'RPT_HKF10_FN_CASHFLOW_PC';
const INDICATOR_REPORT = 'RPT_HKF10_FN_MAININDICATOR';
const STATEMENT_COLUMNS =
  'SECUCODE,REPORT_DATE,DATE_TYPE_CODE,FISCAL_YEAR,STD_ITEM_CODE,STD_ITEM_NAME,AMOUNT';

interface HkReportRow {
  REPORT_DATE: string;
  START_DATE: string;
  FISCAL_YEAR: string;
  CURRENCY: string;
  ACCOUNT_STANDARD: string;
  REPORT_TYPE: string;
}

interface HkStatementRow {
  REPORT_DATE: string;
  STD_ITEM_NAME: string | null;
  STD_ITEM_CODE?: string | null;
  AMOUNT: number | null;
}

interface HkIndicatorRow {
  REPORT_DATE: string;
  [key: string]: number | string | null;
}

interface CacheEntry {
  t: number;
  d: FinanceData;
}

async function dataCenterJson(params: Record<string, string>): Promise<any> {
  const url = new URL(`${DC_HOST}/securities/api/data/v1/get`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = isTauri
    ? await (await import('@tauri-apps/plugin-http')).fetch(url.toString())
    : await fetch(url.toString());
  if (!response.ok) throw new Error(`东财港股接口 ${response.status}`);
  return response.json();
}

async function dataRows<T>(params: Record<string, string>): Promise<T[]> {
  const json = await dataCenterJson(params);
  if (json.success === false) {
    throw new Error(`东财港股接口: ${json.message || '请求失败'}`);
  }
  const data = json.result?.data;
  return Array.isArray(data) ? data : [];
}

async function fetchReportList(stock: Stock): Promise<HkReportRow[]> {
  const data = await dataRows<{ REPORT_LIST?: HkReportRow[] }>({
    reportName: REPORT_LIST_NAME,
    columns:
      'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,START_DATE,REPORT_DATE,FISCAL_YEAR,' +
      'CURRENCY,ACCOUNT_STANDARD,REPORT_TYPE',
    quoteColumns: '',
    filter: `(SECUCODE="${stock.code}.HK")`,
    source: 'F10',
    client: 'PC',
    v: '02092616586970355',
  });
  return data[0]?.REPORT_LIST ?? [];
}

async function fetchStatement(
  reportName: string,
  filter: string,
  columns: string
): Promise<HkStatementRow[]> {
  const params = {
    reportName,
    columns,
    quoteColumns: '',
    filter,
    pageNumber: '1',
    pageSize: '1000',
    sortTypes: '-1,1',
    sortColumns: 'REPORT_DATE,STD_ITEM_CODE',
    source: 'F10',
    client: 'PC',
    v: '01975982096513973',
  };

  // 实测三表请求偶发返回 200 + 空数组，空结果重试一次再视为缺失。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rows = await dataRows<HkStatementRow>(params);
    if (rows.length > 0 || attempt === 1) return rows;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  return [];
}

async function fetchIndicators(stock: Stock): Promise<HkIndicatorRow[]> {
  return dataRows<HkIndicatorRow>({
    reportName: INDICATOR_REPORT,
    columns: 'HKF10_FN_MAININDICATOR',
    quoteColumns: '',
    pageNumber: '1',
    pageSize: '24',
    sortTypes: '-1',
    sortColumns: 'STD_REPORT_DATE',
    source: 'F10',
    client: 'PC',
    v: '01975982096513973',
    filter: `(SECUCODE="${stock.code}.HK")`,
  });
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(DATA_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCache(all: Record<string, CacheEntry>): void {
  const now = Date.now();
  for (const key of Object.keys(all)) {
    if (now - all[key].t > DATA_TTL) delete all[key];
  }
  const keys = Object.keys(all);
  if (keys.length > DATA_KEEP) {
    keys
      .sort((a, b) => all[a].t - all[b].t)
      .slice(0, keys.length - DATA_KEEP)
      .forEach((key) => delete all[key]);
  }
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(all));
  } catch {
    localStorage.removeItem(DATA_KEY);
  }
}

function itemName(name: string): string {
  return name.trim().replace(/\s+/g, '').replace(/[：:]/g, '').replace(/帐/g, '账');
}

function statementByPeriod(rows: HkStatementRow[]): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!row.STD_ITEM_NAME || typeof row.AMOUNT !== 'number') continue;
    const period = row.REPORT_DATE.slice(0, 10);
    const items = result.get(period) ?? new Map<string, number>();
    items.set(itemName(row.STD_ITEM_NAME), row.AMOUNT);
    result.set(period, items);
  }
  return result;
}

function pickAmount(items: Map<string, number> | undefined, aliases: string[]): number | null {
  if (!items) return null;
  for (const alias of aliases) {
    const value = items.get(itemName(alias));
    if (value != null) return value;
  }
  return null;
}

function mapStatement(
  items: Map<string, number> | undefined,
  mapping: Record<string, string[]>
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const [name, aliases] of Object.entries(mapping)) {
    result[name] = pickAmount(items, aliases);
  }
  return result;
}

function ratio(value: number | null, denominator: number | null): number | null {
  if (value == null || denominator == null || denominator === 0) return null;
  return (value / denominator) * 100;
}

function add(left: number | null, right: number | null): number | null {
  if (left == null && right == null) return null;
  return (left ?? 0) + (right ?? 0);
}

const INCOME_MAP: Record<string, string[]> = {
  营业额: ['营业额', '营运收入'],
  毛利: ['毛利'],
  经营溢利: ['经营溢利'],
  除税前溢利: ['除税前溢利'],
  税项: ['税项'],
  除税后溢利: ['除税后溢利'],
  少数股东损益: ['少数股东损益'],
  股东应占溢利: ['股东应占溢利'],
  销售及分销费用: ['销售及分销费用'],
  行政开支: ['行政开支'],
  研发费用: ['研发费用'],
  融资成本: ['融资成本'],
  应占联营公司溢利: ['应占联营公司溢利'],
  减值及拨备: ['减值及拨备'],
  基本每股盈利: ['每股基本盈利'],
  摊薄每股盈利: ['每股摊薄盈利'],
};

const BALANCE_MAP: Record<string, string[]> = {
  现金及等价物: ['现金及等价物', '库存现金及短期资金'],
  短期存款: ['短期存款'],
  中长期存款: ['中长期存款'],
  存货: ['存货'],
  应收账款: ['应收账款', '客户贷款及其他款项'],
  应付账款: ['应付账款', '应付账款及其他应付款'],
  物业厂房及设备: ['物业厂房及设备'],
  投资物业: ['投资物业'],
  联营公司权益: ['联营公司权益'],
  无形资产: ['无形资产'],
  商誉: ['商誉'],
  短期贷款: ['短期贷款'],
  长期贷款: ['长期贷款'],
  已发行债券: ['已发行债券', '应付票据'],
  流动资产合计: ['流动资产合计'],
  流动负债合计: ['流动负债合计'],
  总资产: ['总资产'],
  总负债: ['总负债'],
  股东权益: ['归属于母公司股东权益', '股东权益'],
  总权益: ['股东权益合计', '总权益', '净资产'],
  少数股东权益: ['非控股股东权益', '少数股东权益'],
};

const CASHFLOW_MAP: Record<string, string[]> = {
  经营业务现金净额: ['经营业务现金净额'],
  投资业务现金净额: ['投资业务现金净额'],
  融资业务现金净额: ['融资业务现金净额'],
  现金净额: ['现金净额'],
  购建固定资产: ['购建固定资产'],
  购建无形资产及其他资产: ['购建无形资产及其他资产'],
  折旧及摊销: ['加折旧及摊销', '折旧及摊销'],
  减值及拨备: ['加减值及拨备', '减值及拨备'],
  已付税项: ['已付税项'],
};

const INDICATOR_MAP: Record<string, string> = {
  ROE: 'ROE_AVG',
  ROA: 'ROA',
  ROIC: 'ROIC_YEARLY',
  毛利率: 'GROSS_PROFIT_RATIO',
  净利率: 'NET_PROFIT_RATIO',
  营业额同比: 'OPERATE_INCOME_YOY',
  毛利同比: 'GROSS_PROFIT_YOY',
  股东应占溢利同比: 'HOLDER_PROFIT_YOY',
  资产负债率: 'DEBT_ASSET_RATIO',
  流动比率: 'CURRENT_RATIO',
  实际税率: 'TAX_EBT',
  经营现金流营收比: 'OCF_SALES',
  基本每股盈利: 'BASIC_EPS',
  摊薄每股盈利: 'DILUTED_EPS',
  每股净资产: 'BPS',
  每股经营现金流: 'PER_NETCASH_OPERATE',
};

function indicatorValue(row: HkIndicatorRow | undefined, key: string): number | null {
  if (!row) return null;
  const value = row[key];
  return typeof value === 'number' ? value : null;
}

function deriveHkRatios(data: FinanceData): void {
  for (const period of data.periodOrder ?? []) {
    const profit = data.profit[period];
    const balance = data.balance[period];
    const cashflow = data.cashflow[period];
    const indicator = data.indicator[period];
    const revenue = profit?.['营业额'];
    const grossProfit = profit?.['毛利'];
    const parentProfit = profit?.['股东应占溢利'];
    const pretaxProfit = profit?.['除税前溢利'];

    if (revenue != null && revenue !== 0) {
      for (const [expense, ratioKey] of [
        ['销售及分销费用', '销售费用率'],
        ['行政开支', '行政费用率'],
        ['研发费用', '研发费用率'],
        ['融资成本', '融资成本率'],
      ] as const) {
        const value = profit?.[expense];
        if (value != null) profit[ratioKey] = ratio(value, revenue);
      }
      if (grossProfit != null && indicator?.['毛利率'] == null) {
        indicator!['毛利率'] = ratio(grossProfit, revenue);
      }
      if (parentProfit != null && indicator?.['净利率'] == null) {
        indicator!['净利率'] = ratio(parentProfit, revenue);
      }
    }

    const tax = profit?.['税项'];
    if (tax != null && pretaxProfit != null && pretaxProfit !== 0 && indicator?.['实际税率'] == null) {
      indicator!['实际税率'] = ratio(tax, pretaxProfit);
    }

    const totalAssets = balance?.['总资产'];
    const totalLiabilities = balance?.['总负债'];
    if (
      totalAssets != null &&
      totalAssets !== 0 &&
      totalLiabilities != null &&
      indicator?.['资产负债率'] == null
    ) {
      indicator!['资产负债率'] = ratio(totalLiabilities, totalAssets);
    }

    const currentAssets = balance?.['流动资产合计'];
    const currentLiabilities = balance?.['流动负债合计'];
    if (
      currentLiabilities != null &&
      currentLiabilities !== 0 &&
      currentAssets != null &&
      indicator?.['流动比率'] == null
    ) {
      indicator!['流动比率'] = currentAssets / currentLiabilities;
    }

    const operatingCash = cashflow?.['经营业务现金净额'];
    if (
      operatingCash != null &&
      revenue != null &&
      revenue !== 0 &&
      indicator?.['经营现金流营收比'] == null
    ) {
      indicator!['经营现金流营收比'] = ratio(operatingCash, revenue);
    }

    const cash = balance?.['现金及等价物'];
    const shortDeposits = balance?.['短期存款'];
    if (cash != null || shortDeposits != null) {
      balance!['现金及短期存款'] = add(cash, shortDeposits);
    }

    const borrowings = [
      balance?.['短期贷款'],
      balance?.['长期贷款'],
      balance?.['已发行债券'],
    ];
    if (borrowings.some((value) => value != null)) {
      balance!['有息负债'] = borrowings.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    }

    const capex = add(cashflow?.['购建固定资产'] ?? null, cashflow?.['购建无形资产及其他资产'] ?? null);
    if (capex != null) cashflow!['资本开支'] = capex;
    if (operatingCash != null && capex != null) cashflow!['自由现金流'] = operatingCash - capex;
  }
}

function selectPeriods(reports: HkReportRow[]): HkReportRow[] {
  const ordered = reports
    .filter((report) => report.REPORT_DATE && report.REPORT_TYPE)
    .sort((a, b) => b.REPORT_DATE.localeCompare(a.REPORT_DATE));
  const unique = [...new Map(ordered.map((report) => [report.REPORT_DATE.slice(0, 10), report])).values()];
  const annual = unique.filter((report) => report.REPORT_TYPE === '年报').slice(0, 5).reverse();
  const interim = unique.filter((report) => report.REPORT_TYPE === '中报').slice(0, 2).reverse();
  return [...annual, ...interim];
}

function emptyFinanceData(periods: FinancePeriodMeta[], periodOrder: string[]): FinanceData {
  const data: FinanceData = {
    indicator: {},
    profit: {},
    balance: {},
    cashflow: {},
    periods: {},
    periodOrder,
  };
  for (const period of periodOrder) {
    data.indicator[period] = {};
    data.profit[period] = {};
    data.balance[period] = {};
    data.cashflow[period] = {};
    data.periods![period] = periods[periodOrder.indexOf(period)];
  }
  return data;
}

async function loadHkFinance(stock: Stock): Promise<FinanceData> {
  const reports = selectPeriods(await fetchReportList(stock));
  if (reports.length === 0) throw new Error('东财未返回港股报告期');

  const periodOrder = reports.map((report) => report.REPORT_DATE.slice(0, 10));
  const metadata = reports.map<FinancePeriodMeta>((report) => ({
    reportType: report.REPORT_TYPE,
    currency: report.CURRENCY,
    accountingStandard: report.ACCOUNT_STANDARD,
    startDate: report.START_DATE.slice(0, 10),
  }));
  const data = emptyFinanceData(metadata, periodOrder);
  const filter = `(SECUCODE="${stock.code}.HK")(REPORT_DATE in (${periodOrder
    .map((period) => `'${period}'`)
    .join(',')}))`;

  // 东财三表并发时偶发空结果，顺序请求也更稳定。
  const balanceRows = await fetchStatement(BALANCE_REPORT, filter, STATEMENT_COLUMNS);
  const incomeRows = await fetchStatement(INCOME_REPORT, filter, STATEMENT_COLUMNS);
  const cashflowRows = await fetchStatement(CASHFLOW_REPORT, filter, STATEMENT_COLUMNS);
  const indicators = await fetchIndicators(stock);

  const balanceByPeriod = statementByPeriod(balanceRows);
  const incomeByPeriod = statementByPeriod(incomeRows);
  const cashflowByPeriod = statementByPeriod(cashflowRows);
  const indicatorByPeriod = new Map(
    indicators.map((row) => [row.REPORT_DATE.slice(0, 10), row])
  );

  for (const period of periodOrder) {
    data.balance[period] = mapStatement(balanceByPeriod.get(period), BALANCE_MAP);
    data.profit[period] = mapStatement(incomeByPeriod.get(period), INCOME_MAP);
    data.cashflow[period] = mapStatement(cashflowByPeriod.get(period), CASHFLOW_MAP);
    const source = indicatorByPeriod.get(period);
    for (const [name, key] of Object.entries(INDICATOR_MAP)) {
      data.indicator[period][name] = indicatorValue(source, key);
    }
  }

  if ([balanceRows, incomeRows, cashflowRows].every((rows) => rows.length === 0)) {
    throw new Error('东财未返回港股财务报表');
  }
  deriveHkRatios(data);
  return data;
}

export async function fetchHkFinance(stock: Stock): Promise<FinanceData> {
  const cache = CACHE_ON ? readCache() : {};
  const hit = cache[stock.code];
  if (hit && Date.now() - hit.t < DATA_TTL) return hit.d;

  const data = await loadHkFinance(stock);
  if (CACHE_ON) {
    cache[stock.code] = { t: Date.now(), d: data };
    writeCache(cache);
  }
  return data;
}

const toYi = (value: number | null) => (value == null ? null : value / 1e8);

function amountRow(label: string, src: MetricRow['src'], key: string): MetricRow {
  return { label: `${label}(亿)`, src, key, transform: toYi };
}

export const HK_METRIC_GROUPS: MetricGroup[] = [
  {
    title: '盈利指标',
    rows: [
      { label: 'ROE', src: 'indicator', key: 'ROE', pct: true },
      { label: 'ROA', src: 'indicator', key: 'ROA', pct: true },
      { label: 'ROIC', src: 'indicator', key: 'ROIC', pct: true },
      { label: '毛利率', src: 'indicator', key: '毛利率', pct: true },
      { label: '净利率', src: 'indicator', key: '净利率', pct: true },
    ],
  },
  {
    title: '增长',
    rows: [
      { label: '营业额同比', src: 'indicator', key: '营业额同比', pct: true },
      { label: '毛利同比', src: 'indicator', key: '毛利同比', pct: true },
      { label: '股东应占溢利同比', src: 'indicator', key: '股东应占溢利同比', pct: true },
    ],
  },
  {
    title: '每股指标',
    rows: [
      { label: '基本每股盈利', src: 'indicator', key: '基本每股盈利' },
      { label: '摊薄每股盈利', src: 'indicator', key: '摊薄每股盈利' },
      { label: '每股净资产', src: 'indicator', key: '每股净资产' },
      { label: '每股经营现金流', src: 'indicator', key: '每股经营现金流' },
    ],
  },
  {
    title: '收入与利润',
    rows: [
      amountRow('营业额', 'profit', '营业额'),
      amountRow('毛利', 'profit', '毛利'),
      amountRow('经营溢利', 'profit', '经营溢利'),
      amountRow('除税前溢利', 'profit', '除税前溢利'),
      amountRow('股东应占溢利', 'profit', '股东应占溢利'),
      amountRow('销售及分销费用', 'profit', '销售及分销费用'),
      amountRow('行政开支', 'profit', '行政开支'),
      amountRow('研发费用', 'profit', '研发费用'),
      amountRow('融资成本', 'profit', '融资成本'),
      amountRow('应占联营公司溢利', 'profit', '应占联营公司溢利'),
    ],
  },
  {
    title: '现金流',
    rows: [
      amountRow('经营业务现金净额', 'cashflow', '经营业务现金净额'),
      amountRow('投资业务现金净额', 'cashflow', '投资业务现金净额'),
      amountRow('融资业务现金净额', 'cashflow', '融资业务现金净额'),
      amountRow('资本开支', 'cashflow', '资本开支'),
      amountRow('自由现金流', 'cashflow', '自由现金流'),
      amountRow('现金净额', 'cashflow', '现金净额'),
      amountRow('折旧及摊销', 'cashflow', '折旧及摊销'),
      amountRow('已付税项', 'cashflow', '已付税项'),
    ],
  },
  {
    title: '资产负债',
    rows: [
      amountRow('现金及等价物', 'balance', '现金及等价物'),
      amountRow('现金及短期存款', 'balance', '现金及短期存款'),
      amountRow('存货', 'balance', '存货'),
      amountRow('应收账款/客户贷款', 'balance', '应收账款'),
      amountRow('总资产', 'balance', '总资产'),
      amountRow('总负债', 'balance', '总负债'),
      amountRow('股东权益', 'balance', '股东权益'),
      amountRow('有息负债', 'balance', '有息负债'),
      { label: '资产负债率', src: 'indicator', key: '资产负债率', pct: true },
      { label: '流动比率', src: 'indicator', key: '流动比率' },
    ],
  },
  {
    title: '费用与效率',
    rows: [
      { label: '销售费用率', src: 'profit', key: '销售费用率', pct: true },
      { label: '行政费用率', src: 'profit', key: '行政费用率', pct: true },
      { label: '研发费用率', src: 'profit', key: '研发费用率', pct: true },
      { label: '融资成本率', src: 'profit', key: '融资成本率', pct: true },
      { label: '实际税率', src: 'indicator', key: '实际税率', pct: true },
      { label: '经营现金流/营业额', src: 'indicator', key: '经营现金流营收比', pct: true },
    ],
  },
];
