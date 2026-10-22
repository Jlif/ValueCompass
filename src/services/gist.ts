import type { Stock, WatchGroup } from '../types';

// GitHub Gist 云同步：自选列表整包存为一个 secret gist 文件，last-write-wins
const SYNC_FILE = 'valuecompass-watchlist.json';
const CONFIG_KEY = 'vc_sync_config';
const SYNC_DESC = 'ValueCompass 自选列表同步';

export interface SyncConfig {
  token: string;
  gistId: string;
}

export interface WatchlistSnapshot {
  stocks: Stock[];
  groups: WatchGroup[];
  updated: number;
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

interface GistBrief {
  id: string;
  description: string | null;
  files?: Record<string, unknown>;
}

function isSyncGist(gist: GistBrief): boolean {
  return Boolean(gist.files?.[SYNC_FILE]);
}

async function createSyncGist(token: string): Promise<string> {
  const res = await gh('/gists', token, 'POST', {
    description: SYNC_DESC,
    public: false,
    files: { [SYNC_FILE]: { content: JSON.stringify({ updated: 0, stocks: [] }) } },
  });
  const json = await res.json();
  return json.id as string;
}

async function chooseBestGist(candidates: GistBrief[], token: string): Promise<string> {
  if (candidates.length === 1) return candidates[0].id;

  const snapshots = await Promise.all(
    candidates.map(async (gist) => {
      try {
        return { id: gist.id, snapshot: await pullWatchlist({ token, gistId: gist.id }) };
      } catch {
        return { id: gist.id, snapshot: null };
      }
    })
  );

  const populated = snapshots.filter(
    (item): item is { id: string; snapshot: WatchlistSnapshot } =>
      Boolean(item.snapshot && (item.snapshot.updated > 0 || item.snapshot.stocks.length > 0 || item.snapshot.groups.length > 0))
  );
  const pool = populated.length > 0 ? populated : snapshots;
  pool.sort((a, b) => (b.snapshot?.updated || 0) - (a.snapshot?.updated || 0));
  return pool[0]?.id || candidates[0].id;
}

// 复用账号下已有的同步 gist（换机器时靠这个接回旧数据）。
// 以文件名而不是描述识别，允许用户随时重命名 Gist。
// ponytail: 只查最近 100 个，gist 多到溢出一页再加分页
export async function findOrCreateGist(token: string): Promise<string> {
  const list = await gh('/gists?per_page=100', token);
  const candidates = ((await list.json()) as GistBrief[]).filter(isSyncGist);
  if (candidates.length === 0) return createSyncGist(token);
  return chooseBestGist(candidates, token);
}

export async function pullWatchlist(
  cfg: SyncConfig
): Promise<WatchlistSnapshot | null> {
  const res = await gh(`/gists/${cfg.gistId}`, cfg.token);
  const json = await res.json();
  const content = json.files?.[SYNC_FILE]?.content;
  if (!content) return null;
  const parsed = JSON.parse(content);
  return {
    stocks: Array.isArray(parsed.stocks) ? parsed.stocks : [],
    groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    updated: Number(parsed.updated) || 0,
  };
}

export async function pushWatchlist(cfg: SyncConfig, stocks: Stock[], groups: WatchGroup[]): Promise<void> {
  await gh(`/gists/${cfg.gistId}`, cfg.token, 'PATCH', {
    files: { [SYNC_FILE]: { content: JSON.stringify({ updated: Date.now(), stocks, groups }) } },
  });
}

export interface PullResult {
  config: SyncConfig;
  snapshot: WatchlistSnapshot | null;
  recovered: boolean;
}

// 新版本曾因描述从 ValueCompass 改成 ValueCompass2 而创建空 Gist。
// 当前同步为空且本地尚无数据时，自动改绑到有数据的旧 Gist。
export async function pullWatchlistWithRecovery(
  cfg: SyncConfig,
  options: { localUpdated: number; hasLocalData: boolean }
): Promise<PullResult> {
  const snapshot = await pullWatchlist(cfg);
  const currentIsEmpty = Boolean(
    snapshot &&
    snapshot.updated === 0 &&
    snapshot.stocks.length === 0 &&
    snapshot.groups.length === 0
  );

  if (!currentIsEmpty || options.localUpdated > 0 || options.hasLocalData) {
    return { config: cfg, snapshot, recovered: false };
  }

  const bestId = await findOrCreateGist(cfg.token);
  if (bestId === cfg.gistId) return { config: cfg, snapshot, recovered: false };

  const recovered = await pullWatchlist({ token: cfg.token, gistId: bestId });
  if (!recovered || recovered.updated === 0) {
    return { config: cfg, snapshot, recovered: false };
  }

  const config = { token: cfg.token, gistId: bestId };
  saveSyncConfig(config);
  return { config, snapshot: recovered, recovered: true };
}
