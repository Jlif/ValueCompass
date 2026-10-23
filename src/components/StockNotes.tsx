import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useStockNotes } from '../hooks/useStockNotes';
import type { Stock } from '../types';

interface Props {
  stock: Stock;
}

const NOTE_TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function StockNotes({ stock }: Props) {
  const { notes, addNote, removeNote, storageError } = useStockNotes(stock);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    textareaRef.current?.focus();

    const handleMouseDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const submit = () => {
    if (!draft.trim()) return;
    addNote(draft);
    setDraft('');
    textareaRef.current?.focus();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="stock-notes" ref={wrapRef}>
      <button
        type="button"
        className={`watchlist-btn-large note-btn-large ${notes.length > 0 ? 'has-notes' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="stock-notes-panel"
      >
        ✎ 笔记{notes.length > 0 ? ` ${notes.length}` : ''}
      </button>

      {open && (
        <section
          id="stock-notes-panel"
          className="stock-notes-panel"
          role="dialog"
          aria-label={`${stock.name}的投资笔记`}
        >
          <div className="stock-notes-header">
            <div>
              <h3>{stock.name} · 投资笔记</h3>
              <p>仅保存在当前浏览器</p>
            </div>
            <button
              type="button"
              className="stock-notes-close"
              onClick={() => setOpen(false)}
              aria-label="关闭笔记"
            >
              ×
            </button>
          </div>

          <form className="stock-notes-composer" onSubmit={handleSubmit}>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="记录估值判断、风险点、交易计划……"
              maxLength={5000}
              rows={4}
            />
            <div className="stock-notes-composer-footer">
              <span>⌘/Ctrl + Enter 添加 · {draft.length}/5000</span>
              <button
                type="submit"
                className="btn-small btn-primary"
                disabled={!draft.trim()}
              >
                添加笔记
              </button>
            </div>
          </form>

          {storageError && <p className="stock-notes-error">{storageError}</p>}

          <div className="stock-notes-list">
            {notes.length === 0 ? (
              <div className="stock-notes-empty">
                <span>还没有笔记</span>
                <p>记录第一次判断，之后会按时间倒序显示。</p>
              </div>
            ) : (
              notes.map((note) => (
                <article className="stock-note" key={note.id}>
                  <div className="stock-note-meta">
                    <time dateTime={new Date(note.createdAt).toISOString()}>
                      {NOTE_TIME_FORMAT.format(note.createdAt)}
                    </time>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('确定删除这条笔记吗？')) removeNote(note.id);
                      }}
                      aria-label={`删除 ${NOTE_TIME_FORMAT.format(note.createdAt)} 的笔记`}
                    >
                      删除
                    </button>
                  </div>
                  <p>{note.text}</p>
                </article>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
