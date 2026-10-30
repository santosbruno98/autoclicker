#!/usr/bin/env bash
set -euo pipefail

export PORT="${PORT:-8080}"

echo "Starting OSRM on internal port 5000..."

osrm-routed \
  --algorithm ch \
  --ip 127.0.0.1 \
  --port 5000 \
  --max-table-size 200 \
  --max-viaroute-size 200 \
  /data/guarda.osrm &

OSRM_PID=$!

cleanup() {
  echo "Stopping routing services..."
  kill "${API_PID:-}" "$OSRM_PID" 2>/dev/null || true
  wait "$OSRM_PID" 2>/dev/null || true

  if [[ -n "${API_PID:-}" ]]; then
    wait "$API_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

echo "Starting public API on 0.0.0.0:${PORT}..."

uvicorn app:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers 1 &

API_PID=$!

# Stop the container if either process exits.
wait -n "$OSRM_PID" "$API_PID"

echo "A routing process exited; stopping container."
exit 1
