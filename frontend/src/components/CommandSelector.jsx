import React from 'react';
import { Command } from 'lucide-react';

export default function CommandSelector({ tasks = [], selectedTaskId, onSelect }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-semibold text-slate-300">Automation Task</label>
      <select
        value={selectedTaskId}
        onChange={(e) => onSelect(e.target.value)}
        className="bg-slate-800 text-slate-100 border border-slate-700 rounded p-2 focus:outline-none focus:border-blue-500"
      >
        <option value="">-- Select Task Profile --</option>
        {(tasks || []).map((task) => (
          <option key={task.id} value={task.id}>
            {task.name} ({task.keys})
          </option>
        ))}
      </select>
    </div>
  );
}