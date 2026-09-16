import type { Stock } from '../types';

// 新浪财务数据（akshare 同款数据源，直接抓 HTML 解析，无需 python）
// 指标页: vFD_FinancialGuideLine  报表页: vFD_ProfitStatement / vFD_BalanceSheet / vFD_CashFlow（单位:万元）

export interface SinaFinance {
  // 报告期 -> 指标名 -> 值（null 表示缺失）
  [period: string]: Record<string, number | null>;
}

const GBK = new TextDecoder('gbk');

// Tauri 环境用 plugin-http 绕 CORS（打包版无 Vite 代理），浏览器走 /sina 代理
const isTauri = '__TAURI_INTERNALS__' in window;

async function fetchPage(stock: Stock, page: string, year: number): Promise<string> {
  const path = `/corp/go.php/${page}/stockid/${stock.code}/ctrl/${year}/displaytype/4.phtml`;
  const res = isTauri
    ? await (await import('@tauri-apps/plugin-http')).fetch(`https://money.finance.sina.com.cn${path}`)
    : await fetch(`/sina${path}`);
  if (!res.ok) throw new Error(`新浪接口 ${res.status}`);
  return GBK.decode(await res.arrayBuffer());
}

// 解析报表表格：首行（报告日期/报表日期）是各报告期，其余行是 指标名 + 各期值
function parseTable(html: string): SinaFinance {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = Array.from(doc.querySelectorAll('table')).find((t) => {
    const text = t.textContent || '';
    return text.includes('报告日期') || text.includes('报表日期');
  });
  if (!table) throw new Error('页面结构变化，未找到财务数据表');

  const result: SinaFinance = {};
  let periods: string[] = [];
  for (const tr of table.querySelectorAll('tr')) {
    const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() || '');
    if (cells[0] === '报告日期' || cells[0] === '报表日期') {
      periods = cells.slice(1).filter(Boolean);
      for (const p of periods) result[p] = result[p] || {};
      continue;
    }
    // 分类行（如"每股指标"）只有一格，跳过
    if (periods.length === 0 || cells.length < 2) continue;
    const name = cells[0];
    if (!name) continue;
    periods.forEach((p, i) => {
      const raw = cells[i + 1];
      const v = raw && raw !== '--' ? parseFloat(raw.replace(/,/g, '')) : NaN;
      result[p][name] = Number.isNaN(v) ? null : v;
    });
  }
  return result;
}

export interface SinaData {
  indicator: SinaFinance; // 财务指标页
  profit: SinaFinance; // 利润表（万元）
  balance: SinaFinance; // 资产负债表（万元）
  cashflow: SinaFinance; // 现金流量表（万元）
}

// ===== 东财补充源 =====
// 新浪资产负债表模板停留在旧准则科目，缺「其他权益工具投资」等新准则科目，
// 从东财 F10 按需补充（东财单位:元，转万元与新浪对齐）。失败静默降级，不影响新浪主数据。
interface EmBalanceRow {
  REPORT_DATE: string;
  OTHER_EQUITY_INVEST: number | null;
}

const EM_HOST = 'https://emweb.securities.eastmoney.com';

async function emFetch(path: string): Promise<{ data?: EmBalanceRow[] }> {
  const res = isTauri
    ? await (await import('@tauri-apps/plugin-http')).fetch(EM_HOST + path)
    : await fetch(`/em${path}`);
  if (!res.ok) throw new Error(`东财接口 ${res.status}`);
  return res.json();
}

// 东财按公司类型分四套表（4通用/2保险/3券商/1银行），无类型探测接口，并行取首个有数据的
async function emBalanceRows(stock: Stock, dates: string, ct?: number): Promise<{ ct: number; rows: EmBalanceRow[] }> {
  const code = `${/^[69]/.test(stock.code) ? 'SH' : /^[48]/.test(stock.code) ? 'BJ' : 'SZ'}${stock.code}`;
  const q = (t: number) =>
    `/PC_HSF10/NewFinanceAnalysis/ZcfzbAjaxNew?companyType=${t}&reportDateType=0&reportType=1&dates=${dates}&code=${code}`;
  const probes = await Promise.allSettled(
    (ct ? [ct] : [4, 2, 3, 1]).map(async (t) => {
      const rows = (await emFetch(q(t))).data;
      if (!rows?.length) throw new Error(`companyType=${t} 无数据`);
      return rows;
    })
  );
  const hit = probes.findIndex((p) => p.status === 'fulfilled');
  if (hit < 0) throw new Error('东财资产负债表无数据');
  return { ct: (ct ? [ct] : [4, 2, 3, 1])[hit], rows: (probes[hit] as PromiseFulfilledResult<EmBalanceRow[]>).value };
}

async function fetchEmBalance(stock: Stock, periods: string[]): Promise<SinaFinance> {
  const out: SinaFinance = {};
  try {
    // dates 每次最多 5 个；首个请求同时完成类型探测
    let { ct, rows } = await emBalanceRows(stock, periods.slice(0, 5).join(','));
    const rest = periods.slice(5);
    if (rest.length) rows = rows.concat((await emBalanceRows(stock, rest.join(','), ct)).rows);
    for (const d of rows) {
      const p = d.REPORT_DATE.slice(0, 10);
      if (d.OTHER_EQUITY_INVEST != null) out[p] = { ...out[p], 其他权益工具投资: d.OTHER_EQUITY_INVEST / 1e4 };
    }
  } catch {
    // ponytail: 东财仅是补充字段，任一环节失败就放弃补充
  }
  return out;
}

// 最近 5 个年报 + 2 个半年报需要 6 个年度页（每年一页含 4 期）
export async function fetchSinaFinance(stock: Stock, years = 6): Promise<SinaData> {
  const thisYear = new Date().getFullYear();
  const yearList = Array.from({ length: years }, (_, i) => thisYear - i);
  const [indicators, profits, balances, cashflows] = await Promise.all([
    Promise.all(yearList.map((y) => fetchPage(stock, 'vFD_FinancialGuideLine', y))).then((pages) => pages.map(parseTable)),
    Promise.all(yearList.map((y) => fetchPage(stock, 'vFD_ProfitStatement', y))).then((pages) => pages.map(parseTable)),
    Promise.all(yearList.map((y) => fetchPage(stock, 'vFD_BalanceSheet', y))).then((pages) => pages.map(parseTable)),
    Promise.all(yearList.map((y) => fetchPage(stock, 'vFD_CashFlow', y))).then((pages) => pages.map(parseTable)),
  ]);
  const merge = (parts: SinaFinance[]): SinaFinance => Object.assign({}, ...parts);
  const data: SinaData = {
    indicator: merge(indicators),
    profit: merge(profits),
    balance: merge(balances),
    cashflow: merge(cashflows),
  };
  // 补充新准则科目（F10 显示 5 年报 + 2 半年报）；按期深合并，避免覆盖新浪同期的整行数据
  const emPeriods = [
    ...yearList.map((y) => `${y}-12-31`),
    `${thisYear - 1}-06-30`,
    `${thisYear - 2}-06-30`,
  ];
  const em = await fetchEmBalance(stock, emPeriods);
  for (const p of Object.keys(em)) data.balance[p] = { ...data.balance[p], ...em[p] };
  deriveMetrics(data);
  return data;
}

// ===== 派生指标 =====
// 全部以百分数形式写入（如 23.4 表示 23.4%），放 profit/balance 数据集，供表格直接取列

// 从数据集某期取第一个非空字段
function pick(src: SinaFinance, p: string, keys: string[]): number | null {
  for (const k of keys) {
    const v = src[p]?.[k];
    if (v != null) return v;
  }
  return null;
}

function deriveMetrics(data: SinaData): void {
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
      // 毛利率 = (营收-营业成本)/营收（新浪部分股票毛利率字段缺失）
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

  // 同比与"占归母净利比"类指标（参考雪球 F10 口径），需查上年同期
  const prevPeriod = (p: string) => {
    const y = Number(p.slice(0, 4));
    return `${y - 1}${p.slice(4)}`;
  };
  for (const p of periods) {
    const prev = prevPeriod(p);
    const ni = data.profit[p]?.['归属于母公司所有者的净利润'];
    const niPrev = data.profit[prev]?.['归属于母公司所有者的净利润'];
    // 归母净利同比
    if (ni != null && niPrev != null && niPrev !== 0) {
      data.profit[p]['归母净利同比'] = (ni / Math.abs(niPrev) - 1) * 100;
    }
    // 扣非同比
    const kf = data.indicator[p]?.['扣除非经常性损益后的净利润(元)'];
    const kfPrev = data.indicator[prev]?.['扣除非经常性损益后的净利润(元)'];
    if (kf != null && kfPrev != null && kfPrev !== 0) {
      data.indicator[p]['扣非同比'] = (kf / Math.abs(kfPrev) - 1) * 100;
    }
    if (ni != null && ni !== 0) {
      // 以下占归母净利比
      const ofNi = (dst: string, v: number | null | undefined) => {
        if (v != null) data.profit[p][dst] = (v / ni) * 100;
      };
      ofNi('投资收益/归母净利', data.profit[p]?.['投资收益']);
      ofNi('减值损失/归母净利', data.profit[p]?.['资产减值损失']);
      ofNi('折旧摊销/归母净利', data.cashflow[p]?.['折旧摊销']);
    }
  }
}

// 万元 -> 亿元
const WAN_TO_YI = (v: number | null) => (v == null ? null : v / 1e4);

// 分组的指标表定义（顺序对照雪球 F10 参考表格）
export interface MetricRow {
  label: string;
  src: keyof SinaData;
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
      { label: '固定资产周转率(次)', src: 'indicator', key: '固定资产周转率(次)' },
      { label: '总资产周转率(次)', src: 'indicator', key: '总资产周转率(次)' },
    ],
  },
  {
    title: '每股指标',
    rows: [
      { label: 'EPS(摊薄)', src: 'indicator', key: '摊薄每股收益(元)' },
      { label: '每股净资产', src: 'indicator', key: '每股净资产_调整前(元)' },
      { label: '每股经营现金流', src: 'indicator', key: '每股经营性现金流(元)' },
    ],
  },
];
