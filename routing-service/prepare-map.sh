#!/usr/bin/env bash

set -euo pipefail

mkdir -p /data
cd /data

curl -fL \
  https://download.geofabrik.de/europe/portugal-latest.osm.pbf \
  -o portugal.osm.pbf

# Initial rectangular coverage, not an administrative
# district boundary. Verify all intended stops fit.
osmium extract \
  --bbox=-8.10,40.10,-6.65,41.15 \
  --strategy=complete_ways \
  --output=guarda.osm.pbf \
  portugal.osm.pbf

osrm-extract \
  -p /opt/car.lua \
  guarda.osm.pbf

osrm-routed \
  --algorithm ch \
  --port 5000 \
  --max-table-size 200 \
  --max-viaroute-size 200 \
  /data/guarda.osrm
  
osrm-contract guarda.osrm

rm -f portugal.osm.pbf guarda.osm.pbf
