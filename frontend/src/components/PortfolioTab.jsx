import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard, Wallet, Search, BrainCircuit, Bell,
  Filter, Grid2X2, Activity, Plus, Pencil, Trash2,
  RefreshCw, Save, X, ArrowUpRight, ExternalLink,
} from 'lucide-react';

import PortfolioPerformanceChart from './PortfolioPerformanceChart';
import TradingViewTechnicalChart from './TradingViewTechnicalChart';
import MarketSummaryTab from './MarketSummaryTab';
import MarketHeatmap from './MarketHeatmap';

import {
  fetchPortfolioSummary,
  fetchBuyingPower,
  updateBuyingPower,
  createPortfolioTrade,
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

const positionColumns = [
  ['symbol', 'Symbol'],
  ['shares', 'Shares'],
  ['avg_cost_share_usd', 'Avg cost'],
  ['last_price_usd', 'Last price'],
  ['market_value_usd', 'Market value'],
  ['day_gain_abs_usd', 'Day change'],
  ['total_gain_abs_usd', 'Unrealized'],
  ['realized_gain_abs_usd', 'Realized'],
];

const tradeCurrencies = ['USD', 'EUR', 'GBP', 'JPY'];

const tradeDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Lisbon',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function todayInLisbon() {
  const parts = Object.fromEntries(
    tradeDateFormatter.formatToParts(new Date()).map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

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
      {amount != null && (
        <div className="font-semibold">
          {Number(amount) > 0 ? '+' : ''}{money(amount)}
        </div>
      )}
      {percent != null && (
        <div className="text-xs">
          {Number(percent) > 0 ? '+' : ''}{num(percent)}%
        </div>
      )}
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

function TradeEditor({ initialSymbol, saving, onSave, onCancel }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [side, setSide] = useState('buy');
  const [date, setDate] = useState(todayInLisbon);
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [rate, setRate] = useState('');
  const [error, setError] = useState('');
  const lastRequest = useRef(null);

  function submit(event) {
    event.preventDefault();
    if (saving) return;

    const payload = {
      symbol: symbol.trim().toUpperCase(),
      side,
      date,
      shares: shares.trim().replace(',', '.'),
      unit_price: price.trim().replace(',', '.'),
      currency,
      usd_per_currency_unit: currency === 'USD'
        ? ''
        : rate.trim().replace(',', '.'),
    };

    if (!payload.symbol) {
      setError('Enter a ticker.');
      return;
    }

    if (Number(payload.shares) <= 0 || Number(payload.unit_price) <= 0) {
      setError('Shares and execution price must be greater than zero.');
      return;
    }

    if (currency !== 'USD' && Number(payload.usd_per_currency_unit) <= 0) {
      setError('The exchange rate must be greater than zero.');
      return;
    }

    setError('');

    const key = JSON.stringify(payload);
    if (lastRequest.current?.key !== key) {
      lastRequest.current = { key, id: crypto.randomUUID() };
    }

    onSave({ ...payload, request_id: lastRequest.current.id });
  }

  return (
    <form onSubmit={submit}>
      <fieldset
        disabled={saving}
        className="grid gap-3 md:grid-cols-3 xl:grid-cols-6"
      >
        <label className="terminal-label">
          Ticker
          <input
            required
            maxLength={10}
            className="terminal-input"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
          />
        </label>

        <label className="terminal-label">
          Side
          <select
            className="terminal-input"
            value={side}
            onChange={(event) => setSide(event.target.value)}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </label>

        <label className="terminal-label">
          Trade date
          <input
            required
            type="date"
            max={todayInLisbon()}
            className="terminal-input"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>

        <label className="terminal-label">
          Shares
          <input
            required
            inputMode="decimal"
            pattern="[0-9]{1,7}([.,][0-9]{1,7})?"
            className="terminal-input"
            value={shares}
            onChange={(event) => setShares(event.target.value)}
          />
        </label>

        <label className="terminal-label">
          Execution price per share
          <input
            required
            inputMode="decimal"
            pattern="[0-9]{1,7}([.,][0-9]{1,7})?"
            className="terminal-input"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>

        <label className="terminal-label">
          Currency
          <select
            className="terminal-input"
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value);
              setRate('');
            }}
          >
            {tradeCurrencies.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>

        {currency !== 'USD' && (
          <label className="terminal-label">
            USD per 1 {currency}
            <input
              required
              inputMode="decimal"
              pattern="[0-9]{1,7}([.,][0-9]{1,12})?"
              className="terminal-input"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
          </label>
        )}

        <div className="flex items-end gap-2 md:col-span-2">
          <button type="submit" className="terminal-button">
            <Save size={15} /> {saving ? 'Saving…' : 'Save transaction'}
          </button>
          <button type="button" onClick={onCancel} className="terminal-button-secondary">
            Cancel
          </button>
        </div>
      </fieldset>

      {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
    </form>
  );
}

function TradeHistory({ holding }) {
  const trades = holding.transactions ?? [];

  return (
    <div className="space-y-2 py-2">
      <p className="font-semibold">{holding.symbol} transactions</p>

      {holding.estimated_cost_basis && (
        <p className="text-xs text-slate-400">
          USD gains include an estimated exchange rate for older purchases.
        </p>
      )}

      {holding.cost_basis_error && (
        <p className="text-xs text-rose-400">{holding.cost_basis_error}</p>
      )}

      <div className="overflow-x-auto">
        <table className="terminal-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Side</th>
              <th>Shares</th>
              <th>Execution price</th>
              <th>Realized gain (USD)</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.id}>
                <td>{trade.date || 'Date unknown'}</td>
                <td>{trade.side === 'sell' ? 'Sell' : 'Buy'}</td>
                <td>{num(trade.shares, 7)}</td>
                <td>{num(trade.unit_price, 7)} {trade.currency}</td>
                <td><Change amount={trade.realized_gain_abs_usd} /></td>
              </tr>
            ))}
            {!trades.length && (
              <tr><td colSpan={5}>No transactions recorded.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PositionsTable({
  rows,
  expandedSymbols,
  sortField,
  sortDirection,
  saving,
  onSort,
  onToggleHistory,
  onOpenStock,
  onAddTrade,
}) {
  return (
    <div className="overflow-x-auto">
      <table className="terminal-table">
        <thead>
          <tr>
            {positionColumns.map(([field, label]) => (
              <th
                key={field}
                aria-sort={sortField === field
                  ? (sortDirection === 'asc' ? 'ascending' : 'descending')
                  : undefined}
              >
                <button type="button" onClick={() => onSort(field)}>
                  {label} {sortField === field
                    ? (sortDirection === 'asc' ? '↑' : '↓')
                    : '↕'}
                </button>
              </th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((holding) => {
            const { symbol } = holding;
            const expanded = expandedSymbols.has(symbol);
            const closed = Number(holding.shares) === 0;
            const quoteUnavailable = Boolean(holding.quote_fetch_error);
            const costUnavailable = Boolean(holding.cost_basis_error);

            return (
              <React.Fragment key={symbol}>
                <tr>
                  <td>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} ${symbol} transactions`}
                        onClick={() => onToggleHistory(symbol)}
                        className="rounded px-2 py-1 text-cyan-400"
                      >
                        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                      </button>

                      <button
                        type="button"
                        className="font-semibold text-cyan-400"
                        onClick={() => onOpenStock(symbol)}
                      >
                        {symbol} <ArrowUpRight size={12} className="inline" />
                      </button>
                    </div>
                  </td>
                  <td>{num(holding.shares, 7)}</td>
                  <td>
                    {closed || costUnavailable ? '—' : money(holding.avg_cost_share_usd)}
                    {!closed && !costUnavailable && holding.estimated_cost_basis && ' ≈'}
                  </td>
                  <td>{quoteUnavailable ? '—' : money(holding.last_price_usd)}</td>
                  <td className="font-semibold text-white">
                    {!closed && quoteUnavailable ? '—' : money(holding.market_value_usd)}
                  </td>
                  <td>
                    {closed || quoteUnavailable ? '—' : (
                      <Change
                        amount={holding.day_gain_abs_usd}
                        percent={holding.day_gain_percent}
                      />
                    )}
                  </td>
                  <td>
                    {closed || quoteUnavailable || costUnavailable ? '—' : (
                      <Change
                        amount={holding.total_gain_abs_usd}
                        percent={Number(holding.avg_cost_share_usd) > 0
                          ? holding.total_gain_percent
                          : null}
                      />
                    )}
                  </td>
                  <td><Change amount={holding.realized_gain_abs_usd} /></td>
                  <td>
                    <button
                      type="button"
                      disabled={saving}
                      className="text-cyan-400"
                      onClick={() => onAddTrade(symbol)}
                    >
                      Add transaction
                    </button>
                  </td>
                </tr>

                {expanded && (
                  <tr>
                    <td colSpan={9}>
                      <TradeHistory holding={holding} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}

          {!rows.length && (
            <tr><td colSpan={9}>No positions found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
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
      <Panel
        title="Stock Explorer"
        subtitle="Search a ticker and analyze it using TradingView."
      >
        <form onSubmit={search} className="flex max-w-xl gap-2">
          <input
            className="terminal-input"
            value={input}
            onChange={(event) => setInput(event.target.value.toUpperCase())}
            placeholder="NVDA, AMD, MSFT..."
          />
          <button type="submit" className="terminal-button">
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
        <button type="button" className="terminal-button" onClick={() => onAlert(ticker)}>
          <Bell size={16} /> Create alert for {ticker}
        </button>
        <a
          className="terminal-button-secondary"
          href={`https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/`}
          target="_blank"
          rel="noreferrer"
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
            <input
              required
              className="terminal-input"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            />
          </label>
          <label className="terminal-label">
            Condition
            <select
              className="terminal-input"
              value={condition}
              onChange={(event) => setCondition(event.target.value)}
            >
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
          </label>
          <label className="terminal-label">
            Target
            <input
              required
              type="number"
              min="0.000001"
              step="any"
              className="terminal-input"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          <label className="terminal-label">
            Enabled
            <select
              className="terminal-input"
              value={String(enabled)}
              onChange={(event) => setEnabled(event.target.value === 'true')}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="terminal-button">
              <Save size={15} /> Save
            </button>
            {editingId != null && (
              <button
                type="button"
                className="terminal-button-secondary"
                onClick={reset}
                aria-label="Cancel alert edit"
              >
                <X size={16} />
              </button>
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
                <th>Symbol</th>
                <th>Condition</th>
                <th>Target</th>
                <th>Status</th>
                <th>Actions</th>
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
                      <button
                        type="button"
                        className="text-cyan-400"
                        aria-label={`Edit ${alert.symbol} alert`}
                        onClick={() => {
                          setEditingId(alert.id);
                          setSymbol(alert.symbol);
                          setCondition(alert.condition);
                          setTarget(String(alert.target_price ?? alert.target));
                          setEnabled(Boolean(alert.enabled));
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        className="text-rose-400"
                        aria-label={`Delete ${alert.symbol} alert`}
                        onClick={() => remove(alert.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!alerts.length && (
                <tr><td colSpan={5}>No alerts configured.</td></tr>
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
  const [tradeForm, setTradeForm] = useState(null);
  const [tradeError, setTradeError] = useState('');
  const [expandedSymbols, setExpandedSymbols] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('NVDA');
  const [sortField, setSortField] = useState('market_value_usd');
  const [sortDirection, setSortDirection] = useState('desc');
  const [filter, setFilter] = useState('');

  const portfolioLoadID = useRef(0);
  const tradeSaving = useRef(false);

  const loadPortfolio = useCallback(async () => {
    const id = ++portfolioLoadID.current;

    try {
      const [data, bp] = await Promise.all([
        fetchPortfolioSummary(),
        fetchBuyingPower().catch(() => null),
      ]);

      if (id !== portfolioLoadID.current) return;

      setSummary(data);
      if (bp?.buying_power != null) setBuyingPower(bp.buying_power);
      setError('');
    } catch (err) {
      if (id !== portfolioLoadID.current) return;

      setError(err?.response?.data?.error || err.message || 'Failed to load portfolio.');
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
      if (!document.hidden && !tradeSaving.current) loadPortfolio();
    }, 15_000);

    return () => {
      clearInterval(timer);
      portfolioLoadID.current += 1;
    };
  }, [loadPortfolio, loadAlerts]);

  const holdings = useMemo(() => {
    const items = Array.isArray(summary?.holdings) ? summary.holdings : [];

    return [...items].sort((left, right) => {
      const av = left[sortField];
      const bv = right[sortField];

      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;

      const result = sortField === 'symbol'
        ? String(av).localeCompare(String(bv))
        : Number(av) - Number(bv);

      return sortDirection === 'asc' ? result : -result;
    });
  }, [summary, sortField, sortDirection]);

  const openPositions = holdings.filter((holding) => Number(holding.shares) > 0);
  const closedPositions = holdings.filter((holding) => Number(holding.shares) === 0);

  const sort = (field) => {
    if (field === sortField) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'symbol' ? 'asc' : 'desc');
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

  const openTradeForm = (symbol = '') => {
    if (tradeSaving.current) return;

    setTradeError('');
    setTradeForm({ symbol });
    setSection('holdings');
  };

  const closeTradeForm = () => {
    setTradeForm(null);
    setTradeError('');
  };

  const toggleTradeHistory = (symbol) => {
    setExpandedSymbols((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const saveTrade = async (payload) => {
    if (tradeSaving.current) return;

    tradeSaving.current = true;
    setSaving(true);
    setTradeError('');

    try {
      const { symbol } = await createPortfolioTrade(payload);
      setExpandedSymbols((current) => new Set([...current, symbol]));
      setTradeForm(null);
      await loadPortfolio();
    } catch (err) {
      setTradeError(err?.response?.data?.error || err.message || 'Could not save transaction.');
    } finally {
      tradeSaving.current = false;
      setSaving(false);
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

  const renderPositions = (rows) => (
    <PositionsTable
      rows={rows}
      expandedSymbols={expandedSymbols}
      sortField={sortField}
      sortDirection={sortDirection}
      saving={saving}
      onSort={sort}
      onToggleHistory={toggleTradeHistory}
      onOpenStock={openStock}
      onAddTrade={openTradeForm}
    />
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
        <button
          type="button"
          className="terminal-button-secondary"
          onClick={() => {
            loadPortfolio();
            loadAlerts();
          }}
        >
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
              <input
                className="terminal-input"
                type="number"
                step="any"
                aria-label="Buying power"
                value={buyingInput}
                onChange={(event) => setBuyingInput(event.target.value)}
              />
              <button
                type="button"
                className="terminal-button"
                onClick={saveBuying}
                aria-label="Save buying power"
              >
                <Save size={16} />
              </button>
              <button
                type="button"
                className="terminal-button-secondary"
                onClick={() => setEditingBuying(false)}
                aria-label="Cancel buying power edit"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-emerald-400">{money(buyingPower)}</span>
              <button
                type="button"
                className="text-xs text-cyan-400"
                onClick={() => {
                  setBuyingInput(String(buyingPower));
                  setEditingBuying(true);
                }}
              >
                Edit
              </button>
            </div>
          )}
        </Metric>

        <Metric title="Day change">
          <Change
            amount={summary?.day_change_abs_usd}
            percent={summary?.day_change_percent}
          />
        </Metric>

        <Metric title="Unrealized gain">
          <Change
            amount={summary?.total_gain_abs_usd}
            percent={summary?.total_gain_percent}
          />
          {summary?.cost_basis_incomplete && (
            <p className="mt-1 text-xs font-normal">Partial totals</p>
          )}
          {summary?.estimated_cost_basis && (
            <p className="mt-1 text-xs font-normal">Includes estimated legacy FX</p>
          )}
        </Metric>
      </div>

      <nav className="flex gap-2 overflow-x-auto border-b border-white/10 pb-3">
        {sections.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${
              section === id
                ? 'bg-cyan-400/10 font-semibold text-cyan-300'
                : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>

      {error && (
        <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error}
        </p>
      )}

      {/* Chart stays mounted while navigating, but only polls in Overview. */}
      <div style={{ display: section === 'overview' ? 'block' : 'none' }}>
        <PortfolioPerformanceChart active={section === 'overview'} />
      </div>

      {section === 'overview' && (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <Panel
              title="Portfolio holdings"
              subtitle={`${openPositions.length} open positions · Expand a ticker to see trades`}
              action={(
                <button
                  type="button"
                  className="text-xs text-cyan-400"
                  onClick={() => setSection('holdings')}
                >
                  Manage holdings
                </button>
              )}
            >
              {renderPositions(openPositions)}
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title="Quick actions">
              <div className="grid gap-2">
                <button
                  type="button"
                  className="terminal-button"
                  disabled={saving}
                  onClick={() => openTradeForm()}
                >
                  <Plus size={16} /> Add transaction
                </button>
                <button
                  type="button"
                  className="terminal-button-secondary"
                  onClick={() => setSection('research')}
                >
                  <BrainCircuit size={16} /> Analyze PDF
                </button>
                <button
                  type="button"
                  className="terminal-button-secondary"
                  onClick={() => setSection('explorer')}
                >
                  <Search size={16} /> Explore stocks
                </button>
              </div>
            </Panel>

            <Panel title="Price alerts">
              {alerts.length ? alerts.slice(0, 5).map((alert) => (
                <div
                  key={alert.id}
                  className="flex justify-between border-b border-white/10 py-2 text-sm"
                >
                  <span>{alert.symbol}</span>
                  <span className="text-slate-400">
                    {alert.condition} {money(alert.target_price ?? alert.target)}
                  </span>
                </div>
              )) : (
                <p className="text-sm text-slate-500">No alerts configured.</p>
              )}
              <button
                type="button"
                className="mt-4 text-sm text-cyan-400"
                onClick={() => setSection('alerts')}
              >
                Manage alerts
              </button>
            </Panel>
          </div>
        </div>
      )}

      <div hidden={section !== 'holdings'} className="space-y-5">
        <Panel
          title="Manage transactions"
          subtitle="Record a dated buy or sell. Tickers are matched automatically."
          action={(
            <button
              type="button"
              className="terminal-button"
              disabled={saving}
              onClick={() => openTradeForm()}
            >
              <Plus size={16} /> Add transaction
            </button>
          )}
        >
          {tradeForm ? (
            <TradeEditor
              key={tradeForm.symbol || 'new'}
              initialSymbol={tradeForm.symbol}
              saving={saving}
              onSave={saveTrade}
              onCancel={closeTradeForm}
            />
          ) : (
            <p className="text-sm text-slate-400">
              Add a transaction here or open the form from a position below.
            </p>
          )}

          {tradeError && (
            <p role="alert" className="mt-3 text-sm text-rose-400">
              {tradeError}
            </p>
          )}
        </Panel>

        {section === 'holdings' && (
          <>
            <Panel
              title="Open positions"
              subtitle={`Recorded realized gain (USD): ${money(summary?.realized_gain_abs_usd)}`}
            >
              {renderPositions(openPositions)}
            </Panel>

            {closedPositions.length > 0 && (
              <Panel title="Closed positions">
                {renderPositions(closedPositions)}
              </Panel>
            )}
          </>
        )}
      </div>

      {section === 'explorer' && (
        <StockExplorer symbol={selectedSymbol} onAlert={openAlert} />
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
        <Panel
          title="Portfolio Screener"
          subtitle="Search your holdings. Market-wide screening needs additional data."
        >
          <input
            className="terminal-input mb-4 max-w-md"
            placeholder="Filter by ticker..."
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="space-y-2">
            {openPositions.filter((item) =>
              item.symbol?.toUpperCase().includes(filter.trim().toUpperCase())
            ).map((item) => (
              <button
                key={item.symbol}
                type="button"
                onClick={() => openStock(item.symbol)}
                className="flex w-full justify-between rounded-xl border border-white/10 p-4 hover:bg-white/5"
              >
                <span className="font-semibold">{item.symbol}</span>
                <span>{item.quote_fetch_error ? '—' : money(item.market_value_usd)}</span>
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
            <a
              key={name}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="terminal-card flex items-center justify-between p-5 hover:border-cyan-400/40"
            >
              <span className="font-semibold">{name}</span>
              <ExternalLink size={17} className="text-cyan-400" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}