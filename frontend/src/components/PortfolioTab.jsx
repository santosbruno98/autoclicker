
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, Wallet, Search, BrainCircuit, Bell,
  Filter, Grid2X2, Activity, Plus, Pencil, Trash2,
  RefreshCw, Save, X, ArrowUpRight, ExternalLink
} from 'lucide-react';

import PortfolioPerformanceChart from './PortfolioPerformanceChart';
import TradingViewTechnicalChart from './TradingViewTechnicalChart';
import MarketSummaryTab from './MarketSummaryTab';
import MarketHeatmap from './MarketHeatmap';

import {
  fetchPortfolioSummary,
  fetchBuyingPower,
  updateBuyingPower,
  createHolding,
  updateHolding,
  deleteHolding,
  fetchThresholds,
  createThreshold,
  updateThreshold,
  deleteThreshold,
  fetchMarketQuotes,
} from '../services/api';

const sections = [
  ['overview', 'Overview', LayoutDashboard],
  ['holdings', 'Holdings', Wallet],
  ['explorer', 'Stock Explorer', Search],
  ['research', 'AI Research', BrainCircuit],
  ['alerts', 'Alerts', Bell],
  ['screener', 'Screener', Filter],
  ['heatmap', 'Heatmap', Grid2X2],
  ['monitoring', 'Monitoring', Activity],
];

function money(value, currency = 'USD') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function num(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-US', {
    maximumFractionDigits: digits,
  });
}

function Change({ amount, percent }) {
  if (amount == null && percent == null) return '—';
  const positive = Number(amount ?? percent) >= 0;
  return (
    <div className={positive ? 'text-emerald-400' : 'text-rose-400'}>
      <div className="font-semibold">
        {positive ? '+' : '-'}{money(Math.abs(Number(amount || 0)))}
      </div>
      <div className="text-xs">
        {Number(percent) > 0 ? '+' : ''}{num(percent)}%
      </div>
    </div>
  );
}

function Panel({ title, subtitle, action, children }) {
  return (
    <section className="terminal-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="font-semibold text-white">{title}</h2>
          {subtitle && (
            <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Metric({ title, children }) {
  return (
    <div className="terminal-card p-5">
      <p className="mb-3 text-xs text-slate-400">{title}</p>
      <div className="text-xl font-bold">{children}</div>
    </div>
  );
}

function HoldingEditor({ initial, saving, onSave, onCancel }) {
  const [symbol, setSymbol] = useState(initial?.symbol || '');
  const [shares, setShares] = useState(String(initial?.shares ?? ''));
  const [price, setPrice] = useState(
    String(initial?.purchase_price ?? '')
  );
  const [currency, setCurrency] = useState(
    initial?.purchase_price_currency || 'USD'
  );
  const [date, setDate] = useState(
    initial?.purchase_date
      ? new Date(initial.purchase_date).toISOString().slice(0, 10)
      : ''
  );

  const submit = (event) => {
    event.preventDefault();
    onSave({
      symbol: symbol.trim().toUpperCase(),
      shares: Number(shares),
      purchase_price: Number(price || 0),
      purchase_price_currency: currency,
      purchase_date: date
        ? new Date(`${date}T00:00:00`).toISOString()
        : null,
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      <label className="terminal-label">
        Ticker
        <input required className="terminal-input" value={symbol}
          onChange={(e) => setSymbol(e.target.value)} />
      </label>
      <label className="terminal-label">
        Shares
        <input required type="number" min="0.000001" step="any"
          className="terminal-input" value={shares}
          onChange={(e) => setShares(e.target.value)} />
      </label>
      <label className="terminal-label">
        Purchase price
        <input type="number" min="0" step="any"
          className="terminal-input" value={price}
          onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label className="terminal-label">
        Currency
        <select className="terminal-input" value={currency}
          onChange={(e) => setCurrency(e.target.value)}>
          {['USD', 'EUR', 'GBP', 'JPY'].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className="terminal-label">
        Purchase date
        <input type="date" className="terminal-input" value={date}
          onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="flex items-end gap-2">
        <button disabled={saving} className="terminal-button">
          <Save size={15} /> {saving ? 'Saving' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}
          className="terminal-button-secondary">
          <X size={16} />
        </button>
      </div>
    </form>
  );
}

function StockExplorer({ symbol, onAlert }) {
  const [input, setInput] = useState(symbol || 'NVDA');
  const [ticker, setTicker] = useState(symbol || 'NVDA');
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (symbol) {
      setInput(symbol);
      setTicker(symbol);
    }
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (document.hidden) return;
      try {
        const data = await fetchMarketQuotes([ticker]);
        if (cancelled) return;
        const next = data?.quotes?.[ticker] || null;
        setQuote(next);
        setError(next ? '' : 'Quote unavailable.');
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    };

    setQuote(null);
    load();
    const timer = setInterval(load, 60_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ticker]);

  const search = (event) => {
    event.preventDefault();
    const next = input.trim().toUpperCase();
    if (next) setTicker(next);
  };

  return (
    <div className="space-y-5">
      <Panel title="Stock Explorer"
        subtitle="Search a ticker and analyze it using TradingView.">
        <form onSubmit={search} className="flex max-w-xl gap-2">
          <input className="terminal-input" value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="NVDA, AMD, MSFT..." />
          <button className="terminal-button">
            <Search size={16} /> Search
          </button>
        </form>
      </Panel>

      <div className="grid gap-4 md:grid-cols-3">
        <Metric title={`${ticker} · Last price`}>
          {quote ? money(quote.price, quote.currency) : '—'}
        </Metric>
        <Metric title="Previous close">
          {quote ? money(quote.previous_close, quote.currency) : '—'}
        </Metric>
        <Metric title="Market session">
          <span className="capitalize">{quote?.market_session || '—'}</span>
        </Metric>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <TradingViewTechnicalChart symbol={ticker} />

      <div className="flex flex-wrap gap-3">
        <button className="terminal-button" onClick={() => onAlert(ticker)}>
          <Bell size={16} /> Create alert for {ticker}
        </button>
        <a
          className="terminal-button-secondary"
          href={`https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/`}
          target="_blank" rel="noreferrer"
        >
          <ExternalLink size={16} /> Yahoo Finance
        </a>
      </div>
    </div>
  );
}

function AlertManager({ alerts, reload, initialSymbol }) {
  const [editingId, setEditingId] = useState(null);
  const [symbol, setSymbol] = useState(initialSymbol || '');
  const [condition, setCondition] = useState('above');
  const [target, setTarget] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialSymbol) setSymbol(initialSymbol);
  }, [initialSymbol]);

  const reset = () => {
    setEditingId(null);
    setSymbol('');
    setCondition('above');
    setTarget('');
    setEnabled(true);
  };

  const save = async (event) => {
    event.preventDefault();
    setError('');
    const payload = {
      symbol: symbol.trim().toUpperCase(),
      condition,
      target_price: Number(target),
      enabled,
    };

    try {
      if (editingId != null) {
        await updateThreshold(editingId, payload);
      } else {
        await createThreshold(payload);
      }
      reset();
      await reload();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this alert?')) return;
    try {
      await deleteThreshold(id);
      await reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-5">
      <Panel title={editingId != null ? 'Edit alert' : 'Create price alert'}>
        <form onSubmit={save} className="grid gap-3 md:grid-cols-5">
          <label className="terminal-label">
            Ticker
            <input required className="terminal-input" value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
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
            Target
            <input required type="number" min="0.000001" step="any"
              className="terminal-input" value={target}
              onChange={(e) => setTarget(e.target.value)} />
          </label>
          <label className="terminal-label">
            Enabled
            <select className="terminal-input" value={String(enabled)}
              onChange={(e) => setEnabled(e.target.value === 'true')}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button className="terminal-button">
              <Save size={15} /> Save
            </button>
            {editingId != null && (
              <button type="button" className="terminal-button-secondary"
                onClick={reset}><X size={16} /></button>
            )}
          </div>
        </form>
        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      </Panel>

      <Panel title="Configured alerts">
        <div className="overflow-x-auto">
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Symbol</th><th>Condition</th><th>Target</th>
                <th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id}>
                  <td className="font-semibold">{alert.symbol}</td>
                  <td className="capitalize">{alert.condition}</td>
                  <td>{money(alert.target_price ?? alert.target)}</td>
                  <td>{alert.enabled ? 'Enabled' : 'Disabled'}</td>
                  <td>
                    <div className="flex gap-3">
                      <button className="text-cyan-400" onClick={() => {
                        setEditingId(alert.id);
                        setSymbol(alert.symbol);
                        setCondition(alert.condition);
                        setTarget(String(alert.target_price ?? alert.target));
                        setEnabled(Boolean(alert.enabled));
                      }}><Pencil size={16} /></button>
                      <button className="text-rose-400"
                        onClick={() => remove(alert.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!alerts.length && (
                <tr><td colSpan="5">No alerts configured.</td></tr>
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
  const [buyingInput, setBuyingInput] = useState('');
  const [editingBuying, setEditingBuying] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingHolding, setEditingHolding] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('NVDA');
  const [sortField, setSortField] = useState('market_value_usd');
  const [sortDirection, setSortDirection] = useState('desc');
  const [filter, setFilter] = useState('');

  const loadPortfolio = useCallback(async () => {
    try {
      const [data, bp] = await Promise.all([
        fetchPortfolioSummary(),
        fetchBuyingPower().catch(() => null),
      ]);
      setSummary(data);
      if (bp?.buying_power != null) setBuyingPower(bp.buying_power);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load portfolio.');
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const data = await fetchThresholds();
      setAlerts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Unable to fetch alerts', err);
    }
  }, []);

  useEffect(() => {
    loadPortfolio();
    loadAlerts();
    const timer = setInterval(() => {
      if (!document.hidden) loadPortfolio();
    }, 15_000);
    return () => clearInterval(timer);
  }, [loadPortfolio, loadAlerts]);

  const holdings = useMemo(() => {
    const items = Array.isArray(summary?.holdings) ? summary.holdings : [];
    return [...items].sort((a, b) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      const result = typeof av === 'string'
        ? av.localeCompare(String(bv))
        : Number(av) - Number(bv);
      return sortDirection === 'asc' ? result : -result;
    });
  }, [summary, sortField, sortDirection]);

  const sort = (field) => {
    if (field === sortField) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

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
      await loadPortfolio();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeHolding = async (id) => {
    if (!window.confirm('Delete this holding?')) return;
    try {
      await deleteHolding(id);
      await loadPortfolio();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveBuying = async () => {
    try {
      const data = await updateBuyingPower(buyingInput);
      setBuyingPower(data.buying_power);
      setEditingBuying(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const holdingsTable = (
    <div className="overflow-x-auto">
      <table className="terminal-table">
        <thead>
          <tr>
            {[
              ['symbol', 'Symbol'],
              ['shares', 'Shares'],
              ['avg_cost_share_usd', 'Avg cost'],
              ['last_price_usd', 'Last price'],
              ['market_value_usd', 'Market value'],
              ['day_gain_abs_usd', 'Day change'],
              ['total_gain_abs_usd', 'Total return'],
            ].map(([field, label]) => (
              <th key={field}>
                <button onClick={() => sort(field)}>
                  {label} {sortField === field
                    ? sortDirection === 'asc' ? '↑' : '↓'
                    : '↕'}
                </button>
              </th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => (
            <tr key={holding.id}>
              <td>
                <button className="font-semibold text-cyan-400"
                  onClick={() => openStock(holding.symbol)}>
                  {holding.symbol}
                  <ArrowUpRight size={13} className="ml-1 inline" />
                </button>
              </td>
              <td>{num(holding.shares, 4)}</td>
              <td>{money(holding.avg_cost_share_usd)}</td>
              <td>{money(holding.last_price_usd)}</td>
              <td className="font-semibold text-white">
                {money(holding.market_value_usd)}
              </td>
              <td>
                <Change amount={holding.day_gain_abs_usd}
                  percent={holding.day_gain_percent} />
              </td>
              <td>
                <Change amount={holding.total_gain_abs_usd}
                  percent={holding.total_gain_percent} />
              </td>
              <td>
                <div className="flex gap-3">
                  <button className="text-cyan-400" onClick={() => {
                    setEditingHolding(holding);
                    setFormOpen(true);
                    setSection('holdings');
                  }}>
                    <Pencil size={16} />
                  </button>
                  <button className="text-rose-400"
                    onClick={() => removeHolding(holding.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!holdings.length && (
            <tr><td colSpan="8">No holdings found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">
            Investment Workspace
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Portfolio performance, research and market monitoring.
          </p>
        </div>
        <button className="terminal-button-secondary" onClick={() => {
          loadPortfolio();
          loadAlerts();
        }}>
          <RefreshCw size={16} /> Refresh data
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Total portfolio value">
          {money(summary?.total_value_usd)}
        </Metric>
        <Metric title="Buying power">
          {editingBuying ? (
            <div className="flex gap-2">
              <input className="terminal-input" type="number" step="any"
                value={buyingInput}
                onChange={(e) => setBuyingInput(e.target.value)} />
              <button className="terminal-button" onClick={saveBuying}>
                <Save size={16} />
              </button>
              <button className="terminal-button-secondary"
                onClick={() => setEditingBuying(false)}>
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-emerald-400">{money(buyingPower)}</span>
              <button className="text-xs text-cyan-400" onClick={() => {
                setBuyingInput(String(buyingPower));
                setEditingBuying(true);
              }}>Edit</button>
            </div>
          )}
        </Metric>
        <Metric title="Day change">
          <Change amount={summary?.day_change_abs_usd}
            percent={summary?.day_change_percent} />
        </Metric>
        <Metric title="Total return">
          <Change amount={summary?.total_gain_abs_usd}
            percent={summary?.total_gain_percent} />
        </Metric>
      </div>

      <nav className="flex gap-2 overflow-x-auto border-b border-white/10 pb-3">
        {sections.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setSection(id)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${
              section === id
                ? 'bg-cyan-400/10 font-semibold text-cyan-300'
                : 'text-slate-400 hover:bg-white/5'
            }`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>

      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error}
        </p>
      )}

      {/* Chart stays mounted while navigating, but only polls in Overview. */}
      <div style={{ display: section === 'overview' ? 'block' : 'none' }}>
        <PortfolioPerformanceChart active={section === 'overview'} />
      </div>

      {section === 'overview' && (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Panel title="Portfolio holdings"
              subtitle={`${holdings.length} holdings · Select a ticker to open TradingView`}
              action={
                <button className="text-xs text-cyan-400"
                  onClick={() => setSection('holdings')}>
                  Manage holdings
                </button>
              }>
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
                }}>
                  <Plus size={16} /> Add holding
                </button>
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

            <Panel title="Price alerts">
              {alerts.length ? alerts.slice(0, 5).map((alert) => (
                <div key={alert.id}
                  className="flex justify-between border-b border-white/10 py-2 text-sm">
                  <span>{alert.symbol}</span>
                  <span className="text-slate-400">
                    {alert.condition} {money(alert.target_price ?? alert.target)}
                  </span>
                </div>
              )) : (
                <p className="text-sm text-slate-500">
                  No alerts configured.
                </p>
              )}
              <button className="mt-4 text-sm text-cyan-400"
                onClick={() => setSection('alerts')}>
                Manage alerts
              </button>
            </Panel>
          </div>
        </div>
      )}

      {section === 'holdings' && (
        <div className="space-y-5">
          <Panel title="Manage holdings"
            action={
              <button className="terminal-button" onClick={() => {
                setEditingHolding(null);
                setFormOpen(true);
              }}>
                <Plus size={16} /> Add holding
              </button>
            }>
            {formOpen ? (
              <HoldingEditor
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
                Add a position or edit an existing holding below.
              </p>
            )}
          </Panel>
          <Panel title="Your positions">
            {holdingsTable}
          </Panel>
        </div>
      )}

      {section === 'explorer' && (
        <StockExplorer
          symbol={selectedSymbol}
          onAlert={openAlert}
        />
      )}

      <div style={{ display: section === 'research' ? 'block' : 'none' }}>
        <MarketSummaryTab
          active={section === 'research'}
          onSelectSymbol={openStock}
        />
      </div>

      {section === 'alerts' && (
        <AlertManager
          alerts={alerts}
          reload={loadAlerts}
          initialSymbol={selectedSymbol}
        />
      )}

      {section === 'screener' && (
        <Panel title="Portfolio Screener"
          subtitle="Search your holdings. Market-wide screening needs additional data.">
          <input className="terminal-input mb-4 max-w-md"
            placeholder="Filter by ticker..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)} />
          <div className="space-y-2">
            {holdings.filter((item) =>
              item.symbol?.toUpperCase().includes(filter.toUpperCase())
            ).map((item) => (
              <button key={item.id}
                onClick={() => openStock(item.symbol)}
                className="flex w-full justify-between rounded-xl border border-white/10 p-4 hover:bg-white/5">
                <span className="font-semibold">{item.symbol}</span>
                <span>{money(item.market_value_usd)}</span>
              </button>
            ))}
          </div>
        </Panel>
      )}

      {section === 'heatmap' && <MarketHeatmap />}

      {section === 'monitoring' && (
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ['Grafana', '/grafana/'],
            ['Prometheus', '/prometheus/'],
            ['Kafka UI', '/kafka-ui/'],
            ['API Metrics', '/metrics'],
          ].map(([name, url]) => (
            <a key={name} href={url} target="_blank" rel="noreferrer"
              className="terminal-card flex items-center justify-between p-5 hover:border-cyan-400/40">
              <span className="font-semibold">{name}</span>
              <ExternalLink size={17} className="text-cyan-400" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
