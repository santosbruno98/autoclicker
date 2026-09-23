import React, { useState, useEffect, useCallback } from 'react';
import { MarketHeatmap } from './MarketHeatmap';
import {
  fetchPortfolioSummary,
  createHolding,
  updateHolding,
  deleteHolding,
  fetchThresholds,
  createThreshold,
  updateThreshold,
  deleteThreshold,
} from '../services/api';

function fmt(n, decimals = 2) {
  if (n === undefined || n === null || Number.isNaN(n)) return '--';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10); // yyyy-mm-dd for <input type="date">
}

function GainText({ value, isPct }) {
  if (value === undefined || value === null) return <span className="text-gray-500">--</span>;
  const positive = value >= 0;
  const color = positive ? 'text-green-400' : 'text-red-400';
  const sign = positive ? '+' : '';
  return <span className={color}>{sign}{fmt(value)}{isPct ? '%' : ''}</span>;
}

export const PortfolioTab = () => {
  const [activeSubTab, setActiveSubTab] = useState('holdings');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // Add/Edit holding form state
  const [editingId, setEditingId] = useState(null); // null = "add" mode, otherwise editing this holding's id
  const [symbol, setSymbol] = useState('');
  const [shares, setShares] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Alerts (price thresholds)
  const [thresholds, setThresholds] = useState([]);
  const [alertSymbol, setAlertSymbol] = useState('');
  const [alertCondition, setAlertCondition] = useState('above');
  const [alertTarget, setAlertTarget] = useState('');
  const [alertError, setAlertError] = useState('');
  const [isSubmittingAlert, setIsSubmittingAlert] = useState(false);

  const fetchPortfolioData = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage('');
      const data = await fetchPortfolioSummary();
      setSummary(data);
    } catch (err) {
      console.error('Failed to fetch portfolio data:', err);
      setErrorMessage('Failed to connect to backend service.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadThresholds = useCallback(async () => {
    try {
      const data = await fetchThresholds();
      setThresholds(data || []);
    } catch (err) {
      console.error('Failed to fetch thresholds:', err);
    }
  }, []);

  useEffect(() => {
    fetchPortfolioData();
    loadThresholds();
    const interval = setInterval(fetchPortfolioData, 15000);
    return () => clearInterval(interval);
  }, [fetchPortfolioData, loadThresholds]);

  const resetForm = () => {
    setEditingId(null);
    setSymbol('');
    setShares('');
    setPurchasePrice('');
    setCurrency('USD');
    setPurchaseDate('');
  };

  const startEdit = (holding) => {
    setEditingId(holding.id);
    setSymbol(holding.symbol);
    setShares(String(holding.shares));
    setPurchasePrice(String(holding.purchase_price ?? ''));
    setCurrency(holding.purchase_price_currency || 'USD');
    setPurchaseDate(fmtDate(holding.purchase_date));
  };

  const handleSubmitHolding = async (e) => {
    e.preventDefault();
    if (!symbol || !shares) return;

    const payload = {
      symbol: symbol.toUpperCase(),
      shares: parseFloat(shares),
      purchase_price: purchasePrice ? parseFloat(purchasePrice) : 0,
      purchase_price_currency: currency,
      purchase_date: purchaseDate ? new Date(purchaseDate).toISOString() : null,
    };

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      if (editingId) {
        await updateHolding(editingId, payload);
      } else {
        await createHolding(payload);
      }
      resetForm();
      fetchPortfolioData();
    } catch (err) {
      console.error('Failed to save holding:', err);
      setErrorMessage(editingId ? 'Failed to update holding.' : 'Failed to add holding — check the symbol and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteHolding = async (id) => {
    try {
      await deleteHolding(id);
      if (editingId === id) resetForm();
      fetchPortfolioData();
    } catch (err) {
      console.error('Failed to delete holding:', err);
    }
  };

  const holdingSymbols = [...new Set((summary?.holdings || []).map((h) => h.symbol))];

  const handleCreateAlert = async (e) => {
    e.preventDefault();
    if (!alertSymbol || !alertTarget) return;
    setIsSubmittingAlert(true);
    setAlertError('');
    try {
      await createThreshold({
        symbol: alertSymbol.toUpperCase(),
        condition: alertCondition,
        target_price: parseFloat(alertTarget),
        enabled: true,
      });
      setAlertTarget('');
      loadThresholds();
    } catch (err) {
      console.error('Failed to create alert:', err);
      setAlertError('Failed to create alert — you may already have one for this symbol/condition pair.');
    } finally {
      setIsSubmittingAlert(false);
    }
  };

  const handleToggleAlert = async (threshold) => {
    try {
      await updateThreshold(threshold.id, {
        symbol: threshold.symbol,
        condition: threshold.condition,
        target_price: threshold.target_price,
        enabled: !threshold.enabled,
      });
      loadThresholds();
    } catch (err) {
      console.error('Failed to toggle alert:', err);
    }
  };

  const handleDeleteAlert = async (id) => {
    try {
      await deleteThreshold(id);
      loadThresholds();
    } catch (err) {
      console.error('Failed to delete alert:', err);
    }
  };

  return (
    <div className="p-6 space-y-6 bg-gray-900 text-white min-h-screen">
      {/* Subtab Navigation */}
      <div className="flex space-x-4 border-b border-gray-700 pb-2">
        <button
          onClick={() => setActiveSubTab('holdings')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            activeSubTab === 'holdings'
              ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-400'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Holdings
        </button>
        <button
          onClick={() => setActiveSubTab('alerts')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            activeSubTab === 'alerts'
              ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-400'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Alerts
        </button>
        <button
          onClick={() => setActiveSubTab('summary')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            activeSubTab === 'summary'
              ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-400'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Summary
        </button>
        <button
          onClick={() => setActiveSubTab('heatmap')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            activeSubTab === 'heatmap'
              ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-400'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Market Heatmap
        </button>
      </div>

      {errorMessage && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded text-sm">
          {errorMessage}
        </div>
      )}

      {/* Holdings Subtab */}
      {activeSubTab === 'holdings' && (
        <div className="space-y-6">
          <form
            onSubmit={handleSubmitHolding}
            className="bg-gray-800 p-4 rounded-lg flex flex-wrap items-end gap-4 border border-gray-700"
          >
            {editingId && (
              <div className="w-full text-xs text-blue-400 font-semibold">
                Editing holding #{editingId} —{' '}
                <button type="button" onClick={resetForm} className="underline hover:text-blue-300">
                  cancel
                </button>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Ticker Symbol</label>
              <input
                type="text"
                placeholder="e.g. AMD"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Shares</label>
              <input
                type="number"
                step="any"
                placeholder="0"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Purchase Price</label>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Purchase Date</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-4 py-2 rounded text-sm font-semibold transition cursor-pointer disabled:opacity-50 ${
                editingId ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'
              } text-white`}
            >
              {isSubmitting ? 'Saving...' : editingId ? 'Update Holding' : 'Add Holding'}
            </button>
          </form>

          {loading && !summary ? (
            <div className="text-gray-400">Loading holdings...</div>
          ) : (
            <div className="overflow-x-auto bg-gray-800 rounded-lg border border-gray-700">
              <table className="w-full text-left text-sm text-gray-300">
                <thead className="bg-gray-700 text-gray-400 uppercase text-xs">
                  <tr>
                    <th className="px-6 py-3">Symbol</th>
                    <th className="px-6 py-3">Shares</th>
                    <th className="px-6 py-3">Avg Cost</th>
                    <th className="px-6 py-3">Last Price</th>
                    <th className="px-6 py-3">Market Value</th>
                    <th className="px-6 py-3">Day Gain %</th>
                    <th className="px-6 py-3">Total Gain %</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {(!summary || summary.holdings.length === 0) ? (
                    <tr>
                      <td colSpan="8" className="px-6 py-4 text-center text-gray-500">
                        No holdings found.
                      </td>
                    </tr>
                  ) : (
                    summary.holdings.map((h) => (
                      <tr key={h.id} className={`hover:bg-gray-750 ${editingId === h.id ? 'bg-amber-950/30' : ''}`}>
                        <td className="px-6 py-4 font-bold text-white">{h.symbol}</td>
                        <td className="px-6 py-4">{fmt(h.shares, 4)}</td>
                        <td className="px-6 py-4">
                          {h.avg_cost_share_usd ? `$${fmt(h.avg_cost_share_usd)}` : '--'}
                        </td>
                        <td className="px-6 py-4">
                          {h.quote_fetch_error ? (
                            <span className="text-red-400 italic text-xs">error</span>
                          ) : (
                            `$${fmt(h.last_price_usd)}`
                          )}
                        </td>
                        <td className="px-6 py-4">${fmt(h.market_value_usd)}</td>
                        <td className="px-6 py-4"><GainText value={h.day_gain_percent} isPct /></td>
                        <td className="px-6 py-4"><GainText value={h.total_gain_percent} isPct /></td>
                        <td className="px-6 py-4 text-right space-x-3 whitespace-nowrap">
                          <button
                            onClick={() => startEdit(h)}
                            className="text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteHolding(h.id)}
                            className="text-red-400 hover:text-red-300 font-medium cursor-pointer"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Alerts Subtab — price thresholds tied to current holdings */}
      {activeSubTab === 'alerts' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateAlert}
            className="bg-gray-800 p-4 rounded-lg flex flex-wrap items-end gap-4 border border-gray-700"
          >
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Symbol</label>
              <select
                value={alertSymbol}
                onChange={(e) => setAlertSymbol(e.target.value)}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">-- Select holding --</option>
                {holdingSymbols.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Condition</label>
              <select
                value={alertCondition}
                onChange={(e) => setAlertCondition(e.target.value)}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="above">Price goes above</option>
                <option value="below">Price goes below</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Target Price</label>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={alertTarget}
                onChange={(e) => setAlertTarget(e.target.value)}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isSubmittingAlert || holdingSymbols.length === 0}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-semibold transition cursor-pointer"
            >
              {isSubmittingAlert ? 'Adding...' : 'Add Alert'}
            </button>
          </form>

          {holdingSymbols.length === 0 && (
            <p className="text-xs text-gray-500">Add a holding first to set price alerts for it.</p>
          )}
          {alertError && (
            <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded text-sm">
              {alertError}
            </div>
          )}

          <div className="overflow-x-auto bg-gray-800 rounded-lg border border-gray-700">
            <table className="w-full text-left text-sm text-gray-300">
              <thead className="bg-gray-700 text-gray-400 uppercase text-xs">
                <tr>
                  <th className="px-6 py-3">Symbol</th>
                  <th className="px-6 py-3">Condition</th>
                  <th className="px-6 py-3">Target Price</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {thresholds.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-4 text-center text-gray-500">
                      No alerts configured.
                    </td>
                  </tr>
                ) : (
                  thresholds.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-750">
                      <td className="px-6 py-4 font-bold text-white">{t.symbol}</td>
                      <td className="px-6 py-4 capitalize">{t.condition}</td>
                      <td className="px-6 py-4">${fmt(t.target_price)}</td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleToggleAlert(t)}
                          className={`text-xs px-2 py-1 rounded font-semibold cursor-pointer ${
                            t.enabled
                              ? 'bg-green-900/50 text-green-400 border border-green-700'
                              : 'bg-gray-700 text-gray-400 border border-gray-600'
                          }`}
                        >
                          {t.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleDeleteAlert(t.id)}
                          className="text-red-400 hover:text-red-300 font-medium cursor-pointer"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary Subtab */}
      {activeSubTab === 'summary' && (
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
          <h2 className="text-lg font-bold text-white">Portfolio Overview</h2>
          {summary ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-700 p-4 rounded-lg">
                <div className="text-xs text-gray-400">Total Value (USD)</div>
                <div className="text-xl font-bold text-green-400">
                  ${fmt(summary.total_value_usd)}
                </div>
              </div>
              <div className="bg-gray-700 p-4 rounded-lg">
                <div className="text-xs text-gray-400">Total Value (EUR)</div>
                <div className="text-xl font-bold text-green-400">
                  €{fmt(summary.total_value_eur)}
                </div>
              </div>
              <div className="bg-gray-700 p-4 rounded-lg">
                <div className="text-xs text-gray-400">Total Gain (%)</div>
                <div
                  className={`text-xl font-bold ${
                    (summary.total_gain_percent || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {fmt(summary.total_gain_percent)}%
                </div>
              </div>
            </div>
          ) : (
            <div className="text-gray-400">No summary metrics available.</div>
          )}
        </div>
      )}

      {/* Market Heatmap Subtab */}
      {activeSubTab === 'heatmap' && <MarketHeatmap />}
    </div>
  );
};

export default PortfolioTab;

//TODO: ADD THE BUYING POWER, AKA MONEY LEFT TO USE FOR BUYING