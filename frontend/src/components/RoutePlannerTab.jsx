
import React, { useEffect, useState } from 'react';
import {
  Upload, Route, Navigation, CheckCircle2,
  AlertTriangle, RefreshCw, ExternalLink
} from 'lucide-react';

import {
  fetchRoutePlans,
  createRoutePlan,
  updateRouteSegment,
  parseRouteScreenshots,
  verifyRouteAddress
} from '../services/api';

const keyOf = s =>
  `${Number(s.latitude).toFixed(6)},${Number(s.longitude).toFixed(6)}`;

function groupDestinations(services) {
  const groups = new Map();

  for (const service of services) {
    const key = keyOf(service);
    if (!groups.has(key)) {
      groups.set(key, {
        address: service.address,
        latitude: service.latitude,
        longitude: service.longitude,
        services: []
      });
    }
    groups.get(key).services.push({
      service_type: service.service_type
    });
  }

  return [...groups.values()];
}

export default function RoutePlannerTab() {
  const [files, setFiles] = useState([]);
  const [complete, setComplete] = useState([]);
  const [uncomplete, setUncomplete] = useState([]);
  const [plans, setPlans] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState('');
  const [depot, setDepot] = useState('');
  const [depotPoint, setDepotPoint] = useState(null);
  const [roundTrip, setRoundTrip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('complete');

  const load = async () => {
    const data = await fetchRoutePlans();
    setPlans(data || []);
    setSelectedId(current =>
      data?.some(p => p.id === current)
        ? current
        : data?.[0]?.id ?? null
    );
  };

  useEffect(() => {
    load().catch(err => setError(err.message));
  }, []);

  const upload = async () => {
    if (!files.length) return;
    setBusy(true);
    setError('');

    try {
      const data = await parseRouteScreenshots(files);
      setComplete(data.complete || []);
      setUncomplete(data.uncomplete || []);
      setTab('complete');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const updateIncompleteAddress = (index, value) => {
    setUncomplete(current => current.map((s, i) =>
      i === index ? { ...s, address: value } : s
    ));
  };

  const retryAddress = async index => {
    setBusy(true);
    setError('');

    try {
      const item = uncomplete[index];
      const result = await verifyRouteAddress(item.address);

      if (result.status !== 'complete') {
        throw new Error(result.reason || 'Address still incomplete');
      }

      setComplete(current => [...current, {
        ...result,
        service_type: item.service_type
      }]);

      setUncomplete(current => current.filter((_, i) => i !== index));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyDepot = async () => {
    setBusy(true);
    setError('');
    setDepotPoint(null);

    try {
      const result = await verifyRouteAddress(depot);
      if (result.status !== 'complete') {
        throw new Error(result.reason || 'Starting address not verified');
      }
      setDepotPoint(result);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const destinations = groupDestinations(complete);

  const optimize = async () => {
    if (!depotPoint) {
      setError('Verify your starting location first.');
      return;
    }
    if (!destinations.length) {
      setError('No complete destinations available.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const route = await createRoutePlan({
        name: name.trim() || 'Guarda Deliveries',
        round_trip: roundTrip,
        stops: [
          {
            address: depotPoint.address,
            latitude: depotPoint.latitude,
            longitude: depotPoint.longitude,
            services: []
          },
          ...destinations
        ]
      });

      await load();
      setSelectedId(route.id);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async segment => {
    if (!selectedId) return;

    try {
      await updateRouteSegment(
        selectedId,
        segment.id,
        !segment.completed
      );
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const selected = plans.find(p => p.id === selectedId);
  const segments = selected?.segments || [];
  const done = segments.filter(s => s.completed).length;
  const next = segments.find(s => !s.completed);

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-2xl font-bold">Route Planner</h2>
        <p className="mt-1 text-sm text-slate-400">
          Screenshot → addresses → optimized Google Maps routes
        </p>
      </header>

      <section className="terminal-card space-y-4 p-4">
        <h3 className="flex items-center gap-2 font-semibold">
          <Upload size={18} /> Import delivery screenshots
        </h3>

        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="terminal-input"
          onChange={e => setFiles([...e.target.files])}
        />

        <p className="text-xs text-slate-400">
          Upload screenshots from your delivery app.
          Incomplete addresses will be excluded automatically.
        </p>

        <button
          className="terminal-button"
          disabled={busy || !files.length}
          onClick={upload}
        >
          {busy ? 'Processing...' : `Extract addresses (${files.length})`}
        </button>
      </section>

      <section className="terminal-card p-4">
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            className={tab === 'complete'
              ? 'terminal-button'
              : 'terminal-button-secondary'}
            onClick={() => setTab('complete')}
          >
            <CheckCircle2 size={16} />
            Complete ({complete.length})
          </button>

          <button
            className={tab === 'uncomplete'
              ? 'terminal-button'
              : 'terminal-button-secondary'}
            onClick={() => setTab('uncomplete')}
          >
            <AlertTriangle size={16} />
            Uncomplete ({uncomplete.length})
          </button>
        </div>

        {tab === 'complete' ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              {complete.length} services across{' '}
              {destinations.length} unique destinations.
              Review the addresses before optimization.
            </p>

            {destinations.map((stop, index) => {
              const deliveries = stop.services.filter(
                s => s.service_type === 'delivery'
              ).length;
              const pickups = stop.services.filter(
                s => s.service_type === 'pickup'
              ).length;
              const unknown = stop.services.filter(
                s => s.service_type === 'unknown'
              ).length;

              return (
                <div
                  key={keyOf(stop)}
                  className="rounded-xl border border-white/10 p-3"
                >
                  <p className="text-sm font-semibold">
                    {index + 1}. {stop.address}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {deliveries} deliveries · {pickups} pickups
                    {unknown > 0 && ` · ${unknown} unknown`}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {uncomplete.length === 0 && (
              <p className="text-sm text-slate-400">
                No incomplete addresses.
              </p>
            )}

            {uncomplete.map((item, index) => (
              <div
                key={`${index}-${item.service_type}`}
                className="space-y-2 rounded-xl border border-amber-500/20 p-3"
              >
                <p className="text-xs text-amber-300">
                  {item.reason}
                </p>

                <textarea
                  className="terminal-input min-h-20"
                  value={item.address}
                  onChange={e =>
                    updateIncompleteAddress(index, e.target.value)
                  }
                />

                <p className="text-xs text-slate-400">
                  Service: {item.service_type}
                </p>

                <button
                  className="terminal-button-secondary"
                  disabled={busy}
                  onClick={() => retryAddress(index)}
                >
                  <RefreshCw size={15} />
                  Verify corrected address
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="terminal-card space-y-4 p-4">
        <h3 className="flex items-center gap-2 font-semibold">
          <Route size={18} /> Generate route
        </h3>

        <input
          className="terminal-input"
          placeholder="Route name"
          value={name}
          onChange={e => setName(e.target.value)}
        />

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="terminal-input flex-1"
            placeholder="Starting address with postal code and locality"
            value={depot}
            onChange={e => {
              setDepot(e.target.value);
              setDepotPoint(null);
            }}
          />
          <button
            className="terminal-button-secondary"
            onClick={verifyDepot}
            disabled={busy || !depot.trim()}
          >
            Verify start
          </button>
        </div>

        {depotPoint && (
          <p className="text-xs text-emerald-300">
            Starting location verified: {depotPoint.address}
          </p>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={roundTrip}
            onChange={e => setRoundTrip(e.target.checked)}
          />
          Return to starting location
        </label>

        <button
          className="terminal-button w-full sm:w-auto"
          disabled={busy || !depotPoint || !destinations.length}
          onClick={optimize}
        >
          <Navigation size={17} />
          {busy ? 'Processing...' : `Optimize ${destinations.length} stops`}
        </button>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      <section className="terminal-card space-y-4 p-4">
        <h3 className="font-semibold">Saved routes</h3>
        <div className="flex flex-wrap gap-2">
          {plans.map(plan => (
            <button
              key={plan.id}
              onClick={() => setSelectedId(plan.id)}
              className={selectedId === plan.id
                ? 'terminal-button'
                : 'terminal-button-secondary'}
            >
              {plan.name} #{plan.id}
            </button>
          ))}
        </div>
      </section>

      {selected && (
        <section className="terminal-card space-y-4 p-4">
          <h3 className="text-lg font-semibold">{selected.name}</h3>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/5 p-3">
              <p className="text-lg font-bold">
                {(selected.distance_m / 1000).toFixed(1)}
              </p>
              <p className="text-xs text-slate-400">km</p>
            </div>
            <div className="rounded-xl bg-white/5 p-3">
              <p className="text-lg font-bold">
                {Math.round(selected.duration_s / 60)}
              </p>
              <p className="text-xs text-slate-400">minutes</p>
            </div>
            <div className="rounded-xl bg-white/5 p-3">
              <p className="text-lg font-bold">
                {done}/{segments.length}
              </p>
              <p className="text-xs text-slate-400">routes done</p>
            </div>
          </div>

          {next && (
            <a
              href={next.google_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="terminal-button w-full"
            >
              <Navigation size={17} />
              Open next route in Google Maps
            </a>
          )}

          <div className="space-y-3">
            {segments.map(segment => {
              const from = selected.stops.find(
                s => s.sequence === segment.start_stop
              );
              const to = selected.stops.find(
                s => s.sequence === segment.end_stop
              );

              const visited = selected.stops.filter(
                s => s.sequence > segment.start_stop &&
                  s.sequence <= segment.end_stop
              );

              return (
                <div
                  key={segment.id}
                  className="rounded-xl border border-white/10 p-3"
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5"
                      checked={segment.completed}
                      onChange={() => toggle(segment)}
                    />

                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        Route {segment.sequence}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {from?.address} → {to?.address}
                      </p>

                      <p className="mt-2 text-xs text-slate-500">
                        {visited.reduce(
                          (n, s) => n + (s.services?.length || 0), 0
                        )} services · {visited.length} destination stops
                      </p>

                      <a
                        href={segment.google_maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-cyan-400"
                      >
                        Open Google Maps <ExternalLink size={15} />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
