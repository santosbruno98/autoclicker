import React from 'react';
import { Cpu, RefreshCw } from 'lucide-react';

export default function ProcessSelector({ processes = [], selectedPid, onSelect }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-semibold text-slate-300">Target Process</label>
      <select
        value={selectedPid}
        onChange={(e) => onSelect(e.target.value)}
        className="bg-slate-800 text-slate-100 border border-slate-700 rounded p-2 focus:outline-none focus:border-blue-500"
      >
        <option value="">-- Select Process --</option>
        {(processes || []).map((proc) => (
          <option key={proc.pid} value={proc.pid}>
            {proc.name} (PID: {proc.pid})
          </option>
        ))}
      </select>
    </div>
  );
}