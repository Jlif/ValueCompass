import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { NotesSyncConfig, SyncState } from '../types';
import {
  createSnapshot,
  getSnapshot,
  hasAnyNotes,
  mergeRemoteNotes,
  parseSnapshot,
  subscribe,
} from '../services/notesStore';
import {
  getNotesObject,
  normalizeNotesSyncConfig,
  putNotesObject,
  S3ConflictError,
  testNotesConnection,
  validateNotesSyncConfig,
} from '../services/s3';

const CONFIG_KEY = 'vc_notes_s3_config';
const UPDATED_KEY = 'vc_notes_s3_updated';
const PUSH_DEBOUNCE = 3000;

function loadConfig(): NotesSyncConfig | null {
  try {
    return normalizeNotesSyncConfig(JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null'));
  } catch {
    return null;
  }
}

function fingerprint(notes: { id: string }[]): string {
  return JSON.stringify([...notes].sort((a, b) => a.id.localeCompare(b.id)));
}

export interface NotesSyncApi {
  config: NotesSyncConfig | null;
  syncState: SyncState;
  syncError: string | null;
  lastSyncedAt: number | null;
  saveConfig: (config: NotesSyncConfig) => Promise<void>;
  testConfig: (config: NotesSyncConfig) => Promise<string>;
  syncNow: () => Promise<void>;
  disconnect: () => void;
}

export function useNotesSync(): NotesSyncApi {
  const [config, setConfig] = useState<NotesSyncConfig | null>(loadConfig);
  const [syncState, setSyncState] = useState<SyncState>(() => (loadConfig() ? 'synced' : 'off'));
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => {
    const value = Number(localStorage.getItem(UPDATED_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const notesState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const configRef = useRef<NotesSyncConfig | null>(config);
  const lastPushedRef = useRef<string | null>(null);
  const suppressPushRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const startedRef = useRef(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const doSync = useCallback(async () => {
    const current = configRef.current;
    if (!current) return;
    setSyncState('pulling');
    setSyncError(null);

    try {
      const remote = await getNotesObject(current);
      const remoteSnapshot = remote ? parseSnapshot(remote.text) : null;

      if (remoteSnapshot) {
        suppressPushRef.current = true;
        const merged = mergeRemoteNotes(remoteSnapshot);
        if (!merged.changed) suppressPushRef.current = false;
      }

      const local = getSnapshot();
      const syncedText = JSON.stringify(local.notesByStock);
      const localSnapshot = createSnapshot(local.notesByStock);
      const shouldPush = Boolean(remote) || hasAnyNotes(local.notesByStock);
      const remoteFingerprint = remoteSnapshot ? fingerprint(remoteSnapshot.notes) : null;
      const localFingerprint = fingerprint(localSnapshot.notes);

      if (shouldPush && remoteFingerprint !== localFingerprint) {
        setSyncState('pushing');
        try {
          await putNotesObject(current, JSON.stringify(localSnapshot), remote?.etag);
          lastPushedRef.current = syncedText;
        } catch (error) {
          if (error instanceof S3ConflictError) {
            // 其他设备刚写过：重新拉取合并后再试一次
            suppressPushRef.current = true;
            const retryRemote = await getNotesObject(current);
            if (retryRemote) mergeRemoteNotes(parseSnapshot(retryRemote.text));
            const retryNotes = getSnapshot().notesByStock;
            const retryText = JSON.stringify(retryNotes);
            await putNotesObject(current, JSON.stringify(createSnapshot(retryNotes)), retryRemote?.etag);
            lastPushedRef.current = retryText;
          } else {
            throw error;
          }
        }
      } else {
        lastPushedRef.current = syncedText;
      }

      localStorage.setItem(UPDATED_KEY, String(Date.now()));
      setLastSyncedAt(Date.now());
      setSyncState('synced');
      setSyncError(null);
    } catch (error) {
      setSyncState('error');
      setSyncError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const enqueueSync = useCallback((): Promise<void> => {
    const run = () => doSync();
    queueRef.current = queueRef.current.then(run, run);
    return queueRef.current;
  }, [doSync]);

  // 本地编辑 -> 防抖上传；远端合并落地的变更不重复上传
  useEffect(() => {
    const payload = JSON.stringify(notesState.notesByStock);
    if (lastPushedRef.current === null) {
      lastPushedRef.current = payload;
      return;
    }
    if (payload === lastPushedRef.current) return;
    if (suppressPushRef.current) {
      suppressPushRef.current = false;
      lastPushedRef.current = payload;
      return;
    }
    if (!configRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void enqueueSync();
    }, PUSH_DEBOUNCE);
  }, [notesState, enqueueSync]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (configRef.current) void enqueueSync();
  }, [enqueueSync]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  // 其他设备写入后，回到窗口或每分钟拉取一次；无变化时只发 GET。
  useEffect(() => {
    if (!config) return;
    const timer = setInterval(() => {
      void enqueueSync();
    }, 60_000);
    const onFocus = () => {
      void enqueueSync();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [config, enqueueSync]);

  const saveConfig = useCallback(
    async (next: NotesSyncConfig) => {
      const validation = validateNotesSyncConfig(next);
      if (validation) throw new Error(validation);
      const normalized = normalizeNotesSyncConfig(next);
      if (!normalized) throw new Error('S3 配置不完整');
      localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
      configRef.current = normalized;
      setConfig(normalized);
      setSyncError(null);
      await enqueueSync();
    },
    [enqueueSync]
  );

  const testConfig = useCallback(async (next: NotesSyncConfig) => {
    const validation = validateNotesSyncConfig(next);
    if (validation) throw new Error(validation);
    return testNotesConnection(next);
  }, []);

  const syncNow = useCallback(() => enqueueSync(), [enqueueSync]);

  const disconnect = useCallback(() => {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(UPDATED_KEY);
    configRef.current = null;
    setConfig(null);
    setSyncState('off');
    setSyncError(null);
    setLastSyncedAt(null);
    lastPushedRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return {
    config,
    syncState,
    syncError,
    lastSyncedAt,
    saveConfig,
    testConfig,
    syncNow,
    disconnect,
  };
}
