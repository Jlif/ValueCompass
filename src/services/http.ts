// 统一 HTTP 读取：浏览器走 fetch，Tauri 走 plugin-http（绕过 CORS）。
// 白名单见 src-tauri/capabilities/default.json。

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function getJson(url: string, label = '接口'): Promise<any> {
  const response = isTauriRuntime()
    ? await (await import('@tauri-apps/plugin-http')).fetch(url)
    : await fetch(url);
  if (!response.ok) throw new Error(`${label} ${response.status}`);
  return response.json();
}
