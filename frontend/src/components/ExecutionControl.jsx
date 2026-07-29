import React from 'react';
import { Play } from 'lucide-react';

export default function ExecutionControl({ selectedPid, selectedCommand, isExecuting, onExecute }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex items-center justify-between">
      <div>
        <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Active Selection</span>
        <p className="text-sm font-mono text-slate-300 mt-0.5">
          Target PID: <span className="text-indigo-400 font-bold">{selectedPid || 'None'}</span> | Command:{' '}
          <span className="text-indigo-400 font-bold">{selectedCommand || 'None'}</span>
        </p>
      </div>
      <button
        onClick={onExecute}
        disabled={isExecuting || !selectedPid || !selectedCommand}
        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-lg flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
      >
        <Play className="w-4 h-4 fill-current" />
        {isExecuting ? 'Executing...' : 'Execute'}
      </button>
    </div>
  );
}