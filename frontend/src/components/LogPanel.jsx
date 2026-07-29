import React from 'react';
import { Terminal, CheckCircle, AlertCircle } from 'lucide-react';

export default function LogPanel({ logs = [] }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded p-4 h-48 overflow-y-auto font-mono text-sm">
      <div className="text-xs text-slate-500 mb-2 font-bold uppercase tracking-wider">Execution Logs</div>
      {(!logs || logs.length === 0) ? (
        <div className="text-slate-600 italic">No logs recorded yet.</div>
      ) : (
        (logs || []).map((log, index) => (
          <div key={index} className="text-emerald-400 py-0.5">
            {log}
          </div>
        ))
      )}
    </div>
  );
}