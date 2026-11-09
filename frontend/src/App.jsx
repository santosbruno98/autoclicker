import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  StickyNote,
  Activity,
  MousePointer2,
  Menu,
  X,
  ChevronRight,
  Github,
  Route,
  Settings,
} from 'lucide-react';

import PortfolioTab from './components/PortfolioTab';
import NotesTab from './components/NotesTab';
import KafkaLogsTab from './components/KafkaLogsTab';
import ControllerTab from './components/ControllerTab';
import RoutePlannerTab from './components/RoutePlannerTab';
import SettingsPage from './components/ThemeSettings';

const navigation = [
  { id: 'portfolio', label: 'Investment Workspace', icon: LayoutDashboard },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'kafka', label: 'Kafka Logs', icon: Activity },
  { id: 'controller', label: 'Desktop Controller', icon: MousePointer2 },
  { id: 'routes', label: 'Route Planner', icon: Route },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('portfolio');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const active = navigation.find((item) => item.id === activeTab);

  useEffect(() => {
    document.title = `MyPlatform | ${active.label}`;
  }, [active.label]);

  function navigate(id) {
    setActiveTab(id);
    setMobileMenuOpen(false);
  }

  return (
    <div className="app-shell min-h-screen lg:flex">
      {mobileMenuOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-30 bg-black/70 lg:hidden"
        />
      )}

      <aside
        id="workspace-navigation"
        className={`app-sidebar fixed inset-y-0 left-0 z-40 flex w-64 flex-col
          border-r border-white/10 transition-transform lg:sticky lg:top-0
          lg:visible lg:h-screen lg:translate-x-0 ${
            mobileMenuOpen
              ? 'visible translate-x-0'
              : 'invisible -translate-x-full'
          }`}
      >
        <div className="flex h-20 shrink-0 items-center justify-between border-b border-white/10 px-5">
          <div>
            <div className="text-xl font-bold tracking-tight text-white">
              My<span className="text-cyan-400">Platform</span>
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
              Investment workspace
            </div>
          </div>

          <button
            type="button"
            className="text-slate-400 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav
          aria-label="Workspace"
          className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3"
        >
          <div className="px-3 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Navigation
          </div>

          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={activeTab === id ? 'page' : undefined}
              onClick={() => navigate(id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
                activeTab === id
                  ? 'bg-cyan-400/10 font-semibold text-cyan-300'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon size={18} className="shrink-0" />
              <span className="flex-1">{label}</span>
              {activeTab === id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>

        <div className="mx-4 mb-5 mt-3 shrink-0 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-xs font-medium text-slate-300">Development</div>

          <a
            href="https://github.com/santosbruno98/autoclicker"
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex items-center gap-2 text-xs text-cyan-400 hover:text-cyan-300"
          >
            <Github size={15} /> GitHub repository
          </a>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="app-header sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-white/10 px-4 backdrop-blur md:px-8">
          <button
            type="button"
            className="rounded-lg p-2 text-slate-300 lg:hidden"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation"
            aria-controls="workspace-navigation"
            aria-expanded={mobileMenuOpen}
          >
            <Menu size={22} />
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-white md:text-base">
              {active.label}
            </h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              {activeTab === 'settings'
                ? 'Manage your workspace preferences'
                : 'Research, portfolio analytics and market monitoring'}
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Workspace
          </div>
        </header>

        <main className="mx-auto max-w-[1700px] p-4 md:p-8">
          <div style={{ display: activeTab === 'portfolio' ? 'block' : 'none' }}>
            <PortfolioTab />
          </div>

          {activeTab === 'notes' && <NotesTab />}
          {activeTab === 'kafka' && <KafkaLogsTab />}
          {activeTab === 'controller' && <ControllerTab />}
          {activeTab === 'routes' && <RoutePlannerTab />}
          {activeTab === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}