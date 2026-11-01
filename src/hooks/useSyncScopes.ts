import { useSyncExternalStore } from 'react';
import type { Stock, WatchGroup } from '../types';
import { getSnapshot, subscribe } from '../services/notesStore';

export interface SyncScope {
  key: string;
  label: string;
  count: number;
}

interface SyncScopeCounts {
  watchlist: number;
  groups: number;
  notes: number;
}

const SCOPE_DEFINITIONS: Array<{
  key: string;
  label: string;
  count: (counts: SyncScopeCounts) => number;
}> = [
  { key: 'watchlist', label: '自选', count: (counts) => counts.watchlist },
  { key: 'groups', label: '分组', count: (counts) => counts.groups },
  { key: 'notes', label: '笔记', count: (counts) => counts.notes },
];

export function buildSyncScopes(counts: SyncScopeCounts): SyncScope[] {
  return SCOPE_DEFINITIONS.map(({ key, label, count }) => ({
    key,
    label,
    count: count(counts),
  }));
}

export function useSyncScopes(watchlist: Stock[], groups: WatchGroup[]): SyncScope[] {
  const notesState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const noteCount = Object.values(notesState.notesByStock).reduce(
    (total, notes) => total + notes.filter((note) => note.deletedAt == null).length,
    0
  );

  return buildSyncScopes({
    watchlist: watchlist.length,
    groups: groups.length,
    notes: noteCount,
  });
}
