// 验证 A/HK 估值归一化、缺失值语义与选股过滤边界
// 跑法: npm run check:screener
import assert from 'node:assert/strict';
import {
  normalizeCnValuation,
  normalizeHkValuation,
  normalizeTencentValuation,
} from '../src/services/valuation/normalize.ts';
import { filterStocks, DEFAULT_STOCK_FILTERS } from '../src/services/stockScreener.ts';
import { formatMarketCap, formatValuationLine } from '../src/utils/valuationFormat.ts';
import { isDelistedInstrument } from '../src/utils/stockStatus.ts';

const now = 1_700_000_000_000;
const tencent = { code: '00700', name: '腾讯控股', exchange: 'HK' };
const maotai = { code: '600519', name: '贵州茅台', exchange: 'SH' };
const lossMaking = { code: '300001', name: '测试科技', exchange: 'SZ' };
const missing = { code: '688001', name: '暂无估值', exchange: 'SH' };

const hkValuation = normalizeHkValuation(
  {
    f12: '00700',
    f9: 1307,
    f20: 3_487_938_556_404,
    f21: 3_487_938_556_404,
    f23: 267,
    f100: '软件服务',
    f114: 1551,
    f115: 1307,
  },
  tencent,
  now
);
assert.equal(hkValuation.peTtm, 13.07, '港股 PE TTM 按 100 倍缩放');
assert.equal(hkValuation.peStatic, 15.51, '港股静态 PE 按 100 倍缩放');
assert.equal(hkValuation.pb, 2.67, '港股 PB 按 100 倍缩放');
assert.equal(hkValuation.marketCap, 3_487_938_556_404, '港股市值保持原始港币元');
assert.equal(hkValuation.currency, 'HKD', '港股估值币种为港币');
assert.equal(hkValuation.industry, '软件服务', '港股行业取东财分类');

const cnValuation = normalizeCnValuation(
  {
    f12: '600519',
    f9: 20.1,
    f20: 2_100_000_000_000,
    f21: 2_100_000_000_000,
    f23: 8.2,
    f100: '酿酒行业',
    f114: 19.8,
    f115: 20.1,
  },
  maotai,
  now
);
assert.equal(cnValuation.peTtm, 20.1, 'A 股 PE 保持普通小数');
assert.equal(cnValuation.pb, 8.2, 'A 股 PB 保持普通小数');
assert.equal(cnValuation.currency, 'CNY', 'A 股估值币种为人民币');

const tencentFields = Array.from({ length: 60 }, () => '');
tencentFields[39] = '13.07';
tencentFields[44] = '34879.3856';
tencentFields[45] = '34879.3856';
tencentFields[46] = 'TENCENT';
tencentFields[58] = '2.68';
const tencentValuation = normalizeTencentValuation(tencentFields, tencent, now);
assert.equal(tencentValuation.peTtm, 13.07, '腾讯港股 PE 保持普通小数');
assert.equal(tencentValuation.pb, 2.68, '腾讯港股 PB 取第 58 字段');
assert.ok(
  Math.abs((tencentValuation.roeTtm ?? 0) - 20.5) < 0.01,
  '腾讯 ROE 由 PB/PE 推算'
);
assert.equal(tencentValuation.marketCap, 3_487_938_560_000, '腾讯市值由亿元换算为港币元');
assert.equal(tencentValuation.source, 'tencent', '腾讯降级数据的来源可追踪');

const negativeValuation = normalizeCnValuation(
  { f12: '300001', f9: -12.3, f23: 3.1, f20: 6_000_000_000, f21: '-', f100: '软件开发', f114: '-', f115: -12.3 },
  lossMaking,
  now
);
const noValuation = normalizeCnValuation(
  { f12: '688001', f9: '-', f23: '-', f20: '-', f21: '-', f100: '-', f114: '-', f115: '-' },
  missing,
  now
);
assert.equal(negativeValuation.peTtm, -12.3, '负 PE 被保留，允许用户筛选亏损公司');
assert.equal(negativeValuation.roeTtm, null, '负 PE 不推算 ROE，避免亏损公司出现虚假高 ROE');
assert.equal(noValuation.peTtm, null, '缺失 PE 不转换为 0');
assert.equal(noValuation.marketCap, null, '缺失市值不转换为 0');

const valuations = {
  '00700.HK': hkValuation,
  '600519.SH': cnValuation,
  '300001.SZ': negativeValuation,
  '688001.SH': noValuation,
};
const stocks = [tencent, maotai, lossMaking, missing];
const industryMap = {
  '600519.SH': { sw1: '食品饮料', sw2: '白酒', sw3: '白酒' },
};

assert.equal(
  filterStocks(stocks, valuations, industryMap, { ...DEFAULT_STOCK_FILTERS }).length,
  4,
  '未设置估值条件时保留估值缺失股票'
);
assert.deepEqual(
  filterStocks(stocks, valuations, industryMap, {
    ...DEFAULT_STOCK_FILTERS,
    market: 'HK',
  }).map((stock) => stock.code),
  ['00700'],
  '市场筛选只保留港股'
);
assert.deepEqual(
  filterStocks(stocks, valuations, industryMap, {
    ...DEFAULT_STOCK_FILTERS,
    peMin: 10,
    peMax: 20.1,
  }).map((stock) => stock.code),
  ['00700', '600519'],
  'PE 区间为闭区间且自动排除缺失值'
);
assert.deepEqual(
  filterStocks(stocks, valuations, industryMap, {
    ...DEFAULT_STOCK_FILTERS,
    peMax: 0,
  }).map((stock) => stock.code),
  ['300001'],
  '负 PE 可通过上限筛选'
);
assert.deepEqual(
  filterStocks(stocks, valuations, industryMap, {
    ...DEFAULT_STOCK_FILTERS,
    roeMin: 15,
  }).map((stock) => stock.code),
  ['00700', '600519'],
  'ROE 由 PB/PE 推算并可参与筛选'
);
assert.deepEqual(
  filterStocks(stocks, valuations, industryMap, {
    ...DEFAULT_STOCK_FILTERS,
    peMin: 0,
    pbMax: 3,
    roeMin: 20,
  }).map((stock) => stock.code),
  ['00700'],
  '低 PB-ROE 组合条件可同时生效'
);
assert.deepEqual(
  filterStocks(stocks, valuations, industryMap, {
    ...DEFAULT_STOCK_FILTERS,
    marketCapMin: 1000,
  }).map((stock) => stock.code),
  ['00700', '600519'],
  '市值条件按亿元比较并排除缺失值'
);
assert.deepEqual(
  filterStocks(stocks, valuations, industryMap, {
    ...DEFAULT_STOCK_FILTERS,
    market: 'CN',
    industry: 'sw1:食品饮料',
  }).map((stock) => stock.code),
  ['600519'],
  'A 股行业使用申万层级'
);
assert.deepEqual(
  filterStocks(stocks, valuations, industryMap, {
    ...DEFAULT_STOCK_FILTERS,
    market: 'HK',
    industry: 'hk:软件服务',
  }).map((stock) => stock.code),
  ['00700'],
  '港股行业使用东财分类'
);
assert.deepEqual(
  filterStocks(stocks, valuations, industryMap, {
    ...DEFAULT_STOCK_FILTERS,
    keyword: '科创',
  }).map((stock) => stock.code),
  ['688001'],
  '搜索继续支持板块名称'
);
assert.deepEqual(
  filterStocks(stocks, valuations, industryMap, {
    ...DEFAULT_STOCK_FILTERS,
    keyword: '茅台',
  }).map((stock) => stock.code),
  ['600519'],
  '名称搜索继续生效'
);

assert.equal(formatMarketCap(3_487_938_556_404), '3.49万亿', '市值展示使用万亿单位');
assert.equal(formatValuationLine(hkValuation), 'PB 2.67 · ROE 20.4%', '股票行展示 PB 与推算 ROE');

assert.equal(
  isDelistedInstrument({
    exchange: 'SH',
    name: '齐鲁石化',
    ext: { total_shares: 1_950_000_000, float_shares: 0 },
  }),
  true,
  '流通股本为 0 的历史退市股可识别'
);
assert.equal(
  isDelistedInstrument({
    exchange: 'SH',
    name: '浦发银行',
    ext: { total_shares: 33_305_838_300, float_shares: 33_305_838_300 },
  }),
  false,
  '正常交易股票不会被误判退市'
);

const delisted = { code: '600001', name: '邯郸钢铁', exchange: 'SH', delisted: true };
assert.equal(
  filterStocks([delisted], {}, {}, { ...DEFAULT_STOCK_FILTERS }).length,
  0,
  '默认过滤退市股票'
);
assert.equal(
  filterStocks([delisted], {}, {}, {
    ...DEFAULT_STOCK_FILTERS,
    hideDelisted: false,
  }).length,
  1,
  '关闭隐藏退市后保留退市股票'
);

console.log('PASS: valuation normalization and stock screener');
