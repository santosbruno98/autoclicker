import React, { useEffect, useRef } from 'react';

export default function WorkerLogPanel({ logs = [] }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [logs]);

  return (
    <div className="h-48 min-h-[100px] max-h-[500px] resize-y overflow-auto bg-slate-950 border border-slate-800 rounded p-4 font-mono text-sm">
      <div className="text-xs text-slate-500 mb-2 font-bold uppercase tracking-wider">Worker Output</div>
      {(!logs || logs.length === 0) ? (
        <div className="text-slate-600 italic">No worker output yet. Start automation to see live loop activity.</div>
      ) : (
        <>
          {logs.map((log, index) => (
            <div key={index} className="text-amber-400 py-0.5">
              {log}
            </div>
          ))}
          <div ref={bottomRef} />
        </>
      )}
    </div>
  );
}