import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  Navigation,
  Upload,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';

import {
  createRoutePlan,
  parseRouteScreenshots,
} from '../services/api';

import { usePlanner } from '../services/plannerStore';

function validPoint(point) {
  return (
    point?.latitude != null &&
    point?.longitude != null &&
    Number.isFinite(Number(point.latitude)) &&
    Number.isFinite(Number(point.longitude)) &&
    Math.abs(Number(point.latitude)) <= 90 &&
    Math.abs(Number(point.longitude)) <= 180 &&
    !(
      Number(point.latitude) === 0 &&
      Number(point.longitude) === 0
    )
  );
}

const coordinateKey = (point) =>
  `${Number(point.latitude).toFixed(6)},` +
  `${Number(point.longitude).toFixed(6)}`;

function destinationsOf(services) {
  const grouped = new Map();

  for (const item of services) {
    if (!validPoint(item)) {
      continue;
    }

    const key = coordinateKey(item);

    if (!grouped.has(key)) {
      grouped.set(key, {
        address: item.address,
        latitude: Number(item.latitude),
        longitude: Number(item.longitude),
        services: [],
      });
    }

    grouped.get(key).services.push({
      service_type: item.service_type || 'unknown',
    });
  }

  return [...grouped.values()];
}

const messageOf = (error) =>
  error.response?.data?.error ||
  error.message ||
  'Request failed';

const dateOf = (value) =>
  value
    ? new Date(value).toLocaleString()
    : 'Unknown';

export default function RoutePlannerTab() {
  const { store, view, identity } = usePlanner();

  const [online, setOnline] = useState(
    navigator.onLine
  );
  const [working, setWorking] = useState('');
  const [localError, setLocalError] = useState('');

  const alive = useRef(true);
  const canConnect = online && !identity.localOnly;
  const state = view.record?.state;

  const destinations = useMemo(
    () => destinationsOf(state?.complete || []),
    [state?.complete]
  );

  const selected = state?.plans.find(
    (plan) => plan.id === state.selectedId
  );

  const segments = [...(selected?.segments || [])].sort(
    (a, b) => a.sequence - b.sequence
  );

  const stops = [...(selected?.stops || [])].sort(
    (a, b) => a.sequence - b.sequence
  );

  useEffect(() => {
    alive.current = true;

    const change = () => setOnline(navigator.onLine);

    window.addEventListener('online', change);
    window.addEventListener('offline', change);

    return () => {
      alive.current = false;
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);

  async function recordError(error) {
    const message = messageOf(error);

    if (!alive.current) {
      return;
    }

    setLocalError(message);

    try {
      await store.change((current) => ({
        ...current,
        phase: 'error',
        error: message,
      }));
    } catch {
      // Storage failures are displayed by the persistence layer.
    }
  }

  async function generate(snapshot) {
    if (
      !navigator.onLine ||
      identity.localOnly
    ) {
      return;
    }

    const current =
      snapshot || store.getSnapshot().record.state;

    if (!current.origin) {
      return;
    }

    const destinations = destinationsOf(
      current.complete
    ).filter(
      (stop) =>
        coordinateKey(stop) !==
        coordinateKey(current.origin)
    );

    if (!destinations.length) {
      return;
    }

    if (destinations.length > 149) {
      throw new Error(
        'Use at most 149 unique destinations plus the starting point.'
      );
    }

    setWorking('optimizing');

    await store.change((s) => ({
      ...s,
      phase: 'optimizing',
      error: '',
    }));

    const plan = await createRoutePlan({
      round_trip: false,
      stops: [
        {
          address: 'My current location',
          latitude: current.origin.latitude,
          longitude: current.origin.longitude,
          services: [],
        },
        ...destinations,
      ],
    });

    if (
      !plan?.id ||
      !Array.isArray(plan.segments) ||
      !plan.segments.length
    ) {
      throw new Error(
        'Backend returned no route links.'
      );
    }

    // Preserve completed work even if the user switched tabs.
    await store.change((s) => ({
      ...s,
      phase: 'ready',
      error: '',
      selectedId: plan.id,
      plans: [
        plan,
        ...s.plans.filter(
          (item) => item.id !== plan.id
        ),
      ].slice(0, 30),
    }));
  }

  async function locate() {
    setWorking('locating');
    setLocalError('');

    try {
      if (
        !navigator.geolocation ||
        !window.isSecureContext
      ) {
        throw new Error(
          'Location requires HTTPS or localhost and a supported browser.'
        );
      }

      const position = await new Promise(
        (resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            {
              enableHighAccuracy: true,
              timeout: 20000,
              maximumAge: 60000,
            }
          )
      );

      const origin = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: position.timestamp,
      };

      if (!validPoint(origin)) {
        throw new Error(
          'Browser returned invalid coordinates.'
        );
      }

      const record = await store.change((s) => ({
        ...s,
        origin,
        error: '',
      }));

      await generate(record.state);
    } catch (error) {
      await recordError(error);
    } finally {
      if (alive.current) {
        setWorking('');
      }
    }
  }

  // Only a NEW journey requests location.
  // Restoration never reruns Gemini or route generation.
  useEffect(() => {
    if (
      view.phase === 'active' &&
      view.fresh &&
      store.consumeFresh()
    ) {
      if (canConnect) {
        locate();
      }
    }
  }, [
    view.phase,
    view.fresh,
    canConnect,
    store,
  ]);

  async function upload(event) {
    const files = Array.from(
      event.target.files || []
    );

    event.target.value = '';

    if (
      !files.length ||
      working ||
      !canConnect
    ) {
      return;
    }

    if (
      files.length > 10 ||
      files.some(
        (file) => file.size > 10 * 1024 * 1024
      )
    ) {
      setLocalError(
        'Choose up to 10 screenshots, each at most 10 MiB.'
      );
      return;
    }

    setWorking('extracting');
    setLocalError('');

    try {
      await store.change((s) => ({
        ...s,
        phase: 'extracting',
        error: '',
        screenshotCount: files.length,
      }));

      const result = await parseRouteScreenshots(files);

      if (
        !Array.isArray(result.complete) &&
        !Array.isArray(result.uncomplete)
      ) {
        throw new Error(
          'Invalid extraction response.'
        );
      }

      const complete = (
        result.complete || []
      ).filter(validPoint);

      const invalid = (
        result.complete || []
      )
        .filter((item) => !validPoint(item))
        .map((item) => ({
          ...item,
          reason: 'Invalid coordinates',
        }));

      const record = await store.change((s) => ({
        ...s,
        complete,
        incomplete: [
          ...(result.uncomplete || []),
          ...invalid,
        ],
        tab: 'complete',
        phase: 'extracted',
        error: '',
        selectedId: null,
      }));

      await generate(record.state);
    } catch (error) {
      await recordError(error);
    } finally {
      if (alive.current) {
        setWorking('');
      }
    }
  }

  async function run(action) {
    setLocalError('');

    try {
      await action();
    } catch (error) {
      setLocalError(messageOf(error));
    }
  }

  if (view.phase === 'loading') {
    return (
      <p role="status">
        Loading saved route planner…
      </p>
    );
  }

  if (view.phase === 'error') {
    return (
      <p role="alert" className="text-red-300">
        {view.error}
      </p>
    );
  }

  if (view.phase === 'choice') {
    const previous = view.candidate?.state;

    const plan = previous?.plans.find(
      (item) => item.id === previous.selectedId
    );

    return (
      <section className="terminal-card space-y-4 p-6">
        <h2 className="text-xl font-semibold">
          {previous
            ? 'Restore your previous journey?'
            : 'Start a new journey?'}
        </h2>

        {previous && (
          <p>
            {dateOf(view.candidate.updated_at)}
            {' · '}
            {destinationsOf(previous.complete).length}
            {' '}destinations
            {' · '}
            {plan?.segments?.filter(
              (item) => item.completed
            ).length || 0}
            /
            {plan?.segments?.length || 0}
            {' '}routes completed
          </p>
        )}

        <p className="text-sm text-slate-400">
          {view.status}
        </p>

        <div className="flex flex-wrap gap-3">
          {previous && (
            <button
              className="terminal-button"
              onClick={() =>
                run(() => store.continuePrevious())
              }
            >
              Continue previous journey
            </button>
          )}

          <button
            className="terminal-button-secondary"
            onClick={() =>
              run(() => store.startNew())
            }
          >
            Start new journey
          </button>
        </div>

        {localError && (
          <p role="alert" className="text-red-300">
            {localError}
          </p>
        )}
      </section>
    );
  }

  const patch = (change) =>
    run(() => store.change(change));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">
            Route Planner
          </h2>

          <p
            role="status"
            className="text-sm text-slate-400"
          >
            {view.status}
          </p>
        </div>

        <button
          className="terminal-button-secondary"
          disabled={Boolean(working)}
          onClick={() =>
            store.emit({
              phase: 'choice',
              candidate: view.record,
            })
          }
        >
          Start new journey
        </button>
      </header>

      {!canConnect && (
        <div className="rounded-xl border border-amber-500/30 p-4 text-amber-200">
          Saved journey · {online ? 'local view' : 'offline'}.
          Route links and addresses remain available.
          Completion changes are queued on this device.
        </div>
      )}

      {view.conflict && (
        <section className="terminal-card space-y-3 p-4">
          <h3 className="font-semibold">
            A newer cloud copy exists
          </h3>

          <p>
            Your device changes have not overwritten it.
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              className="terminal-button"
              disabled={Boolean(working)}
              onClick={() =>
                run(() => store.useCloud())
              }
            >
              Use cloud copy
            </button>

            <button
              className="terminal-button-secondary"
              disabled={Boolean(working)}
              onClick={() =>
                run(() => store.keepDevice())
              }
            >
              Keep this device copy
            </button>
          </div>
        </section>
      )}

      <section className="terminal-card space-y-3 p-4">
        <h3 className="flex items-center gap-2 font-semibold">
          <Navigation size={18} />
          Starting location
        </h3>

        {state.origin ? (
          <div className="space-y-2 break-words font-mono text-sm">
            <p>
              Latitude: {state.origin.latitude}
            </p>

            <p>
              Longitude: {state.origin.longitude}
            </p>

            <p>
              Estimated accuracy:{' '}
              {Math.round(state.origin.accuracy)} m
            </p>

            <p className="font-sans text-slate-400">
              Captured: {dateOf(state.origin.capturedAt)}
            </p>
          </div>
        ) : (
          <p>No starting coordinates saved.</p>
        )}

        <button
          className="terminal-button-secondary"
          disabled={Boolean(working)}
          onClick={locate}
        >
          <RefreshCw size={15} />
          Refresh my location
        </button>
      </section>

      <section className="terminal-card space-y-3 p-4">
        <h3 className="flex items-center gap-2 font-semibold">
          <Upload size={18} />
          Delivery screenshots
        </h3>

        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="terminal-input"
          disabled={Boolean(working) || !canConnect}
          onChange={upload}
        />

        <p className="text-sm text-slate-400">
          {state.screenshotCount} screenshots ·{' '}
          {destinations.length} unique destinations.
          New screenshots replace the active address list.
        </p>

        <p role="status">
          {working
            ? `${working}…`
            : `Saved processing state: ${state.phase}`}
        </p>

        <button
          className="terminal-button-secondary"
          disabled={
            Boolean(working) ||
            !canConnect ||
            !state.origin ||
            !destinations.length
          }
          onClick={async () => {
            try {
              await generate();
            } catch (error) {
              await recordError(error);
            } finally {
              if (alive.current) {
                setWorking('');
              }
            }
          }}
        >
          Regenerate routes
        </button>
      </section>

      {(localError || view.error || state.error) && (
        <div
          role="alert"
          className="whitespace-pre-wrap rounded-xl border border-red-500/30 p-4 text-red-300"
        >
          {localError || view.error || state.error}
        </div>
      )}

      <section className="terminal-card space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          {['complete', 'incomplete'].map((tab) => (
            <button
              key={tab}
              className={
                state.tab === tab
                  ? 'terminal-button'
                  : 'terminal-button-secondary'
              }
              onClick={() =>
                patch((s) => ({ ...s, tab }))
              }
            >
              {tab === 'complete'
                ? `Complete (${state.complete.length})`
                : `Incomplete (${state.incomplete.length})`}
            </button>
          ))}
        </div>

        {state.tab === 'complete'
          ? destinations.map((stop, index) => (
              <div
                key={coordinateKey(stop)}
                className="rounded-lg border border-white/10 p-3"
              >
                <p>
                  {index + 1}. {stop.address}
                </p>

                <p className="text-xs text-slate-400">
                  {stop.services.length} services
                </p>
              </div>
            ))
          : state.incomplete.map((item, index) => (
              <div
                key={index}
                className="rounded-lg border border-amber-500/20 p-3"
              >
                <p>
                  {item.address || 'Address unavailable'}
                </p>

                <p className="text-sm text-amber-300">
                  {item.reason}
                </p>
              </div>
            ))}
      </section>

      {selected && (
        <section className="terminal-card space-y-4 p-4">
          <h3 className="font-semibold">
            Optimized routes
          </h3>

          <p>
            {segments.length} links ·{' '}
            {(Number(selected.distance_m) / 1000).toFixed(1)}
            {' '}km ·{' '}
            {Math.round(Number(selected.duration_s) / 60)}
            {' '}minutes driving
          </p>

          {segments.map((segment, index) => {
            const label =
              `Route ${index + 1} of ${segments.length}`;

            const visited = stops.filter(
              (stop) =>
                stop.sequence > segment.start_stop &&
                stop.sequence <= segment.end_stop
            );

            const from = stops.find(
              (stop) =>
                stop.sequence === segment.start_stop
            );

            return (
              <article
                key={segment.id}
                className="space-y-3 rounded-xl border border-white/10 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">
                    {label}
                  </h4>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(segment.completed)}
                      onChange={() =>
                        patch((s) => ({
                          ...s,
                          plans: s.plans.map((plan) =>
                            plan.id !== selected.id
                              ? plan
                              : {
                                  ...plan,
                                  segments: plan.segments.map(
                                    (item) =>
                                      item.id === segment.id
                                        ? {
                                            ...item,
                                            completed: !item.completed,
                                          }
                                        : item
                                  ),
                                }
                          ),
                        }))
                      }
                    />
                    Done
                  </label>
                </div>

                <p className="text-sm text-slate-400">
                  From: {from?.address}
                  {' · '}
                  {visited.length} destinations
                </p>

                <a
                  href={segment.google_maps_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="terminal-button inline-flex items-center gap-2"
                >
                  Open {label} in Google Maps
                  <ExternalLink size={16} />
                </a>

                <details>
                  <summary>View destinations</summary>

                  <ol className="mt-2 space-y-2">
                    {visited.map((stop, n) => (
                      <li key={stop.sequence}>
                        {n + 1}. {stop.address}
                      </li>
                    ))}
                  </ol>
                </details>
              </article>
            );
          })}
        </section>
      )}

      {state.plans.length > 0 && (
        <section className="terminal-card space-y-3 p-4">
          <h3 className="font-semibold">
            Saved journeys
          </h3>

          <div className="flex flex-wrap gap-2">
            {state.plans.map((plan) => (
              <button
                key={plan.id}
                className={
                  plan.id === state.selectedId
                    ? 'terminal-button'
                    : 'terminal-button-secondary'
                }
                onClick={() =>
                  patch((s) => ({
                    ...s,
                    selectedId: plan.id,
                  }))
                }
              >
                Journey #{plan.id} ·{' '}
                {plan.segments?.length || 0} routes
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}