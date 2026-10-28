
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y \
    curl \
    osmium-tool \
    osrm-backend \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY prepare-map.sh .

# Find the installed OSRM car profile.
RUN find /usr -name car.lua -print

# Prepare map data at build time, not per request.
RUN chmod +x prepare-map.sh && \
    mkdir -p /opt && \
    cp "$(find /usr -name car.lua -print -quit)" /opt/car.lua && \
    ./prepare-map.sh

ENV OSRM_URL=http://127.0.0.1:5000

CMD ["sh", "-c", \
  "osrm-routed --algorithm ch --port 5000 /data/guarda.osrm & \
   exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080}"]
