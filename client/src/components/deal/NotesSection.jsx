import { useEffect, useState, useCallback } from 'react';
import { generateHTML } from '@tiptap/core';
import { api } from '../../lib/api.js';
import { Eyebrow, Button, IconButton } from '../ui.jsx';
import { fmtDate } from '../../lib/dates.js';
import NoteEditor, { NOTE_EXTENSIONS } from './NoteEditor.jsx';

export default function NotesSection({ dealId }) {
  const [notes, setNotes] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listNotes(dealId).then(setNotes).catch(() => setNotes([]));
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  async function after(fn) {
    setBusy(true);
    try {
      await fn();
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (notes === null) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Notes</Eyebrow>
        {!adding && <Button variant="ghost" onClick={() => setAdding(true)}>+ Add Note</Button>}
      </div>

      {adding && (
        <div className="mb-3">
          <NoteEditor
            busy={busy}
            onCancel={() => setAdding(false)}
            onSubmit={(body) => after(() => api.addNote(dealId, body)).then(() => setAdding(false))}
          />
        </div>
      )}

      {notes.length === 0 && !adding ? (
        <div className="text-text-disabled text-[12px]">No notes yet.</div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              busy={busy}
              onTogglePin={() => after(() => (n.pinned ? api.unpinNote(dealId, n.id) : api.pinNote(dealId, n.id)))}
              onRemove={() => after(() => api.deleteNote(dealId, n.id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function NoteRow({ note, busy, onTogglePin, onRemove }) {
  let html = '';
  try {
    html = generateHTML(note.content_json, NOTE_EXTENSIONS);
  } catch {
    html = `<p>${note.content_text ?? ''}</p>`;
  }

  return (
    <div className="border border-hairline p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {note.pinned && <IconButton icon="pin" active title="Pinned" className="pointer-events-none h-5 w-5" />}
          <span className="text-[12px] text-text-secondary">{note.author ?? 'Unknown'}</span>
          <span className="text-[11px] text-text-muted">{fmtDate(note.created_at)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={busy} onClick={onTogglePin}>
            {note.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onRemove}>Remove</Button>
        </div>
      </div>
      <div className="tiptap-content text-[13px] text-text-primary" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
