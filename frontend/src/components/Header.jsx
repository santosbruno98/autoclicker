import React from 'react';
import { Cpu } from 'lucide-react';

export default function Header({ status = 'Ready' }) {
  return (
    <header className="flex items-center justify-between border-b border-slate-800 pb-4">
      <div className="flex items-center gap-3">
        <Cpu className="w-8 h-8 text-indigo-500" />
        <h1 className="text-2xl font-bold tracking-wide">AutoClicker Controller</h1>
      </div>
      <span className="text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-3 py-1 rounded-full font-mono">
        Status: {status}
      </span>
    </header>
  );
}