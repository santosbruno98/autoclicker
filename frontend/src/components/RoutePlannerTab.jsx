import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { API } from '../services/http';
import { usePlanner } from '../services/plannerStore';
import RouteLocationPicker from './RouteLocationPicker';
import RoutePlannerSettings from './RoutePlannerSettings';

const POLICY = 'selected-area-resolution-v3';

function addressOf(service) {
  return String(
    service?.original_address || service?.address || ''
  ).trim();
}

function validPoint(point) {
  if (
    point?.latitude == null ||
    point?.longitude == null ||
    String(point.latitude).trim() === '' ||
    String(point.longitude).trim() === ''
  ) return false;

  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);

  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0);
}

function coordinateKey(point) {
  return `${Number(point.latitude).toFixed(6)},` +
    `${Number(point.longitude).toFixed(6)}`;
}

function correctionKey(areaID, address) {
  return `${areaID}:` + String(address)
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function errorMessage(error) {
  return error?.response?.data?.error ||
    error?.message ||
    'Request failed';
}

function normalizeService(service, index = 0) {
  return {
    ...service,
    id: service.id || `legacy-${index}`,
    original_address: addressOf(service),
    candidates: Array.isArray(service.candidates)
      ? service.candidates
      : [],
    parcel_count: Math.max(1, Number(service.parcel_count) || 1),
  };
}

function servicesOf(state) {
  if (Array.isArray(state?.services)) {
    return state.services.map(normalizeService);
  }

  return [
    ...(state?.complete || []),
    ...(state?.incomplete || []),
  ].map((service, index) => normalizeService({
    ...service,
    status: 'needs_attention',
    stage: 'extracted',
    reason: 'Saved under an older policy; verify this address again.',
  }, index));
}

function readyToRoute(service, revision) {
  if (
    !revision ||
    service.status !== 'ready' ||
    service.stage !== 'ready' ||
    service.area_revision !== revision ||
    service.resolution?.policy_version !== POLICY ||
    !service.resolution?.road_checked_at ||
    !validPoint(service) ||
    !validPoint({
      latitude: service.road_latitude,
      longitude: service.road_longitude,
    })
  ) return false;

  if (service.resolution.method === 'user_pin') {
    return service.confirmed === true;
  }

  const selected = service.candidates.filter(
    (candidate) =>
      candidate.id === service.resolution.selected_candidate_id
  );

  return selected.length === 1 &&
    selected[0].in_selected_area === true &&
    selected[0].can_confirm === true &&
    Math.abs(
      Number(selected[0].latitude) - Number(service.latitude)
    ) < 0.0000001 &&
    Math.abs(
      Number(selected[0].longitude) - Number(service.longitude)
    ) < 0.0000001;
}

function withServices(state, services, revision) {
  const normalized = services.map(normalizeService);

  return {
    ...state,
    services: normalized,
    complete: normalized.filter((service) =>
      readyToRoute(service, revision)
    ),
    incomplete: normalized.filter((service) =>
      service.status !== 'excluded' &&
      !readyToRoute(service, revision)
    ),
  };
}

function invalidateArea(state, revision) {
  const services = servicesOf(state).map((service) => ({
    ...service,
    status: service.status === 'excluded'
      ? 'excluded'
      : 'needs_attention',
    stage: 'extracted',
    candidates: [],
    latitude: null,
    longitude: null,
    road_latitude: null,
    road_longitude: null,
    snap_distance_m: null,
    area_revision: '',
    location_precision: '',
    matched_address: '',
    resolution: null,
    reason: service.status === 'excluded'
      ? service.reason
      : 'The search area changed; verify this address again.',
  }));

  return {
    ...withServices(state, services, revision),
    area_revision: revision,
    selectedId: null,
    error: '',
  };
}

function destinationsOf(services, revision) {
  const grouped = new Map();

  for (const service of services) {
    if (!readyToRoute(service, revision)) continue;

    const key = coordinateKey(service);

    if (!grouped.has(key)) {
      grouped.set(key, {
        address: service.matched_address || addressOf(service),
        latitude: Number(service.latitude),
        longitude: Number(service.longitude),
        services: [],
      });
    }

    grouped.get(key).services.push({
      id: service.id,
      source_reference: service.source_reference || '',
      service_type: service.service_type || 'unknown',
      parcel_count: service.parcel_count,
    });
  }

  return [...grouped.values()];
}

function searchURL(query) {
  return 'https://www.google.com/maps/search/?' +
    new URLSearchParams({ api: '1', query }).toString();
}

function directionsURL(point) {
  return 'https://www.google.com/maps/dir/?' +
    new URLSearchParams({
      api: '1',
      destination: `${point.latitude},${point.longitude}`,
      travelmode: 'driving',
    }).toString();
}

export default function RoutePlannerTab() {
  const { store, view, identity } = usePlanner();

  const [page, setPage] = useState('planner');
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(null);
  const [selectedIDs, setSelectedIDs] = useState([]);
  const [messages, setMessages] = useState({});
  const [roundTrip, setRoundTrip] = useState(false);

  const busy = useRef(false);
  const settingsRef = useRef(null);

  const state = view.record?.state;
  const revision = settings?.revision || '';
  const canConnect = online && !identity.localOnly;
  const configured = Boolean(settings?.area && revision);

  const services = useMemo(() => servicesOf(state), [state]);
  const destinations = useMemo(
    () => destinationsOf(services, revision),
    [services, revision]
  );

  const ready = services.filter((service) =>
    readyToRoute(service, revision)
  );
  const attention = services.filter((service) =>
    service.status !== 'excluded' &&
    !readyToRoute(service, revision)
  );
  const excluded = services.filter((service) =>
    service.status === 'excluded'
  );

  const listTab = state?.tab || 'complete';
  const shown = listTab === 'complete'
    ? ready
    : listTab === 'excluded'
      ? excluded
      : attention;

  const selectedPlan = state?.plans?.find(
    (plan) => plan.id === state.selectedId
  );

  const loadSettings = useCallback(async () => {
    if (identity.localOnly || !navigator.onLine) return;

    setSettingsLoading(true);
    setSettingsError('');

    try {
      const { data } = await API.get('/route-planner/settings', {
        timeout: 15000,
      });

      if (!data.settings ||
        typeof data.settings.revision !== 'string') {
        throw new Error('The updated route-settings backend is required.');
      }

      settingsRef.current = data.settings;
      setSettings(data.settings);
    } catch (failure) {
      setSettingsError(errorMessage(failure));

      if (failure.response?.status === 401) {
        window.dispatchEvent(new Event('auth:expired'));
      }
    } finally {
      setSettingsLoading(false);
    }
  }, [identity.user_id, identity.localOnly]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void loadSettings();
    };

    const visible = () => {
      if (document.visibilityState === 'visible' && !busy.current) {
        void loadSettings();
      }
    };

    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    document.addEventListener('visibilitychange', visible);

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [loadSettings]);

  useEffect(() => {
    if (
      view.phase !== 'active' ||
      !settings ||
      !state ||
      state.area_revision === revision ||
      busy.current
    ) return;

    void store.change((current) => invalidateArea(current, revision))
      .catch((failure) => setError(errorMessage(failure)));
  }, [view.phase, state, revision, settings, store, working]);

  useEffect(() => {
    const available = new Set(services.map((service) => service.id));
    setSelectedIDs((previous) =>
      previous.filter((id) => available.has(id))
    );
  }, [services]);

  async function perform(label, action) {
    if (busy.current) return;

    busy.current = true;
    setWorking(label);
    setError('');

    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));

      if (failure.response?.status === 401) {
        window.dispatchEvent(new Event('auth:expired'));
      }

      if (failure.response?.data?.code === 'AREA_CHANGED') {
        await loadSettings();
        setPage('settings');
      }
    } finally {
      busy.current = false;
      setWorking('');
    }
  }

  function operationRevision() {
    if (!canConnect) {
      throw new Error('Reconnect and sign in first.');
    }

    const current = settingsRef.current;
    if (!current?.area || !current.revision) {
      throw new Error('Select a geographic area in Settings first.');
    }

    return current.revision;
  }

  function assertRevision(expected) {
    if (settingsRef.current?.revision !== expected) {
      throw new Error('The search area changed; the old result was discarded.');
    }
  }

  async function replaceService(result, expectedRevision) {
    assertRevision(expectedRevision);

    await store.change((current) => ({
      ...withServices(
        current,
        servicesOf(current).map((service) =>
          service.id === result.id ? normalizeService(result) : service
        ),
        expectedRevision
      ),
      error: '',
    }));
  }

  async function review(service, confirm = null, action = 'verify') {
    const expected = operationRevision();

    const { data } = await API.post('/routes/verify-address', {
      action,
      service,
      area_revision: expected,
      ...(confirm ? { confirm } : {}),
    }, { timeout: 130000 });

    assertRevision(expected);

    if (!data.service?.id) {
      throw new Error('Backend returned no updated service.');
    }

    return { data, expected };
  }

  async function retry(service, preservePin = false) {
    const { data, expected } = await review(
      service,
      preservePin ? service.confirmation || null : null
    );
    await replaceService(data.service, expected);
  }

  async function askAI(ids) {
    await perform('Reviewing selected addresses with AI', async () => {
      const initial = servicesOf(store.getSnapshot().record.state);
      const requested = initial.filter((service) =>
        ids.includes(service.id) && service.status !== 'excluded'
      );

      for (const service of requested) {
        try {
          setMessages((previous) => ({
            ...previous,
            [service.id]: 'Requesting a fresh AI review…',
          }));

          const { data, expected } = await review(
            service, null, 'ai_assist'
          );

          if (data.ai_attempted !== true || !data.request_id) {
            throw new Error('Backend did not confirm an AI request.');
          }

          await replaceService(data.service, expected);

          setMessages((previous) => ({
            ...previous,
            [service.id]: readyToRoute(data.service, expected)
              ? 'AI review and road validation passed.'
              : `Needs attention: ${data.service.reason || 'Unresolved address'}`,
          }));
        } catch (failure) {
          setMessages((previous) => ({
            ...previous,
            [service.id]: errorMessage(failure),
          }));

          if (
            failure.response?.status === 401 ||
            failure.response?.data?.code === 'AREA_CHANGED'
          ) throw failure;
        }
      }
    });
  }

  async function confirmService(service, point) {
    const confirmation = {
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
    };

    const { data, expected } = await review(service, confirmation);
    assertRevision(expected);

    const areaID = settingsRef.current.area.place_id;

    await store.change((current) => {
      const next = withServices(
        current,
        servicesOf(current).map((item) =>
          item.id === service.id ? data.service : item
        ),
        expected
      );

      return {
        ...next,
        corrections: {
          ...(current.corrections || {}),
          ...(readyToRoute(data.service, expected)
            ? {
                [correctionKey(areaID, addressOf(service))]: confirmation,
              }
            : {}),
        },
      };
    });

    setPicker(null);
  }

  async function upload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';

    if (!files.length || busy.current) return;

    await perform('Extracting and checking screenshots', async () => {
      const expected = operationRevision();

      if (
        files.length > 10 ||
        files.some((file) => file.size > 10 * 1024 * 1024)
      ) {
        throw new Error('Choose up to 10 screenshots, each at most 10 MiB.');
      }

      const form = new FormData();
      form.append('area_revision', expected);
      files.forEach((file) => form.append('files', file));

      const { data } = await API.post('/routes/parse', form, {
        timeout: 250000,
      });

      assertRevision(expected);

      if (!Array.isArray(data.services) ||
        data.area_revision !== expected) {
        throw new Error('Backend returned an incompatible screenshot result.');
      }

      await store.change((current) => ({
        ...withServices(current, data.services, expected),
        area_revision: expected,
        screenshotCount: files.length,
        phase: 'extracted',
        selectedId: null,
        error: '',
      }));

      setSelectedIDs([]);
      setMessages({});

      const snapshot = store.getSnapshot().record.state;
      const areaID = settingsRef.current.area.place_id;

      for (const service of servicesOf(snapshot)) {
        const saved = snapshot.corrections?.[
          correctionKey(areaID, addressOf(service))
        ];

        if (!saved) continue;

        try {
          const reviewed = await review(service, saved);
          await replaceService(reviewed.data.service, expected);
        } catch (failure) {
          if (failure.response?.data?.code === 'AREA_CHANGED') {
            throw failure;
          }
          // The extracted record remains available for explicit retry.
        }
      }
    });
  }

  async function saveOrigin(point) {
    await store.change((current) => ({
      ...current,
      origin: {
        latitude: Number(point.latitude),
        longitude: Number(point.longitude),
        accuracy: point.accuracy ?? null,
        captured_at: new Date().toISOString(),
      },
      originError: '',
    }));
    setPicker(null);
  }

  async function locate() {
    if (!navigator.geolocation) {
      throw new Error('This browser does not provide geolocation.');
    }

    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });
    });

    await saveOrigin({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    });
  }

  function mapInitial(service = null) {
    const candidate = service?.candidates?.find(validPoint);

    return [
      service,
      candidate,
      state?.origin,
      settings?.area,
    ].find(validPoint) || { latitude: 0, longitude: 0 };
  }

  async function generate() {
    const expected = operationRevision();
    const current = store.getSnapshot().record.state;
    const stops = destinationsOf(servicesOf(current), expected);

    if (!validPoint(current.origin)) {
      throw new Error('Choose or refresh your starting location.');
    }

    if (!stops.length) {
      throw new Error('There are no ready destinations.');
    }

    try {
      const { data } = await API.post('/routes', {
        area_revision: expected,
        round_trip: roundTrip,
        stops: [{
          address: 'Starting location',
          latitude: Number(current.origin.latitude),
          longitude: Number(current.origin.longitude),
          services: [],
        }, ...stops],
      }, { timeout: 190000 });

      assertRevision(expected);

      if (!data.id || !Array.isArray(data.segments)) {
        throw new Error('Backend returned an invalid journey.');
      }

      const plan = {
        ...data,
        area_revision: expected,
        area_label: settingsRef.current.area.label,
      };

      await store.change((latest) => ({
        ...latest,
        plans: [plan, ...(latest.plans || [])],
        selectedId: plan.id,
        error: '',
      }));
    } catch (failure) {
      const issues = failure.response?.data?.issues || [];
      const affected = new Map();

      for (const issue of issues) {
        if (issue.is_origin) {
          await store.change((latest) => ({
            ...latest,
            originError: issue.message ||
              'Starting location failed road validation.',
          }));
        }

        for (const id of issue.service_ids || []) {
          affected.set(id, issue.message || 'Location failed validation.');
        }
      }

      if (affected.size) {
        await store.change((latest) => withServices(
          latest,
          servicesOf(latest).map((service) =>
            affected.has(service.id)
              ? {
                  ...service,
                  status: 'needs_attention',
                  reason: affected.get(service.id),
                  resolution: {
                    ...service.resolution,
                    road_checked_at: '',
                  },
                }
              : service
          ),
          expected
        ));
      }

      throw failure;
    }
  }

  async function applyArea(selectionToken) {
    if (busy.current) throw new Error('Wait for the current operation.');

    busy.current = true;
    setWorking('Saving geographic area');

    try {
      const { data } = await API.put('/route-planner/settings', {
        expected_revision: settingsRef.current?.revision || '',
        selection_token: selectionToken,
      }, { timeout: 15000 });

      if (!data.settings?.revision || !data.settings.area) {
        throw new Error('Backend returned invalid saved settings.');
      }

      settingsRef.current = data.settings;
      setSettings(data.settings);

      if (store.getSnapshot().record) {
        await store.change((current) =>
          invalidateArea(current, data.settings.revision)
        );
      }

      setSelectedIDs([]);
      setMessages({});
      setPicker(null);
    } finally {
      busy.current = false;
      setWorking('');
    }
  }

  async function toggleExcluded(service) {
    const restored = service.status === 'excluded';

    await replaceService({
      ...service,
      status: restored ? 'needs_attention' : 'excluded',
      reason: restored
        ? 'Restored; verify this address before routing.'
        : 'Explicitly excluded from this journey.',
    }, revision);
  }

  function toggleSelection(id) {
    setSelectedIDs((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id]
    );
  }

  async function toggleSegment(plan, segment) {
    const completed = !segment.completed;

    if (canConnect) {
      await API.patch(
        `/routes/${plan.id}/segments/${segment.id}`,
        { completed },
        { timeout: 15000 }
      );
    }

    await store.change((current) => ({
      ...current,
      plans: current.plans.map((item) =>
        item.id !== plan.id
          ? item
          : {
              ...item,
              segments: item.segments.map((entry) =>
                entry.id === segment.id
                  ? {
                      ...entry,
                      completed,
                      completed_at: completed
                        ? new Date().toISOString()
                        : null,
                    }
                  : entry
              ),
            }
      ),
    }));
  }

  const selectableIDs = selectedIDs.filter((id) =>
    services.some((service) =>
      service.id === id && service.status !== 'excluded'
    )
  );

  const disabled = Boolean(working);
  const networkDisabled = disabled || !canConnect || !configured;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Route Planner</h2>
          <p className="text-sm text-slate-400">
            {working || view.status}
          </p>
        </div>

        {view.phase === 'active' && (
          <button
            className="terminal-button-secondary"
            disabled={disabled}
            onClick={() => perform('Starting new journey', () =>
              store.startNew()
            )}
          >
            Start new journey
          </button>
        )}
      </div>

      <nav aria-label="Route Planner sections" className="flex gap-2">
        {[
          ['planner', 'Planner'],
          ['settings', 'Settings'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={page === id}
            className={page === id
              ? 'terminal-button'
              : 'terminal-button-secondary'}
            onClick={() => setPage(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {settingsError && (
        <div role="alert" className="terminal-card space-y-3 p-4">
          <p className="text-red-300">{settingsError}</p>
          <button
            className="terminal-button-secondary"
            disabled={disabled || settingsLoading || !canConnect}
            onClick={() => void loadSettings()}
          >
            Retry loading settings
          </button>
        </div>
      )}

      {page === 'settings' ? (
        <RoutePlannerSettings
          settings={settings}
          online={canConnect}
          busy={disabled || settingsLoading}
          onApply={applyArea}
          onReload={loadSettings}
        />
      ) : (
        <>
          <div className="terminal-card flex flex-wrap items-center justify-between gap-3 p-4">
            <p>
              Search area:{' '}
              <strong>
                {settingsLoading
                  ? 'Loading…'
                  : settings?.area?.label || 'Not selected'}
              </strong>
            </p>
            <button
              className="terminal-button-secondary"
              onClick={() => setPage('settings')}
            >
              Change search area
            </button>
          </div>

          {view.phase === 'loading' && <p>Loading saved journey…</p>}

          {view.phase === 'error' && (
            <p role="alert" className="text-red-300">{view.error}</p>
          )}

          {view.phase === 'choice' && (
            <section className="terminal-card space-y-4 p-4">
              <h3 className="font-semibold">Previous journey</h3>
              <p>{view.status}</p>

              {view.candidate && (
                <button
                  className="terminal-button"
                  disabled={disabled}
                  onClick={() => perform('Restoring journey', () =>
                    store.continuePrevious()
                  )}
                >
                  Continue previous journey
                </button>
              )}

              <button
                className="terminal-button-secondary"
                disabled={disabled}
                onClick={() => perform('Starting journey', () =>
                  store.startNew()
                )}
              >
                Start new journey
              </button>
            </section>
          )}

          {view.conflict && (
            <section className="terminal-card space-y-3 p-4">
              <p>A newer journey exists in the cloud.</p>
              <button
                className="terminal-button"
                disabled={disabled}
                onClick={() => perform('Loading cloud journey', () =>
                  store.useCloud()
                )}
              >
                Use cloud copy
              </button>
              <button
                className="terminal-button-secondary"
                disabled={disabled}
                onClick={() => perform('Keeping device journey', () =>
                  store.keepDevice()
                )}
              >
                Keep this device copy
              </button>
            </section>
          )}

          {view.phase === 'active' && state && (
            <>
              <section className="terminal-card space-y-3 p-4">
                <h3 className="font-semibold">Starting location</h3>

                {validPoint(state.origin) ? (
                  <div className="font-mono text-sm">
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
                      {state.origin.captured_at
                        ? new Date(state.origin.captured_at).toLocaleString()
                        : 'Unknown'}
                    </p>
                  </div>
                ) : <p>No starting location selected.</p>}

                {state.originError && (
                  <p className="text-red-300">{state.originError}</p>
                )}

                <p className="text-sm text-slate-400">
                  Rechecked against the road network for every journey.
                </p>

                <div className="flex flex-wrap gap-2">
                  <button
                    className="terminal-button-secondary"
                    disabled={disabled}
                    onClick={() => perform('Getting GPS location', locate)}
                  >
                    Refresh my location
                  </button>
                  <button
                    className="terminal-button-secondary"
                    disabled={disabled}
                    onClick={() => setPicker({
                      origin: true,
                      initial: mapInitial(),
                    })}
                  >
                    Choose starting point on map
                  </button>
                </div>
              </section>

              {picker && (
                <RouteLocationPicker
                  key={picker.origin ? 'origin' : picker.service.id}
                  title={picker.origin
                    ? 'Choose starting location'
                    : addressOf(picker.service)}
                  initial={picker.initial}
                  onCancel={() => setPicker(null)}
                  onConfirm={(point) => perform(
                    'Checking selected location',
                    () => picker.origin
                      ? saveOrigin(point)
                      : confirmService(picker.service, point)
                  )}
                />
              )}

              <section className="terminal-card space-y-4 p-4">
                <h3 className="font-semibold">Delivery screenshots</h3>

                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  disabled={networkDisabled}
                  onChange={upload}
                  className="terminal-input"
                />

                <p className="text-sm text-slate-400">
                  New screenshots replace the current batch.
                  Different shipments at one address remain separate services.
                </p>

                <p>
                  {destinations.length} ready destinations ·{' '}
                  {attention.length} services need attention ·{' '}
                  {excluded.length} excluded
                </p>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={roundTrip}
                    disabled={disabled}
                    onChange={(event) =>
                      setRoundTrip(event.target.checked)}
                  />
                  Return to starting location
                </label>

                <button
                  className="terminal-button"
                  disabled={
                    networkDisabled ||
                    !validPoint(state.origin) ||
                    !destinations.length
                  }
                  onClick={() => perform('Generating routes', generate)}
                >
                  {attention.length || excluded.length
                    ? `Generate routes for the ${destinations.length} ready destinations`
                    : `Generate routes for ${destinations.length} destinations`}
                </button>

                {(attention.length > 0 || excluded.length > 0) && (
                  <p className="text-sm text-amber-200">
                    This action includes only ready destinations.
                    Unresolved and excluded services remain listed for review.
                  </p>
                )}
              </section>

              {(error || state.error) && (
                <p role="alert" className="terminal-card p-4 text-red-300">
                  {error || state.error}
                </p>
              )}

              <section className="terminal-card space-y-4 p-4">
                <h3 className="font-semibold">Addresses and AI assistance</h3>

                <div className="flex flex-wrap gap-2">
                  {[
                    ['complete', `Ready to route (${ready.length})`],
                    ['incomplete', `Needs attention (${attention.length})`],
                    ['excluded', `Excluded (${excluded.length})`],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      disabled={disabled}
                      className={listTab === id
                        ? 'terminal-button'
                        : 'terminal-button-secondary'}
                      onClick={() => perform('Saving view', () =>
                        store.change((current) => ({
                          ...current,
                          tab: id,
                        }))
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    className="terminal-button-secondary"
                    disabled={disabled}
                    onClick={() => setSelectedIDs((previous) => [
                      ...new Set([
                        ...previous,
                        ...shown.filter((service) =>
                          service.status !== 'excluded'
                        ).map((service) => service.id),
                      ]),
                    ])}
                  >
                    Select visible addresses
                  </button>
                  <button
                    className="terminal-button-secondary"
                    disabled={disabled}
                    onClick={() => setSelectedIDs([])}
                  >
                    Clear selection
                  </button>
                  <button
                    className="terminal-button"
                    disabled={networkDisabled || !selectableIDs.length}
                    onClick={() => askAI(selectableIDs)}
                  >
                    Ask AI about selected ({selectableIDs.length})
                  </button>
                </div>

                {!shown.length && <p>No services in this list.</p>}

                {shown.map((service) => (
                  <article
                    key={service.id}
                    className="space-y-3 rounded-xl border border-white/15 p-4"
                  >
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIDs.includes(service.id)}
                        disabled={disabled || service.status === 'excluded'}
                        onChange={() => toggleSelection(service.id)}
                        className="mt-1"
                      />
                      <span className="font-semibold">
                        {addressOf(service) || 'Address obscured'}
                      </span>
                    </label>

                    <p className="text-sm text-slate-400">
                      {service.source_reference
                        ? `Shipment ${service.source_reference} · `
                        : ''}
                      {service.service_type || 'unknown'} ·{' '}
                      {service.parcel_count} parcels
                    </p>

                    {readyToRoute(service, revision) &&
                      service.location_precision === 'street' && (
                        <p className="font-medium text-amber-200">
                          Street-level location
                        </p>
                      )}

                    {!readyToRoute(service, revision) && (
                      <p className="text-amber-200">
                        {service.reason || 'Verify this address before routing.'}
                      </p>
                    )}

                    {service.matched_address && (
                      <p className="text-sm">
                        Matched: {service.matched_address}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        className="terminal-button"
                        disabled={
                          networkDisabled || service.status === 'excluded'
                        }
                        onClick={() => askAI([service.id])}
                      >
                        Ask AI about this address
                      </button>

                      <button
                        className="terminal-button-secondary"
                        disabled={networkDisabled}
                        onClick={() => perform(
                          'Looking up address',
                          () => retry(service)
                        )}
                      >
                        Retry address lookup
                      </button>

                      <button
                        className="terminal-button-secondary"
                        disabled={networkDisabled}
                        onClick={() => setPicker({
                          service,
                          initial: mapInitial(service),
                        })}
                      >
                        Choose location on map
                      </button>

                      {service.confirmation && (
                        <button
                          className="terminal-button-secondary"
                          disabled={networkDisabled}
                          onClick={() => perform(
                            'Checking saved pin',
                            () => retry(service, true)
                          )}
                        >
                          Check saved pin
                        </button>
                      )}

                      <button
                        className="terminal-button-secondary"
                        disabled={disabled || !configured}
                        onClick={() => perform(
                          'Saving service',
                          () => toggleExcluded(service)
                        )}
                      >
                        {service.status === 'excluded'
                          ? 'Restore to journey'
                          : 'Exclude from this journey'}
                      </button>
                    </div>

                    <a
                      className="terminal-button-secondary inline-block"
                      href={searchURL(`${addressOf(service)}, Portugal`)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Search in Google Maps
                    </a>

                    {readyToRoute(service, revision) && (
                      <a
                        className="terminal-button-secondary ml-2 inline-block"
                        href={directionsURL(service)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Navigate to checked location
                      </a>
                    )}

                    {messages[service.id] && (
                      <p role="status" className="text-sm">
                        {messages[service.id]}
                      </p>
                    )}

                    {!readyToRoute(service, revision) &&
                      service.candidates?.length > 0 && (
                        <details>
                          <summary className="cursor-pointer">
                            Review address candidates
                          </summary>

                          <div className="mt-3 space-y-3">
                            {service.candidates.filter((candidate) =>
                              candidate.in_selected_area === true
                            ).map((candidate) => (
                              <div
                                key={candidate.id}
                                className="space-y-3 rounded border border-white/15 p-3"
                              >
                                <p>{candidate.address}</p>
                                <p className="text-sm text-slate-400">
                                  {candidate.result_type} ·{' '}
                                  {candidate.can_confirm
                                    ? 'Available for confirmation'
                                    : 'Insufficient street/building evidence'}
                                </p>

                                <a
                                  href={searchURL(
                                    `${candidate.latitude},${candidate.longitude}`
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="terminal-button-secondary inline-block"
                                >
                                  Inspect in Google Maps
                                </a>

                                <button
                                  className="terminal-button-secondary"
                                  disabled={
                                    networkDisabled ||
                                    !candidate.can_confirm
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

                    <details>
                      <summary className="cursor-pointer">
                        Address and AI details
                      </summary>
                      <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify({
                          original_address: addressOf(service),
                          original_evidence: service.original_addresses,
                          street: service.street,
                          house_number: service.house_number,
                          postcode: service.postal_code,
                          locality: service.locality,
                          issues: service.extraction_issues,
                          resolution: service.resolution,
                        }, null, 2)}
                      </pre>
                    </details>
                  </article>
                ))}
              </section>

              {selectedPlan && (
                <section className="terminal-card space-y-4 p-4">
                  <h3 className="font-semibold">Saved journey</h3>

                  <p>
                    {(Number(selectedPlan.distance_m) / 1000).toFixed(1)}
                    {' '}km ·{' '}
                    {Math.round(Number(selectedPlan.duration_s) / 60)}
                    {' '}minutes driving
                  </p>

                  {selectedPlan.area_revision !== revision && (
                    <p className="text-amber-200">
                      Historical journey generated under another area
                      selection. Its links have not been revalidated.
                    </p>
                  )}

                  {[...(selectedPlan.segments || [])]
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((segment, index) => (
                      <article
                        key={segment.id}
                        className="space-y-3 rounded border border-white/15 p-4"
                      >
                        <h4>Route {index + 1}</h4>

                        <label className="flex gap-2">
                          <input
                            type="checkbox"
                            checked={Boolean(segment.completed)}
                            disabled={disabled}
                            onChange={() => perform(
                              'Saving route completion',
                              () => toggleSegment(selectedPlan, segment)
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
                          Open Route {index + 1} in Google Maps
                        </a>

                        <details>
                          <summary>Destinations and services</summary>
                          <ol className="mt-3 space-y-3">
                            {[...(selectedPlan.stops || [])]
                              .sort((a, b) => a.sequence - b.sequence)
                              .filter((stop) =>
                                stop.sequence > segment.start_stop &&
                                stop.sequence <= segment.end_stop
                              )
                              .map((stop) => (
                                <li key={stop.sequence}>
                                  <p>{stop.address}</p>
                                  <p className="text-sm text-slate-400">
                                    {stop.services?.length || 0} services
                                    {' · '}
                                    {(stop.services || []).reduce(
                                      (sum, service) =>
                                        sum + (Number(service.parcel_count) || 1),
                                      0
                                    )} parcels
                                  </p>
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
                  <h3 className="font-semibold">Saved journeys</h3>
                  <div className="flex flex-wrap gap-2">
                    {state.plans.map((plan) => (
                      <button
                        key={plan.id}
                        className="terminal-button-secondary"
                        disabled={disabled}
                        onClick={() => perform('Opening saved journey', () =>
                          store.change((current) => ({
                            ...current,
                            selectedId: plan.id,
                          }))
                        )}
                      >
                        Journey #{plan.id} ·{' '}
                        {plan.segments?.length || 0} routes
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}