
import React, { useEffect, useState } from 'react';
import {
  Route, MapPin, Navigation, CheckCircle2,
  RefreshCw, Plus, ExternalLink
} from 'lucide-react';

import {
  fetchRoutePlans,
  createRoutePlan,
  updateRouteSegment
} from '../services/api';

function parseLocations(text) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  return lines.map((line, index) => {
    const parts = line.split(';').map(s => s.trim());

    if (parts.length !== 3) {
      throw new Error(`Row ${index + 1}: expected Address;Latitude;Longitude`);
    }

    const latitude = Number(parts[1]);
    const longitude = Number(parts[2]);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error(`Row ${index + 1}: invalid coordinates`);
    }

    return {
      address: parts[0],
      latitude,
      longitude
    };
  });
}

export default function RoutePlannerTab() {
  const [plans, setPlans] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState('');
  const [locations, setLocations] = useState('');
  const [roundTrip, setRoundTrip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await fetchRoutePlans();
      setPlans(data || []);
      setSelectedId(current =>
        current ?? (data?.[0]?.id || null)
      );
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);

    try {
      const stops = parseLocations(locations);

      if (stops.length < 2) {
        throw new Error('At least two locations are required.');
      }

      const plan = await createRoutePlan({
        name: name || 'Guarda Route',
        stops,
        round_trip: roundTrip
      });

      await load();
      setSelectedId(plan.id);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (planId, segment) => {
    try {
      await updateRouteSegment(
        planId,
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
  const completed = segments.filter(s => s.completed).length;
  const next = segments.find(s => !s.completed);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">
          Route Planner
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Optimize stops and navigate through connected Google Maps routes.
        </p>
      </div>

      <section className="terminal-card p-5">
        <h3 className="mb-4 flex items-center gap-2 font-semibold">
          <Plus size={18} /> New route
        </h3>

        <form onSubmit={create} className="space-y-4">
          <input
            className="terminal-input"
            placeholder="Route name"
            value={name}
            onChange={e => setName(e.target.value)}
          />

          <textarea
            className="terminal-input min-h-40 w-full font-mono text-sm"
            placeholder={
              'Depot;40.538;-7.262\n' +
              'Stop A;40.547;-7.291\n' +
              'Stop B;40.522;-7.244'
            }
            value={locations}
            onChange={e => setLocations(e.target.value)}
            required
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={roundTrip}
              onChange={e => setRoundTrip(e.target.checked)}
            />
            Return to starting location
          </label>

          <button className="terminal-button" disabled={busy}>
            <Route size={16} />
            {busy ? 'Optimizing...' : 'Optimize route'}
          </button>
        </form>
      </section>

      {error && (
        <div role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error}
        </div>
      )}

      <section className="terminal-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">Saved routes</h3>
          <button
            className="terminal-button-secondary"
            onClick={load}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {plans.map(plan => (
            <button
              key={plan.id}
              onClick={() => setSelectedId(plan.id)}
              className={
                selectedId === plan.id
                  ? 'terminal-button'
                  : 'terminal-button-secondary'
              }
            >
              {plan.name} #{plan.id}
            </button>
          ))}
        </div>
      </section>

      {selected && (
        <section className="terminal-card overflow-hidden">
          <div className="border-b border-white/10 p-5">
            <h3 className="text-lg font-semibold">
              {selected.name}
            </h3>

            <div className="mt-3 grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-slate-400">Distance</p>
                <p className="font-semibold">
                  {(selected.distance_m / 1000).toFixed(1)} km
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Drive time</p>
                <p className="font-semibold">
                  {Math.round(selected.duration_s / 60)} min
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Completed</p>
                <p className="font-semibold">
                  {completed}/{segments.length}
                </p>
              </div>
            </div>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full bg-emerald-500"
                style={{
                  width: `${segments.length
                    ? completed / segments.length * 100
                    : 0}%`
                }}
              />
            </div>

            {next && (
              <a
                className="terminal-button mt-4 inline-flex"
                href={next.google_maps_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Navigation size={17} />
                Navigate Route {next.sequence}
              </a>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="terminal-table w-full">
              <thead>
                <tr>
                  <th>Done</th>
                  <th>Route</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Navigation</th>
                </tr>
              </thead>
              <tbody>
                {segments.map(segment => {
                  const from = selected.stops.find(
                    s => s.sequence === segment.start_stop
                  );
                  const to = selected.stops.find(
                    s => s.sequence === segment.end_stop
                  );

                  return (
                    <tr key={segment.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={segment.completed}
                          onChange={() =>
                            toggle(selected.id, segment)
                          }
                          aria-label={
                            `Complete Route ${segment.sequence}`
                          }
                        />
                      </td>
                      <td>
                        <span className="flex items-center gap-2">
                          {segment.completed
                            ? <CheckCircle2
                                size={16}
                                className="text-emerald-400"
                              />
                            : <MapPin
                                size={16}
                                className="text-cyan-400"
                              />
                          }
                          Route {segment.sequence}
                        </span>
                      </td>
                      <td>{from?.address || '—'}</td>
                      <td>{to?.address || '—'}</td>
                      <td>
                        <a
                          href={segment.google_maps_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-cyan-400"
                        >
                          Open Maps <ExternalLink size={14} />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
