
#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data
cd /data

echo "Downloading Portugal OSM data..."

curl \
  --fail \
  --location \
  --retry 3 \
  --output portugal.osm.pbf \
  https://download.geofabrik.de/europe/portugal-latest.osm.pbf

echo "Extracting Guarda coverage..."

# Approximate Guarda coverage with a buffer.
# This is NOT the official district polygon.
# Cross-border routes may require Spanish OSM data.
osmium extract \
  --bbox=-8.10,40.10,-6.65,41.15 \
  --strategy=complete_ways \
  --overwrite \
  --output=guarda.osm.pbf \
  portugal.osm.pbf

echo "Extracting road graph..."

osrm-extract \
  -p /opt/car.lua \
  guarda.osm.pbf

echo "Contracting road graph..."

osrm-contract guarda.osrm

echo "Removing source PBF files..."

rm -f portugal.osm.pbf guarda.osm.pbf

echo "OSRM map preprocessing complete."
