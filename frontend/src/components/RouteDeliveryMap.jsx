import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const TILE = 256;
const HEIGHT = 430;
const EARTH_RADIUS = 6371008.8;
const CITY_RADIUS = 200;

export function classifyDeliveryLocality(locality) {
  const value = String(locality || '')
    .split(',')[0]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  if (!value) return 'review';

  return [
    'sabugal',
    'cidade do sabugal',
    'cidade de sabugal',
  ].includes(value)
    ? 'city'
    : 'villages';
}

export function deliverySection(service) {
  if (
    service.routing_section_override === 'city' ||
    service.routing_section_override === 'villages'
  ) {
    return service.routing_section_override;
  }

  return classifyDeliveryLocality(service.locality);
}

export function pointValid(point) {
  return point?.latitude != null &&
    point?.longitude != null &&
    String(point.latitude).trim() !== '' &&
    String(point.longitude).trim() !== '' &&
    Number.isFinite(Number(point.latitude)) &&
    Number.isFinite(Number(point.longitude)) &&
    Math.abs(Number(point.latitude)) <= 90 &&
    Math.abs(Number(point.longitude)) <= 180;
}

export function distanceMeters(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitude1 = radians(Number(first.latitude));
  const latitude2 = radians(Number(second.latitude));
  const latitudeDifference = latitude2 - latitude1;
  const longitudeDifference = radians(
    Number(second.longitude) - Number(first.longitude)
  );

  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(longitudeDifference / 2) ** 2;

  return 2 * EARTH_RADIUS *
    Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function world(point, zoom) {
  const size = TILE * 2 ** zoom;
  const latitude = clamp(Number(point.latitude), -85.05112878, 85.05112878);
  const sine = Math.sin(latitude * Math.PI / 180);

  return {
    x: (Number(point.longitude) + 180) / 360 * size,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size,
  };
}

function geographic(point, zoom) {
  const size = TILE * 2 ** zoom;

  return {
    longitude: clamp(point.x / size * 360 - 180, -180, 180),
    latitude: Math.atan(
      Math.sinh(Math.PI - 2 * Math.PI * point.y / size)
    ) * 180 / Math.PI,
  };
}

function fitView(points, width, city) {
  if (!points.length) {
    return {
      center: { latitude: 40.4, longitude: -7.15 },
      zoom: 9,
    };
  }

  const projected = points.map((point) => world(point, 0));
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));

  const zoom = clamp(
    Math.log2(Math.min(
      Math.max(100, width - 90) / Math.max(maxX - minX, 0.00001),
      (HEIGHT - 100) / Math.max(maxY - minY, 0.00001)
    )),
    2,
    city ? 16 : 14
  );

  return {
    center: geographic({
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    }, 0),
    zoom,
  };
}

function circlePoints(center) {
  const latitude = Number(center.latitude) * Math.PI / 180;
  const longitude = Number(center.longitude) * Math.PI / 180;
  const angularDistance = CITY_RADIUS / EARTH_RADIUS;

  return Array.from({ length: 73 }, (_, index) => {
    const bearing = index / 72 * 2 * Math.PI;

    const nextLatitude = Math.asin(
      Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing)
    );

    const nextLongitude = longitude + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(nextLatitude)
    );

    return {
      latitude: nextLatitude * 180 / Math.PI,
      longitude: nextLongitude * 180 / Math.PI,
    };
  });
}

function totals(stops) {
  const result = {
    destinations: stops.length,
    services: 0,
    deliveryParcels: 0,
    pickups: 0,
    unknown: 0,
  };

  for (const stop of stops) {
    for (const service of stop.services || []) {
      result.services++;

      if (service.service_type === 'delivery') {
        result.deliveryParcels += Math.max(
          1,
          Number(service.parcel_count) || 1
        );
      } else if (service.service_type === 'pickup') {
        result.pickups++;
      } else {
        result.unknown++;
      }
    }
  }

  return result;
}

function pointerGeometry(pointers) {
  const points = [...pointers.values()];

  if (points.length === 1) {
    return { ...points[0], distance: 0 };
  }

  return {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
    distance: Math.hypot(
      points[0].x - points[1].x,
      points[0].y - points[1].y
    ),
  };
}

export default function RouteDeliveryMap({
  section,
  stops,
  origin,
  contextStops = [],
  orderedPath = [],
}) {
  const city = section === 'city';
  const container = useRef(null);
  const [width, setWidth] = useState(360);
  const [focus, setFocus] = useState(null);

  const validStops = useMemo(
    () => stops.filter(pointValid),
    [stops]
  );

  const fitPoints = useMemo(
    () => city
      ? validStops
      : [
          ...(pointValid(origin) ? [origin] : []),
          ...validStops,
          ...contextStops.filter(pointValid),
          ...orderedPath.filter(pointValid),
        ],
    [city, validStops, origin, contextStops, orderedPath]
  );

  const signature = JSON.stringify(
    fitPoints.map((point) => [point.latitude, point.longitude])
  );

  const [view, setView] = useState(() =>
    fitView(fitPoints, 360, city)
  );
  const viewRef = useRef(view);
  viewRef.current = view;

  const gesture = useRef({
    pointers: new Map(),
    start: null,
    tap: false,
  });

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(1, entry.contentRect.width));
    });

    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const next = fitView(fitPoints, width, city);
    viewRef.current = next;
    setView(next);
    setFocus(null);
  }, [signature, city, width]);

  useEffect(() => {
    const element = container.current;

    function wheel(event) {
      event.preventDefault();

      setView((current) => {
        const next = {
          ...current,
          zoom: clamp(
            current.zoom + (event.deltaY < 0 ? 0.5 : -0.5),
            2,
            19
          ),
        };
        viewRef.current = next;
        return next;
      });
    }

    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  const nearby = useMemo(
    () => city && focus
      ? validStops.filter((stop) =>
          distanceMeters(focus, stop) <= CITY_RADIUS
        )
      : [],
    [city, focus, validStops]
  );

  const summary = totals(city && focus ? nearby : validStops);

  function updateView(next) {
    viewRef.current = next;
    setView(next);
  }

  function fit() {
    updateView(fitView(fitPoints, width, city));
  }

  function position(event) {
    const rectangle = event.currentTarget.getBoundingClientRect();

    return {
      x: event.clientX - rectangle.left - rectangle.width / 2,
      y: event.clientY - rectangle.top - rectangle.height / 2,
    };
  }

  function resetStart() {
    const active = gesture.current;

    if (!active.pointers.size) {
      active.start = null;
      return;
    }

    active.start = {
      ...pointerGeometry(active.pointers),
      zoom: viewRef.current.zoom,
      center: world(viewRef.current.center, viewRef.current.zoom),
    };
  }

  function pointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();

    const active = gesture.current;
    const point = position(event);

    active.tap = active.pointers.size === 0;
    active.pointers.set(event.pointerId, point);

    if (active.pointers.size > 1) active.tap = false;

    event.currentTarget.setPointerCapture(event.pointerId);
    resetStart();
  }

  function pointerMove(event) {
    const active = gesture.current;
    if (!active.pointers.has(event.pointerId) || !active.start) return;

    const point = position(event);
    active.pointers.set(event.pointerId, point);

    const geometry = pointerGeometry(active.pointers);
    const start = active.start;

    if (
      Math.hypot(geometry.x - start.x, geometry.y - start.y) > 7
    ) active.tap = false;

    if (active.tap) return;

    const zoom = clamp(
      start.distance > 0 && geometry.distance > 0
        ? start.zoom + Math.log2(geometry.distance / start.distance)
        : start.zoom,
      2,
      19
    );

    const scale = 2 ** (zoom - start.zoom);

    updateView({
      zoom,
      center: geographic({
        x: (start.center.x + start.x) * scale - geometry.x,
        y: (start.center.y + start.y) * scale - geometry.y,
      }, zoom),
    });
  }

  function chooseFocus(point) {
    setFocus(point);

    if (city) {
      updateView({
        center: {
          latitude: Number(point.latitude),
          longitude: Number(point.longitude),
        },
        zoom: 16,
      });
    }
  }

  function pointerUp(event) {
    const active = gesture.current;

    if (active.tap && active.pointers.size === 1 && city) {
      const current = viewRef.current;
      const center = world(current.center, current.zoom);
      const point = position(event);

      let closest = null;
      let closestDistance = 25;

      for (const stop of validStops) {
        const projected = world(stop, current.zoom);
        const distance = Math.hypot(
          projected.x - center.x - point.x,
          projected.y - center.y - point.y
        );

        if (distance < closestDistance) {
          closest = stop;
          closestDistance = distance;
        }
      }

      chooseFocus(closest || geographic({
        x: center.x + point.x,
        y: center.y + point.y,
      }, current.zoom));
    }

    active.pointers.delete(event.pointerId);
    active.tap = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resetStart();
  }

  function busiestArea() {
    let best = null;
    let bestParcels = -1;
    let bestServices = -1;

    for (const candidate of validStops) {
      const group = validStops.filter((stop) =>
        distanceMeters(candidate, stop) <= CITY_RADIUS
      );
      const count = totals(group);

      if (
        count.deliveryParcels > bestParcels ||
        (count.deliveryParcels === bestParcels &&
          count.services > bestServices)
      ) {
        best = candidate;
        bestParcels = count.deliveryParcels;
        bestServices = count.services;
      }
    }

    if (best) chooseFocus(best);
  }

  const center = world(view.center, view.zoom);
  const left = center.x - width / 2;
  const top = center.y - HEIGHT / 2;

  function screen(point) {
    const projected = world(point, view.zoom);
    return { x: projected.x - left, y: projected.y - top };
  }

  const tileZoom = Math.floor(view.zoom);
  const tileScale = 2 ** (view.zoom - tileZoom);
  const tileSize = TILE * tileScale;
  const tileCount = 2 ** tileZoom;
  const tiles = [];

  for (
    let y = Math.floor(top / tileSize);
    y <= Math.floor((top + HEIGHT) / tileSize);
    y++
  ) {
    if (y < 0 || y >= tileCount) continue;

    for (
      let x = Math.floor(left / tileSize);
      x <= Math.floor((left + width) / tileSize);
      x++
    ) {
      const wrappedX = ((x % tileCount) + tileCount) % tileCount;

      tiles.push(
        <img
          key={`${tileZoom}:${x}:${y}`}
          src={`https://tile.openstreetmap.org/${tileZoom}/${wrappedX}/${y}.png`}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: x * tileSize - left,
            top: y * tileSize - top,
            width: tileSize + 0.5,
            height: tileSize + 0.5,
            maxWidth: 'none',
            pointerEvents: 'none',
          }}
        />
      );
    }
  }

  const circle = city && focus
    ? circlePoints(focus).map((point) => {
        const projected = screen(point);
        return `${projected.x},${projected.y}`;
      }).join(' ')
    : '';

  const path = !city
    ? orderedPath.filter(pointValid).map((point) => {
        const projected = screen(point);
        return `${projected.x},${projected.y}`;
      }).join(' ')
    : '';

  return (
    <section className="terminal-card space-y-4 p-4">
      <h3 className="font-semibold">
        {city ? 'Sabugal city — unloading areas' : 'Villages — regional overview'}
      </h3>

      <p className="text-sm text-slate-400">
        {city
          ? 'Tap the map or a delivery pin to inspect a 200 m straight-line radius.'
          : 'The view includes your starting point and village destinations. Dashed lines show visit order as straight-line connections.'}
      </p>

      <div className="flex flex-wrap gap-2">
        <button className="terminal-button-secondary" onClick={fit}>
          Fit {city ? 'city deliveries' : 'regional journey'}
        </button>

        <button
          className="terminal-button-secondary"
          onClick={() => updateView({
            ...viewRef.current,
            zoom: clamp(viewRef.current.zoom + 1, 2, 19),
          })}
        >
          Zoom +
        </button>

        <button
          className="terminal-button-secondary"
          onClick={() => updateView({
            ...viewRef.current,
            zoom: clamp(viewRef.current.zoom - 1, 2, 19),
          })}
        >
          Zoom −
        </button>

        {city && (
          <>
            <button
              className="terminal-button-secondary"
              disabled={!validStops.length}
              onClick={busiestArea}
            >
              Most delivery parcels near a pin
            </button>
            <button
              className="terminal-button-secondary"
              onClick={() => setFocus(null)}
            >
              Clear circle
            </button>
          </>
        )}
      </div>

      <div className="relative overflow-hidden rounded-xl border border-white/15">
        <div
          ref={container}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={(event) => {
            gesture.current.tap = false;
            pointerUp(event);
          }}
          onContextMenu={(event) => event.preventDefault()}
          style={{
            position: 'relative',
            height: HEIGHT,
            overflow: 'hidden',
            touchAction: 'none',
            userSelect: 'none',
            background: '#243447',
          }}
        >
          {tiles}

          <svg
            width="100%"
            height={HEIGHT}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            {path && (
              <polyline
                points={path}
                fill="none"
                stroke="#f97316"
                strokeWidth="3"
                strokeDasharray="7 5"
              />
            )}

            {circle && (
              <polygon
                points={circle}
                fill="rgba(6,182,212,0.18)"
                stroke="#0891b2"
                strokeWidth="2"
              />
            )}

            {!city && contextStops.filter(pointValid).map((stop, index) => {
              const point = screen(stop);

              return (
                <circle
                  key={`context-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r="5"
                  fill="#06b6d4"
                  opacity="0.65"
                />
              );
            })}

            {!city && pointValid(origin) && (() => {
              const point = screen(origin);
              return (
                <g transform={`translate(${point.x},${point.y})`}>
                  <circle r="13" fill="#16a34a" stroke="white" strokeWidth="2" />
                  <text textAnchor="middle" y="4" fill="white" fontSize="11">
                    S
                  </text>
                </g>
              );
            })()}

            {validStops.map((stop, index) => {
              const point = screen(stop);
              const highlighted = city && focus &&
                distanceMeters(focus, stop) <= CITY_RADIUS;

              return (
                <g
                  key={stop.id || `${stop.latitude}:${stop.longitude}`}
                  transform={`translate(${point.x},${point.y})`}
                >
                  <circle
                    r={highlighted ? 15 : 12}
                    fill={city ? '#0891b2' : '#ea580c'}
                    stroke={highlighted ? '#fef08a' : 'white'}
                    strokeWidth={highlighted ? 4 : 2}
                  />
                  <text
                    textAnchor="middle"
                    y="4"
                    fill="white"
                    fontSize="11"
                    fontWeight="700"
                  >
                    {index + 1}
                  </text>
                </g>
              );
            })}
          </svg>
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
            padding: '2px 5px',
            fontSize: 11,
          }}
        >
          © OpenStreetMap contributors
        </a>
      </div>

      <p>
        {city && focus ? 'Within 200 m: ' : ''}
        {summary.destinations} destinations · {summary.services} services ·{' '}
        <strong>{summary.deliveryParcels} delivery parcels</strong> ·{' '}
        {summary.pickups} pickup services
        {summary.unknown > 0 ? ` · ${summary.unknown} unclassified services` : ''}
      </p>

      {city && focus && (
        <div className="space-y-3">
          {!nearby.length && <p>No city deliveries within this circle.</p>}

          {nearby.map((stop, index) => (
            <article
              key={stop.id || index}
              className="rounded border border-white/15 p-3"
            >
              <p className="font-semibold">{stop.address}</p>
              <p className="text-sm text-slate-400">
                {Math.round(distanceMeters(focus, stop))} m from circle centre
              </p>

              {(stop.services || []).map((service, serviceIndex) => (
                <p key={service.id || service.service_id || serviceIndex} className="mt-1 text-sm">
                  {service.source_reference || 'Shipment reference unavailable'}
                  {' · '}{service.service_type || 'unknown'}
                  {' · '}{Math.max(1, Number(service.parcel_count) || 1)} parcels
                  {service.location_precision === 'street'
                    ? ' · Street-level location'
                    : ''}
                </p>
              ))}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}