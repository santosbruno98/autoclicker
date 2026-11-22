import axios from 'axios';

const backendURL = (
  import.meta.env.VITE_API_URL || ''
).replace(/\/+$/, '');

export const authAPI = axios.create({
  baseURL: backendURL || '/',
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
  },
});

export const API = axios.create({
  baseURL: backendURL
    ? `${backendURL}/api/v1`
    : '/api/v1',
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
  },
});

function isRouteSettingsRequest(config) {
  const path = String(config?.url || '')
    .split(/[?#]/)[0]
    .replace(/\/+$/, '');

  return path === 'route-planner/settings' ||
    path.endsWith('/route-planner/settings');
}

function validCorner(corner) {
  return (
    corner &&
    Number.isFinite(corner.longitude) &&
    Number.isFinite(corner.latitude) &&
    Math.abs(corner.longitude) <= 180 &&
    Math.abs(corner.latitude) <= 90
  );
}

function copyCorners(corners) {
  if (
    !Array.isArray(corners) ||
    corners.length !== 4 ||
    !corners.every(validCorner)
  ) {
    throw new Error(
      'The delivery area must contain exactly four valid corners.'
    );
  }

  return corners.map((corner) => ({
    longitude: corner.longitude,
    latitude: corner.latitude,
  }));
}

function cornersFromPolygon(polygon) {
  if (
    polygon?.type !== 'Polygon' ||
    !Array.isArray(polygon.coordinates) ||
    polygon.coordinates.length !== 1
  ) {
    throw new Error('Draw a four-corner delivery area first.');
  }

  const ring = polygon.coordinates[0];

  if (
    !Array.isArray(ring) ||
    ring.length !== 5 ||
    !ring.every((coordinate) =>
      Array.isArray(coordinate) &&
      coordinate.length === 2 &&
      coordinate.every(Number.isFinite)
    )
  ) {
    throw new Error(
      'The map area must contain four corners and a closing coordinate.'
    );
  }

  if (
    Math.abs(ring[0][0] - ring[4][0]) > 1e-10 ||
    Math.abs(ring[0][1] - ring[4][1]) > 1e-10
  ) {
    throw new Error('The map area outline is not closed.');
  }

  return copyCorners(
    ring.slice(0, 4).map(([longitude, latitude]) => ({
      longitude,
      latitude,
    }))
  );
}

function polygonFromCorners(corners) {
  const validated = copyCorners(corners);

  const ring = validated.map((corner) => [
    corner.longitude,
    corner.latitude,
  ]);

  return {
    type: 'Polygon',
    coordinates: [[
      ...ring,
      [...ring[0]],
    ]],
  };
}

function settingsForMap(settings) {
  if (!settings?.area) return settings;

  const area = settings.area;

  // Older administrative-boundary settings remain visible until
  // the user replaces them with a four-corner working area.
  if (area.type !== 'four_corners') {
    return settings;
  }

  const corners = copyCorners(area.corners);

  if (!area.id) {
    throw new Error(
      'The backend returned an area without an identifier.'
    );
  }

  return {
    ...settings,
    area: {
      ...area,
      api_type: 'four_corners',

      // Frontend-only map representation.
      type: 'polygon',
      polygon: polygonFromCorners(corners),
      corners,
    },
  };
}

API.interceptors.request.use((config) => {
  if (
    !isRouteSettingsRequest(config) ||
    String(config.method).toLowerCase() !== 'put'
  ) {
    return config;
  }

  let input = config.data;

  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      throw new Error('Invalid route-settings request.');
    }
  }

  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    throw new Error('Invalid route-settings request.');
  }

  const corners = Array.isArray(input.corners)
    ? copyCorners(input.corners)
    : cornersFromPolygon(input.polygon);

  // Only the four-corner API contract goes over the network.
  return {
    ...config,
    data: {
      expected_revision: input.expected_revision || '',
      label: String(input.label || '').trim(),
      corners,
    },
  };
});

API.interceptors.response.use(
  (response) => {
    if (
      isRouteSettingsRequest(response.config) &&
      response.data?.settings
    ) {
      return {
        ...response,
        data: {
          ...response.data,
          settings: settingsForMap(response.data.settings),
        },
      };
    }

    return response;
  },
  (error) => Promise.reject(error)
);