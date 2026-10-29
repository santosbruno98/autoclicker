
FROM debian:bookworm-slim AS vroom-builder

ARG VROOM_VERSION=v1.15.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    build-essential \
    cmake \
    pkg-config \
    libboost-all-dev \
    libssl-dev \
    libcurl4-openssl-dev \
    libglpk-dev \
    libasio-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

RUN git clone \
    --depth 1 \
    --branch "${VROOM_VERSION}" \
    https://github.com/VROOM-Project/vroom.git

WORKDIR /src/vroom

RUN cmake -S . -B build \
    -DCMAKE_BUILD_TYPE=Release

RUN cmake --build build --parallel 2

RUN find build -type f -name vroom -executable \
    -exec cp {} /usr/local/bin/vroom \;

RUN test -x /usr/local/bin/vroom


FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VROOM_BIN=/usr/local/bin/vroom \
    OSRM_HOST=127.0.0.1 \
    OSRM_PORT=5000

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    osmium-tool \
    osrm-backend \
    libboost-system1.74.0 \
    libboost-filesystem1.74.0 \
    libboost-program-options1.74.0 \
    libssl3 \
    libcurl4 \
    libglpk40 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=vroom-builder \
    /usr/local/bin/vroom \
    /usr/local/bin/vroom

RUN ldd /usr/local/bin/vroom

WORKDIR /app

COPY requirements.txt ./

RUN pip install \
    --no-cache-dir \
    -r requirements.txt

COPY app.py ./
COPY prepare-map.sh ./
COPY start.sh ./

RUN chmod +x prepare-map.sh start.sh && \
    mkdir -p /opt /data && \
    PROFILE="$(find /usr -name car.lua -print -quit)" && \
    test -n "$PROFILE" && \
    cp "$PROFILE" /opt/car.lua

RUN ./prepare-map.sh

EXPOSE 8080

CMD ["./start.sh"]
