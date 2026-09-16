# ValueCompass2

## 项目概述

项目名称：ValueCompass
技术栈：Tauri v2 + React 19 + TypeScript + Rust（桌面壳）
项目描述：A股价值分析桌面应用 - 基于 TickFlow API 的股票数据分析工具

## 目录结构

```
CLAUDE.md              # 项目专属信息（技术栈、命令、架构）
src/                   # 前端 React 源码（数据层也在这里）
├── App.tsx            # 主界面（股票列表 + K线 + F10）
├── components/        # KlineChart、StockF10
├── hooks/             # useWatchlist（localStorage 自选列表）
├── services/          # tickflow.ts（行情/列表/行业）、finance.ts（东财财务数据）
├── types/             # 共享类型
└── utils/             # 技术指标计算（MACD/KDJ/RSI）
src-tauri/             # Tauri 桌面壳（无业务逻辑）
├── Cargo.toml
└── tauri.conf.json
index.html
package.json
vite.config.ts         # 含 /sina 代理（新浪财务数据，dev 用）
```

## 工作流命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 启动前端开发服务器（浏览器调试） |
| `npm run tauri dev` | 启动 Tauri 开发模式（完整应用） |
| `npm run tauri build` | 构建生产版本 |
| `npm run check:cache` | 校验财报缓存逻辑（真实模块 + 桩化 fetch，统计请求数） |

## 技术要点

- **前端框架**: React 19 + TypeScript + Vite 8
- **桌面端**: Tauri v2 (Rust，仅桌面壳，数据层在前端)
- **行情数据源**: TickFlow REST API (https://api.tickflow.org/v1，`x-api-key` 认证，支持 CORS 可浏览器直连)
- **财务数据源**: 东方财富 F10 JSON 接口（src/services/finance.ts，dev 走 Vite /em 代理，打包版走 tauri-plugin-http；资产负债/利润/现金流三表按公司类型并行探测，指标用 ZYZB 主要指标接口）
- **本地存储**: localStorage（自选列表、股票列表缓存、行业映射、财报缓存）
- **财报缓存**: TTL 24h、最多 60 只；**开发模式自动旁路**（改代码后刷新即最新数据），仅生产构建启用
- **图表库**: lightweight-charts
- **开发调试**: `npm run dev` 后直接浏览器打开 http://localhost:1420，无需启动 Tauri
