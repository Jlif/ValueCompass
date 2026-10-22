// 验证港股财务适配器：报告期、币种、三表归一化、主要指标和缓存
// 跑法: npm run check:hk-finance
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src', 'services', 'hkFinance.ts'), 'utf8')
  .replace(/import\.meta\.env\.DEV/g, 'false');
const tempDir = mkdtempSync(join(tmpdir(), 'vc-hk-finance-'));
const tempTs = join(tempDir, 'hkFinance.ts');
writeFileSync(tempTs, source);
for (const file of ['cache.ts', 'http.ts']) {
  copyFileSync(join(root, 'src', 'services', file), join(tempDir, file));
}

const store = new Map();
globalThis.window = {};
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const reports = {
  '00700': [
    ['2026-06-30', '中报', '人民币'],
    ['2025-12-31', '年报', '人民币'],
    ['2025-06-30', '中报', '人民币'],
    ['2024-12-31', '年报', '人民币'],
    ['2023-12-31', '年报', '人民币'],
    ['2022-12-31', '年报', '人民币'],
    ['2021-12-31', '年报', '人民币'],
    ['2020-12-31', '年报', '人民币'],
  ],
  '09988': [
    ['2026-03-31', '年报', '人民币'],
    ['2025-09-30', '中报', '人民币'],
    ['2025-03-31', '年报', '人民币'],
    ['2024-09-30', '中报', '人民币'],
    ['2024-03-31', '年报', '人民币'],
  ],
  '00005': [
    ['2025-12-31', '年报', '美元'],
    ['2025-06-30', '中报', '美元'],
    ['2024-12-31', '年报', '美元'],
  ],
};

function reportList(code) {
  return reports[code].map(([date, type, currency]) => ({
    REPORT_DATE: `${date} 00:00:00`,
    START_DATE: `${date.slice(0, 4)}-01-01 00:00:00`,
    FISCAL_YEAR: code === '09988' ? '3-31' : '12-31',
    CURRENCY: currency,
    ACCOUNT_STANDARD: '国际会计准则',
    REPORT_TYPE: type,
  }));
}

function statementItems(code, reportName) {
  if (reportName === 'RPT_HKF10_FN_INCOME_PC') {
    return [
      ['营业额', 751766000000],
      ['毛利', 422593000000],
      ['经营溢利', 241562000000],
      ['除税前溢利', 277249000000],
      ['税项', 47448000000],
      ['股东应占溢利', 224842000000],
      ['销售及分销费用', 41727000000],
      ['行政开支', 136127000000],
      ['研发费用', 66533000000],
      ['融资成本', 15130000000],
      ['应占联营公司溢利', 23740000000],
    ];
  }
  if (reportName === 'RPT_HKF10_FN_BALANCE_PC') {
    if (code === '00005') {
      return [
        ['库存现金及短期资金', 1707007339200],
        ['总资产', 22724349379200],
        ['总负债', 21278764198400],
        ['归属于母公司股东权益', 1393283880000],
        ['已发行债券', 700595640000],
      ];
    }
    return [
      ['现金及等价物', 141041000000],
      ['短期存款', 236801000000],
      ['存货', 530000000],
      ['应收账款', 49930000000],
      ['总资产', 2038986000000],
      ['总负债', 797921000000],
      ['股东权益', 1154152000000],
      ['短期贷款', 42618000000],
      ['长期贷款', 208369000000],
    ];
  }
  return [
    ['经营业务现金净额', 303052000000],
    ['投资业务现金净额', -205732000000],
    ['融资业务现金净额', -87155000000],
    ['现金净额', 10165000000],
    ['购建固定资产', 87482000000],
    ['购建无形资产及其他资产', 25393000000],
    ['加:折旧及摊销', 66028000000],
    ['已付税项', 44699000000],
  ];
}

function requestedDates(filter) {
  return [...filter.matchAll(/'(\d{4}-\d{2}-\d{2})'/g)].map((match) => match[1]);
}

let requestCount = 0;
globalThis.fetch = async (input) => {
  requestCount += 1;
  const url = new URL(String(input));
  const reportName = url.searchParams.get('reportName');
  const columns = url.searchParams.get('columns') || '';
  const filter = url.searchParams.get('filter') || '';
  const code = filter.match(/SECUCODE="(\d+)\.HK"/)?.[1];

  if (reportName === 'RPT_CUSTOM_HKSK_APPFN_CASHFLOW_SUMMARY') {
    return Response.json({ result: { data: [{ REPORT_LIST: reportList(code) }] } });
  }
  if (reportName === 'RPT_HKF10_FN_MAININDICATOR') {
    return Response.json({
      result: {
        data: reports[code].map(([date]) => ({
          REPORT_DATE: `${date} 00:00:00`,
          ROE_AVG: 21.1347,
          ROA: 11.7719,
          ROIC_YEARLY: 15.2467,
          GROSS_PROFIT_RATIO: 56.2134,
          NET_PROFIT_RATIO: 30.5682,
          OPERATE_INCOME_YOY: 13.8596,
          HOLDER_PROFIT_YOY: 15.8543,
          DEBT_ASSET_RATIO: 39.1332,
          BASIC_EPS: 24.749,
          BPS: 126.9325,
        })),
      },
    });
  }

  if (
    reportName?.endsWith('_PC') &&
    (columns.includes('START_DATE') || columns.includes('STD_REPORT_DATE'))
  ) {
    return Response.json({
      result: null,
      success: false,
      message: '可选报告字段返回不存在',
    });
  }

  const dates = requestedDates(filter);
  const items = statementItems(code, reportName);
  return Response.json({
    result: {
      data: dates.flatMap((date) =>
        items.map(([name, amount]) => ({
          REPORT_DATE: `${date} 00:00:00`,
          STD_ITEM_NAME: name,
          AMOUNT: amount,
        }))
      ),
    },
  });
};

const { fetchHkFinance, HK_METRIC_GROUPS } = await import(tempTs);
const assert = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${message}`);
  if (!ok) process.exitCode = 1;
};

const tencent = await fetchHkFinance({ code: '00700', name: '腾讯控股', exchange: 'HK' });
assert(
  tencent.periodOrder.join(',') ===
    '2021-12-31,2022-12-31,2023-12-31,2024-12-31,2025-12-31,2025-06-30,2026-06-30',
  '腾讯报告期按 5 年报 + 2 中报排序'
);
assert(tencent.periods?.['2025-12-31'].currency === '人民币', '腾讯报表币种为人民币');
assert(tencent.profit['2025-12-31']['营业额'] === 751766000000, '利润表保留原始币种金额');
assert(tencent.indicator['2025-12-31']['ROE'] === 21.1347, '港股 ROE 直接取主要指标');
assert(tencent.cashflow['2025-12-31']['自由现金流'] === 190177000000, '自由现金流按 CFO - Capex 派生');
assert(HK_METRIC_GROUPS.some((group) => group.title === '现金流'), '港股专用指标组已生成');

const alibaba = await fetchHkFinance({ code: '09988', name: '阿里巴巴', exchange: 'HK' });
assert(alibaba.periodOrder.includes('2026-03-31'), '支持非 12 月财年');
assert(alibaba.periods?.['2026-03-31'].reportType === '年报', '非自然年仍按报告类型标记年报');

const hsbc = await fetchHkFinance({ code: '00005', name: '汇丰控股', exchange: 'HK' });
assert(hsbc.periods?.['2025-12-31'].currency === '美元', '支持美元报表');
assert(hsbc.balance['2025-12-31']['总资产'] === 22724349379200, '兼容银行报表科目名称');
assert(hsbc.balance['2025-12-31']['股东权益'] === 1393283880000, '银行归母权益映射正确');

requestCount = 0;
await fetchHkFinance({ code: '00700', name: '腾讯控股', exchange: 'HK' });
assert(requestCount === 0, '归一化财报缓存可复用');
