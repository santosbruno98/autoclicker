
BEGIN;

-- Delete children first to satisfy foreign-key constraints.
DELETE FROM route_segments;
DELETE FROM route_stops;
DELETE FROM route_plans;

COMMIT;
