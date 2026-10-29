
#!/usr/bin/env bash
set -euo pipefail

echo "Starting OSRM..."

osrm-routed \
  --algorithm ch \
  --port 5000 \
  --max-table-size 200 \
  --max-viaroute-size 200 \
  /data/guarda.osrm &

OSRM_PID=$!

cleanup() {
  echo "Stopping routing services..."
  kill "$OSRM_PID" 2>/dev/null || true
  wait "$OSRM_PID" 2>/dev/null || true
}

trap cleanup EXIT TERM INT

echo "Waiting for OSRM..."

READY=0

for attempt in $(seq 1 60); do
  if ! kill -0 "$OSRM_PID" 2>/dev/null; then
    echo "OSRM exited unexpectedly"
    exit 1
  fi

  if curl \
    --silent \
    --fail \
    --max-time 2 \
    "http://127.0.0.1:5000/nearest/v1/driving/-7.262,40.537?number=1" \
    >/dev/null; then
    READY=1
    break
  fi

  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "OSRM failed to become ready"
  exit 1
fi

echo "OSRM ready. Starting FastAPI..."

exec uvicorn app:app \
  --host 0.0.0.0 \
  --port "${PORT:-8080}" \
  --workers 1
