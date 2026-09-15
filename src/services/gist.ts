import type { Stock } from '../types';

// GitHub Gist 云同步：自选列表整包存为一个 secret gist 文件，last-write-wins
const SYNC_FILE = 'valuecompass-watchlist.json';
const CONFIG_KEY = 'vc_sync_config';

export interface SyncConfig {
  token: string;
  gistId: string;
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    return cfg?.token && cfg?.gistId ? cfg : null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(cfg: SyncConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function clearSyncConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

async function gh(path: string, token: string, method = 'GET', body?: unknown): Promise<Response> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const msg = res.status === 401 ? 'Token 无效' : res.status === 404 ? 'Gist 不存在' : `GitHub ${res.status}`;
    throw new Error(msg);
  }
  return res;
}

// 用 token 自动创建一个 secret gist，返回 gist id
export async function createGist(token: string): Promise<string> {
  const res = await gh('/gists', token, 'POST', {
    description: 'ValueCompass2 自选列表同步',
    public: false,
    files: { [SYNC_FILE]: { content: JSON.stringify({ updated: 0, stocks: [] }) } },
  });
  const json = await res.json();
  return json.id as string;
}

export async function pullWatchlist(cfg: SyncConfig): Promise<{ stocks: Stock[]; updated: number } | null> {
  const res = await gh(`/gists/${cfg.gistId}`, cfg.token);
  const json = await res.json();
  const content = json.files?.[SYNC_FILE]?.content;
  if (!content) return null;
  const parsed = JSON.parse(content);
  return { stocks: parsed.stocks || [], updated: parsed.updated || 0 };
}

export async function pushWatchlist(cfg: SyncConfig, stocks: Stock[]): Promise<void> {
  await gh(`/gists/${cfg.gistId}`, cfg.token, 'PATCH', {
    files: { [SYNC_FILE]: { content: JSON.stringify({ updated: Date.now(), stocks }) } },
  });
}
