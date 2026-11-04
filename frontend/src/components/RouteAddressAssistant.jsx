import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { API } from '../services/http';

function addressOf(service) {
  return String(
    service.original_address ||
    service.address ||
    ''
  ).trim();
}

function readServices(state) {
  if (Array.isArray(state?.services)) {
    return state.services.map((service, index) => ({
      ...service,
      id: service.id || `legacy-${index}`,
      original_address: addressOf(service),
    }));
  }

  return [
    ...(state?.complete || []),
    ...(state?.incomplete || []),
  ].map((service, index) => ({
    ...service,
    id: service.id || `legacy-${index}`,
    original_address: addressOf(service),
    status: service.status === 'excluded'
      ? 'excluded'
      : 'needs_attention',
  }));
}

function isReady(service) {
  return (
    service.status === 'ready' &&
    service.stage === 'ready'
  );
}

function batchSignature(services) {
  return JSON.stringify(
    services.map((service) => [
      service.id,
      addressOf(service),
    ])
  );
}

function mapsURL(service) {
  const address = addressOf(service);
  if (!address) return null;

  return (
    'https://www.google.com/maps/search/?' +
    new URLSearchParams({
      api: '1',
      query: address,
    }).toString()
  );
}

export default function RouteAddressAssistant({
  store,
  state,
  canConnect,
  disabled = false,
  onBusyChange,
}) {
  const services = useMemo(
    () => readServices(state),
    [state]
  );

  const signature = batchSignature(services);

  const [tab, setTab] = useState('needs_attention');
  const [selectedIDs, setSelectedIDs] = useState([]);
  const [runningID, setRunningID] = useState(null);
  const [messages, setMessages] = useState({});
  const [summary, setSummary] = useState('');

  const busy = useRef(false);

  useEffect(() => {
    const existing = new Set(
      services.map((service) => service.id)
    );

    setSelectedIDs((previous) =>
      previous.filter((id) => existing.has(id))
    );
  }, [signature]);

  const visible = services.filter((service) => {
    if (tab === 'ready') return isReady(service);

    return (
      !isReady(service) &&
      service.status !== 'excluded'
    );
  });

  function toggle(id) {
    setSelectedIDs((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id]
    );
  }

  function setMessage(id, message) {
    setMessages((previous) => ({
      ...previous,
      [id]: message,
    }));
  }

  async function saveResult(
    originalID,
    result,
    expectedSignature,
    requestID
  ) {
    await store.change((current) => {
      const currentServices = readServices(current);

      if (batchSignature(currentServices) !== expectedSignature) {
        throw new Error(
          'The screenshot batch changed. AI results were not applied.'
        );
      }

      const updated = currentServices.map((service) =>
        service.id !== originalID
          ? service
          : {
              ...result,
              // Preserve the UI identity used for this service.
              id: originalID,
              last_ai_assistance: {
                request_id: requestID,
                completed_at: new Date().toISOString(),
              },
            }
      );

      return {
        ...current,
        services: updated,
        complete: updated.filter(isReady),
        incomplete: updated.filter(
          (service) =>
            !isReady(service) &&
            service.status !== 'excluded'
        ),
        selectedId: null,
        error: '',
      };
    });
  }

  async function askAI(ids) {
    if (busy.current || disabled) return;

    if (!canConnect) {
      setSummary(
        'Reconnect and sign in to request AI assistance.'
      );
      return;
    }

    const selected = services.filter(
      (service) => ids.includes(service.id)
    );

    if (!selected.length) {
      setSummary('Select at least one address.');
      return;
    }

    busy.current = true;
    onBusyChange?.(true);
    setSummary('');

    let readyCount = 0;
    let attentionCount = 0;
    let failedCount = 0;

    try {
      for (const selectedService of selected) {
        const currentServices = readServices(
          store.getSnapshot().record?.state
        );

        if (
          batchSignature(currentServices) !== signature
        ) {
          throw new Error(
            'The screenshot batch changed. Remaining requests were stopped.'
          );
        }

        const service = currentServices.find(
          (item) => item.id === selectedService.id
        );

        if (!service) continue;

        setRunningID(service.id);
        setMessage(
          service.id,
          'Requesting a fresh AI parse, candidate lookup and road check…'
        );

        try {
          const { data } = await API.post(
            '/routes/verify-address',
            {
              action: 'ai_assist',
              service,
            },
            {
              timeout: 130000,
            }
          );

          if (
            data.ai_attempted !== true ||
            !data.service ||
            !data.request_id
          ) {
            throw new Error(
              'Backend did not confirm an AI-assistance result. ' +
              'Deploy the updated ai_assist handler.'
            );
          }

          await saveResult(
            service.id,
            data.service,
            signature,
            data.request_id
          );

          if (isReady(data.service)) {
            readyCount++;
            setMessage(
              service.id,
              'AI review completed. Address and road checks passed.'
            );
          } else {
            attentionCount++;
            setMessage(
              service.id,
              'AI review completed; still needs attention: ' +
              (
                data.service.reason ||
                data.service.resolution?.reason ||
                'No supported location was established.'
              )
            );
          }
        } catch (error) {
          failedCount++;

          setMessage(
            selectedService.id,
            error.response?.data?.error ||
            error.message ||
            'AI assistance failed. Previous address data was retained.'
          );

          if (error.response?.status === 401) {
            window.dispatchEvent(new Event('auth:expired'));
            break;
          }
        }
      }

      setSummary(
        `${readyCount} ready · ` +
        `${attentionCount} still need attention · ` +
        `${failedCount} requests failed`
      );
    } catch (error) {
      setSummary(error.message);
    } finally {
      setRunningID(null);
      busy.current = false;
      onBusyChange?.(false);
    }
  }

  return (
    <section className="terminal-card space-y-4 p-4">
      <h3 className="text-lg font-semibold">
        Address review and AI assistance
      </h3>

      <p className="text-sm text-slate-400">
        Select addresses from either list. AI assistance makes a
        fresh request for each selected service.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(runningID) || disabled}
          className={
            tab === 'ready'
              ? 'terminal-button'
              : 'terminal-button-secondary'
          }
          onClick={() => setTab('ready')}
        >
          Ready to route
        </button>

        <button
          type="button"
          disabled={Boolean(runningID) || disabled}
          className={
            tab === 'needs_attention'
              ? 'terminal-button'
              : 'terminal-button-secondary'
          }
          onClick={() => setTab('needs_attention')}
        >
          Needs attention
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="terminal-button-secondary"
          disabled={Boolean(runningID) || disabled}
          onClick={() => setSelectedIDs((previous) => [
            ...new Set([
              ...previous,
              ...visible.map((service) => service.id),
            ]),
          ])}
        >
          Select visible addresses
        </button>

        <button
          type="button"
          className="terminal-button-secondary"
          disabled={Boolean(runningID) || disabled}
          onClick={() => setSelectedIDs([])}
        >
          Clear selection
        </button>

        <button
          type="button"
          className="terminal-button"
          disabled={
            Boolean(runningID) ||
            disabled ||
            !canConnect ||
            selectedIDs.length === 0
          }
          onClick={() => askAI(selectedIDs)}
        >
          Ask AI about selected addresses ({selectedIDs.length})
        </button>
      </div>

      {summary && (
        <p role="status" className="text-sm text-cyan-200">
          {summary}
        </p>
      )}

      {!visible.length && (
        <p>No addresses in this list.</p>
      )}

      {visible.map((service) => {
        const resolution = service.resolution;
        const searchURL = mapsURL(service);

        return (
          <article
            key={service.id}
            className="space-y-3 rounded-xl border border-white/15 p-4"
          >
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selectedIDs.includes(service.id)}
                disabled={Boolean(runningID) || disabled}
                onChange={() => toggle(service.id)}
                className="mt-1"
              />

              <span className="font-semibold">
                {addressOf(service) || 'Address unavailable'}
              </span>
            </label>

            <p className="text-sm text-slate-400">
              {service.service_type || 'unknown'}
              {' · '}
              {service.stage || 'extracted'}
            </p>

            {service.reason && (
              <p className="text-amber-200">
                {service.reason}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="terminal-button"
                disabled={
                  Boolean(runningID) ||
                  disabled ||
                  !canConnect
                }
                onClick={() => askAI([service.id])}
              >
                {runningID === service.id
                  ? 'AI is reviewing this address…'
                  : 'Ask AI about this address'}
              </button>

              {searchURL && (
                <a
                  href={searchURL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="terminal-button-secondary inline-flex"
                >
                  Search in Google Maps
                </a>
              )}
            </div>

            {messages[service.id] && (
              <p role="status" className="text-sm text-cyan-200">
                {messages[service.id]}
              </p>
            )}

            {resolution && (
              <details>
                <summary>AI and validation details</summary>

                <div className="mt-2 space-y-2 text-sm">
                  <p>Method: {resolution.method}</p>
                  <p>Decision: {resolution.decision}</p>

                  {resolution.model && (
                    <p>Model: {resolution.model}</p>
                  )}

                  {resolution.reason && (
                    <p>{resolution.reason}</p>
                  )}

                  {resolution.selected_candidate_id && (
                    <p className="break-all">
                      Candidate: {resolution.selected_candidate_id}
                    </p>
                  )}

                  {resolution.road_checked_at && (
                    <p>
                      Road checked:{' '}
                      {new Date(
                        resolution.road_checked_at
                      ).toLocaleString()}
                    </p>
                  )}

                  {service.last_ai_assistance?.request_id && (
                    <p className="break-all">
                      Request:{' '}
                      {service.last_ai_assistance.request_id}
                    </p>
                  )}
                </div>
              </details>
            )}
          </article>
        );
      })}
    </section>
  );
}