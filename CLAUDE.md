# ValueCompass2

## 项目概述

项目名称：ValueCompass
技术栈：Tauri v2 + React 19 + TypeScript + Rust（桌面壳）
项目描述：A 股与港股价值分析桌面应用 - 基于 TickFlow API 的股票数据分析工具

## 目录结构

```
CLAUDE.md              # 项目专属信息（技术栈、命令、架构）
src/                   # 前端 React 源码（数据层也在这里）
├── App.tsx            # 页面编排（useStockList + useKline + useWatchlist）
├── theme.ts           # 图表颜色：从 App.css 的 CSS token 读取
├── components/
│   ├── Sidebar.tsx    # 搜索/市场/行业筛选、市场树、自选分组
│   ├── StockDetail.tsx# 股票标题、行情、K线、F10
│   ├── KlineChart.tsx # lightweight-charts 封装
│   ├── StockNotes.tsx # 股票投资笔记面板
│   ├── StockF10.tsx、StockQuoteBar.tsx、SyncPanel.tsx、GroupManager.tsx
│   ├── StockGroupMenu.tsx、IndustrySelect.tsx
├── hooks/             # useStockList、useKline、useWatchlist、useStockQuote
│                      # useStockNotes、useNotesSync、useS3SyncSettings
├── services/          # tickflow（行情）、finance（A 股财务）、hkFinance（港股财务）
│                      # cache（TTL 缓存）、http（浏览器/Tauri）
│                      # notesStore（笔记合并/墓碑）、s3（S3 兼容 SigV4）
│                      # watchlistSync（自选快照）
├── types/             # 共享类型（Stock/WatchGroup/SyncState 等）
└── utils/             # markets、stockKey、periods、indicators、watchlistBackup
src-tauri/             # Tauri 桌面壳（无业务逻辑）
├── Cargo.toml
└── tauri.conf.json
index.html
package.json
vite.config.ts         # 含 /em 代理（东财财务数据，dev 用）
```

## 工作流命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 启动前端开发服务器（浏览器调试） |
| `npm run tauri dev` | 启动 Tauri 开发模式（完整应用） |
| `npm run tauri build` | 构建生产版本 |
| `npm run check:cache` | 校验财报缓存逻辑（真实模块 + 桩化 fetch，统计请求数） |
| `npm run check:retry` | 校验 TickFlow 429 限频重试与取消逻辑 |
| `npm run check:hk` | 校验港股股票池、实时行情与 K 线归一化 |
| `npm run check:markets` | 校验交易所、市场与板块归类 |
| `npm run check:hk-finance` | 校验港股财报适配器、币种、特殊财年与缓存 |
| `npm run check:backup` | 校验自选/分组的 JSON 导出、导入与时间戳 |
| `npm run check:notes` | 校验笔记墓碑、快照格式与多端合并 |
| `npm run check:s3` | 校验 S3 URL、配置与 SigV4 签名头 |
| `npm run check:watchlist-sync` | 校验自选 S3 快照与独立对象 Key |

## 技术要点

- **前端框架**: React 19 + TypeScript + Vite 8
- **桌面端**: Tauri v2 (Rust，仅桌面壳，数据层在前端)
- **行情数据源**: TickFlow REST API (https://api.tickflow.org/v1，`x-api-key` 认证，支持 A股、港股股票池、实时行情与 K 线)
- **财务数据源**: 东方财富 F10 JSON 接口；A 股由 `finance.ts` 处理，港股由 `hkFinance.ts` 处理独立的报告期、币种、会计准则和港股指标组
- **远端同步**: 阿里云 OSS / 腾讯云 COS 的 S3 兼容接口，共用一份 Endpoint、Bucket 和 AK/SK；自选默认写 `valuecompass/watchlist.json`，笔记默认写 `valuecompass/notes.json`
- **本地存储**: localStorage（自选、笔记、股票列表缓存、行业映射、财报缓存）
- **自选主键**: `${code}.${exchange}`（如 `600519.SH`）；旧版纯 code 分组在读取/导入时自动迁移
- **财报缓存**: 共享 `createCache`，TTL 24h；A 股最多 60 只、港股 40 只；**开发模式自动旁路**（改代码后刷新即最新数据），仅生产构建启用
- **请求取消**: 切换股票/周期时通过 `AbortController` 中止 K 线请求；429 退避等待同样可取消
- **配色**: 浅色莫兰迪（燕麦纸感，`color-scheme: light`）；`App.css` 顶部 `:root` 定义 token（背景/表面/文字/主色/涨跌/状态），图表从 `theme.ts` 读取同一套 token，避免两套色值
- **笔记同步**: 与自选共用 OSS 连接，单独写 `valuecompass/notes.json`；按 `id` + `updatedAt` 合并，删除保留 `deletedAt` 墓碑
- **自选同步**: 与笔记共用 OSS 连接，单独写 `valuecompass/watchlist.json`；整体快照按 `updatedAt` 同步
- **S3 安全**: AK/SK 存本机 localStorage，建议使用只授权单个 Bucket 的子账号；Tauri HTTP 白名单只放行 `*.aliyuncs.com`、`*.myqcloud.com` 和 localhost
- **图表库**: lightweight-charts
- **开发调试**: `npm run dev` 后直接浏览器打开 http://localhost:1420，无需启动 Tauri
