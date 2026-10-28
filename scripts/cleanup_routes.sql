
BEGIN;

DELETE FROM route_services;
DELETE FROM route_segments;
DELETE FROM route_stops;
DELETE FROM route_plans;

-- Deliberately preserve:
-- route_optimization_caches
-- route_image_caches
-- route_geocode_caches

COMMIT;
