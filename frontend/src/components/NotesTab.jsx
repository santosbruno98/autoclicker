import React, { useState, useEffect } from 'react';
import { fetchNotes, createNote, updateNote, deleteNote } from '../services/api';

export default function NotesTab() {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadNotes = async () => {
    try {
      const data = await fetchNotes();
      setNotes(data || []);
    } catch (err) {
      console.error('Failed to load notes:', err);
    }
  };

  useEffect(() => {
    loadNotes();
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setIsSubmitting(true);
    try {
      await createNote(draft.trim());
      setDraft('');
      loadNotes();
    } catch (err) {
      console.error('Failed to save note:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleDone = async (note) => {
    try {
      await updateNote(note.id, { content: note.content, done: !note.done });
      loadNotes();
    } catch (err) {
      console.error('Failed to update note:', err);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteNote(id);
      loadNotes();
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  const pending = notes.filter((n) => !n.done);
  const done = notes.filter((n) => n.done);

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-slate-900 p-4 rounded border border-slate-800">
        <h3 className="text-md font-bold text-slate-100 mb-3">New Note</h3>
        <form onSubmit={handleAdd} className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Anything you need to remember or do in-game..."
            rows={3}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 resize-y"
          />
          <button
            type="submit"
            disabled={isSubmitting || !draft.trim()}
            className="self-end bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded px-4 py-1.5 text-sm font-semibold"
          >
            {isSubmitting ? 'Saving...' : 'Add Note'}
          </button>
        </form>
      </div>

      <div className="bg-slate-900 p-4 rounded border border-slate-800">
        <h3 className="text-md font-bold text-slate-100 mb-3">
          Checklist <span className="text-slate-500 font-normal text-sm">({pending.length} open)</span>
        </h3>
        <div className="flex flex-col gap-2">
          {notes.length === 0 && (
            <div className="text-slate-500 italic text-sm">No notes yet. Add something above.</div>
          )}
          {pending.map((note) => (
            <NoteRow key={note.id} note={note} onToggle={handleToggleDone} onDelete={handleDelete} />
          ))}
          {done.length > 0 && (
            <>
              <div className="text-xs text-slate-600 uppercase tracking-wider mt-3 mb-1">Done</div>
              {done.map((note) => (
                <NoteRow key={note.id} note={note} onToggle={handleToggleDone} onDelete={handleDelete} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NoteRow({ note, onToggle, onDelete }) {
  return (
    <div className="flex items-start gap-3 bg-slate-800/50 border border-slate-800 rounded px-3 py-2">
      <input type="checkbox" checked={note.done} onChange={() => onToggle(note)} className="mt-1" />
      <p className={`flex-1 text-sm whitespace-pre-wrap ${note.done ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
        {note.content}
      </p>
      <button
        onClick={() => onDelete(note.id)}
        className="text-red-400 hover:text-red-300 text-xs font-semibold shrink-0"
      >
        Delete
      </button>
    </div>
  );
}