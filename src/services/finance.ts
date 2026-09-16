import type { Stock } from '../types';

// 东财 F10 财务数据（akshare 同款数据源，JSON 接口）
// 三表: Zcfzb(资产负债) / Lrb(利润) / Xjllb(现金流)，单位:元 → 存万元
// 指标: datacenter 主要指标（不分公司类型，pageSize 可覆盖 F10 显示的 7 期）

export interface FinanceDict {
  // 报告期 -> 科目名 -> 值（null 表示缺失）
  [period: string]: Record<string, number | null>;
}

export interface FinanceData {
  indicator: FinanceDict;
  profit: FinanceDict; // 万元
  balance: FinanceDict; // 万元
  cashflow: FinanceDict; // 万元
}

const isTauri = '__TAURI_INTERNALS__' in window;
const EM_HOST = 'https://emweb.securities.eastmoney.com';
const DC_HOST = 'https://datacenter.eastmoney.com';

async function emJson(path: string): Promise<any> {
  const res = isTauri
    ? await (await import('@tauri-apps/plugin-http')).fetch(EM_HOST + path)
    : await fetch(`/em${path}`);
  if (!res.ok) throw new Error(`东财接口 ${res.status}`);
  return res.json();
}

// datacenter 接口自带 CORS 头，浏览器直连无需代理
async function dcJson(path: string): Promise<any> {
  const res = isTauri
    ? await (await import('@tauri-apps/plugin-http')).fetch(DC_HOST + path)
    : await fetch(DC_HOST + path);
  if (!res.ok) throw new Error(`东财接口 ${res.status}`);
  return res.json();
}

function emCode(stock: Stock): string {
  return `${/^[69]/.test(stock.code) ? 'SH' : /^[48]/.test(stock.code) ? 'BJ' : 'SZ'}${stock.code}`;
}

interface EmRow {
  REPORT_DATE: string;
  [k: string]: number | string | null;
}

// ===== 本地缓存 =====
// 开发模式旁路财报缓存：改前端代码后刷新即是最新数据，不会被旧缓存误导。
// 公司类型缓存不旁路——它永不变化，也没有误导调试的可能。
const CACHE_ON = !import.meta.env.DEV;
const DATA_KEY = 'vc.finance.v1';
const CT_KEY = 'vc.companyType.v1';
// 东财按公司类型分四套报表（4通用/2保险/3券商/1银行），无类型探测接口，并行取首个有数据的
const CT_LIST = [4, 2, 3, 1];
const DATA_TTL = 24 * 3600 * 1000; // 财报季度更新，缓存 1 天
const DATA_KEEP = 60; // 最多留 60 只，防 localStorage 超限

interface CacheEntry {
  t: number;
  d: FinanceData;
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(DATA_KEY) || '{}');
  } catch {
    return {}; // 数据损坏直接丢弃
  }
}

function writeCache(all: Record<string, CacheEntry>): void {
  const now = Date.now();
  for (const k of Object.keys(all)) if (now - all[k].t > DATA_TTL) delete all[k];
  const keys = Object.keys(all);
  if (keys.length > DATA_KEEP) {
    keys
      .sort((a, b) => all[a].t - all[b].t)
      .slice(0, keys.length - DATA_KEEP)
      .forEach((k) => delete all[k]);
  }
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(all));
  } catch {
    localStorage.removeItem(DATA_KEY); // ponytail: 超限就清空重来，不做精细淘汰
  }
}

function readCt(code: string): number | null {
  const v = Number(localStorage.getItem(`${CT_KEY}.${code}`));
  return CT_LIST.includes(v) ? v : null;
}

async function probeWithRows(stock: Stock, dates: string): Promise<{ ct: number; rows: EmRow[] }> {
  const code = emCode(stock);
  const known = readCt(stock.code);
  const types = known ? [known] : CT_LIST;
  const probes = await Promise.allSettled(
    types.map(async (t) => {
      const rows = (
        await emJson(
          `/PC_HSF10/NewFinanceAnalysis/ZcfzbAjaxNew?companyType=${t}&reportDateType=0&reportType=1&dates=${dates}&code=${code}`
        )
      ).data;
      if (!rows?.length) throw new Error(`companyType=${t} 无数据`);
      return rows as EmRow[];
    })
  );
  const hit = probes.findIndex((p) => p.status === 'fulfilled');
  if (hit < 0) {
    // 已知类型失效（东财改了分类），清掉缓存下次重新探测
    if (known) localStorage.removeItem(`${CT_KEY}.${stock.code}`);
    throw new Error('东财资产负债表无数据');
  }
  const ct = types[hit];
  localStorage.setItem(`${CT_KEY}.${stock.code}`, String(ct));
  return { ct, rows: (probes[hit] as PromiseFulfilledResult<EmRow[]>).value };
}

async function emRows(api: string, stock: Stock, dates: string, ct: number): Promise<EmRow[]> {
  const res = await emJson(
    `/PC_HSF10/NewFinanceAnalysis/${api}AjaxNew?companyType=${ct}&reportDateType=0&reportType=1&dates=${dates}&code=${emCode(stock)}`
  );
  return (res.data ?? []) as EmRow[];
}

// ===== 科目映射（东财字段 → 现有中文科目名，下游 deriveMetrics/METRIC_GROUPS 零改动）=====
// string: 直接映射；string[]: 依次取首个非空（新旧准则科目并存时用）
// ponytail: OILGAS_BIOLOGY_DEPR 与 FA_IR_DEPR 是重复填充（中石油实测同值），只取 FA_IR_DEPR
type FieldSpec = string | string[];

const BALANCE_MAP: Record<string, FieldSpec> = {
  '货币资金': 'MONETARYFUNDS',
  '交易性金融资产': ['TRADE_FINASSET_NOTFVTPL', 'TRADE_FINASSET'],
  '存货': 'INVENTORY',
  '应收票据及应收账款': 'NOTE_ACCOUNTS_RECE',
  '应收账款': 'ACCOUNTS_RECE',
  '应付票据及应付账款': 'NOTE_ACCOUNTS_PAYABLE',
  '应付账款': 'ACCOUNTS_PAYABLE',
  // 新准则下多用合同负债，雪球同款口径
  '预收款项': ['ADVANCE_RECEIVABLES', 'CONTRACT_LIAB'],
  '固定资产净额': 'FIXED_ASSET',
  '投资性房地产': 'INVEST_REALESTATE',
  '长期股权投资': 'LONG_EQUITY_INVEST',
  '其他权益工具投资': 'OTHER_EQUITY_INVEST',
  '商誉': 'GOODWILL',
  '短期借款': 'SHORT_LOAN',
  '长期借款': 'LONG_LOAN',
  '应付债券': 'BOND_PAYABLE',
  '一年内到期的非流动负债': 'NONCURRENT_LIAB_1YEAR',
  '流动资产合计': 'TOTAL_CURRENT_ASSETS',
  '流动负债合计': 'TOTAL_CURRENT_LIAB',
  '资产总计': 'TOTAL_ASSETS',
  '归属于母公司股东权益合计': 'TOTAL_PARENT_EQUITY',
};

const PROFIT_MAP: Record<string, FieldSpec> = {
  '一、营业总收入': 'TOTAL_OPERATE_INCOME',
  '营业成本': 'OPERATE_COST',
  '销售费用': 'SALE_EXPENSE',
  '管理费用': 'MANAGE_EXPENSE',
  '研发费用': 'RESEARCH_EXPENSE',
  '财务费用': 'FINANCE_EXPENSE',
  '营业税金及附加': 'OPERATE_TAX_ADD',
  '投资收益': 'INVEST_INCOME',
  '公允价值变动收益': 'FAIRVALUE_CHANGE_INCOME',
  '利润总额': 'TOTAL_PROFIT',
  '所得税费用': 'INCOME_TAX',
  '归属于母公司所有者的净利润': 'PARENT_NETPROFIT',
  // 新准则损失以负数列示
  '资产减值损失': ['ASSET_IMPAIRMENT_INCOME', 'ASSET_IMPAIRMENT_LOSS'],
  '信用减值损失': ['CREDIT_IMPAIRMENT_INCOME', 'CREDIT_IMPAIRMENT_LOSS'],
};

const CASHFLOW_MAP: Record<string, FieldSpec> = {
  '经营活动产生的现金流量净额': 'NETCASH_OPERATE',
  '投资活动产生的现金流量净额': 'NETCASH_INVEST',
  '筹资活动产生的现金流量净额': 'NETCASH_FINANCE',
  '五、现金及现金等价物净增加额': 'CCE_ADD',
  '购建固定资产、无形资产和其他长期资产所支付的现金': 'CONSTRUCT_LONG_ASSET',
  '固定资产折旧、油气资产折耗、生产性物资折旧': 'FA_IR_DEPR',
  '无形资产摊销': 'IA_AMORTIZE',
  '长期待摊费用摊销': 'LPE_AMORTIZE',
};

// ZYZB 主要指标（原单位: 百分数/元/次），不除 1e4；方向与三表一致: 中文科目 -> 东财字段
const ZYZB_INDICATOR: Record<string, string> = {
  '净资产收益率(%)': 'ROEJQ',
  '总资产利润率(%)': 'ZZCJLL',
  '销售净利率(%)': 'XSJLL',
  '主营业务收入增长率(%)': 'TOTALOPERATEREVETZ',
  '扣除非经常性损益后的净利润(元)': 'KCFJCXSYJLR',
  '扣非同比': 'KCFJCXSYJLRTZ',
  '资产负债率(%)': 'ZCFZL',
  '存货周转天数(天)': 'CHZZTS',
  '应收账款周转天数(天)': 'YSZKZZTS',
  '总资产周转率(次)': 'TOAZZL',
  '基本每股收益(元)': 'EPSJB',
  '每股净资产(元)': 'BPS',
  '每股经营性现金流(元)': 'MGJYXJJE',
};

const ZYZB_PROFIT: Record<string, string> = {
  '归母净利同比': 'PARENTNETPROFITTZ',
};

function mapOne(row: EmRow, map: Record<string, FieldSpec>, toWan: boolean): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [cn, spec] of Object.entries(map)) {
    const keys = Array.isArray(spec) ? spec : [spec];
    for (const k of keys) {
      const v = row[k];
      if (typeof v === 'number') {
        out[cn] = toWan ? v / 1e4 : v;
        break;
      }
    }
  }
  return out;
}

// F10 显示 5 年报 + 2 半年报（以指标接口实际披露为准）；三表多拉兜底
export async function fetchFinance(stock: Stock): Promise<FinanceData> {
  const all = CACHE_ON ? readCache() : {};
  const hit = all[stock.code];
  if (hit && Date.now() - hit.t < DATA_TTL) return hit.d;

  const thisYear = new Date().getFullYear();
  const periods = [
    ...Array.from({ length: 6 }, (_, i) => `${thisYear - i}-12-31`),
    `${thisYear}-06-30`,
    `${thisYear - 1}-06-30`,
    `${thisYear - 2}-06-30`,
  ];
  // dates 每次最多 5 个；首批资产负债表请求同时完成公司类型探测
  const first = await probeWithRows(stock, periods.slice(0, 5).join(','));
  const rest = periods.slice(5).join(',');
  const secu = `${emCode(stock).slice(2)}.${emCode(stock).slice(0, 2)}`;
  const [b2, l1, l2, x1, x2, zyzb] = await Promise.all([
    emRows('Zcfzb', stock, rest, first.ct),
    emRows('Lrb', stock, periods.slice(0, 5).join(','), first.ct),
    emRows('Lrb', stock, rest, first.ct),
    emRows('Xjllb', stock, periods.slice(0, 5).join(','), first.ct),
    emRows('Xjllb', stock, rest, first.ct),
    dcJson(
      `/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=${encodeURIComponent(
        `(SECUCODE="${secu}")`
      )}&pageNumber=1&pageSize=21&sortColumns=REPORT_DATE&sortTypes=-1&source=HSF10&client=PC`
    ),
  ]);
  const data: FinanceData = {
    indicator: {},
    profit: {},
    balance: {},
    cashflow: {},
  };
  const put = (dict: FinanceDict, rows: EmRow[], map: Record<string, FieldSpec>, toWan: boolean) => {
    for (const r of rows) dict[r.REPORT_DATE.slice(0, 10)] = mapOne(r, map, toWan);
  };
  put(data.balance, [...first.rows, ...b2], BALANCE_MAP, true);
  put(data.profit, [...l1, ...l2], PROFIT_MAP, true);
  put(data.cashflow, [...x1, ...x2], CASHFLOW_MAP, true);
  for (const r of ((zyzb.result?.data ?? []) as EmRow[])) {
    const p = r.REPORT_DATE.slice(0, 10);
    data.indicator[p] = mapOne(r, ZYZB_INDICATOR, false);
    data.profit[p] = { ...data.profit[p], ...mapOne(r, ZYZB_PROFIT, false) };
  }
  deriveMetrics(data);
  if (CACHE_ON) {
    all[stock.code] = { t: Date.now(), d: data };
    writeCache(all);
  }
  return data;
}

// ===== 派生指标 =====
// 全部以百分数形式写入（如 23.4 表示 23.4%），放 profit/balance 数据集，供表格直接取列

// 从数据集某期取第一个非空字段
function pick(src: FinanceDict, p: string, keys: string[]): number | null {
  for (const k of keys) {
    const v = src[p]?.[k];
    if (v != null) return v;
  }
  return null;
}

function deriveMetrics(data: FinanceData): void {
  const periods = new Set([...Object.keys(data.profit), ...Object.keys(data.balance)]);
  for (const p of periods) {
    const rev = pick(data.profit, p, ['一、营业总收入', '营业总收入']);
    if (rev != null && rev !== 0) {
      // 费用率
      const ratios: Array<[string, string]> = [
        ['销售费用', '销售费用率'],
        ['管理费用', '管理费用率'],
        ['研发费用', '研发费用率'],
        ['财务费用', '财务费用率'],
        ['营业税金及附加', '税金及附加率'],
      ];
      for (const [src, dst] of ratios) {
        const v = data.profit[p]?.[src];
        if (v != null) data.profit[p][dst] = (v / rev) * 100;
      }
      // 毛利率 = (营收-营业成本)/营收
      const cost = data.profit[p]?.['营业成本'];
      if (cost != null) data.profit[p]['毛利率'] = ((rev - cost) / rev) * 100;
      // 税前经营利润率 = (利润总额 - 投资收益 - 公允价值变动收益)/营收
      const tp = pick(data.profit, p, ['利润总额', '四、利润总额']);
      if (tp != null) {
        const inv = data.profit[p]?.['投资收益'] ?? 0;
        const fv = data.profit[p]?.['公允价值变动收益'] ?? 0;
        data.profit[p]['税前经营利润率'] = ((tp - inv - fv) / rev) * 100;
      }
      // 实际所得税率 = 所得税/利润总额
      const tax = pick(data.profit, p, ['减：所得税费用', '所得税费用', '所得税']);
      if (tax != null && tp != null && tp !== 0) data.profit[p]['实际所得税率'] = (tax / tp) * 100;
      // 折旧摊销合计（绝对值入 cashflow 集合，万元）
      const dep =
        (data.cashflow[p]?.['固定资产折旧、油气资产折耗、生产性物资折旧'] ?? 0) +
        (data.cashflow[p]?.['无形资产摊销'] ?? 0) +
        (data.cashflow[p]?.['长期待摊费用摊销'] ?? 0);
      if (dep !== 0) data.cashflow[p]['折旧摊销'] = dep;
      // 应付账款周转天数 = 应付账款/营业成本×365（期末值简化口径）
      const ap = pick(data.balance, p, ['应付票据及应付账款', '应付账款']);
      if (ap != null && cost != null && cost !== 0) data.profit[p]['应付账款周转天数'] = (ap / cost) * 365;
      // 固定资产周转率 = 营业总收入/固定资产净额（东财指标接口无此字段）
      const fa = data.balance[p]?.['固定资产净额'];
      if (fa != null && fa !== 0) data.profit[p]['固定资产周转率'] = rev / fa;
      // ROIC（简化口径）= 归母净利 / (归母净资产 + 有息负债 - 货币资金)
      const ni = data.profit[p]?.['归属于母公司所有者的净利润'];
      const equity = data.balance[p]?.['归属于母公司股东权益合计'];
      const debt =
        (data.balance[p]?.['短期借款'] ?? 0) +
        (data.balance[p]?.['长期借款'] ?? 0) +
        (data.balance[p]?.['应付债券'] ?? 0) +
        (data.balance[p]?.['一年内到期的非流动负债'] ?? 0);
      const cashV = data.balance[p]?.['货币资金'];
      if (ni != null && equity != null && cashV != null) {
        const invested = equity + debt - cashV;
        if (invested !== 0) data.profit[p]['ROIC'] = (ni / invested) * 100;
      }
    }
    // 净营运资本 = 流动资产 - 流动负债
    const ca = data.balance[p]?.['流动资产合计'];
    const cl = data.balance[p]?.['流动负债合计'];
    if (ca != null && cl != null) data.balance[p]['净营运资本'] = ca - cl;
    // 资产负债结构占比（分母:资产总计）
    const ta = data.balance[p]?.['资产总计'];
    if (ta != null && ta !== 0) {
      const pctOf = (dst: string, ...keys: string[]) => {
        let sum = 0;
        let has = false;
        for (const k of keys) {
          const v = data.balance[p]?.[k];
          if (v != null) {
            sum += v;
            has = true;
          }
        }
        if (has) data.balance[p][dst] = (sum / ta) * 100;
      };
      pctOf('货币资金占比', '货币资金');
      pctOf('现金占比', '货币资金', '交易性金融资产');
      pctOf('存货占比', '存货');
      pctOf('应收款占比', '应收票据及应收账款', '应收账款');
      pctOf('应付款占比', '应付票据及应付账款', '应付账款');
      pctOf('预收款占比', '预收款项');
      pctOf('固定资产占比', '固定资产净额', '固定资产及清理(合计)');
      pctOf('投资性房地产占比', '投资性房地产');
      pctOf('长期股权投资占比', '长期股权投资');
      pctOf('商誉占比', '商誉');
      pctOf('有息负债率', '短期借款', '长期借款', '应付债券', '一年内到期的非流动负债');
    }
  }

  // "占归母净利比"类指标（同比类已由东财 ZYZB 直接提供）
  for (const p of periods) {
    const ni = data.profit[p]?.['归属于母公司所有者的净利润'];
    if (ni != null && ni !== 0) {
      const ofNi = (dst: string, v: number | null | undefined) => {
        if (v != null) data.profit[p][dst] = (v / ni) * 100;
      };
      ofNi('投资收益/归母净利', data.profit[p]?.['投资收益']);
      // 新准则拆为资产/信用减值两项，损失为负值
      const imp1 = data.profit[p]?.['资产减值损失'];
      const imp2 = data.profit[p]?.['信用减值损失'];
      if (imp1 != null || imp2 != null) ofNi('减值损失/归母净利', (imp1 ?? 0) + (imp2 ?? 0));
      ofNi('折旧摊销/归母净利', data.cashflow[p]?.['折旧摊销']);
    }
  }
}

// 万元 -> 亿元
const WAN_TO_YI = (v: number | null) => (v == null ? null : v / 1e4);

// 分组的指标表定义（顺序对照雪球 F10 参考表格）
export interface MetricRow {
  label: string;
  src: keyof FinanceData;
  key: string;
  alt?: string; // 同行第二指标，值以 " / " 拼接展示（构成类指标）
  pct?: boolean;
  transform?: (v: number | null) => number | null;
}

export interface MetricGroup {
  title: string;
  rows: MetricRow[];
}

export const METRIC_GROUPS: MetricGroup[] = [
  {
    title: '盈利指标',
    rows: [
      { label: 'ROE', src: 'indicator', key: '净资产收益率(%)', pct: true },
      { label: 'ROA', src: 'indicator', key: '总资产利润率(%)', pct: true },
      { label: 'ROIC', src: 'profit', key: 'ROIC', pct: true },
      { label: '毛利率', src: 'profit', key: '毛利率', pct: true },
      { label: '净利率', src: 'indicator', key: '销售净利率(%)', pct: true },
    ],
  },
  {
    title: '收入与利润',
    rows: [
      { label: '营业收入(亿)', src: 'profit', key: '一、营业总收入', transform: WAN_TO_YI },
      { label: '营收同比', src: 'indicator', key: '主营业务收入增长率(%)', pct: true },
      { label: '归母净利(亿)', src: 'profit', key: '归属于母公司所有者的净利润', transform: WAN_TO_YI },
      { label: '归母净利同比', src: 'profit', key: '归母净利同比', pct: true },
      { label: '扣非净利(亿)', src: 'indicator', key: '扣除非经常性损益后的净利润(元)', transform: (v) => (v == null ? null : v / 1e8) },
      { label: '扣非同比', src: 'indicator', key: '扣非同比', pct: true },
      { label: '经营现金流CFO(亿)', src: 'cashflow', key: '经营活动产生的现金流量净额', transform: WAN_TO_YI },
      { label: '资本开支(亿)', src: 'cashflow', key: '购建固定资产、无形资产和其他长期资产所支付的现金', transform: WAN_TO_YI },
      { label: '投资现金流CFI(亿)', src: 'cashflow', key: '投资活动产生的现金流量净额', transform: WAN_TO_YI },
      { label: '筹资现金流CFF(亿)', src: 'cashflow', key: '筹资活动产生的现金流量净额', transform: WAN_TO_YI },
      { label: '现金净增加额(亿)', src: 'cashflow', key: '五、现金及现金等价物净增加额', transform: WAN_TO_YI },
      { label: '总资产(亿)', src: 'balance', key: '资产总计', transform: WAN_TO_YI },
      { label: '归母净资产(亿)', src: 'balance', key: '归属于母公司股东权益合计', transform: WAN_TO_YI },
      { label: '净营运资本(亿)', src: 'balance', key: '净营运资本', transform: WAN_TO_YI },
    ],
  },
  {
    title: '费用与比率',
    rows: [
      { label: '税金及附加率', src: 'profit', key: '税金及附加率', pct: true },
      { label: '销售费用率', src: 'profit', key: '销售费用率', pct: true },
      { label: '管理费用率', src: 'profit', key: '管理费用率', pct: true },
      { label: '研发费用率', src: 'profit', key: '研发费用率', pct: true },
      { label: '财务费用率', src: 'profit', key: '财务费用率', pct: true },
      { label: '投资收益/归母净利', src: 'profit', key: '投资收益/归母净利', pct: true },
      { label: '实际所得税率', src: 'profit', key: '实际所得税率', pct: true },
      { label: '减值损失/归母净利', src: 'profit', key: '减值损失/归母净利', pct: true },
      { label: '折旧摊销/归母净利', src: 'profit', key: '折旧摊销/归母净利', pct: true },
    ],
  },
  {
    title: '资产负债结构',
    rows: [
      { label: '现金占比', src: 'balance', key: '现金占比', pct: true },
      { label: '货币资金/交易性金融资产(亿)', src: 'balance', key: '货币资金', alt: '交易性金融资产', transform: WAN_TO_YI },
      { label: '货币资金占比', src: 'balance', key: '货币资金占比', pct: true },
      { label: '存货占比', src: 'balance', key: '存货占比', pct: true },
      { label: '应收款占比', src: 'balance', key: '应收款占比', pct: true },
      { label: '应付款占比', src: 'balance', key: '应付款占比', pct: true },
      { label: '预收款占比', src: 'balance', key: '预收款占比', pct: true },
      { label: '固定资产占比', src: 'balance', key: '固定资产占比', pct: true },
      { label: '投资性房地产占比', src: 'balance', key: '投资性房地产占比', pct: true },
      { label: '长期股权投资占比', src: 'balance', key: '长期股权投资占比', pct: true },
      { label: '长期股权投资/其他权益工具投资(亿)', src: 'balance', key: '长期股权投资', alt: '其他权益工具投资', transform: WAN_TO_YI },
      { label: '商誉占比', src: 'balance', key: '商誉占比', pct: true },
    ],
  },
  {
    title: '杠杆',
    rows: [
      { label: '资产负债率', src: 'indicator', key: '资产负债率(%)', pct: true },
      { label: '有息负债率', src: 'balance', key: '有息负债率', pct: true },
    ],
  },
  {
    title: '营运能力',
    rows: [
      { label: '存货周转天数', src: 'indicator', key: '存货周转天数(天)' },
      { label: '应收账款周转天数', src: 'indicator', key: '应收账款周转天数(天)' },
      { label: '应付账款周转天数', src: 'profit', key: '应付账款周转天数' },
      { label: '固定资产周转率(次)', src: 'profit', key: '固定资产周转率' },
      { label: '总资产周转率(次)', src: 'indicator', key: '总资产周转率(次)' },
    ],
  },
  {
    title: '每股指标',
    rows: [
      { label: 'EPS(基本)', src: 'indicator', key: '基本每股收益(元)' },
      { label: '每股净资产', src: 'indicator', key: '每股净资产(元)' },
      { label: '每股经营现金流', src: 'indicator', key: '每股经营性现金流(元)' },
    ],
  },
];
