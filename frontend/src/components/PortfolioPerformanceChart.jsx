
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine
} from 'recharts';
import { Activity, RefreshCw } from 'lucide-react';
import {
  fetchPortfolioHistory,
  fetchBenchmarkHistory
} from '../services/api';

const get = (point, key) =>
  point?.[key] ?? point?.[key.toLowerCase()];

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];

  return points
    .map((point) => ({
      time: Number(get(point, 'Timestamp')),
      close: Number(get(point, 'Close')),
    }))
    .filter((point) =>
      Number.isFinite(point.time) &&
      Number.isFinite(point.close) &&
      point.close > 0
    )
    .sort((a, b) => a.time - b.time);
}

function buildComparison(portfolio, benchmark) {
  const p = normalizePoints(portfolio);
  const b = normalizePoints(benchmark);

  if (p.length < 2 || b.length < 2) return [];

  // Only compare the overlapping time period.
  const start = Math.max(p[0].time, b[0].time);
  const end = Math.min(p[p.length - 1].time, b[b.length - 1].time);

  const filteredPortfolio = p.filter((item) =>
    item.time >= start && item.time <= end
  );
  const filteredBenchmark = b.filter((item) =>
    item.time >= start && item.time <= end
  );

  if (filteredPortfolio.length < 2 || filteredBenchmark.length < 2) {
    return [];
  }

  // Align each portfolio observation with the latest benchmark
  // observation at or before that timestamp.
  const rows = [];
  let index = 0;
  let firstPortfolio = null;
  let firstBenchmark = null;

  for (const item of filteredPortfolio) {
    while (
      index + 1 < filteredBenchmark.length &&
      filteredBenchmark[index + 1].time <= item.time
    ) {
      index++;
    }

    const reference = filteredBenchmark[index];

    if (reference.time > item.time) continue;

    if (firstPortfolio === null) {
      firstPortfolio = item.close;
      firstBenchmark = reference.close;
    }

    rows.push({
      timestamp: item.time * 1000,
      portfolio: (item.close / firstPortfolio - 1) * 100,
      benchmark: (reference.close / firstBenchmark - 1) * 100,
    });
  }

  return rows;
}

const formatPercent = (value) =>
  `${Number(value).toFixed(2)}%`;

export default function PortfolioPerformanceChart({ active = true }) {
  const [portfolioPoints, setPortfolioPoints] = useState([]);
  const [benchmarkPoints, setBenchmarkPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPortfolio, setShowPortfolio] = useState(true);
  const [showBenchmark, setShowBenchmark] = useState(true);

  const refresh = useCallback(async () => {
    if (!active || document.hidden) return;

    setLoading(true);
    setError('');

    try {
      const [portfolio, benchmark] = await Promise.all([
        fetchPortfolioHistory(),
        fetchBenchmarkHistory(),
      ]);

      setPortfolioPoints(portfolio?.usd || portfolio?.USD || []);
      setBenchmarkPoints(benchmark?.points || []);
    } catch (err) {
      setError(
        err?.response?.data?.error ||
        err?.message ||
        'Unable to load chart data.'
      );
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;

    refresh();

    const timer = window.setInterval(refresh, 60_000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };

    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, refresh]);

  const data = useMemo(
    () => buildComparison(portfolioPoints, benchmarkPoints),
    [portfolioPoints, benchmarkPoints]
  );

  const latest = data[data.length - 1];

  return (
    <section className="terminal-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-white">
            <Activity size={18} className="text-cyan-400" />
            Portfolio vs S&P 500
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Intraday performance · Current holdings vs SPY ETF proxy · USD
          </p>
        </div>

        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="terminal-button-secondary"
        >
          <RefreshCw
            size={15}
            className={loading ? 'animate-spin' : ''}
          />
          Refresh
        </button>
      </div>

      <div className="p-5">
        <div className="mb-5 flex flex-wrap items-center gap-5">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showPortfolio}
              onChange={(e) => setShowPortfolio(e.target.checked)}
            />
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
            Portfolio
            {latest && (
              <strong>{formatPercent(latest.portfolio)}</strong>
            )}
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showBenchmark}
              onChange={(e) => setShowBenchmark(e.target.checked)}
            />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            S&P 500 (SPY)
            {latest && (
              <strong>{formatPercent(latest.benchmark)}</strong>
            )}
          </label>
        </div>

        {error && (
          <p className="mb-4 text-sm text-rose-400">{error}</p>
        )}

        {data.length > 1 ? (
          <div className="h-[320px] w-full md:h-[410px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 12, right: 12, bottom: 8, left: 0 }}
              >
                <CartesianGrid
                  stroke="#334155"
                  strokeOpacity={0.3}
                  vertical={false}
                />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  scale="time"
                  tickFormatter={(value) =>
                    new Date(value).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  }
                  stroke="#94a3b8"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  stroke="#94a3b8"
                  tick={{ fontSize: 11 }}
                  tickFormatter={formatPercent}
                  width={65}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    background: '#101827',
                    border: '1px solid #334155',
                    borderRadius: 12,
                    color: '#fff',
                  }}
                  labelFormatter={(value) =>
                    new Date(value).toLocaleString()
                  }
                  formatter={(value) => formatPercent(value)}
                />
                <Legend />
                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />

                {showPortfolio && (
                  <Line
                    type="monotone"
                    dataKey="portfolio"
                    name="Portfolio"
                    stroke="#22d3ee"
                    strokeWidth={2.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}

                {showBenchmark && (
                  <Line
                    type="monotone"
                    dataKey="benchmark"
                    name="S&P 500 (SPY)"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-[320px] items-center justify-center rounded-xl border border-dashed border-white/10 text-center text-sm text-slate-400">
            {loading
              ? 'Loading historical prices...'
              : 'Not enough overlapping market data to display a comparison.'}
          </div>
        )}

        <p className="mt-4 text-xs leading-5 text-slate-500">
          This chart compares intraday price movement for your current
          positions against SPY, an ETF tracking the S&P 500.
          It is not a money-weighted or time-weighted account return.
          Historical trades and cash flows are not included.
        </p>
      </div>
    </section>
  );
}
