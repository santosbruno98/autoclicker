
# Build the Linux Go API.
FROM golang:1.26-bookworm AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -tags cloud -o /app/server ./cmd/cloud


# Cloud Run runtime: Go API + Linux Python PDF processor.
FROM python:3.12-slim-bookworm

WORKDIR /app

# Install the Python dependencies in the container.
COPY market_processor/requirements.txt /app/market_processor/requirements.txt

RUN python -m pip install --no-cache-dir \
    -r /app/market_processor/requirements.txt

# Include the Python processor script.
COPY market_processor/market_processor.py /app/market_processor/market_processor.py

# Include the compiled Go backend.
COPY --from=builder /app/server /app/server

# Force the Go service to use Linux Python.
ENV PYTHON_EXECUTABLE=/usr/local/bin/python
ENV API_PORT=8080
ENV PORT=8080

EXPOSE 8080

CMD ["/app/server"]
