import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  Upload,
  Navigation,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

import {
  fetchRoutePlans,
  createRoutePlan,
  updateRouteSegment,
  parseRouteScreenshots,
} from '../services/api';

const DESTINATIONS_PER_ROUTE = 10;

function validCoordinates(stop) {
  if (
    stop?.latitude == null ||
    stop?.longitude == null ||
    stop.latitude === '' ||
    stop.longitude === ''
  ) {
    return false;
  }

  const latitude = Number(stop.latitude);
  const longitude = Number(stop.longitude);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

function coordinateKey(stop) {
  return (
    `${Number(stop.latitude).toFixed(6)},` +
    `${Number(stop.longitude).toFixed(6)}`
  );
}

function groupDestinations(services) {
  const groups = new Map();

  for (const service of services) {
    if (!validCoordinates(service)) {
      continue;
    }

    const key = coordinateKey(service);

    if (!groups.has(key)) {
      groups.set(key, {
        address: service.address,
        latitude: Number(service.latitude),
        longitude: Number(service.longitude),
        services: [],
      });
    }

    groups.get(key).services.push({
      service_type: service.service_type || 'unknown',
    });
  }

  return [...groups.values()];
}

function describeError(error) {
  const response = error.response?.data;

  const message =
    (typeof response?.error === 'string' && response.error) ||
    error.message ||
    'The request failed.';

  const lines = [message];

  if (response?.code) {
    lines.push(`Code: ${response.code}`);
  }

  if (response?.request_id) {
    lines.push(`Request ID: ${response.request_id}`);
  }

  if (Array.isArray(response?.attempts)) {
    for (const attempt of response.attempts) {
      const status = attempt.upstream_http_status
        ? `HTTP ${attempt.upstream_http_status}`
        : attempt.stage;

      lines.push(
        `${attempt.model}: ${status}` +
          (attempt.message ? ` — ${attempt.message}` : '')
      );
    }
  }

  return lines.join('\n');
}

function sortedSegments(plan) {
  return [...(plan?.segments || [])].sort(
    (a, b) => a.sequence - b.sequence
  );
}

function serviceCounts(services) {
  const deliveries = services.filter(
    (service) => service.service_type === 'delivery'
  ).length;

  const pickups = services.filter(
    (service) => service.service_type === 'pickup'
  ).length;

  return {
    deliveries,
    pickups,
    unknown: services.length - deliveries - pickups,
  };
}

export default function RoutePlannerTab() {
  const [complete, setComplete] = useState([]);
  const [incomplete, setIncomplete] = useState([]);
  const [plans, setPlans] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [origin, setOrigin] = useState(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');

  const [parsing, setParsing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [updating, setUpdating] = useState(false);

  const [screenshotCount, setScreenshotCount] = useState(0);
  const [tab, setTab] = useState('complete');
  const [error, setError] = useState('');
  const [retryGeneration, setRetryGeneration] = useState(0);

  const aliveRef = useRef(false);
  const locationSequenceRef = useRef(0);
  const uploadSequenceRef = useRef(0);
  const uploadBusyRef = useRef(false);

  const destinations = useMemo(
    () => groupDestinations(complete),
    [complete]
  );

  const usableDestinations = useMemo(() => {
    if (!origin) {
      return destinations;
    }

    const startKey = coordinateKey(origin);

    // A service at the starting position needs no driving stop.
    return destinations.filter(
      (stop) => coordinateKey(stop) !== startKey
    );
  }, [origin, destinations]);

  const servicesAtStart = useMemo(() => {
    if (!origin) {
      return 0;
    }

    const startKey = coordinateKey(origin);

    return complete.filter(
      (service) =>
        validCoordinates(service) &&
        coordinateKey(service) === startKey
    ).length;
  }, [origin, complete]);

  const expectedRouteCount = Math.ceil(
    usableDestinations.length / DESTINATIONS_PER_ROUTE
  );

  const busy = parsing || generating || updating;

  const requestLocation = useCallback(() => {
    const sequence = ++locationSequenceRef.current;

    setOrigin(null);
    setLocationMessage('');
    setError('');

    if (!window.isSecureContext) {
      setLocationBusy(false);
      setLocationMessage(
        'Open the platform over HTTPS or localhost to allow location access.'
      );
      return;
    }

    if (!navigator.geolocation) {
      setLocationBusy(false);
      setLocationMessage(
        'This browser does not support location access.'
      );
      return;
    }

    setLocationBusy(true);
    setLocationMessage('Getting your current location...');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (
          !aliveRef.current ||
          sequence !== locationSequenceRef.current
        ) {
          return;
        }

        // Preserve the original coordinates returned by the browser.
        // Do not round them or convert them into a street address.
        const point = {
          address: 'My current location',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: position.timestamp,
        };

        if (!validCoordinates(point)) {
          setLocationBusy(false);
          setLocationMessage(
            'The browser returned invalid location coordinates. Try again.'
          );
          return;
        }

        setOrigin(point);
        setLocationBusy(false);
        setLocationMessage(
          'Your current coordinates are selected as the starting point.'
        );
      },
      (locationError) => {
        if (
          !aliveRef.current ||
          sequence !== locationSequenceRef.current
        ) {
          return;
        }

        const messages = {
          1: 'Location permission was denied. Allow location access in your browser and try again.',
          2: 'Your location is currently unavailable. Try again from your delivery device.',
          3: 'Getting your location timed out. Try again.',
        };

        setLocationBusy(false);
        setLocationMessage(
          messages[locationError.code] ||
            'Unable to obtain your current location.'
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 60000,
      }
    );
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    requestLocation();

    let cancelled = false;

    fetchRoutePlans()
      .then((data) => {
        if (cancelled || !aliveRef.current) {
          return;
        }

        const incoming = Array.isArray(data) ? data : [];

        // Preserve a newly generated journey if this fetch finishes later.
        setPlans((current) => {
          const merged = new Map(
            incoming.map((plan) => [plan.id, plan])
          );

          for (const plan of current) {
            merged.set(plan.id, plan);
          }

          return [...merged.values()].sort(
            (a, b) => b.id - a.id
          );
        });
      })
      .catch((err) => {
        if (!cancelled && aliveRef.current) {
          setError(describeError(err));
        }
      });

    return () => {
      cancelled = true;
      aliveRef.current = false;
      locationSequenceRef.current += 1;
      uploadSequenceRef.current += 1;
    };
  }, [requestLocation]);

  const routePayload = useMemo(() => {
    if (
      !origin ||
      !usableDestinations.length ||
      parsing
    ) {
      return null;
    }

    return {
      round_trip: false,
      stops: [
        {
          address: 'My current location',

          // Original numeric coordinates, unchanged.
          latitude: origin.latitude,
          longitude: origin.longitude,

          services: [],
        },
        ...usableDestinations,
      ],
    };
  }, [origin, usableDestinations, parsing]);

  useEffect(() => {
    let cancelled = false;

    setGenerating(false);

    if (!routePayload) {
      return;
    }

    if (routePayload.stops.length > 150) {
      setError(
        'The current routing service supports up to 149 unique destinations plus your starting location.'
      );
      return;
    }

    setSelectedId(null);
    setGenerating(true);
    setError('');

    const timer = window.setTimeout(async () => {
      try {
        const plan = await createRoutePlan(routePayload);

        if (cancelled || !aliveRef.current) {
          return;
        }

        if (
          !plan?.id ||
          !Array.isArray(plan.segments) ||
          !plan.segments.length
        ) {
          throw new Error(
            'The backend returned no Google Maps routes.'
          );
        }

        setPlans((current) => [
          plan,
          ...current.filter((item) => item.id !== plan.id),
        ]);

        setSelectedId(plan.id);
      } catch (err) {
        if (!cancelled && aliveRef.current) {
          setError(describeError(err));
        }
      } finally {
        if (!cancelled && aliveRef.current) {
          setGenerating(false);
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [routePayload, retryGeneration]);

  const uploadScreenshots = async (event) => {
    const chosen = Array.from(event.target.files || []);

    // Allow selecting the same screenshots again.
    event.target.value = '';

    if (!chosen.length || uploadBusyRef.current) {
      return;
    }

    if (chosen.length > 10) {
      setError('Select at most 10 screenshots per batch.');
      return;
    }

    if (chosen.some((file) => file.size > 10 * 1024 * 1024)) {
      setError('Each screenshot must be at most 10 MiB.');
      return;
    }

    const sequence = ++uploadSequenceRef.current;
    uploadBusyRef.current = true;

    setParsing(true);
    setError('');
    setSelectedId(null);
    setComplete([]);
    setIncomplete([]);
    setScreenshotCount(chosen.length);

    try {
      const result = await parseRouteScreenshots(chosen);

      if (
        !aliveRef.current ||
        sequence !== uploadSequenceRef.current
      ) {
        return;
      }

      if (
        !Array.isArray(result?.complete) &&
        !Array.isArray(result?.uncomplete)
      ) {
        throw new Error(
          'The backend returned an unexpected screenshot extraction response.'
        );
      }

      const parsedComplete = Array.isArray(result.complete)
        ? result.complete
        : [];

      const parsedIncomplete = Array.isArray(result.uncomplete)
        ? result.uncomplete
        : [];

      const verified = [];
      const invalid = [];

      for (const service of parsedComplete) {
        if (
          validCoordinates(service) &&
          typeof service.address === 'string' &&
          service.address.trim()
        ) {
          verified.push(service);
        } else {
          invalid.push({
            ...service,
            status: 'uncomplete',
            reason: 'Missing address or invalid coordinates.',
          });
        }
      }

      setComplete(verified);
      setIncomplete([...parsedIncomplete, ...invalid]);
      setTab('complete');

      if (!verified.length) {
        setError(
          'No verified destinations were found. Upload clearer screenshots to try again.'
        );
      }
    } catch (err) {
      if (
        aliveRef.current &&
        sequence === uploadSequenceRef.current
      ) {
        setError(describeError(err));
      }
    } finally {
      uploadBusyRef.current = false;

      if (
        aliveRef.current &&
        sequence === uploadSequenceRef.current
      ) {
        setParsing(false);
      }
    }
  };

  const toggleRoute = async (segment) => {
    if (!selectedId || updating) {
      return;
    }

    const planId = selectedId;
    setUpdating(true);
    setError('');

    try {
      await updateRouteSegment(
        planId,
        segment.id,
        !segment.completed
      );

      if (!aliveRef.current) {
        return;
      }

      setPlans((current) =>
        current.map((plan) =>
          plan.id === planId
            ? {
                ...plan,
                segments: (plan.segments || []).map((item) =>
                  item.id === segment.id
                    ? {
                        ...item,
                        completed: !segment.completed,
                      }
                    : item
                ),
              }
            : plan
        )
      );
    } catch (err) {
      if (aliveRef.current) {
        setError(describeError(err));
      }
    } finally {
      if (aliveRef.current) {
        setUpdating(false);
      }
    }
  };

  const selected = plans.find(
    (plan) => plan.id === selectedId
  );

  const segments = sortedSegments(selected);

  const orderedStops = [...(selected?.stops || [])].sort(
    (a, b) => a.sequence - b.sequence
  );

  const completedRoutes = segments.filter(
    (segment) => segment.completed
  ).length;

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-2xl font-bold">Route Planner</h2>

        <p className="mt-1 text-sm text-slate-400">
          Select screenshots. Addresses and optimized routes are
          generated automatically.
        </p>
      </header>

      <section className="terminal-card space-y-3 p-4">
        <h3 className="flex items-center gap-2 font-semibold">
          <Navigation size={18} />
          Starting location
        </h3>

        {origin && (
          <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="font-semibold">
              My current location
            </p>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-400">
                  Latitude
                </dt>

                <dd className="mt-1 break-all font-mono tabular-nums text-emerald-300">
                  {origin.latitude}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-slate-400">
                  Longitude
                </dt>

                <dd className="mt-1 break-all font-mono tabular-nums text-emerald-300">
                  {origin.longitude}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-slate-400">
                  Estimated accuracy
                </dt>

                <dd className="mt-1 tabular-nums">
                  {Number.isFinite(origin.accuracy)
                    ? `Within approximately ${Math.round(origin.accuracy)} m`
                    : 'Unavailable'}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-slate-400">
                  Location captured
                </dt>

                <dd className="mt-1">
                  {new Date(origin.capturedAt).toLocaleString()}
                </dd>
              </div>
            </dl>

            <p className="text-xs text-slate-400">
              These coordinates are used directly as your starting
              point, without converting them into a street address.
            </p>
          </div>
        )}

        <p
          role="status"
          aria-live="polite"
          className="text-sm text-slate-400"
        >
          {locationMessage ||
            'Allow browser location access to set your starting point.'}
        </p>

        <button
          type="button"
          className="terminal-button-secondary"
          disabled={busy || locationBusy}
          onClick={requestLocation}
        >
          <Navigation size={16} />

          {locationBusy
            ? 'Getting location...'
            : 'Refresh my location'}
        </button>
      </section>

      <section className="terminal-card space-y-4 p-4">
        <h3 className="flex items-center gap-2 font-semibold">
          <Upload size={18} />
          Delivery screenshots
        </h3>

        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          aria-label="Select delivery screenshots"
          className="terminal-input"
          disabled={busy}
          onChange={uploadScreenshots}
        />

        <p className="text-xs text-slate-400">
          Select up to 10 screenshots. Processing starts immediately.
          A new selection replaces the current batch.
        </p>

        <div
          role="status"
          aria-live="polite"
          className="text-sm text-cyan-300"
        >
          {parsing ? (
            <>Extracting and verifying addresses...</>
          ) : generating ? (
            <>
              Optimizing destinations and generating Google Maps links...
            </>
          ) : screenshotCount > 0 ? (
            <>
              {screenshotCount} screenshots ·{' '}
              {usableDestinations.length} driving destinations ·{' '}
              {expectedRouteCount} expected routes
            </>
          ) : (
            <>Waiting for screenshots.</>
          )}
        </div>

        {servicesAtStart > 0 && (
          <p className="text-xs text-slate-400">
            {servicesAtStart} services are already at your starting
            location and need no driving stop.
          </p>
        )}

        {origin && usableDestinations.length > 0 && !busy && (
          <button
            type="button"
            className="terminal-button-secondary"
            onClick={() =>
              setRetryGeneration((current) => current + 1)
            }
          >
            <RefreshCw size={15} />
            Regenerate routes
          </button>
        )}
      </section>

      {error && (
        <div
          role="alert"
          className="whitespace-pre-wrap break-words rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      <section className="terminal-card space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={
              tab === 'complete'
                ? 'terminal-button'
                : 'terminal-button-secondary'
            }
            onClick={() => setTab('complete')}
          >
            <CheckCircle2 size={16} />
            Complete ({complete.length})
          </button>

          <button
            type="button"
            className={
              tab === 'incomplete'
                ? 'terminal-button'
                : 'terminal-button-secondary'
            }
            onClick={() => setTab('incomplete')}
          >
            <AlertTriangle size={16} />
            Incomplete ({incomplete.length})
          </button>
        </div>

        {tab === 'complete' ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              {complete.length} services across{' '}
              {destinations.length} unique destinations.
              Verified destinations are included automatically.
            </p>

            {!destinations.length && (
              <p className="text-sm text-slate-400">
                Verified addresses will appear here.
              </p>
            )}

            {destinations.map((stop, index) => {
              const counts = serviceCounts(stop.services);

              return (
                <div
                  key={coordinateKey(stop)}
                  className="rounded-xl border border-white/10 p-3"
                >
                  <p className="text-sm font-semibold">
                    {index + 1}. {stop.address}
                  </p>

                  <p className="mt-1 text-xs text-slate-400">
                    {counts.deliveries} deliveries ·{' '}
                    {counts.pickups} pickups
                    {counts.unknown > 0 &&
                      ` · ${counts.unknown} unknown`}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              These addresses are excluded. Upload clearer
              screenshots if you want to retry extraction;
              no manual typing is required.
            </p>

            {!incomplete.length && (
              <p className="text-sm text-slate-400">
                No incomplete addresses.
              </p>
            )}

            {incomplete.map((item, index) => (
              <div
                key={`${index}-${item.service_type}`}
                className="space-y-2 rounded-xl border border-amber-500/20 p-3"
              >
                <p className="text-sm font-semibold">
                  {item.address ||
                    'Address could not be extracted'}
                </p>

                <p className="text-xs text-amber-300">
                  {item.reason ||
                    'Address could not be verified.'}
                </p>

                <p className="text-xs text-slate-400">
                  Service: {item.service_type || 'unknown'}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {selected && !parsing && !generating && (
        <section className="terminal-card space-y-4 p-4">
          <h3 className="text-lg font-semibold">
            Optimized routes
          </h3>

          <p className="text-sm text-slate-400">
            {segments.length} Google Maps links ·{' '}
            {(Number(selected.distance_m || 0) / 1000).toFixed(1)} km
            {' · '}
            {Math.round(Number(selected.duration_s || 0) / 60)}
            {' '}minutes driving
          </p>

          <p className="text-xs text-slate-400">
            Follow the routes in order. Each starts where the
            previous route ends.{' '}
            {completedRoutes}/{segments.length} completed.
          </p>

          <div className="space-y-3">
            {segments.map((segment, index) => {
              const start = orderedStops.find(
                (stop) =>
                  stop.sequence === segment.start_stop
              );

              const end = orderedStops.find(
                (stop) =>
                  stop.sequence === segment.end_stop
              );

              const visited = orderedStops.filter(
                (stop) =>
                  stop.sequence > segment.start_stop &&
                  stop.sequence <= segment.end_stop
              );

              const serviceCount = visited.reduce(
                (total, stop) =>
                  total + (stop.services?.length || 0),
                0
              );

              const label =
                `Route ${index + 1} of ${segments.length}`;

              return (
                <article
                  key={segment.id}
                  className="space-y-3 rounded-xl border border-white/10 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="font-semibold">
                      {label}
                    </h4>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(segment.completed)}
                        disabled={busy}
                        onChange={() => toggleRoute(segment)}
                      />
                      Done
                    </label>
                  </div>

                  <p className="text-xs text-slate-400">
                    {visited.length} destinations ·{' '}
                    {serviceCount} services
                  </p>

                  <p className="text-sm">
                    <span className="text-slate-400">
                      From:{' '}
                    </span>
                    {start?.address || 'Starting location'}
                  </p>

                  <p className="text-sm">
                    <span className="text-slate-400">
                      To:{' '}
                    </span>
                    {end?.address || 'Final destination'}
                  </p>

                  <a
                    href={segment.google_maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="terminal-button inline-flex items-center gap-2"
                  >
                    <Navigation size={17} />
                    Open {label} in Google Maps
                    <ExternalLink size={16} />
                  </a>

                  <details className="rounded-lg border border-white/10 p-3">
                    <summary className="cursor-pointer text-sm">
                      View optimized destinations
                    </summary>

                    <ol className="mt-3 space-y-2">
                      {visited.map((stop, stopIndex) => (
                        <li
                          key={stop.id ?? stop.sequence}
                          className="text-sm"
                        >
                          {stopIndex + 1}. {stop.address}
                        </li>
                      ))}
                    </ol>
                  </details>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {plans.length > 0 && (
        <section className="terminal-card space-y-3 p-4">
          <h3 className="font-semibold">
            Saved journeys
          </h3>

          <div className="flex flex-wrap gap-2">
            {plans.map((plan) => (
              <button
                type="button"
                key={plan.id}
                disabled={busy}
                onClick={() => setSelectedId(plan.id)}
                className={
                  selectedId === plan.id
                    ? 'terminal-button'
                    : 'terminal-button-secondary'
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