
# ============================================================
# Stage 1: Build VROOM
# ============================================================

FROM debian:trixie-slim AS vroom-builder

ARG VROOM_VERSION=v1.15.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    build-essential \
    pkg-config \
    libboost-all-dev \
    libssl-dev \
    libcurl4-openssl-dev \
    libglpk-dev \
    libasio-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

RUN git clone --depth 1 --branch "${VROOM_VERSION}" \
    https://github.com/VROOM-Project/vroom.git

WORKDIR /src/vroom

RUN git submodule update --init --recursive

WORKDIR /src/vroom/src

RUN make -j2 && test -x /src/vroom/bin/vroom


# ============================================================
# Stage 2: Build OSRM
# ============================================================

FROM debian:trixie-slim AS osrm-builder

ARG OSRM_VERSION=v5.27.1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    build-essential \
    cmake \
    pkg-config \
    libboost-all-dev \
    libbz2-dev \
    libxml2-dev \
    libzip-dev \
    liblua5.4-dev \
    libtbb-dev \
    libstxxl-dev \
    zlib1g-dev \
    libexpat1-dev \
    libluabind-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

RUN git clone --depth 1 --branch "${OSRM_VERSION}" \
    https://github.com/Project-OSRM/osrm-backend.git

WORKDIR /src/osrm-backend

# Fix RapidJSON compatibility with GCC 14
RUN sed -i \
    's/const SizeType length;/SizeType length;/' \
    third_party/rapidjson/include/rapidjson/document.h

# Fix missing standard library header in OSRM v5.27.1
RUN sed -i '1i#include <vector>' \
    include/extractor/suffix_table.hpp

# Configure OSRM with GCC 14 compatibility flags
RUN cmake -S . -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_FLAGS="-include cstdint -Wno-error" \
    -DCMAKE_CXX_FLAGS_RELEASE="-O2 -DNDEBUG -Wno-error=array-bounds -Wno-array-bounds -Wno-error=unused-result" \
    -DCMAKE_C_FLAGS_RELEASE="-O2 -DNDEBUG"

# Build required OSRM executables
RUN cmake --build build \
    --target osrm-routed osrm-extract osrm-contract \
    --parallel 2

RUN test -x build/osrm-routed && \
    test -x build/osrm-extract && \
    test -x build/osrm-contract


# ============================================================
# Stage 3: Python + VROOM + OSRM Runtime
# ============================================================

FROM python:3.12-slim-trixie

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
    libboost-system1.83.0 \
    libboost-filesystem1.83.0 \
    libboost-program-options1.83.0 \
    libboost-iostreams1.83.0 \
    libboost-thread1.83.0 \
    libssl3t64 \
    libcurl4t64 \
    libglpk40 \
    libtbb12 \
    liblua5.4-0 \
    libstxxl1t64 \
    libbz2-1.0 \
    libxml2 \
    libzip5 \
    && rm -rf /var/lib/apt/lists/*


# Copy VROOM executable
COPY --from=vroom-builder \
    /src/vroom/bin/vroom \
    /usr/local/bin/vroom

# Copy OSRM executables
COPY --from=osrm-builder \
    /src/osrm-backend/build/osrm-routed \
    /src/osrm-backend/build/osrm-extract \
    /src/osrm-backend/build/osrm-contract \
    /usr/local/bin/

# Copy OSRM routing profiles
COPY --from=osrm-builder \
    /src/osrm-backend/profiles \
    /opt/profiles

# Verify executable dependencies
RUN set -eux; \
    for binary in \
        /usr/local/bin/vroom \
        /usr/local/bin/osrm-routed \
        /usr/local/bin/osrm-extract \
        /usr/local/bin/osrm-contract; do \
        test -x "$binary"; \
        ldd "$binary"; \
        if ldd "$binary" | grep -q "not found"; then \
            echo "Missing shared libraries: $binary"; \
            exit 1; \
        fi; \
    done

WORKDIR /app

# Install Python dependencies
COPY requirements.txt ./

RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY app.py ./
COPY prepare-map.sh ./
COPY start.sh ./


# Fix Windows CRLF line endings and ensure Bash execution

RUN sed -i 's/\r$//' prepare-map.sh start.sh && \
    chmod +x prepare-map.sh start.sh && \
    mkdir -p /data && \
    test -f /opt/profiles/car.lua && \
    test -f /opt/profiles/lib/set.lua && \
    ln -s /opt/profiles/lib /opt/lib && \
    ln -s /opt/profiles/car.lua /opt/car.lua

RUN bash ./prepare-map.sh



EXPOSE 8080


CMD ["bash", "/app/start.sh"]
