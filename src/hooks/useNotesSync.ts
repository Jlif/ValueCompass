import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ObjectSyncConfig, SyncState } from '../types';
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
  putNotesObject,
  S3ConflictError,
  withObjectKey,
} from '../services/s3';

const UPDATED_KEY = 'vc_notes_s3_updated';
const PUSH_DEBOUNCE = 3000;

function fingerprint(notes: { id: string }[]): string {
  return JSON.stringify([...notes].sort((a, b) => a.id.localeCompare(b.id)));
}

interface Options {
  config: ObjectSyncConfig | null;
}

export interface NotesSyncApi {
  syncState: SyncState;
  syncError: string | null;
  lastSyncedAt: number | null;
  syncNow: () => Promise<void>;
}

export function useNotesSync({ config }: Options): NotesSyncApi {
  const [syncState, setSyncState] = useState<SyncState>(config ? 'synced' : 'off');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => {
    const value = Number(localStorage.getItem(UPDATED_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const notesState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const configRef = useRef<ObjectSyncConfig | null>(config);
  const lastPushedRef = useRef<string | null>(null);
  const suppressPushRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const doSync = useCallback(async () => {
    const current = configRef.current;
    if (!current) return;
    const objectConfig = withObjectKey(current, current.notesKey);
    setSyncState('pulling');
    setSyncError(null);

    try {
      const remote = await getNotesObject(objectConfig);
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
          await putNotesObject(objectConfig, JSON.stringify(localSnapshot), remote?.etag);
          lastPushedRef.current = syncedText;
        } catch (error) {
          if (!(error instanceof S3ConflictError)) throw error;
          suppressPushRef.current = true;
          const retryRemote = await getNotesObject(objectConfig);
          if (retryRemote) mergeRemoteNotes(parseSnapshot(retryRemote.text));
          const retryNotes = getSnapshot().notesByStock;
          const retryText = JSON.stringify(retryNotes);
          await putNotesObject(
            objectConfig,
            JSON.stringify(createSnapshot(retryNotes)),
            retryRemote?.etag
          );
          lastPushedRef.current = retryText;
        }
      } else {
        lastPushedRef.current = syncedText;
      }

      if (configRef.current !== current) return;
      localStorage.setItem(UPDATED_KEY, String(Date.now()));
      setLastSyncedAt(Date.now());
      setSyncState('synced');
      setSyncError(null);
    } catch (error) {
      if (configRef.current !== current) return;
      setSyncState('error');
      setSyncError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const enqueueSync = useCallback((): Promise<void> => {
    const run = () => doSync();
    queueRef.current = queueRef.current.then(run, run);
    return queueRef.current;
  }, [doSync]);

  useEffect(() => {
    configRef.current = config;
    lastPushedRef.current = null;
    suppressPushRef.current = false;
    if (!config) {
      setSyncState('off');
      setSyncError(null);
      return;
    }
    setSyncState('synced');
    void enqueueSync();
  }, [config, enqueueSync]);

  // 本地编辑 -> 防抖上传；远端合并落地的变更不重复上传。
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
    timerRef.current = setTimeout(() => void enqueueSync(), PUSH_DEBOUNCE);
  }, [notesState, enqueueSync]);

  useEffect(() => {
    if (!config) return;
    const timer = setInterval(() => void enqueueSync(), 60_000);
    const onFocus = () => void enqueueSync();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [config, enqueueSync]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const syncNow = useCallback(() => enqueueSync(), [enqueueSync]);
  return { syncState, syncError, lastSyncedAt, syncNow };
}
