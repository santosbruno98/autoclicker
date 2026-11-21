import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const TILE_SIZE = 256;
const MAP_HEIGHT = 420;
const MAX_LATITUDE = 85.05112878;

const DEFAULT_CENTER = {
  latitude: 39.7,
  longitude: -8,
};

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteCoordinate(point) {
  return (
    point &&
    Number.isFinite(Number(point.latitude)) &&
    Number.isFinite(Number(point.longitude)) &&
    Math.abs(Number(point.latitude)) <= MAX_LATITUDE &&
    Math.abs(Number(point.longitude)) <= 180
  );
}

function sameCoordinate(first, second) {
  return (
    Math.abs(first[0] - second[0]) < 1e-10 &&
    Math.abs(first[1] - second[1]) < 1e-10
  );
}

export function polygonCorners(polygon) {
  if (
    polygon?.type !== 'Polygon' ||
    !Array.isArray(polygon.coordinates) ||
    polygon.coordinates.length !== 1
  ) {
    return null;
  }

  const ring = polygon.coordinates[0];

  if (
    !Array.isArray(ring) ||
    ring.length !== 5 ||
    !ring.every((coordinate) =>
      Array.isArray(coordinate) &&
      coordinate.length === 2 &&
      coordinate.every(Number.isFinite)
    ) ||
    !sameCoordinate(ring[0], ring[4])
  ) {
    return null;
  }

  return ring.slice(0, 4).map(([longitude, latitude]) => ({
    latitude,
    longitude,
  }));
}

export function polygonFromCorners(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) {
    return null;
  }

  const ring = corners.map((point) => [
    Number(point.longitude),
    Number(point.latitude),
  ]);

  return {
    type: 'Polygon',
    coordinates: [[
      ...ring,
      [...ring[0]],
    ]],
  };
}

function orientation(first, second, third) {
  return (
    (second.longitude - first.longitude) *
      (third.latitude - first.latitude) -
    (second.latitude - first.latitude) *
      (third.longitude - first.longitude)
  );
}

function onSegment(first, second, point) {
  const epsilon = 1e-10;

  return (
    Math.abs(orientation(first, second, point)) <= epsilon &&
    point.longitude >=
      Math.min(first.longitude, second.longitude) - epsilon &&
    point.longitude <=
      Math.max(first.longitude, second.longitude) + epsilon &&
    point.latitude >=
      Math.min(first.latitude, second.latitude) - epsilon &&
    point.latitude <=
      Math.max(first.latitude, second.latitude) + epsilon
  );
}

function segmentsIntersect(a, b, c, d) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);

  const crosses =
    ((first > 0 && second < 0) ||
      (first < 0 && second > 0)) &&
    ((third > 0 && fourth < 0) ||
      (third < 0 && fourth > 0));

  return crosses ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b);
}

export function validateAreaPolygon(polygon) {
  const corners = polygonCorners(polygon);

  if (!corners) {
    return 'The area must have exactly four corners.';
  }

  if (!corners.every(finiteCoordinate)) {
    return 'The area contains invalid coordinates.';
  }

  for (let first = 0; first < corners.length; first++) {
    for (let second = first + 1; second < corners.length; second++) {
      if (
        Math.abs(
          corners[first].latitude - corners[second].latitude
        ) < 1e-8 &&
        Math.abs(
          corners[first].longitude - corners[second].longitude
        ) < 1e-8
      ) {
        return 'Each corner must have a different position.';
      }
    }
  }

  const longitudes = corners.map((point) => point.longitude);

  if (
    Math.max(...longitudes) - Math.min(...longitudes) > 180
  ) {
    return 'Areas crossing the international date line are unsupported.';
  }

  if (
    segmentsIntersect(
      corners[0], corners[1], corners[2], corners[3]
    ) ||
    segmentsIntersect(
      corners[1], corners[2], corners[3], corners[0]
    )
  ) {
    return 'The area edges cross. Move the corners into a simple outline.';
  }

  let twiceArea = 0;

  for (let index = 0; index < corners.length; index++) {
    const current = corners[index];
    const next = corners[(index + 1) % corners.length];

    twiceArea +=
      current.longitude * next.latitude -
      next.longitude * current.latitude;

    const previous = corners[
      (index + corners.length - 1) % corners.length
    ];

    if (
      Math.abs(orientation(previous, current, next)) < 1e-10
    ) {
      return 'Three neighbouring corners cannot lie on one straight line.';
    }
  }

  if (Math.abs(twiceArea) < 1e-10) {
    return 'The selected area is too small or has no area.';
  }

  return '';
}

export function approximateAreaKm2(polygon) {
  const corners = polygonCorners(polygon);
  if (!corners) return 0;

  const meanLatitude = corners.reduce(
    (sum, point) => sum + point.latitude,
    0
  ) / corners.length;

  const origin = corners[0];
  const longitudeScale =
    111.32 * Math.cos(meanLatitude * Math.PI / 180);

  const points = corners.map((point) => ({
    x: (point.longitude - origin.longitude) * longitudeScale,
    y: (point.latitude - origin.latitude) * 111.32,
  }));

  let twiceArea = 0;

  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];

    twiceArea += current.x * next.y - next.x * current.y;
  }

  return Math.abs(twiceArea) / 2;
}

function worldPoint(point, zoom) {
  const size = TILE_SIZE * 2 ** zoom;
  const latitude = clamp(
    Number(point.latitude),
    -MAX_LATITUDE,
    MAX_LATITUDE
  );

  const sine = Math.sin(latitude * Math.PI / 180);

  return {
    x: (Number(point.longitude) + 180) / 360 * size,
    y: (
      0.5 -
      Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)
    ) * size,
  };
}

function geographicPoint(point, zoom) {
  const size = TILE_SIZE * 2 ** zoom;
  const n = Math.PI - 2 * Math.PI * point.y / size;

  return {
    longitude: clamp(point.x / size * 360 - 180, -180, 180),
    latitude: clamp(
      Math.atan(Math.sinh(n)) * 180 / Math.PI,
      -MAX_LATITUDE,
      MAX_LATITUDE
    ),
  };
}

function pointerGeometry(pointers) {
  const points = [...pointers.values()];

  if (points.length === 1) {
    return { ...points[0], distance: 0 };
  }

  const first = points[0];
  const second = points[1];

  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    distance: Math.hypot(
      first.x - second.x,
      first.y - second.y
    ),
  };
}

function fitView(corners, width) {
  const points = corners.map((point) => worldPoint(point, 0));

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));

  const availableWidth = Math.max(100, width - 100);
  const availableHeight = MAP_HEIGHT - 100;

  const zoom = clamp(
    Math.log2(Math.min(
      availableWidth / Math.max(maxX - minX, 0.00001),
      availableHeight / Math.max(maxY - minY, 0.00001)
    )),
    2,
    18
  );

  return {
    center: geographicPoint({
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    }, 0),
    zoom,
  };
}

export default function RouteAreaPicker({
  value,
  onChange,
  initialCenter,
  disabled = false,
}) {
  const container = useRef(null);
  const initialFit = useRef(false);

  const [width, setWidth] = useState(360);
  const [locationError, setLocationError] = useState('');
  const [locating, setLocating] = useState(false);

  const [view, setView] = useState(() => {
    const corners = polygonCorners(value);

    if (corners) {
      return fitView(corners, 360);
    }

    const center = finiteCoordinate(initialCenter)
      ? {
          latitude: Number(initialCenter.latitude),
          longitude: Number(initialCenter.longitude),
        }
      : DEFAULT_CENTER;

    return {
      center,
      zoom: finiteCoordinate(initialCenter) ? 11 : 7,
    };
  });

  const currentView = useRef(view);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  const widthRef = useRef(width);

  currentView.current = view;
  valueRef.current = value;
  onChangeRef.current = onChange;
  disabledRef.current = disabled;
  widthRef.current = width;

  const gesture = useRef({
    pointers: new Map(),
    mode: 'pan',
    corner: null,
    start: null,
  });

  function updateView(next) {
    currentView.current = next;
    setView(next);
  }

  function rectangleAt(nextView) {
    const center = worldPoint(nextView.center, nextView.zoom);
    const halfWidth = widthRef.current * 0.3;
    const halfHeight = MAP_HEIGHT * 0.25;

    return polygonFromCorners([
      geographicPoint({
        x: center.x - halfWidth,
        y: center.y - halfHeight,
      }, nextView.zoom),
      geographicPoint({
        x: center.x + halfWidth,
        y: center.y - halfHeight,
      }, nextView.zoom),
      geographicPoint({
        x: center.x + halfWidth,
        y: center.y + halfHeight,
      }, nextView.zoom),
      geographicPoint({
        x: center.x - halfWidth,
        y: center.y + halfHeight,
      }, nextView.zoom),
    ]);
  }

  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;

    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(1, entry.contentRect.width);
      widthRef.current = nextWidth;
      setWidth(nextWidth);

      if (!initialFit.current) {
        initialFit.current = true;

        const corners = polygonCorners(valueRef.current);

        if (corners) {
          const nextView = fitView(corners, nextWidth);
          currentView.current = nextView;
          setView(nextView);
        }
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;

    const wheel = (event) => {
      if (disabledRef.current) return;

      event.preventDefault();

      const current = currentView.current;
      const next = {
        ...current,
        zoom: clamp(
          current.zoom + (event.deltaY < 0 ? 0.5 : -0.5),
          2,
          19
        ),
      };

      currentView.current = next;
      setView(next);
    };

    element.addEventListener('wheel', wheel, { passive: false });

    return () => element.removeEventListener('wheel', wheel);
  }, []);

  function pointerPosition(event) {
    const rectangle = event.currentTarget.getBoundingClientRect();

    return {
      x: event.clientX - rectangle.left - rectangle.width / 2,
      y: event.clientY - rectangle.top - rectangle.height / 2,
    };
  }

  function resetGestureStart() {
    const active = gesture.current;

    if (!active.pointers.size) {
      active.start = null;
      return;
    }

    const current = currentView.current;

    active.start = {
      ...pointerGeometry(active.pointers),
      zoom: current.zoom,
      center: worldPoint(current.center, current.zoom),
    };
  }

  function pointerDown(event) {
    if (disabled || event.button !== 0) return;

    event.preventDefault();

    const active = gesture.current;
    const cornerElement = event.target.closest?.('[data-corner]');

    active.pointers.set(
      event.pointerId,
      pointerPosition(event)
    );

    if (active.pointers.size === 1 && cornerElement) {
      active.mode = 'corner';
      active.corner = Number(cornerElement.dataset.corner);
    } else {
      active.mode = 'pan';
      active.corner = null;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    resetGestureStart();
  }

  function pointerMove(event) {
    if (disabled) return;

    const active = gesture.current;
    if (!active.pointers.has(event.pointerId)) return;

    event.preventDefault();

    const position = pointerPosition(event);
    active.pointers.set(event.pointerId, position);

    if (
      active.mode === 'corner' &&
      active.pointers.size === 1
    ) {
      const corners = polygonCorners(valueRef.current);
      if (!corners || active.corner == null) return;

      const current = currentView.current;
      const center = worldPoint(current.center, current.zoom);

      corners[active.corner] = geographicPoint({
        x: center.x + position.x,
        y: center.y + position.y,
      }, current.zoom);

      onChangeRef.current(polygonFromCorners(corners));
      return;
    }

    if (!active.start) return;

    const geometry = pointerGeometry(active.pointers);
    const start = active.start;

    const zoom = clamp(
      start.distance > 0 && geometry.distance > 0
        ? start.zoom + Math.log2(
            geometry.distance / start.distance
          )
        : start.zoom,
      2,
      19
    );

    const scale = 2 ** (zoom - start.zoom);

    const center = geographicPoint({
      x: (start.center.x + start.x) * scale - geometry.x,
      y: (start.center.y + start.y) * scale - geometry.y,
    }, zoom);

    updateView({ center, zoom });
  }

  function pointerEnd(event) {
    const active = gesture.current;
    active.pointers.delete(event.pointerId);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    active.mode = 'pan';
    active.corner = null;
    resetGestureStart();
  }

  function zoomBy(amount) {
    updateView({
      ...currentView.current,
      zoom: clamp(currentView.current.zoom + amount, 2, 19),
    });
  }

  function fitArea() {
    const corners = polygonCorners(valueRef.current);
    if (corners) {
      updateView(fitView(corners, widthRef.current));
    }
  }

  async function areaAroundLocation() {
    setLocationError('');

    if (!navigator.geolocation) {
      setLocationError('This browser does not provide geolocation.');
      return;
    }

    setLocating(true);

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0,
        });
      });

      const nextView = {
        center: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
        zoom: 12,
      };

      updateView(nextView);
      onChangeRef.current(rectangleAt(nextView));
    } catch (error) {
      setLocationError(
        error.message || 'Cannot obtain your current location.'
      );
    } finally {
      setLocating(false);
    }
  }

  const corners = polygonCorners(value);
  const validationError = value ? validateAreaPolygon(value) : '';

  const center = worldPoint(view.center, view.zoom);
  const left = center.x - width / 2;
  const top = center.y - MAP_HEIGHT / 2;

  const projectedCorners = corners?.map((point) => {
    const projected = worldPoint(point, view.zoom);

    return {
      x: projected.x - left,
      y: projected.y - top,
    };
  }) || [];

  const polygonPoints = projectedCorners.map(
    (point) => `${point.x},${point.y}`
  ).join(' ');

  const tiles = useMemo(() => {
    const tileZoom = Math.floor(view.zoom);
    const scale = 2 ** (view.zoom - tileZoom);
    const size = TILE_SIZE * scale;
    const count = 2 ** tileZoom;

    const firstX = Math.floor(left / size);
    const lastX = Math.floor((left + width) / size);
    const firstY = Math.floor(top / size);
    const lastY = Math.floor((top + MAP_HEIGHT) / size);

    const result = [];

    for (let y = firstY; y <= lastY; y++) {
      if (y < 0 || y >= count) continue;

      for (let x = firstX; x <= lastX; x++) {
        const wrappedX = ((x % count) + count) % count;

        result.push(
          <img
            key={`${tileZoom}:${x}:${y}`}
            src={
              `https://tile.openstreetmap.org/` +
              `${tileZoom}/${wrappedX}/${y}.png`
            }
            alt=""
            draggable={false}
            referrerPolicy="strict-origin-when-cross-origin"
            style={{
              position: 'absolute',
              left: x * size - left,
              top: y * size - top,
              width: size + 0.5,
              height: size + 0.5,
              maxWidth: 'none',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        );
      }
    }

    return result;
  }, [view.zoom, left, top, width]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Drag the map to move around. Pinch or use the zoom buttons.
        Drag the four numbered corners to define your delivery area.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="terminal-button-secondary"
          disabled={disabled}
          onClick={() => zoomBy(1)}
        >
          Zoom +
        </button>

        <button
          type="button"
          className="terminal-button-secondary"
          disabled={disabled}
          onClick={() => zoomBy(-1)}
        >
          Zoom −
        </button>

        <button
          type="button"
          className="terminal-button-secondary"
          disabled={disabled || !corners}
          onClick={fitArea}
        >
          Fit selected area
        </button>

        <button
          type="button"
          className="terminal-button-secondary"
          disabled={disabled}
          onClick={() =>
            onChange(rectangleAt(currentView.current))
          }
        >
          Draw rectangle here
        </button>

        <button
          type="button"
          className="terminal-button-secondary"
          disabled={disabled || locating}
          onClick={areaAroundLocation}
        >
          {locating
            ? 'Getting location…'
            : 'Create area around my location'}
        </button>
      </div>

      <div
        className="relative overflow-hidden rounded-xl border border-white/20"
        style={{ height: MAP_HEIGHT }}
      >
        <div
          ref={container}
          aria-label="Delivery area map"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd}
          onLostPointerCapture={(event) => {
            if (gesture.current.pointers.has(event.pointerId)) {
              gesture.current.pointers.delete(event.pointerId);
              gesture.current.mode = 'pan';
              resetGestureStart();
            }
          }}
          onContextMenu={(event) => event.preventDefault()}
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            background: '#243447',
            touchAction: 'none',
            userSelect: 'none',
            cursor: disabled ? 'default' : 'grab',
          }}
        >
          {tiles}

          <svg
            width="100%"
            height={MAP_HEIGHT}
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
            }}
          >
            {corners && (
              <>
                <polygon
                  points={polygonPoints}
                  fill={
                    validationError
                      ? 'rgba(239,68,68,0.22)'
                      : 'rgba(6,182,212,0.22)'
                  }
                  stroke={validationError ? '#ef4444' : '#06b6d4'}
                  strokeWidth="3"
                  pointerEvents="none"
                />

                {projectedCorners.map((point, index) => (
                  <g
                    key={index}
                    data-corner={index}
                    transform={`translate(${point.x},${point.y})`}
                    style={{ cursor: disabled ? 'default' : 'move' }}
                  >
                    <circle
                      r="24"
                      fill="transparent"
                      data-corner={index}
                    />

                    <circle
                      r="15"
                      fill="#06b6d4"
                      stroke="#ffffff"
                      strokeWidth="3"
                      data-corner={index}
                    />

                    <text
                      x="0"
                      y="5"
                      textAnchor="middle"
                      fill="#05202b"
                      fontSize="14"
                      fontWeight="700"
                      pointerEvents="none"
                    >
                      {index + 1}
                    </text>
                  </g>
                ))}
              </>
            )}
          </svg>
        </div>

        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            padding: '3px 6px',
            fontSize: 11,
            background: 'white',
            color: 'black',
            zIndex: 2,
          }}
        >
          © OpenStreetMap contributors
        </a>
      </div>

      {!corners && (
        <p className="text-sm text-amber-200">
          Move to your delivery region, then press “Draw rectangle here”,
          or create an area around your current location.
        </p>
      )}

      {validationError && (
        <p role="alert" className="text-sm text-red-300">
          {validationError}
        </p>
      )}

      {locationError && (
        <p role="alert" className="text-sm text-red-300">
          {locationError}
        </p>
      )}

      {corners && (
        <>
          <p className="text-sm text-slate-400">
            Approximate area: {approximateAreaKm2(value).toLocaleString(
              undefined,
              { maximumFractionDigits: 2 }
            )} km²
          </p>

          <details>
            <summary className="cursor-pointer text-sm">
              Corner coordinates
            </summary>

            <ol className="mt-2 space-y-1 font-mono text-xs">
              {corners.map((point, index) => (
                <li key={index}>
                  {index + 1}: {point.latitude.toFixed(6)},{' '}
                  {point.longitude.toFixed(6)}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </div>
  );
}