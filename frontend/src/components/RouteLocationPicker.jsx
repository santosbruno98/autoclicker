import React, { useEffect, useRef, useState } from 'react';

const TILE = 256;

function worldPoint(latitude, longitude, zoom) {
  const size = TILE * 2 ** zoom;
  const lat = Math.max(-85, Math.min(85, latitude));
  const sine = Math.sin(lat * Math.PI / 180);

  return {
    x: (longitude + 180) / 360 * size,
    y: (
      0.5 -
      Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)
    ) * size,
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

export default function RouteLocationPicker({
  initial,
  title,
  onConfirm,
  onCancel,
}) {
  const [center, setCenter] = useState(initial);
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(16);
  const [width, setWidth] = useState(360);
  const container = useRef(null);
  const height = 360;

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  const middle = worldPoint(center.latitude, center.longitude, zoom);
  const left = middle.x - width / 2;
  const top = middle.y - height / 2;
  const count = 2 ** zoom;
  const tiles = [];

  for (
    let x = Math.floor(left / TILE);
    x <= Math.floor((left + width) / TILE);
    x++
  ) {
    for (
      let y = Math.floor(top / TILE);
      y <= Math.floor((top + height) / TILE);
      y++
    ) {
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

  const pin = selected && worldPoint(
    selected.latitude,
    selected.longitude,
    zoom
  );

  function pan(dx, dy) {
    setCenter(geographicPoint(
      middle.x + dx,
      middle.y + dy,
      zoom
    ));
  }

  return (
    <section className="terminal-card space-y-3 p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-slate-400">
        Move or zoom the map, then tap the destination.
        The pin is checked against the road network before routing.
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => pan(-width / 3, 0)}>
          ← West
        </button>
        <button type="button" onClick={() => pan(0, -height / 3)}>
          ↑ North
        </button>
        <button type="button" onClick={() => pan(0, height / 3)}>
          ↓ South
        </button>
        <button type="button" onClick={() => pan(width / 3, 0)}>
          East →
        </button>
        <button
          type="button"
          onClick={() => setZoom((value) => Math.min(19, value + 1))}
        >
          Zoom +
        </button>
        <button
          type="button"
          onClick={() => setZoom((value) => Math.max(2, value - 1))}
        >
          Zoom −
        </button>
      </div>

      <div
        ref={container}
        role="application"
        aria-label="Tap the map to select a location"
        onClick={(event) => {
          const rectangle = event.currentTarget.getBoundingClientRect();
          setSelected(geographicPoint(
            left + event.clientX - rectangle.left,
            top + event.clientY - rectangle.top,
            zoom
          ));
        }}
        style={{
          position: 'relative',
          height,
          overflow: 'hidden',
          background: '#1e293b',
          cursor: 'crosshair',
        }}
      >
        {tiles}

        {pin && (
          <span
            style={{
              position: 'absolute',
              left: pin.x - left,
              top: pin.y - top,
              transform: 'translate(-50%, -100%)',
              color: '#e11d48',
              fontSize: 32,
              pointerEvents: 'none',
            }}
          >
            📍
          </span>
        )}

        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
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

      {selected && (
        <p className="break-all font-mono text-sm">
          {selected.latitude}, {selected.longitude}
        </p>
      )}

      <div className="flex gap-3">
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