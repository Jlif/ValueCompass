import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // 东财 F10 财务数据代理（解决浏览器 CORS）
    proxy: {
      "/em": {
        target: "https://emweb.securities.eastmoney.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/em/, ""),
      },
      // 东财行情/估值快照代理（解决浏览器 CORS）
      "/push2": {
        target: "https://push2.eastmoney.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/push2/, ""),
      },
      // 腾讯行情估值降级源
      "/tencent": {
        target: "https://qt.gtimg.cn",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tencent/, ""),
      },
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
