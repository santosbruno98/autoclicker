
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';

import { MarketHeatmap } from './MarketHeatmap';
import MarketSummaryTab from './MarketSummaryTab';

import {
  fetchPortfolioSummary,
  fetchPortfolioDividends,
  createHolding,
  updateHolding,
  deleteHolding,
  fetchThresholds,
  fetchBuyingPower,
  updateBuyingPower,
} from '../services/api';

function fmt(value, decimals = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '--';

  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function money(value, currency = 'EUR') {
  if (value == null) return '--';
  return `${currency === 'EUR' ? '€' : '$'}${fmt(value)}`;
}

function GainDisplay({ value, percent, currency = 'USD' }) {
  if (value == null) return <span>--</span>;

  const positive = Number(value) >= 0;

  return (
    <div className={positive ? 'text-green-400' : 'text-red-400'}>
      <div className="font-semibold">
        {positive ? '+' : '-'}
        {money(Math.abs(value), currency)}
      </div>
      {percent != null && (
        <div className="text-xs">
          {Number(percent) >= 0 ? '+' : ''}
          {fmt(percent)}%
        </div>
      )}
    </div>
  );
}

const inputClass =
  'bg-gray-700 text-white px-3 py-2 rounded text-sm ' +
  'border border-gray-600';

const initialHolding = {
  symbol: '',
  shares: '',
  purchase_price: '',
  purchase_price_currency: 'USD',
  purchase_date: '',
};

export default function PortfolioTab() {
  const [activeSubTab, setActiveSubTab] = useState('holdings');

  const [summary, setSummary] = useState(null);
  const [dividends, setDividends] = useState(null);
  const [thresholds, setThresholds] = useState([]);

  const [buyingPower, setBuyingPower] = useState(0);
  const [buyingPowerInput, setBuyingPowerInput] = useState('');
  const [editingBuyingPower, setEditingBuyingPower] = useState(false);

  const [holdingForm, setHoldingForm] = useState(initialHolding);
  const [editingHoldingId, setEditingHoldingId] = useState(null);

  const [sortField, setSortField] = useState('market_value_usd');
  const [sortDirection, setSortDirection] = useState('desc');

  const [loading, setLoading] = useState(true);
  const [refreshingDividends, setRefreshingDividends] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadPortfolio = useCallback(async () => {
    try {
      const [data, power] = await Promise.all([
        fetchPortfolioSummary(),
        fetchBuyingPower().catch(() => null),
      ]);

      setSummary(data);

      if (power?.buying_power !== undefined) {
        setBuyingPower(power.buying_power);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDividends = useCallback(async (force = false) => {
    if (force) setRefreshingDividends(true);

    try {
      const data = await fetchPortfolioDividends(force);
      setDividends(data);
      setError('');
    } catch (err) {
      setError(
        'Dividend fetch failed: ' +
        (err.response?.data?.error || err.message)
      );
    } finally {
      setRefreshingDividends(false);
    }
  }, []);

  const loadThresholds = useCallback(async () => {
    try {
      setThresholds((await fetchThresholds()) || []);
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    }
  }, []);

  useEffect(() => {
    loadPortfolio();
    loadDividends();
    loadThresholds();

    const timer = window.setInterval(() => {
      loadPortfolio();
    }, 15000);

    return () => window.clearInterval(timer);
  }, [loadPortfolio, loadDividends, loadThresholds]);

  const holdings = summary?.holdings || [];

  const dividendByHolding = useMemo(() => {
    const result = {};

    for (const item of dividends?.holdings || []) {
      if (!item.error) {
        result[item.holding_id] = item;
      }
    }

    return result;
  }, [dividends]);

  const dividendNetEUR = Number(dividends?.estimated_net_eur || 0);
  const priceGainEUR = Number(summary?.total_gain_abs_eur || 0);

  const combinedGainEUR = priceGainEUR + dividendNetEUR;

  const totalCostEUR = holdings.reduce(
    (sum, holding) =>
      sum + Number(holding.total_cost_eur || 0),
    0
  );

  const combinedPercent = totalCostEUR > 0
    ? combinedGainEUR / totalCostEUR * 100
    : null;

  const sortedHoldings = useMemo(() => {
    const valueFor = (holding) => {
      if (sortField === 'dividends') {
        return dividendByHolding[holding.id]?.estimated_net_eur || 0;
      }

      if (sortField === 'combined_gain') {
        return Number(holding.total_gain_abs_eur || 0) +
          Number(dividendByHolding[holding.id]?.estimated_net_eur || 0);
      }

      return holding[sortField];
    };

    return [...holdings].sort((a, b) => {
      const x = valueFor(a);
      const y = valueFor(b);

      const comparison = typeof x === 'string'
        ? x.localeCompare(String(y || ''))
        : Number(x || 0) - Number(y || 0);

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [holdings, dividendByHolding, sortField, sortDirection]);

  const sortBy = (field) => {
    if (sortField === field) {
      setSortDirection((current) =>
        current === 'asc' ? 'desc' : 'asc'
      );
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const resetHolding = () => {
    setEditingHoldingId(null);
    setHoldingForm(initialHolding);
  };

  const saveHolding = async (event) => {
    event.preventDefault();
    setBusy(true);

    try {
      const payload = {
        ...holdingForm,
        symbol: holdingForm.symbol.trim().toUpperCase(),
        shares: Number(holdingForm.shares),
        purchase_price: Number(holdingForm.purchase_price || 0),
        purchase_date: holdingForm.purchase_date
          ? new Date(holdingForm.purchase_date).toISOString()
          : null,
      };

      if (editingHoldingId) {
        await updateHolding(editingHoldingId, payload);
      } else {
        await createHolding(payload);
      }

      resetHolding();
      await loadPortfolio();
      await loadDividends(true);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const editHolding = (holding) => {
    setEditingHoldingId(holding.id);
    setHoldingForm({
      symbol: holding.symbol,
      shares: String(holding.shares),
      purchase_price: String(holding.purchase_price || ''),
      purchase_price_currency:
        holding.purchase_price_currency || 'USD',
      purchase_date: holding.purchase_date
        ? String(holding.purchase_date).slice(0, 10)
        : '',
    });
  };

  const removeHolding = async (id) => {
    if (!window.confirm('Delete this holding?')) return;

    try {
      await deleteHolding(id);
      resetHolding();
      await loadPortfolio();
      await loadDividends(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const saveBuyingPower = async () => {
    try {
      const updated = await updateBuyingPower(buyingPowerInput);
      setBuyingPower(updated.buying_power);
      setEditingBuyingPower(false);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  return (
    <div className="p-6 space-y-6 bg-gray-900 text-white min-h-screen">
      <h2 className="text-xl font-bold">Portfolio</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="bg-gray-800 p-4 rounded-lg">
          <div className="text-xs text-gray-400">Market Value USD</div>
          <div className="text-xl font-bold">
            {money(summary?.total_value_usd, 'USD')}
          </div>
        </div>

        <div className="bg-gray-800 p-4 rounded-lg">
          <div className="text-xs text-gray-400">Buying Power USD</div>

          {editingBuyingPower ? (
            <div className="flex gap-2">
              <input
                type="number"
                step="any"
                className={`${inputClass} w-28`}
                value={buyingPowerInput}
                onChange={(e) => setBuyingPowerInput(e.target.value)}
              />
              <button onClick={saveBuyingPower}>Save</button>
              <button onClick={() => setEditingBuyingPower(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-3 items-center">
              <span className="text-xl font-bold">
                {money(buyingPower, 'USD')}
              </span>
              <button
                className="text-blue-400 text-sm"
                onClick={() => {
                  setBuyingPowerInput(String(buyingPower));
                  setEditingBuyingPower(true);
                }}
              >
                Edit
              </button>
            </div>
          )}
        </div>

        <div className="bg-gray-800 p-4 rounded-lg">
          <div className="text-xs text-gray-400">Day Change USD</div>
          <GainDisplay
            value={summary?.day_change_abs_usd}
            percent={summary?.day_change_percent}
          />
        </div>

        <div className="bg-gray-800 p-4 rounded-lg">
          <div className="text-xs text-gray-400">
            Estimated Net Dividends EUR
          </div>
          <div className="text-xl font-bold text-green-400">
            {dividends ? money(dividendNetEUR) : 'Loading...'}
          </div>
        </div>

        <div className="bg-gray-800 p-4 rounded-lg">
          <div className="text-xs text-gray-400">
            All-Time P&L incl. Dividends EUR
          </div>
          {dividends ? (
            <GainDisplay
              value={combinedGainEUR}
              percent={combinedPercent}
              currency="EUR"
            />
          ) : (
            <span className="text-gray-400">Loading...</span>
          )}
        </div>
      </div>

      {dividends && !dividends.complete && (
        <div className="bg-amber-950 border border-amber-700 p-3 rounded text-sm">
          Some dividends could not be calculated. The displayed
          dividend and All-Time P&L estimates are incomplete.
          Check the Dividends tab for details.
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-gray-700 pb-3">
        {[
          ['holdings', 'Holdings'],
          ['dividends', 'Dividends'],
          ['alerts', 'Alerts'],
          ['summary', 'Market Summary'],
          ['heatmap', 'Market Heatmap'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveSubTab(key)}
            className={`px-4 py-2 rounded text-sm ${
              activeSubTab === key
                ? 'bg-blue-600'
                : 'bg-gray-800 hover:bg-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-950 border border-red-700 p-3 rounded">
          {error}
        </div>
      )}

      {loading && !summary && (
        <p className="text-gray-400">Loading portfolio...</p>
      )}

      {activeSubTab === 'holdings' && (
        <div className="space-y-5">
          <form
            onSubmit={saveHolding}
            className="bg-gray-800 p-4 rounded flex flex-wrap gap-3 items-end"
          >
            <label className="text-xs">
              Symbol
              <input
                required
                className={`${inputClass} block mt-1 w-28`}
                value={holdingForm.symbol}
                onChange={(e) => setHoldingForm({
                  ...holdingForm,
                  symbol: e.target.value,
                })}
              />
            </label>

            <label className="text-xs">
              Shares
              <input
                required
                type="number"
                step="any"
                min="0"
                className={`${inputClass} block mt-1 w-28`}
                value={holdingForm.shares}
                onChange={(e) => setHoldingForm({
                  ...holdingForm,
                  shares: e.target.value,
                })}
              />
            </label>

            <label className="text-xs">
              Purchase Price
              <input
                type="number"
                step="any"
                className={`${inputClass} block mt-1 w-28`}
                value={holdingForm.purchase_price}
                onChange={(e) => setHoldingForm({
                  ...holdingForm,
                  purchase_price: e.target.value,
                })}
              />
            </label>

            <label className="text-xs">
              Currency
              <select
                className={`${inputClass} block mt-1`}
                value={holdingForm.purchase_price_currency}
                onChange={(e) => setHoldingForm({
                  ...holdingForm,
                  purchase_price_currency: e.target.value,
                })}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>

            <label className="text-xs">
              First Purchase Date
              <input
                type="date"
                className={`${inputClass} block mt-1`}
                value={holdingForm.purchase_date}
                onChange={(e) => setHoldingForm({
                  ...holdingForm,
                  purchase_date: e.target.value,
                })}
              />
            </label>

            <button
              disabled={busy}
              className="bg-blue-600 px-4 py-2 rounded text-sm disabled:opacity-50"
            >
              {editingHoldingId ? 'Update Holding' : 'Add Holding'}
            </button>

            {editingHoldingId && (
              <button type="button" onClick={resetHolding}>
                Cancel
              </button>
            )}
          </form>

          <div className="overflow-x-auto bg-gray-800 rounded">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-700 text-gray-300">
                <tr>
                  {[
                    ['symbol', 'Symbol'],
                    ['shares', 'Shares'],
                    ['avg_cost_share_usd', 'Avg Cost USD'],
                    ['last_price_usd', 'Last Price USD'],
                    ['market_value_usd', 'Market Value USD'],
                    ['day_gain_abs_usd', 'Day Gain USD'],
                    ['dividends', 'Est. Net Dividends EUR'],
                    ['combined_gain', 'Total P&L EUR'],
                  ].map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => sortBy(key)}
                      className="p-3 cursor-pointer whitespace-nowrap"
                    >
                      {label}
                      {sortField === key
                        ? (sortDirection === 'asc' ? ' ↑' : ' ↓')
                        : ''}
                    </th>
                  ))}
                  <th className="p-3">Actions</th>
                </tr>
              </thead>

              <tbody>
                {sortedHoldings.map((h) => {
                  const d = dividendByHolding[h.id];
                  const net = Number(d?.estimated_net_eur || 0);
                  const combined =
                    Number(h.total_gain_abs_eur || 0) + net;

                  const dividendError = dividends?.holdings?.find(
                    (item) => item.holding_id === h.id
                  )?.error;

                  return (
                    <tr key={h.id} className="border-t border-gray-700">
                      <td className="p-3 font-bold">{h.symbol}</td>
                      <td className="p-3">{fmt(h.shares, 4)}</td>
                      <td className="p-3">
                        {money(h.avg_cost_share_usd, 'USD')}
                      </td>
                      <td className="p-3">
                        {h.quote_fetch_error
                          ? 'Quote unavailable'
                          : money(h.last_price_usd, 'USD')}
                      </td>
                      <td className="p-3">
                        {money(h.market_value_usd, 'USD')}
                      </td>
                      <td className="p-3">
                        <GainDisplay
                          value={h.day_gain_abs_usd}
                          percent={h.day_gain_percent}
                        />
                      </td>
                      <td className="p-3">
                        {dividendError ? (
                          <span className="text-amber-400" title={dividendError}>
                            Unavailable
                          </span>
                        ) : dividends ? (
                          <span className="text-green-400">
                            {money(net)}
                          </span>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="p-3">
                        {dividends ? (
                          <GainDisplay value={combined} currency="EUR" />
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <button
                          onClick={() => editHolding(h)}
                          className="text-blue-400 mr-3"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeHolding(h.id)}
                          className="text-red-400"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {sortedHoldings.length === 0 && (
                  <tr>
                    <td colSpan="9" className="p-5 text-center text-gray-400">
                      No holdings found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'dividends' && (
        <div className="space-y-5">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h3 className="text-lg font-bold">Yahoo Dividend History</h3>
              <p className="text-xs text-gray-400">
                Calculated from your first purchase date using current shares.
              </p>
            </div>

            <button
              type="button"
              disabled={refreshingDividends}
              onClick={() => loadDividends(true)}
              className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm disabled:opacity-50"
            >
              {refreshingDividends
                ? 'Fetching Yahoo data...'
                : 'Refresh Yahoo Dividends'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              ['Gross Dividends EUR', dividends?.gross_eur],
              ['Estimated Tax EUR (28%)', dividends?.estimated_tax_eur],
              ['Estimated Net Dividends EUR', dividends?.estimated_net_eur],
            ].map(([label, amount]) => (
              <div key={label} className="bg-gray-800 rounded p-4">
                <div className="text-xs text-gray-400">{label}</div>
                <div className="text-xl font-bold">
                  {dividends ? money(amount) : '--'}
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-amber-300">
            These are estimated entitlements based on Yahoo ex-dividend
            events, not verified broker payments. The 28% Portuguese
            tax assumption does not account for actual foreign withholding,
            treaty relief or tax credits. USD dividends use the current
            EUR conversion rate.
          </p>

          <div className="space-y-3">
            {(dividends?.holdings || []).map((h) => (
              <details
                key={h.holding_id}
                className="bg-gray-800 rounded border border-gray-700"
              >
                <summary className="p-4 cursor-pointer">
                  <span className="font-bold mr-3">{h.symbol}</span>
                  <span className="text-gray-300">
                    {h.error
                      ? h.error
                      : `${h.events_count} events · ${money(h.estimated_net_eur)} estimated net`}
                  </span>
                </summary>

                {!h.error && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-gray-700">
                        <tr>
                          <th className="p-3">Ex-dividend date</th>
                          <th className="p-3">Per share</th>
                          <th className="p-3">Eligible shares (assumed)</th>
                          <th className="p-3">Gross</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(h.events || []).map((event, index) => (
                          <tr
                            key={`${event.ex_date}-${index}`}
                            className="border-t border-gray-700"
                          >
                            <td className="p-3">{event.ex_date}</td>
                            <td className="p-3">
                              {fmt(event.amount_per_share, 4)} {h.currency}
                            </td>
                            <td className="p-3">{fmt(h.shares, 4)}</td>
                            <td className="p-3">
                              {fmt(
                                event.amount_per_share * h.shares
                              )} {h.currency}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            ))}
          </div>
        </div>
      )}

      {activeSubTab === 'alerts' && (
        <div className="bg-gray-800 rounded overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-700">
              <tr>
                <th className="p-3">Symbol</th>
                <th className="p-3">Condition</th>
                <th className="p-3">Target</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {thresholds.map((t) => (
                <tr key={t.id} className="border-t border-gray-700">
                  <td className="p-3">{t.symbol}</td>
                  <td className="p-3">{t.condition}</td>
                  <td className="p-3">
                    {money(t.target_price ?? t.target, 'USD')}
                  </td>
                  <td className="p-3">
                    {t.enabled ? 'Enabled' : 'Disabled'}
                  </td>
                </tr>
              ))}
              {thresholds.length === 0 && (
                <tr>
                  <td colSpan="4" className="p-5 text-center">
                    No price alerts configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeSubTab === 'summary' && <MarketSummaryTab />}
      {activeSubTab === 'heatmap' && <MarketHeatmap />}
    </div>
  );
}
