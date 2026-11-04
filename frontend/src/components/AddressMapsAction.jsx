import React from 'react';

function verifiedCoordinates(service) {
  const latitude = Number(service?.latitude);
  const longitude = Number(service?.longitude);

  return (
    service?.stage === 'ready' &&
    service?.status === 'ready' &&
    service.latitude != null &&
    service.longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

export default function AddressMapsAction({ service }) {
  const address = String(
    service?.original_address ||
    service?.address ||
    ''
  ).trim();

  const verified = verifiedCoordinates(service);

  if (!address && !verified) {
    return (
      <p className="text-sm text-amber-200">
        No address available for Google Maps.
      </p>
    );
  }

  const searchParameters = new URLSearchParams({
    api: '1',
    query: address,
  });

  const searchURL =
    'https://www.google.com/maps/search/?' +
    searchParameters.toString();

  let directionsURL = null;

  if (verified) {
    const directionsParameters = new URLSearchParams({
      api: '1',
      destination:
        `${Number(service.latitude)},` +
        `${Number(service.longitude)}`,
      travelmode: 'driving',
    });

    // Let Google Maps obtain the current origin instead of
    // reusing a potentially outdated planner starting location.
    directionsURL =
      'https://www.google.com/maps/dir/?' +
      directionsParameters.toString();
  }

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

        {address && (
          <a
            href={searchURL}
            target="_blank"
            rel="noopener noreferrer"
            className="terminal-button-secondary inline-flex"
          >
            Search this address in Google Maps
          </a>
        )}
      </div>

      {!verified && (
        <p className="text-xs text-amber-200">
          This opens an address search. The destination has
          not yet been verified by the route planner.
        </p>
      )}
    </div>
  );
}