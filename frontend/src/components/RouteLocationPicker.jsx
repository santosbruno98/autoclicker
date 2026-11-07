import React, { useEffect, useRef, useState } from 'react';

const TILE = 256;
const MAP_HEIGHT = 360;
const DRAG_THRESHOLD = 8;
const MAX_LATITUDE = 85.05112878;

function clampZoom(zoom) {
  return Math.max(2, Math.min(19, zoom));
}

function worldPoint(latitude, longitude, zoom) {
  const size = TILE * 2 ** zoom;
  const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
  const sine = Math.sin(lat * Math.PI / 180);

  return {
    x: (longitude + 180) / 360 * size,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size,
  };
}

function geographicPoint(x, y, zoom) {
  const size = TILE * 2 ** zoom;
  const wrappedX = ((x % size) + size) % size;
  const clampedY = Math.max(0, Math.min(size, y));

  return {
    longitude: wrappedX / size * 360 - 180,
    latitude: Math.atan(
      Math.sinh(Math.PI * (1 - 2 * clampedY / size))
    ) * 180 / Math.PI,
  };
}

function pointerGeometry(pointers) {
  const [first, second] = pointers.values();

  if (!second) return { ...first, distance: 0 };

  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    distance: Math.hypot(second.x - first.x, second.y - first.y),
  };
}

export default function RouteLocationPicker({
  initial,
  title,
  onConfirm,
  onCancel,
}) {
  const [view, setView] = useState(() => ({ center: initial, zoom: 16 }));
  const [selected, setSelected] = useState(null);
  const [width, setWidth] = useState(360);
  const container = useRef(null);
  const currentView = useRef(view);
  const gesture = useRef({
    pointers: new Map(),
    start: null,
    canTap: false,
  });

  useEffect(() => {
    const element = container.current;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function updateView(nextView) {
    currentView.current = nextView;
    setView(nextView);
  }

  function pointerPosition(event) {
    const rect = event.currentTarget.getBoundingClientRect();

    return {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
  }

  function resetGestureStart() {
    const active = gesture.current;

    if (active.pointers.size === 0) {
      active.start = null;
      return;
    }

    const { center, zoom } = currentView.current;
    active.start = {
      ...pointerGeometry(active.pointers),
      middle: worldPoint(center.latitude, center.longitude, zoom),
      zoom,
    };
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;

    const active = gesture.current;
    active.canTap = active.pointers.size === 0;
    active.pointers.set(event.pointerId, pointerPosition(event));
    event.currentTarget.setPointerCapture(event.pointerId);
    resetGestureStart();
  }

  function handlePointerMove(event) {
    const active = gesture.current;
    if (!active.pointers.has(event.pointerId)) return;

    active.pointers.set(event.pointerId, pointerPosition(event));
    const position = pointerGeometry(active.pointers);
    const start = active.start;

    if (active.canTap) {
      const movement = Math.hypot(position.x - start.x, position.y - start.y);
      if (movement < DRAG_THRESHOLD) return;
      active.canTap = false;
    }

    const zoom = start.distance > 0
      ? clampZoom(start.zoom + Math.round(
        Math.log2(Math.max(1, position.distance) / start.distance)
      ))
      : start.zoom;
    const scale = 2 ** (zoom - start.zoom);

    updateView({
      zoom,
      center: geographicPoint(
        (start.middle.x + start.x) * scale - position.x,
        (start.middle.y + start.y) * scale - position.y,
        zoom
      ),
    });
  }

  function finishPointer(event, cancelled) {
    const active = gesture.current;
    if (!active.pointers.has(event.pointerId)) return;

    if (!cancelled) {
      handlePointerMove(event);

      if (active.canTap) {
        const { center, zoom } = currentView.current;
        const middle = worldPoint(center.latitude, center.longitude, zoom);
        const position = pointerPosition(event);

        setSelected(geographicPoint(
          middle.x + position.x,
          middle.y + position.y,
          zoom
        ));
      }
    }

    active.canTap = false;
    active.pointers.delete(event.pointerId);
    resetGestureStart();
  }

  const { center, zoom } = view;
  const middle = worldPoint(center.latitude, center.longitude, zoom);
  const left = middle.x - width / 2;
  const top = middle.y - MAP_HEIGHT / 2;
  const count = 2 ** zoom;
  const worldWidth = TILE * count;
  const tiles = [];

  function pan(dx, dy) {
    updateView({
      center: geographicPoint(middle.x + dx, middle.y + dy, zoom),
      zoom,
    });
  }

  function changeZoom(delta) {
    updateView({ center, zoom: clampZoom(zoom + delta) });
  }

  for (let x = Math.floor(left / TILE); x <= Math.floor((left + width) / TILE); x++) {
    for (let y = Math.floor(top / TILE); y <= Math.floor((top + MAP_HEIGHT) / TILE); y++) {
      if (y < 0 || y >= count) continue;
      const wrappedX = ((x % count) + count) % count;

      tiles.push(
        <img
          key={`${zoom}:${x}:${y}`}
          src={`https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            width: TILE,
            height: TILE,
            maxWidth: 'none',
            left: x * TILE - left,
            top: y * TILE - top,
            pointerEvents: 'none',
          }}
        />
      );
    }
  }

  const pin = selected && worldPoint(selected.latitude, selected.longitude, zoom);
  const pinX = pin && pin.x + Math.round((middle.x - pin.x) / worldWidth) * worldWidth;

  return (
    <section className="terminal-card space-y-3 p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-slate-400">
        Drag to move the map, pinch to zoom, and tap to place the pin.
        Scroll outside the map to move down the page.
        The planner checks the pin against the road network before routing.
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => pan(-width / 3, 0)}>← West</button>
        <button type="button" onClick={() => pan(0, -MAP_HEIGHT / 3)}>↑ North</button>
        <button type="button" onClick={() => pan(0, MAP_HEIGHT / 3)}>↓ South</button>
        <button type="button" onClick={() => pan(width / 3, 0)}>East →</button>
        <button type="button" onClick={() => changeZoom(1)}>Zoom +</button>
        <button type="button" onClick={() => changeZoom(-1)}>Zoom −</button>
        <button type="button" onClick={() => setSelected(center)}>Select map center</button>
      </div>

      <div style={{ position: 'relative' }}>
        <div
          ref={container}
          role="application"
          aria-label="Drag to move the map, pinch to zoom, or tap to place a pin"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishPointer(event, false)}
          onPointerCancel={(event) => finishPointer(event, true)}
          onLostPointerCapture={(event) => finishPointer(event, true)}
          style={{
            position: 'relative',
            height: MAP_HEIGHT,
            overflow: 'hidden',
            background: '#1e293b',
            cursor: 'crosshair',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          {tiles}

          {pin && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: pinX - left,
                top: pin.y - top,
                transform: 'translate(-50%, -100%)',
                fontSize: 32,
                pointerEvents: 'none',
              }}
            >
              📍
            </span>
          )}
        </div>

        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            background: 'white',
            color: 'black',
            fontSize: 11,
            padding: 3,
          }}
        >
          © OpenStreetMap contributors
        </a>
      </div>

      <div aria-live="polite">
        {selected && (
          <p className="break-all font-mono text-sm">
            {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="terminal-button"
          disabled={!selected}
          onClick={() => onConfirm(selected)}
        >
          Use selected location
        </button>
        <button
          type="button"
          className="terminal-button-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}