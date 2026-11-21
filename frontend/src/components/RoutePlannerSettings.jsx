import React, { useRef, useState } from 'react';
import { API } from '../services/http';

function messageOf(error) {
  return error?.response?.data?.error ||
    error?.message ||
    'Request failed';
}

export default function RoutePlannerSettings({
  settings,
  online,
  busy,
  onApply,
  onReload,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const searchVersion = useRef(0);

  async function search(event) {
    event.preventDefault();

    const text = query.trim();
    if (text.length < 3 || !online || busy || searching) return;

    const version = ++searchVersion.current;
    setSearching(true);
    setError('');
    setSelected(null);
    setResults([]);
    setSearched(false);

    try {
      const { data } = await API.get('/route-planner/areas', {
        params: { q: text },
        timeout: 30000,
      });

      if (version !== searchVersion.current) return;

      if (!Array.isArray(data.results)) {
        throw new Error('The updated route-settings backend is required.');
      }

      setResults(data.results);
      setSearched(true);
    } catch (failure) {
      if (version === searchVersion.current) {
        setError(messageOf(failure));
      }
    } finally {
      if (version === searchVersion.current) {
        setSearching(false);
      }
    }
  }

  async function apply() {
    if (!selected || busy || !online) return;

    setError('');

    try {
      await onApply(selected.selection_token);
      setSelected(null);
      setResults([]);
      setSearched(false);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }

  return (
    <section className="terminal-card space-y-5 p-4 md:p-6">
      <div>
        <h2 className="text-lg font-semibold">Route Planner Settings</h2>
        <p className="mt-2 text-sm text-slate-400">
          Restrict address lookup and route destinations to a selected
          geographic boundary in Portugal.
        </p>
      </div>

      <div className="rounded-xl border border-white/15 p-4">
        <p className="text-sm text-slate-400">Active search area</p>
        <p className="mt-1 font-semibold">
          {settings?.area?.label || 'No geographic area selected'}
        </p>
        {settings?.area && (
          <p className="mt-1 text-sm text-slate-400">
            Boundary type: {settings.area.level}
          </p>
        )}
      </div>

      <form onSubmit={search} className="space-y-3">
        <label htmlFor="route-area-query" className="block font-medium">
          Search district, municipality or postcode area
        </label>

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="route-area-query"
            type="search"
            value={query}
            maxLength={200}
            placeholder="For example: Distrito da Guarda, Portugal"
            autoComplete="off"
            disabled={busy || searching}
            className="terminal-input min-w-0 flex-1"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
              setResults([]);
              setSearched(false);
            }}
          />

          <button
            type="submit"
            className="terminal-button"
            disabled={
              !online || busy || searching || query.trim().length < 3
            }
          >
            {searching ? 'Searching…' : 'Search areas'}
          </button>
        </div>
      </form>

      {searched && results.length === 0 && (
        <p role="status" className="text-sm text-amber-200">
          No supported boundary was returned. Try the full district or
          municipality name. Settlement points without a boundary are
          not offered.
        </p>
      )}

      {results.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="mb-3 font-medium">Choose the boundary</legend>

          {results.map((area) => (
            <label
              key={area.place_id}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/15 p-4"
            >
              <input
                type="radio"
                name="route-area"
                value={area.place_id}
                checked={selected?.place_id === area.place_id}
                disabled={busy}
                onChange={() => setSelected(area)}
                className="mt-1"
              />
              <span>
                <span className="block font-semibold">{area.label}</span>
                <span className="mt-1 block text-sm text-slate-400">
                  {area.level} · {area.country_code.toUpperCase()}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {selected && (
        <div className="space-y-3 rounded-xl border border-amber-400/30 p-4">
          <p>
            Applying this area preserves extracted addresses and saved
            journeys. Address verification and candidates will be reset.
            Saved corrections must pass the new area and road checks.
          </p>

          <button
            type="button"
            className="terminal-button"
            disabled={busy || !online}
            onClick={apply}
          >
            Apply selected area
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-red-300">{error}</p>
      )}

      <button
        type="button"
        className="terminal-button-secondary"
        disabled={busy || searching || !online}
        onClick={onReload}
      >
        Reload saved settings
      </button>

      <p className="text-sm text-slate-400">
        Settings are saved for your account independently of the
        journey’s 24-hour retention. Selecting a wider area does not
        expand the routing service’s road map.
      </p>
    </section>
  );
}