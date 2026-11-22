import React, { useEffect, useRef, useState } from 'react';

import RouteAreaPicker, {
  polygonCorners,
  validateAreaPolygon,
} from './RoutePlannerPicker';

function savedPolygon(settings) {
  const polygon = settings?.area?.polygon;

  return polygonCorners(polygon) ? polygon : null;
}

function defaultLabel(settings) {
  return settings?.area?.type === 'polygon'
    ? settings.area.label || 'Delivery area'
    : 'Delivery area';
}

function errorMessage(error) {
  const message =
    error?.response?.data?.error ||
    error?.message ||
    'Cannot save the selected area.';

  if (
    error?.response?.status === 404 ||
    error?.response?.status === 405
  ) {
    return (
      'The polygon-settings backend has not been deployed yet. ' +
      'Your draft has not been saved.'
    );
  }

  return message;
}

export default function RoutePlannerSettings({
  settings,
  online,
  busy,
  onApply,
  onReload,
}) {
  const [polygon, setPolygon] = useState(() =>
    savedPolygon(settings)
  );

  const [label, setLabel] = useState(() =>
    defaultLabel(settings)
  );

  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pickerVersion, setPickerVersion] = useState(0);

  const previousRevision = useRef(
    settings?.revision ?? null
  );

  const revision = settings?.revision ?? null;

  useEffect(() => {
    if (previousRevision.current === revision) return;

    previousRevision.current = revision;

    setPolygon(savedPolygon(settings));
    setLabel(defaultLabel(settings));
    setDirty(false);
    setError('');
    setNotice('');
    setPickerVersion((previous) => previous + 1);
  }, [revision, settings]);

  function changePolygon(next) {
    setPolygon(next);
    setDirty(true);
    setError('');
    setNotice('');
  }

  function restoreSaved() {
    setPolygon(savedPolygon(settings));
    setLabel(defaultLabel(settings));
    setDirty(false);
    setError('');
    setNotice('');
    setPickerVersion((previous) => previous + 1);
  }

  async function save() {
    setError('');
    setNotice('');

    const validationError = validateAreaPolygon(polygon);

    if (validationError) {
      setError(validationError);
      return;
    }

    const areaLabel = label.trim();

    if (!areaLabel || areaLabel.length > 100) {
      setError(
        'Enter an area name between 1 and 100 characters.'
      );
      return;
    }

    try {
      await onApply({
        label: areaLabel,
        polygon,
      });

      setDirty(false);
      setNotice('Delivery area saved.');
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  async function reload() {
    if (dirty) {
      setError(
        'Restore the saved area before reloading, ' +
        'or save your draft first.'
      );
      return;
    }

    setError('');
    setNotice('');

    try {
      await onReload();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  const validationError = polygon
    ? validateAreaPolygon(polygon)
    : '';

  const initialCenter = settings?.area
    ? {
        latitude: settings.area.latitude,
        longitude: settings.area.longitude,
      }
    : null;

  return (
    <section className="terminal-card space-y-5 p-4 md:p-6">
      <div>
        <h2 className="text-lg font-semibold">
          Route Planner Settings
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          Define your delivery area using four draggable corners.
          Address searches and delivery destinations will be
          restricted to the saved outline.
        </p>
      </div>

      <div className="rounded-xl border border-white/15 p-4">
        <p className="text-sm text-slate-400">
          Currently saved area
        </p>

        <p className="mt-1 font-semibold">
          {settings?.area?.label || 'No delivery area saved'}
        </p>

        {settings?.area &&
          settings.area.type !== 'polygon' && (
            <p className="mt-2 text-sm text-amber-200">
              The current selection is an administrative boundary.
              Draw and save a polygon to replace it.
            </p>
          )}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="route-polygon-label"
          className="block font-medium"
        >
          Area name
        </label>

        <input
          id="route-polygon-label"
          type="text"
          maxLength={100}
          value={label}
          disabled={busy}
          className="terminal-input w-full"
          placeholder="For example: My delivery area"
          onChange={(event) => {
            setLabel(event.target.value);
            setDirty(true);
            setError('');
            setNotice('');
          }}
        />
      </div>

      <RouteAreaPicker
        key={pickerVersion}
        value={polygon}
        initialCenter={initialCenter}
        disabled={busy}
        onChange={changePolygon}
      />

      {dirty && (
        <p
          role="status"
          className="text-sm text-amber-200"
        >
          Unsaved draft. The previously saved area remains active.
        </p>
      )}

      <p className="text-sm text-slate-400">
        Saving a different area preserves extracted services and
        historical journeys. Addresses must pass the new area and
        road checks before they can be routed again.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="terminal-button"
          disabled={
            busy ||
            !online ||
            !dirty ||
            !polygon ||
            Boolean(validationError)
          }
          onClick={save}
        >
          Save selected area
        </button>

        <button
          type="button"
          className="terminal-button-secondary"
          disabled={busy || !dirty}
          onClick={restoreSaved}
        >
          Restore saved area
        </button>

        <button
          type="button"
          className="terminal-button-secondary"
          disabled={busy || !online || dirty}
          onClick={reload}
        >
          Reload account settings
        </button>
      </div>

      {!online && (
        <p className="text-sm text-amber-200">
          Reconnect and sign in to save your area.
        </p>
      )}

      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="text-emerald-300">
          {notice}
        </p>
      )}

      <p className="text-sm text-slate-400">
        Settings are stored per account separately from journey
        retention. The selected area does not expand OSRM’s
        available road map.
      </p>
    </section>
  );
}