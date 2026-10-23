import { useCallback, useState } from 'react';
import type { ObjectSyncConfig } from '../types';
import {
  getNotesObject,
  normalizeNotesSyncConfig,
  normalizeObjectSyncConfig,
  NOTES_OBJECT_KEY,
  validateS3ConnectionConfig,
  WATCHLIST_OBJECT_KEY,
  withObjectKey,
} from '../services/s3';

const CONFIG_KEY = 'vc_s3_sync_config_v1';
const LEGACY_NOTES_CONFIG_KEY = 'vc_notes_s3_config';
const LEGACY_GIST_CONFIG_KEY = 'vc_sync_config';

function loadConfig(): ObjectSyncConfig | null {
  try {
    const current = normalizeObjectSyncConfig(
      JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null')
    );
    if (current) {
      localStorage.removeItem(LEGACY_GIST_CONFIG_KEY);
      return current;
    }

    const legacy = normalizeNotesSyncConfig(
      JSON.parse(localStorage.getItem(LEGACY_NOTES_CONFIG_KEY) || 'null')
    );
    if (!legacy) return null;
    const migrated: ObjectSyncConfig = {
      provider: legacy.provider,
      endpoint: legacy.endpoint,
      region: legacy.region,
      bucket: legacy.bucket,
      accessKeyId: legacy.accessKeyId,
      secretAccessKey: legacy.secretAccessKey,
      forcePathStyle: legacy.forcePathStyle,
      conditionalWrites: legacy.conditionalWrites,
      watchlistKey: WATCHLIST_OBJECT_KEY,
      notesKey: legacy.key || NOTES_OBJECT_KEY,
    };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(migrated));
    localStorage.removeItem(LEGACY_NOTES_CONFIG_KEY);
    localStorage.removeItem(LEGACY_GIST_CONFIG_KEY);
    return migrated;
  } catch {
    return null;
  }
}

export interface S3SyncSettingsApi {
  config: ObjectSyncConfig | null;
  testConfig: (config: ObjectSyncConfig) => Promise<string>;
  saveConfig: (config: ObjectSyncConfig) => Promise<ObjectSyncConfig>;
  disconnect: () => void;
}

export function useS3SyncSettings(): S3SyncSettingsApi {
  const [config, setConfig] = useState<ObjectSyncConfig | null>(loadConfig);

  const testConfig = useCallback(async (next: ObjectSyncConfig) => {
    const error = validateS3ConnectionConfig(next);
    if (error) throw new Error(error);
    if (!next.watchlistKey.trim()) throw new Error('请填写自选对象 Key');
    if (!next.notesKey.trim()) throw new Error('请填写笔记对象 Key');
    if (next.watchlistKey.trim() === next.notesKey.trim()) {
      throw new Error('自选和笔记必须使用不同的对象 Key');
    }

    const watchlist = await getNotesObject(withObjectKey(next, next.watchlistKey));
    const notes = await getNotesObject(withObjectKey(next, next.notesKey));
    return `连接成功；自选文件${watchlist ? '已存在' : '未创建'}，笔记文件${notes ? '已存在' : '未创建'}`;
  }, []);

  const saveConfig = useCallback(async (next: ObjectSyncConfig) => {
    const normalized = normalizeObjectSyncConfig(next);
    if (!normalized) throw new Error('同步配置不完整');
    if (normalized.watchlistKey === normalized.notesKey) {
      throw new Error('自选和笔记必须使用不同的对象 Key');
    }
    localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
    localStorage.removeItem(LEGACY_NOTES_CONFIG_KEY);
    // Gist 不再作为运行时同步源，避免继续保留旧 Token。
    localStorage.removeItem(LEGACY_GIST_CONFIG_KEY);
    setConfig(normalized);
    return normalized;
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(LEGACY_NOTES_CONFIG_KEY);
    localStorage.removeItem(LEGACY_GIST_CONFIG_KEY);
    setConfig(null);
  }, []);

  return { config, testConfig, saveConfig, disconnect };
}
