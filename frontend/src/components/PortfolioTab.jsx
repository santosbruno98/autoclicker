import React, { useState, useEffect, useCallback } from 'react';
import { createHolding, deleteHolding, fetchPortfolioSummary } from '../services/api';
import TradingViewChart from './TradingViewChart';

function fmt(n, decimals = 2) {
  if (n === undefined || n === null || Number.isNaN(n)) return '--';
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(d) {
  if (!d) return '--';
  return new Date(d).toLocaleDateString();
}

function GainCell({ value, isPct }) {
  if (value === undefined || value === null) return <span className="text-slate-500">--</span>;
  const positive = value >= 0;
  const color = positive ? 'text-emerald-400' : 'text-rose-400';
  const sign = positive ? '+' : '';
  return <span className={color}>{sign}{fmt(value)}{isPct ? '%' : ''}</span>;
}

function SessionBadge({ session }) {
  if (!session || session === 'regular') return null;
  const label = session === 'post' ? 'AH' : 'PM';
  return <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-slate-700 text-slate-300 align-middle">{label}</span>;
}

export default function PortfolioTab() {
  const [summary, setSummary] = useState(null);
  const [selectedSymbol, setSelectedSymbol] = useState('');

  const [symbol, setSymbol] = useState('');
  const [shares, setShares] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchasePriceCurrency, setPurchasePriceCurrency] = useState('USD');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadSummary = useCallback(async () => {
    try {
      const data = await fetchPortfolioSummary();
      setSummary(data);
      // Default the chart to the first holding once we have data, but don't
      // stomp on a symbol the user has already picked.
      setSelectedSymbol((prev) => prev || data.holdings?.[0]?.symbol || '');
    } catch (err) {
      console.error('Failed to load portfolio summary:', err);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    const interval = setInterval(loadSummary, 15000);
    return () => clearInterval(interval);
  }, [loadSummary]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!symbol.trim() || !shares) return;
    setIsSubmitting(true);
    setError('');
    try {
      await createHolding({
        symbol: symbol.trim().toUpperCase(),
        shares: parseFloat(shares),
        purchase_price: purchasePrice ? parseFloat(purchasePrice) : 0,
        purchase_price_currency: purchasePriceCurrency,
        purchase_date: purchaseDate ? new Date(purchaseDate).toISOString() : null,
      });
      setSymbol('');
      setShares('');
      setPurchasePrice('');
      setPurchaseDate('');
      loadSummary();
    } catch (err) {
      setError('Failed to add holding — check the symbol and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteHolding(id);
      loadSummary();
    } catch (err) {
      console.error('Failed to delete holding:', err);
    }
  };

  const dayPositive = (summary?.day_change_abs_usd ?? 0) >= 0;
  const holdingSymbols = summary?.holdings?.map((h) => h.symbol) || [];

  return (
    <div className="flex flex-col gap-4">
      {/* Hero: real portfolio totals (your data) + TradingView chart (their data, per symbol) */}
      <div className="bg-slate-900 border border-slate-800 rounded p-6">
        <div className="text-sm text-slate-400 mb-1">Portfolio Value</div>
        <div className="flex items-baseline gap-4 mb-1">
          <div className="text-4xl font-bold text-white">
            {summary ? `$${fmt(summary.total_value_usd)}` : '--'}
          </div>
          <div className="text-xl font-semibold text-slate-400">
            {summary ? `€${fmt(summary.total_value_eur)}` : '--'}
          </div>
        </div>
        {summary && (
          <div className={`text-sm font-mono ${dayPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {dayPositive ? '▲' : '▼'} ${fmt(Math.abs(summary.day_change_abs_usd))} / €{fmt(Math.abs(summary.day_change_abs_eur))} ({fmt(Math.abs(summary.day_change_percent))}%) Today
          </div>
        )}

        {holdingSymbols.length > 0 && (
          <div className="flex items-center gap-2 mt-4">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Chart:</span>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
            >
              {holdingSymbols.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}

        <div className="h-[420px] mt-3 -mx-2">
          {selectedSymbol ? (
            <TradingViewChart symbol={selectedSymbol} />
          ) : (
            <div className="h-full flex items-center justify-center text-slate-600 text-sm italic">
              Add a holding to see its chart.
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-600 mt-2">
          Chart shows live data from TradingView for the selected symbol only — the total above is your actual portfolio value across all holdings.
        </p>
      </div>

      {/* Add holding */}
      <div className="bg-slate-900 p-4 rounded border border-slate-800">
        <h3 className="text-md font-bold text-slate-100 mb-3">Add Holding</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-6 gap-2">
          <input
            type="text"
            placeholder="Symbol (e.g. AAPL)"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
            required
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Shares"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
            required
          />
          <input
            type="number"
            step="0.01"
            placeholder="Price paid per share"
            value={purchasePrice}
            onChange={(e) => setPurchasePrice(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
          />
          <select
            value={purchasePriceCurrency}
            onChange={(e) => setPurchasePriceCurrency(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
          >
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
          </select>
          <input
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
            title="Purchase date (optional)"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-3 py-1 text-sm font-semibold"
          >
            {isSubmitting ? 'Adding...' : 'Add Holding'}
          </button>
        </form>
        {error && <div className="text-rose-400 text-xs mt-2">{error}</div>}
      </div>

      {/* Holdings table */}
      <div className="bg-slate-900 p-4 rounded border border-slate-800">
        <h3 className="text-md font-bold text-slate-100 mb-3">Holdings</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-400 min-w-[1200px]">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="p-2">Symbol</th>
                <th className="p-2 text-right">Shares</th>
                <th className="p-2 text-right">Purchased</th>
                <th className="p-2 text-right">Avg Cost/Share (USD / EUR)</th>
                <th className="p-2 text-right">Last Price (USD / EUR)</th>
                <th className="p-2 text-right">Market Value (USD / EUR)</th>
                <th className="p-2 text-right">Day Gain %</th>
                <th className="p-2 text-right">Day Gain (USD / EUR)</th>
                <th className="p-2 text-right">Total Gain %</th>
                <th className="p-2 text-right">Total Gain (USD / EUR)</th>
                <th className="p-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.holdings || []).map((h) => (
                <tr key={h.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="p-2 font-bold text-slate-100">
                    <button onClick={() => setSelectedSymbol(h.symbol)} className="hover:underline">
                      {h.symbol}
                    </button>
                  </td>
                  <td className="p-2 text-right font-mono">{fmt(h.shares, 4)}</td>
                  <td className="p-2 text-right font-mono">{fmtDate(h.purchase_date)}</td>
                  <td className="p-2 text-right font-mono">
                    {h.avg_cost_share_usd
                      ? <>${fmt(h.avg_cost_share_usd)} <span className="text-slate-500">/ €{fmt(h.avg_cost_share_eur)}</span></>
                      : '--'}
                  </td>
                  <td className="p-2 text-right font-mono">
                    {h.quote_fetch_error ? (
                      <span className="text-rose-500 italic">error</span>
                    ) : (
                      <>
                        ${fmt(h.last_price_usd)} <span className="text-slate-500">/ €{fmt(h.last_price_eur)}</span>
                        <SessionBadge session={h.market_session} />
                      </>
                    )}
                  </td>
                  <td className="p-2 text-right font-mono">
                    ${fmt(h.market_value_usd)} <span className="text-slate-500">/ €{fmt(h.market_value_eur)}</span>
                  </td>
                  <td className="p-2 text-right font-mono"><GainCell value={h.day_gain_percent} isPct /></td>
                  <td className="p-2 text-right font-mono">
                    <GainCell value={h.day_gain_abs_usd} /> <span className="text-slate-600">/</span> <GainCell value={h.day_gain_abs_eur} />
                  </td>
                  <td className="p-2 text-right font-mono"><GainCell value={h.total_gain_percent} isPct /></td>
                  <td className="p-2 text-right font-mono">
                    <GainCell value={h.total_gain_abs_usd} /> <span className="text-slate-600">/</span> <GainCell value={h.total_gain_abs_eur} />
                  </td>
                  <td className="p-2 text-right">
                    <button onClick={() => handleDelete(h.id)} className="text-red-400 hover:text-red-300 font-semibold">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {(!summary || summary.holdings.length === 0) && (
                <tr>
                  <td colSpan="11" className="p-2 text-center text-slate-500 italic">
                    No holdings yet. Add one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-600 mt-2">
          Click a symbol to load its chart above. "AH"/"PM" badges indicate the last price shown is from after-hours or pre-market trading.
        </p>
      </div>
    </div>
  );
}