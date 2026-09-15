import React, { useState, useEffect } from 'react';
import MarketHeatmap from './MarketHeatmap';

export const PortfolioTab = () => {
  const [activeSubTab, setActiveSubTab] = useState('holdings');
  const [holdings, setHoldings] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  // Form states for creating new holdings
  const [symbol, setSymbol] = useState('');
  const [shares, setShares] = useState('');
  const [avgCost, setAvgCost] = useState('');

  const fetchPortfolioData = async () => {
    try {
      setLoading(true);
      const [holdingsRes, summaryRes] = await Promise.all([
        fetch('/api/v1/portfolio/holdings'),
        fetch('/api/v1/portfolio/summary'),
      ]);

      if (holdingsRes.ok) {
        const holdingsData = await holdingsRes.json();
        // Fallback for API response structures (array or wrapped in object)
        const items = Array.isArray(holdingsData)
          ? holdingsData
          : holdingsData?.data || holdingsData?.holdings || [];
        setHoldings(items);
      }
      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        setSummary(summaryData);
      }
    } catch (err) {
      console.error('Failed to fetch portfolio data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPortfolioData();
  }, []);

  const handleCreateHolding = async (e) => {
    e.preventDefault();
    if (!symbol || !shares || !avgCost) return;

    try {
      const res = await fetch('/api/v1/portfolio/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
          shares: parseFloat(shares),
          avg_cost: parseFloat(avgCost),
        }),
      });

      if (res.ok) {
        setSymbol('');
        setShares('');
        setAvgCost('');
        fetchPortfolioData();
      }
    } catch (err) {
      console.error('Failed to create holding:', err);
    }
  };

  const handleDeleteHolding = async (id) => {
    try {
      const res = await fetch(`/api/v1/portfolio/holdings/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchPortfolioData();
      }
    } catch (err) {
      console.error('Failed to delete holding:', err);
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

      {/* Holdings Subtab */}
      {activeSubTab === 'holdings' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateHolding}
            className="bg-gray-800 p-4 rounded-lg flex flex-wrap items-end gap-4 border border-gray-700"
          >
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">
                Ticker Symbol
              </label>
              <input
                type="text"
                placeholder="e.g. AMD"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">
                Shares
              </label>
              <input
                type="number"
                step="any"
                placeholder="0"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">
                Avg Cost ($)
              </label>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={avgCost}
                onChange={(e) => setAvgCost(e.target.value)}
                className="bg-gray-700 text-white px-3 py-2 rounded text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-semibold transition"
            >
              Add Holding
            </button>
          </form>

          {loading ? (
            <div className="text-gray-400">Loading holdings...</div>
          ) : (
            <div className="overflow-x-auto bg-gray-800 rounded-lg border border-gray-700">
              <table className="w-full text-left text-sm text-gray-300">
                <thead className="bg-gray-700 text-gray-400 uppercase text-xs">
                  <tr>
                    <th className="px-6 py-3">Symbol</th>
                    <th className="px-6 py-3">Shares</th>
                    <th className="px-6 py-3">Avg Cost</th>
                    <th className="px-6 py-3">Total Cost</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {holdings.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="px-6 py-4 text-center text-gray-500">
                        No holdings found.
                      </td>
                    </tr>
                  ) : (
                    holdings.map((item) => (
                      <tr key={item.id || item.symbol} className="hover:bg-gray-750">
                        <td className="px-6 py-4 font-bold text-white">
                          {item.symbol}
                        </td>
                        <td className="px-6 py-4">{item.shares}</td>
                        <td className="px-6 py-4">
                          ${typeof item.avg_cost === 'number' ? item.avg_cost.toFixed(2) : item.avg_cost}
                        </td>
                        <td className="px-6 py-4">
                          ${(item.shares * item.avg_cost)?.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleDeleteHolding(item.id)}
                            className="text-red-400 hover:text-red-300 font-medium"
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

      {/* Summary Subtab */}
      {activeSubTab === 'summary' && (
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
          <h2 className="text-lg font-bold text-white">Portfolio Overview</h2>
          {summary ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-700 p-4 rounded-lg">
                <div className="text-xs text-gray-400">Total Invested</div>
                <div className="text-xl font-bold text-green-400">
                  ${summary.total_invested?.toFixed(2) || '0.00'}
                </div>
              </div>
              <div className="bg-gray-700 p-4 rounded-lg">
                <div className="text-xs text-gray-400">Total Holdings Count</div>
                <div className="text-xl font-bold text-blue-400">
                  {summary.total_positions || holdings.length}
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