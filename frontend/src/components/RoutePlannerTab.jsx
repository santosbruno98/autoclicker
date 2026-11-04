import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { API } from '../services/http';
import { usePlanner } from '../services/plannerStore';
import RouteLocationPicker from './RouteLocationPicker';

const errorMessage = (error) =>
  error?.response?.data?.error ||
  error?.message ||
  'Request failed';

const correctionKey = (address) =>
  String(address || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const coordinateKey = (point) =>
  `${Number(point.latitude).toFixed(6)},` +
  `${Number(point.longitude).toFixed(6)}`;

function validPoint(point) {
  const latitude = point?.latitude;
  const longitude = point?.longitude;

  if (
    latitude == null ||
    longitude == null ||
    String(latitude).trim() === '' ||
    String(longitude).trim() === ''
  ) {
    return false;
  }

  return (
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude)) &&
    Math.abs(Number(latitude)) <= 90 &&
    Math.abs(Number(longitude)) <= 180 &&
    !(Number(latitude) === 0 && Number(longitude) === 0)
  );
}

function originalAddress(service) {
  return String(
    service?.original_address ||
    service?.address ||
    ''
  ).trim();
}

function resolutionProblems(service) {
  const resolution = service?.resolution;

  // Missing audit data must not be presented as AI resolution.
  // Existing exact-geocoder and user-confirmed results can still
  // follow their existing validation path.
  if (resolution?.method !== 'ai_candidate') {
    return [];
  }

  const problems = [];

  if (resolution.decision !== 'selected') {
    problems.push(
      'AI did not report an unambiguous candidate selection.'
    );
  }

  const matches = (service.candidates || []).filter(
    (candidate) =>
      candidate.id === resolution.selected_candidate_id
  );

  if (!resolution.selected_candidate_id || matches.length !== 1) {
    problems.push(
      'The AI selection does not identify exactly one returned candidate.'
    );
  } else {
    const candidate = matches[0];

    if (!validPoint(candidate)) {
      problems.push('The selected candidate has invalid coordinates.');
    } else if (
      !validPoint(service) ||
      Math.abs(
        Number(service.latitude) - Number(candidate.latitude)
      ) > 0.0000001 ||
      Math.abs(
        Number(service.longitude) - Number(candidate.longitude)
      ) > 0.0000001
    ) {
      problems.push(
        'The resolved coordinates differ from the selected candidate.'
      );
    }
  }

  return problems;
}

function normalizeService(service, index = 0) {
  const original = originalAddress(service);

  // Recover only a postcode literally present in the original text.
  // Never use a model-generated postcode as an invisible fallback.
  const visiblePostcodes = [
    ...new Set(original.match(/\b\d{4}-\d{3}\b/g) || []),
  ];

  const normalized = {
    ...service,
    id: service.id || `legacy-${index}`,
    original_address: original,
    address: service.address || original,
    postal_code:
      service.postal_code ||
      (visiblePostcodes.length === 1 ? visiblePostcodes[0] : ''),
    candidates: Array.isArray(service.candidates)
      ? service.candidates
      : [],
    parcel_count: Math.max(
      1,
      Number(service.parcel_count) || 1
    ),
  };

  const problems = resolutionProblems(normalized);

  if (problems.length) {
    normalized.status = 'needs_attention';
    normalized.reason = problems.join(' ');
  }

  return normalized;
}

function servicesOf(state) {
  if (Array.isArray(state?.services)) {
    return state.services.map(normalizeService);
  }

  // Previous "complete" flags are not enough to establish that the
  // newer address and road checks were performed.
  return [
    ...(state?.complete || []),
    ...(state?.incomplete || []),
  ].map((service, index) => normalizeService({
    ...service,
    stage: 'extracted',
    status: 'needs_attention',
    reason:
      'Saved under the previous validation policy. Retry this address.',
  }, index));
}

function readyToRoute(service) {
  return (
    service.status === 'ready' &&
    service.stage === 'ready' &&
    validPoint(service) &&
    validPoint({
      latitude: service.road_latitude,
      longitude: service.road_longitude,
    }) &&
    resolutionProblems(service).length === 0
  );
}

function withServices(state, services) {
  const normalized = services.map(normalizeService);

  return {
    ...state,
    services: normalized,
    complete: normalized.filter(readyToRoute),
    incomplete: normalized.filter(
      (service) =>
        !readyToRoute(service) &&
        service.status !== 'excluded'
    ),
    selectedId: null,
  };
}

function destinationsOf(services) {
  const grouped = new Map();

  for (const service of services) {
    if (!readyToRoute(service)) continue;

    const key = coordinateKey(service);

    if (!grouped.has(key)) {
      grouped.set(key, {
        address: originalAddress(service),
        latitude: Number(service.latitude),
        longitude: Number(service.longitude),
        services: [],
      });
    }

    grouped.get(key).services.push({
      id: service.id,
      service_type: service.service_type || 'unknown',
      parcel_count: service.parcel_count || 1,
    });
  }

  return [...grouped.values()];
}

function AddressMapsActions({ service }) {
  const address = originalAddress(service);

  const searchURL = address
    ? 'https://www.google.com/maps/search/?' +
      new URLSearchParams({
        api: '1',
        query: address,
      }).toString()
    : null;

  const directionsURL = readyToRoute(service)
    ? 'https://www.google.com/maps/dir/?' +
      new URLSearchParams({
        api: '1',
        destination:
          `${Number(service.latitude)},` +
          `${Number(service.longitude)}`,
        travelmode: 'driving',
      }).toString()
    : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {directionsURL && (
          <a
            href={directionsURL}
            target="_blank"
            rel="noopener noreferrer"
            className="terminal-button inline-flex"
          >
            Navigate to this destination
          </a>
        )}

        {searchURL && (
          <a
            href={searchURL}
            target="_blank"
            rel="noopener noreferrer"
            className="terminal-button-secondary inline-flex"
          >
            Search address in Google Maps
          </a>
        )}
      </div>

      {!directionsURL && searchURL && (
        <p className="text-xs text-amber-200">
          Opens an address search. The planner has not verified
          this destination.
        </p>
      )}
    </div>
  );
}

function ResolutionDetails({ service }) {
  const resolution = service.resolution;
  const problems = resolutionProblems(service);

  return (
    <details className="rounded-lg border border-white/10 p-3">
      <summary className="cursor-pointer">
        Address resolution details
      </summary>

      <div className="mt-3 space-y-3 text-sm">
        <dl className="space-y-1">
          <div>
            <dt className="inline text-slate-400">Original: </dt>
            <dd className="inline">{originalAddress(service)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-400">Street: </dt>
            <dd className="inline">{service.street || 'Missing'}</dd>
          </div>
          <div>
            <dt className="inline text-slate-400">House number: </dt>
            <dd className="inline">
              {service.house_number || 'Not established'}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-400">Postcode: </dt>
            <dd className="inline">
              {service.postal_code || 'Missing'}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-400">Locality: </dt>
            <dd className="inline">{service.locality || 'Missing'}</dd>
          </div>
          <div>
            <dt className="inline text-slate-400">Matched address: </dt>
            <dd className="inline">
              {service.matched_address || 'Not established'}
            </dd>
          </div>
        </dl>

        {resolution ? (
          <>
            <p>Method: {resolution.method || 'Not recorded'}</p>
            <p>Decision: {resolution.decision || 'Not recorded'}</p>

            {resolution.model && (
              <p>Model: {resolution.model}</p>
            )}

            {resolution.selected_candidate_id && (
              <p className="break-all">
                Selected candidate: {resolution.selected_candidate_id}
              </p>
            )}

            {resolution.reason && (
              <p>Explanation: {resolution.reason}</p>
            )}

            {resolution.normalized_address && (
              <p>Normalized query: {resolution.normalized_address}</p>
            )}

            {Array.isArray(resolution.search_queries) &&
              resolution.search_queries.length > 0 && (
                <div>
                  <p className="font-semibold">Queries used</p>
                  <ul className="list-inside list-disc">
                    {resolution.search_queries.map((query, index) => (
                      <li key={index}>{query}</li>
                    ))}
                  </ul>
                </div>
              )}

            {Array.isArray(resolution.field_sources) &&
              resolution.field_sources.length > 0 && (
                <div>
                  <p className="font-semibold">Field evidence</p>
                  <ul className="space-y-2">
                    {resolution.field_sources.map((entry, index) => (
                      <li key={index}>
                        {entry.field}: {entry.value}
                        {' · '}
                        {entry.source}
                        {entry.evidence ? ` · ${entry.evidence}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </>
        ) : (
          <p className="text-amber-200">
            The backend supplied no AI-resolution audit.
            This page cannot establish that candidate comparison
            was performed by Gemini.
          </p>
        )}

        {problems.map((problem) => (
          <p key={problem} className="text-red-300">
            {problem}
          </p>
        ))}

        {validPoint(service) && (
          <p className="break-all font-mono text-xs">
            Original point: {service.latitude}, {service.longitude}
          </p>
        )}

        {validPoint({
          latitude: service.road_latitude,
          longitude: service.road_longitude,
        }) && (
          <p className="break-all font-mono text-xs">
            Road point: {service.road_latitude},{' '}
            {service.road_longitude}
            {' · '}
            {Math.round(Number(service.snap_distance_m) || 0)} m
            from original
          </p>
        )}
      </div>
    </details>
  );
}

export default function RoutePlannerTab() {
  const { store, view, identity } = usePlanner();

  const [online, setOnline] = useState(navigator.onLine);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(null);

  const busy = useRef(false);

  const state = view.record?.state;
  const canConnect = online && !identity.localOnly;

  const services = useMemo(() => servicesOf(state), [state]);

  const readyServices = services.filter(readyToRoute);

  const attention = services.filter(
    (service) =>
      !readyToRoute(service) &&
      service.status !== 'excluded'
  );

  const excluded = services.filter(
    (service) => service.status === 'excluded'
  );

  const destinations = useMemo(
    () => destinationsOf(services),
    [services]
  );

  const selected = state?.plans?.find(
    (plan) => plan.id === state.selectedId
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);

    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  async function perform(label, action) {
    if (busy.current) return;

    busy.current = true;
    setWorking(label);
    setError('');

    try {
      await action();
    } catch (failure) {
      const message = errorMessage(failure);
      setError(message);

      if (failure.response?.status === 401) {
        window.dispatchEvent(new Event('auth:expired'));
      }

      if (store.getSnapshot().record) {
        try {
          await store.change((current) => ({
            ...current,
            error: message,
          }));
        } catch {
          // The persistence layer displays its own failures.
        }
      }
    } finally {
      busy.current = false;
      setWorking('');
    }
  }

  async function replaceService(next) {
    await store.change((current) => ({
      ...withServices(
        current,
        servicesOf(current).map((service) =>
          service.id === next.id
            ? normalizeService(next)
            : service
        )
      ),
      error: '',
    }));
  }

  async function reviewService(service, confirmation = null) {
    if (!canConnect) {
      throw new Error(
        'Reconnect and sign in to verify locations.'
      );
    }

    const { data } = await API.post(
      '/routes/verify-address',
      {
        service: normalizeService(service),
        ...(confirmation ? { confirm: confirmation } : {}),
      },
      { timeout: 55000 }
    );

    if (!data?.service?.id) {
      throw new Error(
        'Backend returned an invalid review response. ' +
        'The updated address-review endpoint is required.'
      );
    }

    return normalizeService(data.service);
  }

  async function retryService(service, preservePin = false) {
    const confirmation = preservePin
      ? service.confirmation || null
      : null;

    await replaceService(
      await reviewService(service, confirmation)
    );
  }

  async function confirmService(service, point) {
    const confirmation = {
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
    };

    if (!validPoint(confirmation)) {
      throw new Error('Invalid selected coordinates.');
    }

    await store.change((current) => ({
      ...withServices(
        current,
        servicesOf(current).map((item) =>
          item.id === service.id
            ? {
                ...item,
                ...confirmation,
                confirmation,
                confirmed: true,
                road_latitude: null,
                road_longitude: null,
                stage: 'geocoded',
                status: 'needs_attention',
                reason:
                  'Selected location saved; road validation pending',
                resolution: {
                  method: 'user_pin',
                  decision: 'selected',
                  reason: 'Location explicitly selected by the user',
                },
              }
            : item
        )
      ),
      corrections: {
        ...(current.corrections || {}),
        [correctionKey(originalAddress(service))]: {
          ...confirmation,
          confirmed_at: new Date().toISOString(),
          source: 'user',
        },
      },
    }));

    setPicker(null);

    if (canConnect) {
      const reviewed = await reviewService(
        {
          ...service,
          resolution: null,
        },
        confirmation
      );

      await replaceService({
        ...reviewed,
        resolution: {
          method: 'user_pin',
          decision: 'selected',
          reason: 'Location explicitly selected by the user',
        },
      });
    }
  }

  async function saveOrigin(point) {
    if (!validPoint(point)) {
      throw new Error('Invalid starting coordinates.');
    }

    await store.change((current) => ({
      ...current,
      origin: {
        ...point,
        capturedAt: Date.now(),
      },
      originError: '',
      selectedId: null,
      error: '',
    }));

    setPicker(null);
  }

  async function locate() {
    if (!navigator.geolocation || !window.isSecureContext) {
      throw new Error(
        'Location requires HTTPS or localhost.'
      );
    }

    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0,
        }
      );
    });

    await saveOrigin({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    });
  }

  useEffect(() => {
    if (
      view.phase === 'active' &&
      view.fresh &&
      !busy.current &&
      store.consumeFresh()
    ) {
      void perform('Getting your location', locate);
    }
  }, [view.phase, view.fresh, store]);

  async function generate(snapshot, allowPartial = false) {
    if (!canConnect) {
      throw new Error(
        'Reconnect and sign in to generate routes.'
      );
    }

    const current =
      snapshot || store.getSnapshot().record.state;

    const currentServices = servicesOf(current);

    const unresolved = currentServices.filter(
      (service) =>
        !readyToRoute(service) &&
        service.status !== 'excluded'
    );

    const omitted = currentServices.filter(
      (service) => service.status === 'excluded'
    );

    if (
      (unresolved.length || omitted.length) &&
      !allowPartial
    ) {
      throw new Error(
        'Review outstanding services or explicitly generate ' +
        'routes for the remaining destinations.'
      );
    }

    if (!validPoint(current.origin)) {
      throw new Error(
        'Refresh or choose the starting location.'
      );
    }

    const ready = destinationsOf(currentServices).filter(
      (destination) =>
        coordinateKey(destination) !==
        coordinateKey(current.origin)
    );

    if (!ready.length) {
      throw new Error(
        'There are no ready destinations beyond the starting point.'
      );
    }

    if (ready.length > 149) {
      throw new Error(
        'Use at most 149 unique destinations.'
      );
    }

    await store.change((value) => ({
      ...value,
      selectedId: null,
      error: '',
      originError: '',
      phase: 'optimizing',
    }));

    try {
      const { data: plan } = await API.post(
        '/routes',
        {
          round_trip: false,
          stops: [
            {
              address: 'Starting location',
              latitude: Number(current.origin.latitude),
              longitude: Number(current.origin.longitude),
              services: [],
            },
            ...ready,
          ],
        },
        { timeout: 190000 }
      );

      if (!plan?.id || !plan.segments?.length) {
        throw new Error('Backend returned no route links.');
      }

      await store.change((value) => ({
        ...value,
        phase: 'ready',
        selectedId: plan.id,
        error: '',
        plans: [
          plan,
          ...(value.plans || []).filter(
            (item) => item.id !== plan.id
          ),
        ].slice(0, 30),
      }));
    } catch (failure) {
      const issues = failure.response?.data?.issues || [];
      const rejected = new Map();
      let originError = '';

      for (const issue of issues) {
        if (issue.is_origin) {
          originError =
            issue.message ||
            'Starting location needs attention';
        }

        for (const id of issue.service_ids || []) {
          rejected.set(
            id,
            issue.message || 'Location needs attention'
          );
        }
      }

      await store.change((value) => ({
        ...withServices(
          value,
          servicesOf(value).map((service) =>
            rejected.has(service.id)
              ? {
                  ...service,
                  stage: 'geocoded',
                  status: 'needs_attention',
                  reason: rejected.get(service.id),
                }
              : service
          )
        ),
        phase: 'needs_attention',
        originError,
        error: errorMessage(failure),
      }));

      throw failure;
    }
  }

  async function upload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';

    if (!files.length || busy.current) return;

    await perform(
      'Extracting and checking addresses',
      async () => {
        if (!canConnect) {
          throw new Error('Reconnect and sign in first.');
        }

        if (
          files.length > 10 ||
          files.some(
            (file) => file.size > 10 * 1024 * 1024
          )
        ) {
          throw new Error(
            'Choose up to 10 screenshots, each at most 10 MiB.'
          );
        }

        const form = new FormData();
        files.forEach((file) => form.append('files', file));

        const { data } = await API.post(
          '/routes/parse',
          form,
          { timeout: 250000 }
        );

        if (!Array.isArray(data.services)) {
          throw new Error(
            'The updated backend extraction response is required.'
          );
        }

        // Persist extraction before attempting saved corrections.
        await store.change((current) => ({
          ...withServices(current, data.services),
          screenshotCount: files.length,
          phase: 'extracted',
          error: '',
        }));

        const current = store.getSnapshot().record.state;
        const corrections = current.corrections || {};

        for (const service of servicesOf(current)) {
          const correction =
            corrections[correctionKey(originalAddress(service))];

          if (!correction) continue;

          try {
            const reviewed = await reviewService(
              {
                ...service,
                resolution: null,
              },
              correction
            );

            await replaceService({
              ...reviewed,
              resolution: {
                method: 'user_pin',
                decision: 'selected',
                reason: 'Previously confirmed location reused',
              },
            });
          } catch {
            await replaceService({
              ...service,
              latitude: correction.latitude,
              longitude: correction.longitude,
              confirmation: {
                latitude: correction.latitude,
                longitude: correction.longitude,
              },
              road_latitude: null,
              road_longitude: null,
              stage: 'geocoded',
              status: 'needs_attention',
              reason:
                'Saved correction could not be checked; retry',
              resolution: {
                method: 'user_pin',
                decision: 'selected',
                reason: 'Saved pin awaiting road validation',
              },
            });
          }
        }

        const latest = store.getSnapshot().record.state;
        const reviewed = servicesOf(latest);

        if (
          reviewed.length > 0 &&
          reviewed.every(readyToRoute) &&
          validPoint(latest.origin)
        ) {
          await generate(latest);
        }
      }
    );
  }

  function mapInitial(service) {
    if (validPoint(service)) return service;

    const candidate = service?.candidates?.find(validPoint);
    if (candidate) return candidate;

    if (validPoint(state?.origin)) return state.origin;

    // Initial viewport only. It is never accepted automatically.
    return {
      latitude: 40.537,
      longitude: -7.268,
    };
  }

  async function startNew() {
    // The supplied planner store retains confirmed corrections.
    await store.startNew();
    setPicker(null);
  }

  if (view.phase === 'loading') {
    return (
      <p role="status">Loading saved route planner…</p>
    );
  }

  if (view.phase === 'error') {
    return <p role="alert">{view.error}</p>;
  }

  if (view.phase === 'choice') {
    return (
      <section className="terminal-card space-y-4 p-5">
        <h2 className="text-xl font-semibold">
          Restore your previous journey?
        </h2>

        <p>{view.status}</p>

        {view.candidate && (
          <button
            className="terminal-button"
            disabled={Boolean(working)}
            onClick={() => perform(
              'Restoring',
              () => store.continuePrevious()
            )}
          >
            Continue previous journey
          </button>
        )}

        <button
          className="terminal-button-secondary"
          disabled={Boolean(working)}
          onClick={() => perform(
            'Starting journey',
            startNew
          )}
        >
          Start new journey
        </button>

        {error && <p role="alert">{error}</p>}
      </section>
    );
  }

  const shownServices = services.filter((service) => {
    if (state.tab === 'incomplete') {
      return (
        !readyToRoute(service) &&
        service.status !== 'excluded'
      );
    }

    if (state.tab === 'excluded') {
      return service.status === 'excluded';
    }

    return readyToRoute(service);
  });

  const tabs = [
    ['complete', `Ready to route (${readyServices.length})`],
    ['incomplete', `Needs attention (${attention.length})`],
    ['excluded', `Excluded (${excluded.length})`],
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">
            Route Planner
          </h2>
          <p role="status">
            {working || view.status}
          </p>
        </div>

        <button
          className="terminal-button-secondary"
          disabled={Boolean(working)}
          onClick={() => store.emit({
            phase: 'choice',
            candidate: view.record,
          })}
        >
          Start new journey
        </button>
      </header>

      {!canConnect && (
        <div className="terminal-card p-4 text-amber-200">
          Saved local journey. Addresses and route links remain
          available. Corrections are saved on this device.
          Verification and new routes require connectivity and sign-in.
        </div>
      )}

      {view.conflict && (
        <section className="terminal-card space-y-3 p-4">
          <p>A newer cloud copy exists.</p>

          <button
            disabled={Boolean(working)}
            className="terminal-button"
            onClick={() => perform(
              'Loading cloud copy',
              () => store.useCloud()
            )}
          >
            Use cloud copy
          </button>

          <button
            disabled={Boolean(working)}
            className="terminal-button-secondary"
            onClick={() => perform(
              'Keeping device copy',
              () => store.keepDevice()
            )}
          >
            Keep this device copy
          </button>
        </section>
      )}

      <section className="terminal-card space-y-3 p-4">
        <h3 className="font-semibold">
          Starting location
        </h3>

        {state.origin ? (
          <div className="break-all font-mono text-sm">
            <p>Latitude: {state.origin.latitude}</p>
            <p>Longitude: {state.origin.longitude}</p>

            {state.origin.accuracy != null && (
              <p>
                Estimated accuracy:{' '}
                {Math.round(state.origin.accuracy)} m
              </p>
            )}

            <p>
              Captured:{' '}
              {new Date(
                state.origin.capturedAt
              ).toLocaleString()}
            </p>
          </div>
        ) : (
          <p>No starting location saved.</p>
        )}

        <p className="text-sm text-slate-400">
          Rechecked against the road network for every new journey.
        </p>

        {state.originError && (
          <p role="alert" className="text-red-300">
            {state.originError}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            className="terminal-button-secondary"
            disabled={Boolean(working)}
            onClick={() => perform(
              'Getting your location',
              locate
            )}
          >
            Refresh my location
          </button>

          <button
            className="terminal-button-secondary"
            disabled={Boolean(working) || !online}
            onClick={() => setPicker({
              origin: true,
              initial: mapInitial(state.origin),
            })}
          >
            Choose starting point on map
          </button>
        </div>
      </section>

      {picker && (
        <RouteLocationPicker
          key={picker.origin ? 'origin' : picker.service.id}
          title={
            picker.origin
              ? 'Choose starting location'
              : originalAddress(picker.service)
          }
          initial={picker.initial}
          onCancel={() => setPicker(null)}
          onConfirm={(point) => perform(
            'Saving selected location',
            () => picker.origin
              ? saveOrigin(point)
              : confirmService(picker.service, point)
          )}
        />
      )}

      <section className="terminal-card space-y-3 p-4">
        <h3 className="font-semibold">
          Delivery screenshots
        </h3>

        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          disabled={Boolean(working) || !canConnect}
          onChange={upload}
          className="terminal-input"
        />

        <p className="text-sm text-slate-400">
          New screenshots replace the current batch.
          Separate services at one address are retained.
        </p>

        <p>
          {destinations.length} ready destinations ·{' '}
          {attention.length} services need attention ·{' '}
          {excluded.length} excluded
        </p>

        <button
          className="terminal-button"
          disabled={
            Boolean(working) ||
            !canConnect ||
            !validPoint(state.origin) ||
            !destinations.length
          }
          onClick={() => perform(
            'Generating routes',
            () => generate(null, true)
          )}
        >
          {attention.length || excluded.length
            ? `Generate routes for the ${destinations.length} ready destinations`
            : `Generate routes for ${destinations.length} destinations`}
        </button>

        {(attention.length > 0 || excluded.length > 0) && (
          <p className="text-amber-200">
            Unresolved and excluded services will not be included.
            They remain listed for review.
          </p>
        )}
      </section>

      {(error || state.error) && (
        <div
          role="alert"
          className="terminal-card p-4 text-red-300"
        >
          {error || state.error}
        </div>
      )}

      <section className="terminal-card space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          {tabs.map(([tab, label]) => (
            <button
              key={tab}
              disabled={Boolean(working)}
              className={
                state.tab === tab
                  ? 'terminal-button'
                  : 'terminal-button-secondary'
              }
              onClick={() => perform(
                'Saving tab',
                () => store.change((current) => ({
                  ...current,
                  tab,
                }))
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {!shownServices.length && (
          <p className="text-sm text-slate-400">
            No services in this list.
          </p>
        )}

        {shownServices.map((service) => (
          <article
            key={service.id}
            className="space-y-3 rounded-xl border border-white/10 p-4"
          >
            <p className="font-semibold">
              {originalAddress(service) || 'Address obscured'}
            </p>

            <p className="text-sm text-slate-400">
              Stage: {service.stage || 'extracted'} ·{' '}
              {service.service_type || 'unknown'} ·{' '}
              {service.parcel_count} parcels
            </p>

            {service.reason && (
              <p className="text-amber-200">
                {service.reason}
              </p>
            )}

            <AddressMapsActions service={service} />

            <div className="flex flex-wrap gap-2">
              <button
                className="terminal-button-secondary"
                disabled={Boolean(working) || !online}
                onClick={() => setPicker({
                  service,
                  initial: mapInitial(service),
                })}
              >
                Choose location on map
              </button>

              <button
                className="terminal-button-secondary"
                disabled={Boolean(working) || !canConnect}
                onClick={() => perform(
                  'Looking up address',
                  () => retryService(service)
                )}
              >
                Retry address lookup
              </button>

              {service.confirmation && (
                <button
                  className="terminal-button-secondary"
                  disabled={Boolean(working) || !canConnect}
                  onClick={() => perform(
                    'Checking saved pin',
                    () => retryService(service, true)
                  )}
                >
                  Check saved pin
                </button>
              )}

              <button
                className="terminal-button-secondary"
                disabled={Boolean(working)}
                onClick={() => perform(
                  'Saving service',
                  () => replaceService(
                    service.status === 'excluded'
                      ? {
                          ...service,
                          status: 'needs_attention',
                          reason:
                            'Restored to journey; verify before routing',
                        }
                      : {
                          ...service,
                          status: 'excluded',
                          reason:
                            'Explicitly excluded from this journey',
                        }
                  )
                )}
              >
                {service.status === 'excluded'
                  ? 'Restore to journey'
                  : 'Exclude from this journey'}
              </button>
            </div>

            <ResolutionDetails service={service} />

            {!readyToRoute(service) &&
              service.candidates.length > 0 && (
                <details>
                  <summary className="cursor-pointer">
                    Review address candidates
                  </summary>

                  <div className="mt-3 space-y-3">
                    {service.candidates.map((candidate) => (
                      <div
                        key={candidate.id}
                        className="space-y-2 rounded border border-white/10 p-3"
                      >
                        <p>{candidate.address}</p>

                        <p className="text-sm text-slate-400">
                          {candidate.result_type || 'Unknown level'}
                          {' · '}
                          {candidate.match_type || 'Unknown match'}
                        </p>

                        {validPoint(candidate) && (
                          <a
                            href={
                              'https://www.google.com/maps/search/?' +
                              new URLSearchParams({
                                api: '1',
                                query:
                                  `${candidate.latitude},` +
                                  `${candidate.longitude}`,
                              }).toString()
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="terminal-button-secondary inline-flex"
                          >
                            Inspect candidate in Google Maps
                          </a>
                        )}

                        <button
                          className="terminal-button-secondary"
                          disabled={
                            Boolean(working) ||
                            !candidate.can_confirm ||
                            !canConnect
                          }
                          onClick={() => perform(
                            'Checking candidate',
                            () => confirmService(service, candidate)
                          )}
                        >
                          Confirm this location
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
          </article>
        ))}
      </section>

      {selected && (
        <section className="terminal-card space-y-4 p-4">
          <h3 className="font-semibold">
            Saved optimized journey
          </h3>

          <p>
            {(Number(selected.distance_m) / 1000).toFixed(1)} km
            {' · '}
            {Math.round(Number(selected.duration_s) / 60)}
            {' '}minutes driving
          </p>

          {[...(selected.segments || [])]
            .sort((a, b) => a.sequence - b.sequence)
            .map((segment, index, list) => (
              <article
                key={segment.id}
                className="space-y-3 rounded border border-white/10 p-4"
              >
                <h4>
                  Route {index + 1} of {list.length}
                </h4>

                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(segment.completed)}
                    disabled={Boolean(working)}
                    onChange={() => perform(
                      'Saving completion',
                      () => store.change((current) => ({
                        ...current,
                        plans: current.plans.map((plan) =>
                          plan.id !== selected.id
                            ? plan
                            : {
                                ...plan,
                                segments: plan.segments.map(
                                  (item) =>
                                    item.id !== segment.id
                                      ? item
                                      : {
                                          ...item,
                                          completed: !item.completed,
                                          completed_at: !item.completed
                                            ? new Date().toISOString()
                                            : null,
                                        }
                                ),
                              }
                        ),
                      }))
                    )}
                  />
                  Route completed
                </label>

                <a
                  href={segment.google_maps_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="terminal-button inline-block"
                >
                  Open Route {index + 1} of {list.length}
                  {' '}in Google Maps
                </a>

                <details>
                  <summary>Destinations</summary>

                  <ol className="mt-2 space-y-2">
                    {[...(selected.stops || [])]
                      .sort((a, b) => a.sequence - b.sequence)
                      .filter((stop) =>
                        stop.sequence > segment.start_stop &&
                        stop.sequence <= segment.end_stop
                      )
                      .map((stop) => (
                        <li key={stop.sequence}>
                          {stop.address}
                        </li>
                      ))}
                  </ol>
                </details>
              </article>
            ))}
        </section>
      )}

      {(state.plans || []).length > 0 && (
        <section className="terminal-card space-y-3 p-4">
          <h3>Saved journeys</h3>

          <p className="text-sm text-slate-400">
            These links describe previously generated journeys.
          </p>

          {state.plans.map((plan) => (
            <button
              key={plan.id}
              disabled={Boolean(working)}
              className="terminal-button-secondary"
              onClick={() => perform(
                'Opening saved journey',
                () => store.change((current) => ({
                  ...current,
                  selectedId: plan.id,
                }))
              )}
            >
              Journey #{plan.id}
              {' · '}
              {plan.segments?.length || 0} routes
            </button>
          ))}
        </section>
      )}
    </div>
  );
}3