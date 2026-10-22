// 通用 localStorage 缓存：TTL + 容量淘汰，财报类数据共用。
// 读取时惰性过期，写入时统一清理，避免每个适配器各写一套淘汰逻辑。

export interface CacheEntry<T> {
  t: number;
  d: T;
}

export interface CacheConfig {
  key: string;
  ttl: number;
  limit: number;
  enabled?: boolean;
}

export interface LocalCache<T> {
  get(id: string): T | null;
  set(id: string, data: T): void;
}

export function createCache<T>({
  key,
  ttl,
  limit,
  enabled = true,
}: CacheConfig): LocalCache<T> {
  function readAll(): Record<string, CacheEntry<T>> {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      return {}; // 数据损坏直接丢弃
    }
  }

  function writeAll(all: Record<string, CacheEntry<T>>): void {
    const now = Date.now();
    for (const id of Object.keys(all)) {
      if (now - all[id].t > ttl) delete all[id];
    }
    const ids = Object.keys(all);
    if (ids.length > limit) {
      ids
        .sort((a, b) => all[a].t - all[b].t)
        .slice(0, ids.length - limit)
        .forEach((id) => delete all[id]);
    }
    try {
      localStorage.setItem(key, JSON.stringify(all));
    } catch {
      localStorage.removeItem(key); // 超限就清空重来，不做精细淘汰
    }
  }

  return {
    get(id: string): T | null {
      if (!enabled) return null;
      const hit = readAll()[id];
      if (!hit || Date.now() - hit.t >= ttl) return null;
      return hit.d;
    },
    set(id: string, data: T): void {
      if (!enabled) return;
      const all = readAll();
      all[id] = { t: Date.now(), d: data };
      writeAll(all);
    },
  };
}
