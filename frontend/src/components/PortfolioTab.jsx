
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, Wallet, Search, BrainCircuit, Bell,
  Filter, Grid2X2, Activity, TrendingUp, TrendingDown,
  Plus, Pencil, Trash2, RefreshCw, ArrowUpRight,
  ExternalLink, Save, X, ChevronRight
} from 'lucide-react';

import MarketSummaryTab from './MarketSummaryTab';
import MarketHeatmap from './MarketHeatmap';
import {
  fetchPortfolioSummary, fetchBuyingPower, updateBuyingPower,
  createHolding, updateHolding, deleteHolding,
  fetchThresholds, createThreshold, updateThreshold,
  deleteThreshold, fetchMarketQuotes
} from '../services/api';

const sections = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'holdings', label: 'Holdings', icon: Wallet },
  { id: 'explorer', label: 'Stock Explorer', icon: Search },
  { id: 'research', label: 'AI Research', icon: BrainCircuit },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'screener', label: 'Screener', icon: Filter },
  { id: 'heatmap', label: 'Heatmap', icon: Grid2X2 },
  { id: 'monitoring', label: 'Monitoring', icon: Activity },
];

const money = (value, currency = 'USD') => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return '—';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
};

const number = (value, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString('en-US', {
        maximumFractionDigits: digits,
      });

const dateInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

function Change({ value, percent }) {
  if (value == null && percent == null) return <span>—</span>;
  const positive = Number(value ?? percent) >= 0;
  return (
    <div className={positive ? 'text-emerald-400' : 'text-rose-400'}>
      <div className="font-semibold">
        {positive ? '+' : '-'}{money(Math.abs(Number(value || 0)))}
      </div>
      <div className="text-xs">
        {positive ? '+' : ''}{number(percent)}%
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children, action }) {
  return (
    <section className="terminal-card overflow-hidden">
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

function Metric({ label, value, children, icon: Icon }) {
  return (
    <div className="terminal-card p-5">
      <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        {Icon && <Icon size={17} className="text-slate-500" />}
      </div>
      {children || <div className="text-xl font-bold text-white">{value}</div>}
    </div>
  );
}

function HoldingForm({ initial, onSave, onCancel, saving }) {
  const [symbol, setSymbol] = useState(initial?.symbol || '');
  const [shares, setShares] = useState(String(initial?.shares ?? ''));
  const [purchasePrice, setPurchasePrice] = useState(
    String(initial?.purchase_price ?? '')
  );
  const [currency, setCurrency] = useState(
    initial?.purchase_price_currency || 'USD'
  );
  const [purchaseDate, setPurchaseDate] = useState(
    dateInput(initial?.purchase_date)
  );

  const submit = (event) => {
    event.preventDefault();
    onSave({
      symbol: symbol.trim().toUpperCase(),
      shares: Number(shares),
      purchase_price: Number(purchasePrice || 0),
      purchase_price_currency: currency,
      purchase_date: purchaseDate
        ? new Date(`${purchaseDate}T00:00:00`).toISOString()
        : null,
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <label className="terminal-label">
        Ticker
        <input className="terminal-input" required value={symbol}
          onChange={(e) => setSymbol(e.target.value)} placeholder="AMD" />
      </label>
      <label className="terminal-label">
        Shares
        <input className="terminal-input" required type="number" step="any"
          min="0.000001" value={shares}
          onChange={(e) => setShares(e.target.value)} />
      </label>
      <label className="terminal-label">
        Purchase price
        <input className="terminal-input" type="number" step="any" min="0"
          value={purchasePrice}
          onChange={(e) => setPurchasePrice(e.target.value)} />
      </label>
      <label className="terminal-label">
        Currency
        <select className="terminal-input" value={currency}
          onChange={(e) => setCurrency(e.target.value)}>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
          <option value="JPY">JPY</option>
        </select>
      </label>
      <label className="terminal-label">
        Purchase date
        <input className="terminal-input" type="date" value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)} />
      </label>
      <div className="flex items-end gap-2">
        <button disabled={saving} className="terminal-button flex-1">
          <Save size={15} /> {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}
          className="terminal-button-secondary">
          <X size={16} />
        </button>
      </div>
    </form>
  );
}

function StockExplorer({ initialSymbol, onOpenAlert }) {
  const [input, setInput] = useState(initialSymbol || 'NVDA');
  const [symbol, setSymbol] = useState(initialSymbol || 'NVDA');
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialSymbol) {
      setInput(initialSymbol);
      setSymbol(initialSymbol);
    }
  }, [initialSymbol]);

  useEffect(() => {
    let cancelled = false;
    if (!symbol) return undefined;

    const load = async () => {
      if (document.hidden) return;
      setLoading(true);
      try {
        const response = await fetchMarketQuotes([symbol]);
        if (cancelled) return;
        const next = response?.quotes?.[symbol] || null;
        setQuote(next);
        setError(next ? '' : response?.errors?.[symbol] || 'No quote available.');
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Quote request failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const timer = setInterval(load, 60_000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [symbol]);

  const search = (event) => {
    event.preventDefault();
    const next = input.trim().toUpperCase();
    if (next) {
      setQuote(null);
      setSymbol(next);
    }
  };

  const change = quote && Number(quote.previous_close) > 0
    ? quote.price - quote.previous_close
    : null;

  return (
    <div className="space-y-5">
      <Panel title="Stock Explorer"
        subtitle="Live quote lookup using your existing Yahoo Finance backend.">
        <form onSubmit={search} className="flex max-w-xl gap-2">
          <input className="terminal-input" value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="Search ticker, e.g. NVDA" />
          <button className="terminal-button">
            <Search size={16} /> Search
          </button>
        </form>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title={symbol} subtitle="Market quote · Yahoo Finance">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-3xl font-bold tracking-tight text-white">
                  {quote ? money(quote.price, quote.currency || 'USD') : '—'}
                </div>
                {change != null && (
                  <div className={`mt-2 text-sm ${
                    change >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {change >= 0 ? '+' : ''}{number(change)}
                    {' · '}
                    {number(change / quote.previous_close * 100)}%
                    {' vs. previous close'}
                  </div>
                )}
              </div>
              <span className="terminal-chip">
                {quote?.market_session || 'Market data'}
              </span>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="terminal-stat">
                <span>Previous close</span>
                <strong>{quote ? money(quote.previous_close, quote.currency) : '—'}</strong>
              </div>
              <div className="terminal-stat">
                <span>Currency</span>
                <strong>{quote?.currency || '—'}</strong>
              </div>
              <div className="terminal-stat">
                <span>Market session</span>
                <strong className="capitalize">{quote?.market_session || '—'}</strong>
              </div>
            </div>

            {loading && <p className="mt-4 text-xs text-slate-400">Loading quote...</p>}
            {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}

            <div className="mt-5 rounded-xl border border-dashed border-white/10 p-5 text-center">
              <Activity className="mx-auto mb-2 text-slate-500" size={24} />
              <p className="text-sm text-slate-300">Historical chart coming next</p>
              <p className="mt-1 text-xs text-slate-500">
                Requires a historical-price API. No simulated price history is displayed.
              </p>
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Quick actions">
            <button onClick={() => onOpenAlert(symbol)}
              className="terminal-button w-full">
              <Bell size={16} /> Create price alert
            </button>
            <a
              href={`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`}
              target="_blank" rel="noreferrer"
              className="terminal-button-secondary mt-3 flex w-full justify-center"
            >
              <ExternalLink size={16} /> Open Yahoo Finance
            </a>
          </Panel>
          <Panel title="Research coverage">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Live quotes</span>
                <span className="text-emerald-400">Connected</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Historical prices</span>
                <span className="text-amber-400">API needed</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Financial statements</span>
                <span className="text-amber-400">API needed</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">AI documents</span>
                <span className="text-emerald-400">Available</span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function AlertsPanel({ thresholds, refresh, initialSymbol }) {
  const [symbol, setSymbol] = useState(initialSymbol || '');
  const [condition, setCondition] = useState('above');
  const [target, setTarget] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialSymbol) setSymbol(initialSymbol);
  }, [initialSymbol]);

  const reset = () => {
    setEditing(null);
    setSymbol('');
    setCondition('above');
    setTarget('');
    setEnabled(true);
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      symbol: symbol.trim().toUpperCase(),
      condition,
      target_price: Number(target),
      enabled,
    };
    try {
      if (editing != null) {
        await updateThreshold(editing, payload);
      } else {
        await createThreshold(payload);
      }
      reset();
      await refresh();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Unable to save alert.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this price alert?')) return;
    try {
      await deleteThreshold(id);
      await refresh();
    } catch (err) {
      setError(err?.message || 'Unable to delete alert.');
    }
  };

  return (
    <div className="space-y-5">
      <Panel title={editing != null ? 'Edit price alert' : 'Create price alert'}
        subtitle="Your existing Go threshold API and alerting infrastructure.">
        <form onSubmit={save} className="grid gap-3 md:grid-cols-5">
          <label className="terminal-label">
            Symbol
            <input required className="terminal-input" value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="NVDA" />
          </label>
          <label className="terminal-label">
            Condition
            <select className="terminal-input" value={condition}
              onChange={(e) => setCondition(e.target.value)}>
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
          </label>
          <label className="terminal-label">
            Target price
            <input required className="terminal-input" type="number"
              min="0.000001" step="any" value={target}
              onChange={(e) => setTarget(e.target.value)} />
          </label>
          <label className="terminal-label">
            Status
            <select className="terminal-input" value={String(enabled)}
              onChange={(e) => setEnabled(e.target.value === 'true')}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button className="terminal-button flex-1" disabled={busy}>
              <Save size={15} /> {busy ? 'Saving' : 'Save'}
            </button>
            {editing != null && (
              <button type="button" className="terminal-button-secondary"
                onClick={reset}><X size={16} /></button>
            )}
          </div>
        </form>
        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      </Panel>

      <Panel title="Configured alerts" subtitle={`${thresholds.length} rules`}>
        <div className="overflow-x-auto">
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Symbol</th><th>Condition</th><th>Target</th>
                <th>Status</th><th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {thresholds.map((item) => (
                <tr key={item.id}>
                  <td className="font-semibold text-white">{item.symbol}</td>
                  <td className="capitalize">{item.condition}</td>
                  <td>{money(item.target_price ?? item.target)}</td>
                  <td>
                    <span className={item.enabled ? 'text-emerald-400' : 'text-slate-500'}>
                      {item.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    <div className="flex justify-end gap-3">
                      <button className="text-cyan-400" onClick={() => {
                        setEditing(item.id);
                        setSymbol(item.symbol);
                        setCondition(item.condition);
                        setTarget(String(item.target_price ?? item.target ?? ''));
                        setEnabled(Boolean(item.enabled));
                      }}><Pencil size={16} /></button>
                      <button className="text-rose-400"
                        onClick={() => remove(item.id)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!thresholds.length && (
                <tr><td colSpan="5" className="text-center text-slate-500">
                  No alerts configured yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export default function PortfolioTab() {
  const [section, setSection] = useState('overview');
  const [summary, setSummary] = useState(null);
  const [buyingPower, setBuyingPower] = useState(0);
  const [buyingPowerInput, setBuyingPowerInput] = useState('');
  const [editingBuyingPower, setEditingBuyingPower] = useState(false);
  const [thresholds, setThresholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingHolding, setEditingHolding] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('NVDA');
  const [sortField, setSortField] = useState('market_value_usd');
  const [sortDirection, setSortDirection] = useState('desc');
  const [screenerSearch, setScreenerSearch] = useState('');

  const loadPortfolio = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [data, bp] = await Promise.all([
        fetchPortfolioSummary(),
        fetchBuyingPower().catch(() => null),
      ]);
      setSummary(data);
      if (bp?.buying_power != null) setBuyingPower(bp.buying_power);
      setError('');
    } catch (err) {
      setError(err?.message || 'Failed to load portfolio.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadThresholds = useCallback(async () => {
    try {
      const data = await fetchThresholds();
      setThresholds(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    }
  }, []);

  useEffect(() => {
    loadPortfolio();
    loadThresholds();
    const interval = setInterval(() => {
      if (!document.hidden) loadPortfolio(true);
    }, 15_000);
    return () => clearInterval(interval);
  }, [loadPortfolio, loadThresholds]);

  const holdings = useMemo(() => {
    const data = Array.isArray(summary?.holdings) ? summary.holdings : [];
    return [...data].sort((a, b) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      const result = typeof av === 'string'
        ? av.localeCompare(String(bv))
        : Number(av) - Number(bv);
      return sortDirection === 'asc' ? result : -result;
    });
  }, [summary, sortField, sortDirection]);

  const openStock = (symbol) => {
    setSelectedSymbol(String(symbol).toUpperCase());
    setSection('explorer');
  };

  const openAlert = (symbol) => {
    setSelectedSymbol(String(symbol).toUpperCase());
    setSection('alerts');
  };

  const saveHolding = async (payload) => {
    setSaving(true);
    try {
      if (editingHolding?.id != null) {
        await updateHolding(editingHolding.id, payload);
      } else {
        await createHolding(payload);
      }
      setFormOpen(false);
      setEditingHolding(null);
      await loadPortfolio(true);
      setError('');
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Unable to save holding.');
    } finally {
      setSaving(false);
    }
  };

  const removeHolding = async (id) => {
    if (!window.confirm('Delete this holding?')) return;
    try {
      await deleteHolding(id);
      await loadPortfolio(true);
    } catch (err) {
      setError(err?.message || 'Unable to delete holding.');
    }
  };

  const saveBuyingPower = async () => {
    try {
      const response = await updateBuyingPower(buyingPowerInput);
      setBuyingPower(response.buying_power);
      setEditingBuyingPower(false);
    } catch (err) {
      setError(err?.message || 'Unable to update buying power.');
    }
  };

  const sort = (field) => {
    if (field === sortField) {
      setSortDirection((old) => old === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const metrics = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Total portfolio value" icon={Wallet}
        value={money(summary?.total_value_usd)} />
      <Metric label="Buying power" icon={Plus}>
        {editingBuyingPower ? (
          <div className="flex gap-2">
            <input type="number" step="any" className="terminal-input"
              value={buyingPowerInput}
              onChange={(e) => setBuyingPowerInput(e.target.value)} />
            <button className="terminal-button" onClick={saveBuyingPower}>
              <Save size={16} />
            </button>
            <button className="terminal-button-secondary"
              onClick={() => setEditingBuyingPower(false)}><X size={16} /></button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-emerald-400">
              {money(buyingPower)}
            </span>
            <button className="text-xs text-cyan-400" onClick={() => {
              setBuyingPowerInput(String(buyingPower));
              setEditingBuyingPower(true);
            }}>Edit</button>
          </div>
        )}
      </Metric>
      <Metric label="Day change" icon={TrendingUp}>
        <Change value={summary?.day_change_abs_usd}
          percent={summary?.day_change_percent} />
      </Metric>
      <Metric label="Total return" icon={TrendingDown}>
        <Change value={summary?.total_gain_abs_usd}
          percent={summary?.total_gain_percent} />
      </Metric>
    </div>
  );

  const holdingsTable = (
    <div className="overflow-x-auto">
      <table className="terminal-table">
        <thead>
          <tr>
            {[
              ['symbol', 'Symbol'], ['shares', 'Shares'],
              ['avg_cost_share_usd', 'Avg cost'],
              ['last_price_usd', 'Last price'],
              ['market_value_usd', 'Market value'],
              ['day_gain_abs_usd', 'Day change'],
              ['total_gain_abs_usd', 'Total return']
            ].map(([field, label]) => (
              <th key={field}>
                <button className="hover:text-white" onClick={() => sort(field)}>
                  {label} {sortField === field ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                </button>
              </th>
            ))}
            <th className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => (
            <tr key={holding.id}>
              <td>
                <button className="font-bold text-cyan-400 hover:text-cyan-300"
                  onClick={() => openStock(holding.symbol)}>
                  {holding.symbol} <ArrowUpRight size={12} className="inline" />
                </button>
              </td>
              <td>{number(holding.shares, 4)}</td>
              <td>{money(holding.avg_cost_share_usd)}</td>
              <td>{money(holding.last_price_usd)}</td>
              <td className="font-semibold text-white">
                {money(holding.market_value_usd)}
              </td>
              <td><Change value={holding.day_gain_abs_usd}
                percent={holding.day_gain_percent} /></td>
              <td><Change value={holding.total_gain_abs_usd}
                percent={holding.total_gain_percent} /></td>
              <td>
                <div className="flex justify-end gap-3">
                  <button className="text-cyan-400" title="Edit holding"
                    onClick={() => {
                      setEditingHolding(holding);
                      setFormOpen(true);
                      setSection('holdings');
                    }}><Pencil size={16} /></button>
                  <button className="text-rose-400" title="Delete holding"
                    onClick={() => removeHolding(holding.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!holdings.length && (
            <tr><td colSpan="8" className="text-center text-slate-500">
              No holdings found.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Investment Workspace
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Your portfolio, market research and monitoring in one place.
          </p>
        </div>
        <button className="terminal-button-secondary" onClick={() => {
          loadPortfolio();
          loadThresholds();
        }}>
          <RefreshCw size={15} /> Refresh data
        </button>
      </div>

      {metrics}

      <div className="flex gap-2 overflow-x-auto border-b border-white/10 pb-3">
        {sections.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setSection(id)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${
              section === id
                ? 'bg-cyan-400/10 font-semibold text-cyan-300'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error}
        </div>
      )}

      {section === 'overview' && (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <Panel title="Portfolio holdings"
              subtitle={loading ? 'Refreshing...' : `${holdings.length} holdings`}
              action={<button className="text-xs text-cyan-400"
                onClick={() => setSection('holdings')}>
                Manage <ChevronRight size={14} className="inline" />
              </button>}>
              {holdingsTable}
            </Panel>
          </div>
          <div className="space-y-5">
            <Panel title="Quick actions">
              <div className="grid gap-2">
                <button className="terminal-button" onClick={() => {
                  setEditingHolding(null);
                  setFormOpen(true);
                  setSection('holdings');
                }}><Plus size={16} /> Add holding</button>
                <button className="terminal-button-secondary"
                  onClick={() => setSection('research')}>
                  <BrainCircuit size={16} /> Analyze PDF
                </button>
                <button className="terminal-button-secondary"
                  onClick={() => setSection('explorer')}>
                  <Search size={16} /> Explore stocks
                </button>
              </div>
            </Panel>
            <Panel title="Price alerts"
              action={<button className="text-xs text-cyan-400"
                onClick={() => setSection('alerts')}>View all</button>}>
              <div className="space-y-3">
                {thresholds.slice(0, 5).map((alert) => (
                  <div key={alert.id}
                    className="flex items-center justify-between border-b border-white/5 pb-2 text-sm">
                    <span className="font-semibold">{alert.symbol}</span>
                    <span className="text-slate-400">
                      {alert.condition} {money(alert.target_price ?? alert.target)}
                    </span>
                  </div>
                ))}
                {!thresholds.length && (
                  <p className="text-sm text-slate-500">No alerts configured.</p>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {section === 'holdings' && (
        <div className="space-y-5">
          <Panel title="Manage holdings"
            action={<button className="terminal-button" onClick={() => {
              setEditingHolding(null);
              setFormOpen(!formOpen);
            }}><Plus size={16} /> Add holding</button>}>
            {formOpen ? (
              <HoldingForm
                key={editingHolding?.id ?? 'new'}
                initial={editingHolding}
                saving={saving}
                onSave={saveHolding}
                onCancel={() => {
                  setFormOpen(false);
                  setEditingHolding(null);
                }}
              />
            ) : (
              <p className="text-sm text-slate-400">
                Add, edit or remove your portfolio positions.
              </p>
            )}
          </Panel>
          <Panel title="Your positions" subtitle={`${holdings.length} holdings`}>
            {holdingsTable}
          </Panel>
        </div>
      )}

      {section === 'explorer' && (
        <StockExplorer initialSymbol={selectedSymbol} onOpenAlert={openAlert} />
      )}

      {/* Keep AI Research mounted so switching sections doesn't erase the result. */}
      <div style={{ display: section === 'research' ? 'block' : 'none' }}>
        <MarketSummaryTab active={section === 'research'} onSelectSymbol={openStock} />
      </div>

      {section === 'alerts' && (
        <AlertsPanel thresholds={thresholds} refresh={loadThresholds}
          initialSymbol={selectedSymbol} />
      )}

      {section === 'screener' && (
        <Panel title="Portfolio Screener"
          subtitle="Search and inspect existing holdings. Market-wide screening requires a new data API.">
          <input className="terminal-input mb-4 max-w-md"
            placeholder="Filter by ticker..."
            value={screenerSearch}
            onChange={(e) => setScreenerSearch(e.target.value)} />
          <div className="space-y-2">
            {holdings.filter((item) =>
              item.symbol?.toUpperCase().includes(screenerSearch.toUpperCase())
            ).map((item) => (
              <button key={item.id} onClick={() => openStock(item.symbol)}
                className="flex w-full items-center justify-between rounded-lg border border-white/10 p-4 text-left hover:bg-white/5">
                <span className="font-semibold text-white">{item.symbol}</span>
                <span className="text-sm text-slate-400">
                  {money(item.market_value_usd)} <ArrowUpRight size={14} className="inline" />
                </span>
              </button>
            ))}
          </div>
        </Panel>
      )}

      {section === 'heatmap' && <MarketHeatmap />}

      {section === 'monitoring' && (
        <div className="grid gap-4 md:grid-cols-2">
          {[
            { name: 'Grafana', description: 'Dashboards and alert monitoring',
              url: '/grafana/' },
            { name: 'Prometheus', description: 'Metrics and targets',
              url: '/prometheus/' },
            { name: 'Kafka UI', description: 'Kafka topics and messages',
              url: '/kafka-ui/' },
            { name: 'API metrics', description: 'Go backend Prometheus metrics',
              url: '/metrics' },
          ].map((item) => (
            <a key={item.name} href={item.url} target="_blank"
              rel="noreferrer"
              className="terminal-card flex items-center justify-between p-5 hover:border-cyan-500/40">
              <div>
                <h3 className="font-semibold text-white">{item.name}</h3>
                <p className="mt-1 text-sm text-slate-400">{item.description}</p>
              </div>
              <ExternalLink size={18} className="text-cyan-400" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
