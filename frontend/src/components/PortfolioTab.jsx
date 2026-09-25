import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  fetchBuyingPower,
  updateBuyingPower,
} from '../services/api';

function fmt(n, decimals = 2) {
  if (n === undefined || n === null || Number.isNaN(n)) return '--';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

function GainDisplay({ absValue, pctValue, prefix = '$' }) {
  if (absValue === undefined && pctValue === undefined) return <span className="text-gray-500">--</span>;
  
  const positive = (absValue ?? pctValue ?? 0) >= 0;
  const color = positive ? 'text-green-400' : 'text-red-400';
  const sign = positive ? '+' : '';

  return (
    <div className={`flex flex-col ${color}`}>
      <span className="font-semibold">
        {sign}{prefix}{fmt(Math.abs(absValue ?? 0))}
      </span>
      <span className="text-xs opacity-80">
        {sign}{fmt(pctValue)}%
      </span>
    </div>
  );
}

export const PortfolioTab = () => {
  const [activeSubTab, setActiveSubTab] = useState('holdings');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // Buying Power state
  const [buyingPower, setBuyingPower] = useState(0);
  const [isEditingBuyingPower, setIsEditingBuyingPower] = useState(false);
  const [buyingPowerInput, setBuyingPowerInput] = useState('');

  // Table Sorting State
  const [sortField, setSortField] = useState('market_value_usd');
  const [sortDirection, setSortDirection] = useState('desc');

  // Add/Edit holding form state
  const [editingId, setEditingId] = useState(null);
  const [symbol, setSymbol] = useState('');
  const [shares, setShares] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Alerts
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
      const [data, bpData] = await Promise.all([
        fetchPortfolioSummary(),
        fetchBuyingPower().catch(() => ({ buying_power: 0 })),
      ]);
      setSummary(data);
      if (bpData && bpData.buying_power !== undefined) {
        setBuyingPower(bpData.buying_power);
      }
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

  const handleSaveBuyingPower = async () => {
    try {
      const updated = await updateBuyingPower(buyingPowerInput);
      setBuyingPower(updated.buying_power);
      setIsEditingBuyingPower(false);
    } catch (err) {
      console.error('Failed to update buying power:', err);
      setErrorMessage('Failed to update buying power');
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedHoldings = useMemo(() => {
    if (!summary?.holdings) return [];
    return [...summary.holdings].sort((a, b) => {
      let valA, valB;
      switch (sortField) {
        case 'symbol':
          valA = a.symbol;
          valB = b.symbol;
          break;
        case 'shares':
          valA = a.shares;
          valB = b.shares;
          break;
        case 'avg_cost':
          valA = a.avg_cost_share_usd || 0;
          valB = b.avg_cost_share_usd || 0;
          break;
        case 'last_price':
          valA = a.last_price_usd || 0;
          valB = b.last_price_usd || 0;
          break;
        case 'market_value':
          valA = a.market_value_usd || 0;
          valB = b.market_value_usd || 0;
          break;
        case 'day_gain':
          valA = a.day_gain_abs_usd || 0;
          valB = b.day_gain_abs_usd || 0;
          break;
        case 'total_gain':
          valA = a.total_gain_abs_usd || 0;
          valB = b.total_gain_abs_usd || 0;
          break;
        default:
          valA = a.market_value_usd || 0;
          valB = b.market_value_usd || 0;
      }

      if (typeof valA === 'string') {
        return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortDirection === 'asc' ? valA - valB : valB - valA;
    });
  }, [summary, sortField, sortDirection]);

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
      setErrorMessage(editingId ? 'Failed to update holding.' : 'Failed to add holding.');
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

  const renderSortArrow = (field) => {
    if (sortField !== field) return <span className="text-gray-600 ml-1">↕</span>;
    return <span className="text-blue-400 ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="p-6 space-y-6 bg-gray-900 text-white min-h-screen">
      {/* Buying Power & Summary Metric Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-gray-800 p-4 rounded-xl border border-gray-700">
        <div>
          <div className="text-xs text-gray-400 uppercase font-semibold">Total Value</div>
          <div className="text-xl font-bold text-white">
            ${fmt(summary?.total_value_usd)}
          </div>
        </div>

        <div>
          <div className="text-xs text-gray-400 uppercase font-semibold">Buying Power</div>
          {isEditingBuyingPower ? (
            <div className="flex items-center space-x-2 mt-1">
              <input
                type="number"
                step="any"
                value={buyingPowerInput}
                onChange={(e) => setBuyingPowerInput(e.target.value)}
                className="bg-gray-700 text-white px-2 py-1 rounded text-sm w-28 outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={handleSaveBuyingPower}
                className="bg-blue-600 text-xs px-2 py-1 rounded hover:bg-blue-500"
              >
                Save
              </button>
              <button
                onClick={() => setIsEditingBuyingPower(false)}
                className="text-gray-400 text-xs hover:text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <span className="text-xl font-bold text-emerald-400">${fmt(buyingPower)}</span>
              <button
                onClick={() => {
                  setBuyingPowerInput(String(buyingPower));
                  setIsEditingBuyingPower(true);
                }}
                className="text-xs text-blue-400 hover:underline"
              >
                Edit
              </button>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs text-gray-400 uppercase font-semibold">Day Change</div>
          <GainDisplay
            absValue={summary?.day_change_abs_usd}
            pctValue={summary?.day_change_percent}
          />
        </div>

        <div>
          <div className="text-xs text-gray-400 uppercase font-semibold">Total Return</div>
          <GainDisplay
            absValue={summary?.total_gain_abs_usd}
            pctValue={summary?.total_gain_percent}
          />
        </div>
      </div>

      {/* Subtab Navigation */}
      <div className="flex space-x-4 border-b border-gray-700 pb-2">
        {['holdings', 'alerts', 'summary', 'heatmap'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveSubTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize rounded-t-lg transition-colors ${
              activeSubTab === tab
                ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab === 'heatmap' ? 'Market Heatmap' : tab}
          </button>
        ))}
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
                <thead className="bg-gray-700 text-gray-400 uppercase text-xs select-none">
                  <tr>
                    <th onClick={() => handleSort('symbol')} className="px-6 py-3 cursor-pointer hover:text-white">
                      Symbol {renderSortArrow('symbol')}
                    </th>
                    <th onClick={() => handleSort('shares')} className="px-6 py-3 cursor-pointer hover:text-white">
                      Shares {renderSortArrow('shares')}
                    </th>
                    <th onClick={() => handleSort('avg_cost')} className="px-6 py-3 cursor-pointer hover:text-white">
                      Avg Cost {renderSortArrow('avg_cost')}
                    </th>
                    <th onClick={() => handleSort('last_price')} className="px-6 py-3 cursor-pointer hover:text-white">
                      Last Price {renderSortArrow('last_price')}
                    </th>
                    <th onClick={() => handleSort('market_value')} className="px-6 py-3 cursor-pointer hover:text-white">
                      Market Value {renderSortArrow('market_value')}
                    </th>
                    <th onClick={() => handleSort('day_gain')} className="px-6 py-3 cursor-pointer hover:text-white">
                      Day Gain ($ / %) {renderSortArrow('day_gain')}
                    </th>
                    <th onClick={() => handleSort('total_gain')} className="px-6 py-3 cursor-pointer hover:text-white">
                      Total Gain ($ / %) {renderSortArrow('total_gain')}
                    </th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {sortedHoldings.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="px-6 py-4 text-center text-gray-500">
                        No holdings found.
                      </td>
                    </tr>
                  ) : (
                    sortedHoldings.map((h) => (
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
                        <td className="px-6 py-4 font-semibold text-white">${fmt(h.market_value_usd)}</td>
                        <td className="px-6 py-4">
                          <GainDisplay
                            absValue={h.day_gain_abs_usd}
                            pctValue={h.day_gain_percent}
                          />
                        </td>
                        <td className="px-6 py-4">
                          <GainDisplay
                            absValue={h.total_gain_abs_usd}
                            pctValue={h.total_gain_percent}
                          />
                        </td>
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

      {/* Market Heatmap Subtab */}
      {activeSubTab === 'heatmap' && <MarketHeatmap />}
    </div>
  );
};

export default PortfolioTab;