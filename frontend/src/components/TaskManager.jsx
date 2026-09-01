import React, { useState } from 'react';
import { createTask, updateTask, deleteTask } from '../services/api';

export default function TaskManager({ tasks, onRefresh }) {
  const [name, setName] = useState('');
  const [keys, setKeys] = useState('');
  const [keyDelay, setKeyDelay] = useState(0.5);
  const [loopDelay, setLoopDelay] = useState(1.5);
  const [autoFocus, setAutoFocus] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const resetForm = () => {
    setName('');
    setKeys('');
    setKeyDelay(0.5);
    setLoopDelay(1.5);
    setAutoFocus(false);
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !keys) return;

    const payload = {
      name,
      keys,
      key_delay: parseFloat(keyDelay),
      loop_delay: parseFloat(loopDelay),
      auto_focus: autoFocus,
    };

    setIsSubmitting(true);
    try {
      if (editingId) {
        await updateTask(editingId, payload);
      } else {
        await createTask(payload);
      }
      resetForm();
      onRefresh();
    } catch (err) {
      console.error('Failed to save task:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRowAction = async (task, action) => {
    if (action === 'edit') {
      setEditingId(task.id);
      setName(task.name);
      setKeys(task.keys);
      setKeyDelay(task.key_delay);
      setLoopDelay(task.loop_delay);
      setAutoFocus(task.auto_focus);
    } else if (action === 'delete') {
      try {
        await deleteTask(task.id);
        if (editingId === task.id) resetForm();
        onRefresh();
      } catch (err) {
        console.error('Failed to delete task:', err);
      }
    }
  };

  return (
    <div className="bg-slate-900 p-4 rounded border border-slate-800 text-slate-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-md font-bold text-slate-100">Keystroke Task Profiles</h3>
        {editingId && (
          <span className="text-xs text-amber-400 font-mono">
            Editing task #{editingId} — <button type="button" onClick={resetForm} className="underline hover:text-amber-300">cancel</button>
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-4">
        <input
          type="text"
          placeholder="Task Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
          required
        />
        <input
          type="text"
          placeholder="Keys (e.g. f1,f2 or 1)"
          value={keys}
          onChange={(e) => setKeys(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
          required
        />
        <input
          type="number"
          step="0.1"
          placeholder="Key delay (s)"
          value={keyDelay}
          onChange={(e) => setKeyDelay(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
        />
        <input
          type="number"
          step="0.1"
          placeholder="Loop delay (s)"
          value={loopDelay}
          onChange={(e) => setLoopDelay(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
        />
        <label className="flex items-center gap-1 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={autoFocus}
            onChange={(e) => setAutoFocus(e.target.checked)}
          />
          Auto-focus
        </label>
        <div className="flex gap-1">
          <button
            type="submit"
            disabled={isSubmitting}
            className={`flex-1 rounded px-3 py-1 text-sm font-semibold text-white ${
              editingId ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {isSubmitting ? 'Saving...' : editingId ? 'Update Task' : 'Add Task'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded px-2 py-1 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200"
            >
              ✕
            </button>
          )}
        </div>
      </form>

      <div className="h-40 min-h-[80px] max-h-[500px] resize-y overflow-auto border border-slate-800 rounded">
        <table className="w-full text-left text-xs text-slate-400">
          <thead className="bg-slate-800 text-slate-300 sticky top-0">
            <tr>
              <th className="p-2">Name</th>
              <th className="p-2">Keys</th>
              <th className="p-2">Key Delay</th>
              <th className="p-2">Loop Delay</th>
              <th className="p-2">Auto-focus</th>
              <th className="p-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {(tasks || []).map((t) => (
              <tr key={t.id} className={`border-b border-slate-800/50 hover:bg-slate-800/30 ${editingId === t.id ? 'bg-amber-950/30' : ''}`}>
                <td className="p-2 font-medium text-slate-200">{t.name}</td>
                <td className="p-2 font-mono text-emerald-400">{t.keys}</td>
                <td className="p-2">{t.key_delay}s</td>
                <td className="p-2">{t.loop_delay}s</td>
                <td className="p-2">{t.auto_focus ? 'Yes' : 'No'}</td>
                <td className="p-2 text-right">
                  <select
                    value=""
                    onChange={(e) => {
                      const action = e.target.value;
                      if (action) handleRowAction(t, action);
                    }}
                    className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-xs text-slate-200"
                  >
                    <option value="">Action...</option>
                    <option value="edit">Edit</option>
                    <option value="delete">Delete</option>
                  </select>
                </td>
              </tr>
            ))}
            {(!tasks || tasks.length === 0) && (
              <tr>
                <td colSpan="6" className="p-2 text-center text-slate-500 italic">
                  No task patterns registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}