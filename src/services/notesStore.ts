import type { StockNote } from '../types';

// 笔记本地缓存 + 同步合并。
// 本地结构：{ "600000.SH": [{ id, text, createdAt, updatedAt, deletedAt }] }
// 远端结构：{ schemaVersion: 1, updatedAt, notes: [{ ...note, stockKey }] }
// 删除用墓碑（deletedAt）保留，避免另一台设备用旧数据把笔记“复活”。

export const NOTES_KEY = 'vc_stock_notes';
const EMPTY_NOTES: StockNote[] = [];

export interface RemoteStockNote extends StockNote {
  stockKey: string;
}

export type NotesByStock = Record<string, StockNote[]>;

export interface NotesStoreState {
  notesByStock: NotesByStock;
  error: string | null;
}

export interface NotesSnapshot {
  schemaVersion: 1;
  updatedAt: number;
  notes: RemoteStockNote[];
}

function normalizeNote(value: unknown): StockNote | null {
  if (!value || typeof value !== 'object') return null;
  const note = value as Record<string, unknown>;
  if (typeof note.id !== 'string' || !note.id) return null;

  const text = typeof note.text === 'string' ? note.text.trim() : '';
  const createdAt = Number(note.createdAt);
  if (!Number.isFinite(createdAt)) return null;

  const updatedAt = Number(note.updatedAt);
  const deletedAt = note.deletedAt == null ? null : Number(note.deletedAt);
  if (deletedAt != null && !Number.isFinite(deletedAt)) return null;
  if (!text && deletedAt == null) return null;

  return {
    id: note.id,
    text,
    createdAt,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : createdAt,
    deletedAt,
  };
}

function normalizeNotesByStock(value: unknown): NotesByStock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: NotesByStock = {};
  for (const [stockKey, rawNotes] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(rawNotes)) continue;
    const notes = rawNotes
      .map(normalizeNote)
      .filter((note): note is StockNote => note !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
    if (notes.length > 0) result[stockKey] = notes;
  }
  return result;
}

function load(): NotesByStock {
  try {
    return normalizeNotesByStock(JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'));
  } catch {
    return {};
  }
}

function persist(notesByStock: NotesByStock): NotesStoreState {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notesByStock));
    return { notesByStock, error: null };
  } catch {
    return { notesByStock, error: '笔记保存失败，请检查本地存储空间' };
  }
}

let state: NotesStoreState = { notesByStock: load(), error: null };
const listeners = new Set<() => void>();

function setState(next: NotesStoreState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): NotesStoreState {
  return state;
}

export function addNote(stockKey: string, text: string): StockNote | null {
  const content = text.trim();
  if (!content) return null;
  const now = Date.now();
  const note: StockNote = {
    id: crypto.randomUUID(),
    text: content,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const current = state.notesByStock[stockKey] || [];
  setState(persist({ ...state.notesByStock, [stockKey]: [note, ...current] }));
  return note;
}

export function removeNote(stockKey: string, id: string): void {
  const current = state.notesByStock[stockKey] || [];
  const target = current.find((note) => note.id === id);
  if (!target || target.deletedAt != null) return;
  const now = Date.now();
  const nextNotes = current.map((note) =>
    note.id === id ? { ...note, updatedAt: now, deletedAt: now } : note
  );
  setState(persist({ ...state.notesByStock, [stockKey]: nextNotes }));
}

export function activeNotesFor(stockKey: string): StockNote[] {
  const notes = state.notesByStock[stockKey];
  if (!notes) return EMPTY_NOTES;
  return notes.filter((note) => note.deletedAt == null);
}

export function toRemoteNotes(notesByStock: NotesByStock = state.notesByStock): RemoteStockNote[] {
  return Object.entries(notesByStock).flatMap(([stockKey, notes]) =>
    notes.map((note) => ({ ...note, stockKey }))
  );
}

function groupByStock(notes: RemoteStockNote[]): NotesByStock {
  const result: NotesByStock = {};
  for (const { stockKey, ...note } of notes) {
    if (!stockKey) continue;
    (result[stockKey] ||= []).push(note);
  }
  for (const notesForStock of Object.values(result)) {
    notesForStock.sort((a, b) => b.createdAt - a.createdAt);
  }
  return result;
}

export function mergeNoteLists(
  local: RemoteStockNote[],
  remote: RemoteStockNote[]
): RemoteStockNote[] {
  const byId = new Map<string, RemoteStockNote>();
  for (const note of [...local, ...remote]) {
    const current = byId.get(note.id);
    if (!current) {
      byId.set(note.id, note);
      continue;
    }
    const isNewer =
      note.updatedAt !== current.updatedAt
        ? note.updatedAt > current.updatedAt
        : note.deletedAt != null && current.deletedAt == null;
    if (isNewer) byId.set(note.id, note);
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function createSnapshot(
  notesByStock: NotesByStock = state.notesByStock,
  updatedAt = Date.now()
): NotesSnapshot {
  const notes = toRemoteNotes(notesByStock);
  const latest = notes.reduce((max, note) => Math.max(max, note.updatedAt), 0);
  return { schemaVersion: 1, updatedAt: Math.max(updatedAt, latest), notes };
}

export function normalizeSnapshot(value: unknown): NotesSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('笔记文件结构无效');
  }
  const raw = value as Record<string, unknown>;
  const rawNotes = Array.isArray(raw.notes) ? raw.notes : [];
  const notes: RemoteStockNote[] = [];
  for (const item of rawNotes) {
    if (!item || typeof item !== 'object') continue;
    const stockKey = (item as Record<string, unknown>).stockKey;
    if (typeof stockKey !== 'string' || !stockKey) continue;
    const note = normalizeNote(item);
    if (note) notes.push({ ...note, stockKey });
  }
  return {
    schemaVersion: 1,
    updatedAt: Number(raw.updatedAt) || 0,
    notes,
  };
}

export function parseSnapshot(text: string): NotesSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('笔记文件不是有效 JSON');
  }
  return normalizeSnapshot(parsed);
}

export function mergeRemoteNotes(snapshot: NotesSnapshot): {
  changed: boolean;
  snapshot: NotesSnapshot;
} {
  const merged = mergeNoteLists(toRemoteNotes(), snapshot.notes);
  const nextByStock = groupByStock(merged);
  const changed = JSON.stringify(nextByStock) !== JSON.stringify(state.notesByStock);
  if (changed) setState(persist(nextByStock));
  return { changed, snapshot: createSnapshot(nextByStock) };
}

export function hasAnyNotes(notesByStock: NotesByStock = state.notesByStock): boolean {
  return Object.values(notesByStock).some((notes) => notes.some((note) => note.deletedAt == null));
}
