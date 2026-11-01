import type { Stock, WatchGroup } from '../types';
import {
  normalizeSnapshot,
  replaceNotesSnapshot,
  toRemoteNotes,
  type NotesSnapshot,
} from './notesStore.ts';
import {
  createBackupArchive,
  restoreBackupArchive,
  type BackupData,
  type BackupPart,
} from './backupArchive.ts';
import { parseWatchlistBackupData } from '../utils/watchlistBackup.ts';

export interface AppBackupContext {
  watchlist: Stock[];
  groups: WatchGroup[];
  replaceAll: (stocks: Stock[], groups: WatchGroup[]) => void;
}

function hasOwn(data: BackupData, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function parseNotesData(value: unknown): NotesSnapshot {
  if (Array.isArray(value)) {
    return normalizeSnapshot({
      schemaVersion: 1,
      updatedAt: Date.now(),
      notes: value,
    });
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const container = value as Record<string, unknown>;
    if (Array.isArray(container.notes)) {
      return normalizeSnapshot({
        schemaVersion: 1,
        updatedAt: Number(container.updatedAt) || Date.now(),
        notes: container.notes,
      });
    }
  }

  throw new Error('备份中的笔记结构无效');
}

function backupParts(context: AppBackupContext): BackupPart[] {
  return [
    {
      capture: () => ({
        watchlist: context.watchlist,
        groups: context.groups,
      }),
      hasData: (data) => hasOwn(data, 'watchlist') || hasOwn(data, 'stocks') || hasOwn(data, 'groups'),
      prepare: (data) => {
        const parsed = parseWatchlistBackupData(data);
        return () => context.replaceAll(parsed.watchlist, parsed.groups);
      },
    },
    {
      capture: () => ({ notes: toRemoteNotes() }),
      hasData: (data) => hasOwn(data, 'notes'),
      prepare: (data) => {
        const notes = parseNotesData(data.notes);
        return () => replaceNotesSnapshot(notes);
      },
    },
  ];
}

export function createAppBackup(context: AppBackupContext): string {
  return createBackupArchive(backupParts(context));
}

export function restoreAppBackup(text: string, context: AppBackupContext): number {
  return restoreBackupArchive(text, backupParts(context));
}
