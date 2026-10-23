import { useSyncExternalStore } from 'react';
import type { Stock } from '../types';
import { addNote, getSnapshot, removeNote, subscribe } from '../services/notesStore';
import { stockKey } from '../utils/stockKey';

// 笔记状态放在 notesStore 里，本地编辑和远端合并共用同一份快照。
export function useStockNotes(stock: Stock) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const key = stockKey(stock);
  const notes = (state.notesByStock[key] || []).filter((note) => note.deletedAt == null);

  return {
    notes,
    addNote: (text: string) => addNote(key, text),
    removeNote: (id: string) => removeNote(key, id),
    storageError: state.error,
  };
}
