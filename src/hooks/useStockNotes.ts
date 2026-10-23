import { useEffect, useMemo, useState } from 'react';
import type { Stock, StockNote } from '../types';
import { stockKey } from '../utils/stockKey';

const NOTES_KEY = 'vc_stock_notes';
const EMPTY_NOTES: StockNote[] = [];

type NotesByStock = Record<string, StockNote[]>;

function normalizeNotes(value: unknown): StockNote[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (note): note is StockNote =>
        Boolean(
          note &&
          typeof note.id === 'string' &&
          typeof note.text === 'string' &&
          note.text.trim() &&
          Number.isFinite(Number(note.createdAt))
        )
    )
    .map((note) => ({
      id: note.id,
      text: note.text.trim(),
      createdAt: Number(note.createdAt),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function loadNotes(): NotesByStock {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}') as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, notes]) => [key, normalizeNotes(notes)] as const)
        .filter(([, notes]) => notes.length > 0)
    );
  } catch {
    return {};
  }
}

export function useStockNotes(stock: Stock) {
  const [notesByStock, setNotesByStock] = useState<NotesByStock>(loadNotes);
  const [storageError, setStorageError] = useState<string | null>(null);
  const key = stockKey(stock);

  useEffect(() => {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notesByStock));
      setStorageError(null);
    } catch {
      setStorageError('笔记保存失败，请检查浏览器存储空间');
    }
  }, [notesByStock]);

  const notes = useMemo(() => {
    const current = notesByStock[key] || EMPTY_NOTES;
    return [...current].sort((a, b) => b.createdAt - a.createdAt);
  }, [key, notesByStock]);

  const addNote = (text: string) => {
    const content = text.trim();
    if (!content) return;
    const note: StockNote = {
      id: crypto.randomUUID(),
      text: content,
      createdAt: Date.now(),
    };
    setNotesByStock((prev) => ({
      ...prev,
      [key]: [note, ...(prev[key] || [])],
    }));
  };

  const removeNote = (id: string) => {
    setNotesByStock((prev) => {
      const nextNotes = (prev[key] || []).filter((note) => note.id !== id);
      const next = { ...prev };
      if (nextNotes.length > 0) next[key] = nextNotes;
      else delete next[key];
      return next;
    });
  };

  return { notes, addNote, removeNote, storageError };
}
