import React, { useState } from 'react';

export default function TaskManager({ tasks, onRefresh }) {
  const [name, setName] = useState('');
  const [keys, setKeys] = useState('');
  const [keyDelay, setKeyDelay] = useState(0.5);
  const [loopDelay, setLoopDelay] = useState(1.5);
  const [autoFocus, setAutoFocus] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name || !keys) return;

    setIsSubmitting(true);
    try {
      await fetch('http://localhost:8080/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          keys,
          key_delay: parseFloat(keyDelay),
          loop_delay: parseFloat(loopDelay),
          auto_focus: autoFocus,
        }),
      });
      setName('');
      setKeys('');
      setKeyDelay(0.5);
      setLoopDelay(1.5);
      setAutoFocus(false);
      onRefresh();
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`http://localhost:8080/api/v1/tasks/${id}`, { method: 'DELETE' });
      onRefresh();
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  return (
    <div className="bg-slate-900 p-4 rounded border border-slate-800 text-slate-200">
      <h3 className="text-md font-bold text-slate-100 mb-3">Keystroke Task Profiles</h3>

      <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-4">
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
        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-blue-600 hover:bg-blue-500 text-white rounded px-3 py-1 text-sm font-semibold"
        >
          {isSubmitting ? 'Saving...' : 'Add Task'}
        </button>
      </form>

      <div className="max-h-36 overflow-y-auto border border-slate-800 rounded">
        <table className="w-full text-left text-xs text-slate-400">
          <thead className="bg-slate-800 text-slate-300">
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
              <tr key={t.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                <td className="p-2 font-medium text-slate-200">{t.name}</td>
                <td className="p-2 font-mono text-emerald-400">{t.keys}</td>
                <td className="p-2">{t.key_delay}s</td>
                <td className="p-2">{t.loop_delay}s</td>
                <td className="p-2">{t.auto_focus ? 'Yes' : 'No'}</td>
                <td className="p-2 text-right">
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="text-red-400 hover:text-red-300 font-semibold"
                  >
                    Delete
                  </button>
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