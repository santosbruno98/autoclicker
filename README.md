# MyPlatform / Autoclicker

A personal workspace combining investment monitoring, financial document analysis, notes, Windows desktop automation, and delivery route planning.

The repository contains a Go API, a React frontend, a Python financial document processor, a VROOM/OSRM routing service, and supporting Java services and monitoring infrastructure.

> Documentation baseline: `main` at commit
> `df24db831e191fa4d6f70d557cb0c200eef0a025`.
>
> This README describes the implementation at that revision.
> Known inconsistencies are documented explicitly rather than presented
> as working features.

## Contents

- [1. Project overview](#overview)
- [2. Architecture](#architecture)
- [3. Repository and file index](#file-index)
- [4. Configuration](#configuration)
- [5. Running the project](#running)
- [6. HTTP API reference](#http-api)
- [7. Backend entry points](#entry-points)
- [8. Authentication and planner persistence](#authentication)
- [9. Database initialization](#database)
- [10. HTTP handlers](#handlers)
- [11. Backend services](#services)
- [12. Kafka and logging](#kafka)
- [13. Backend data models](#models)
- [14. Python financial document processor](#market-processor)
- [15. VROOM and OSRM routing service](#routing-service)
- [16. Java services](#java-services)
- [17. Frontend file reference](#frontend)
- [18. Infrastructure and operational files](#infrastructure)
- [19. Connectivity checks](#connectivity)
- [20. Deployment](#deployment)
- [21. Troubleshooting](#troubleshooting)
- [22. Known implementation gaps](#known-gaps)
- [23. Documentation maintenance](#maintenance)

<a id="overview"></a>

## 1. Project overview

### Main capabilities

| Area | Responsibilities |
|---|---|
| Investment workspace | Holdings, buying power, valuation, daily changes, portfolio history, and comparison with SPY. |
| Market research | PDF text extraction, Gemini company extraction, bullish/bearish classification, and summaries. |
| Market data | Yahoo Finance quote retrieval, exchange rates, and intraday OHLC data. |
| Alerts | Configurable price thresholds, Prometheus metrics, Grafana webhooks, and Discord delivery. |
| Notes | Create, update, complete, and delete notes. |
| Desktop controller | Select a Windows process and run a saved keyboard automation profile through a local agent. |
| Route planner | Extract delivery and pickup addresses from screenshots, verify addresses, optimize destinations, and generate Google Maps links. |
| Planner persistence | Restore planner state across sessions using Upstash REST and IndexedDB. |
| Offline planner | Load previously cached planner data and queue supported changes for later synchronization. |
| Observability | Kafka logging, Vector processing, Loki storage, Prometheus metrics, and Grafana dashboards. |

### Technology overview

| Component | Technology |
|---|---|
| Main backend | Go, Gin, GORM |
| Relational storage | PostgreSQL |
| Session and planner storage | Upstash Redis HTTPS REST API |
| Frontend | React 18, JavaScript/JSX, Vite, Tailwind CSS |
| Frontend charts | Recharts and embedded TradingView widgets |
| PDF processing | Python, pypdf, Google GenAI SDK |
| Address extraction | Gemini REST API |
| Address verification | Geoapify |
| Route optimization | VROOM |
| Road routing | OSRM |
| Desktop automation | RobotGo and gopsutil |
| Event infrastructure | Kafka and RabbitMQ |
| Supporting Java services | Spring Boot |
| Monitoring | Prometheus, Grafana, Loki, Vector |
| Backend hosting | Google Cloud Run |
| Frontend hosting | Cloudflare Pages or Nginx in Docker |

### Current deployment addresses

| Component | Address |
|---|---|
| Frontend | https://autoclicker-2d1.pages.dev |
| Backend | https://autoclicker-api-889608996259.europe-west1.run.app |

These addresses identify the current deployment. They are not required
for running a separate installation.

<a id="architecture"></a>

## 2. Architecture

### Cloud application

The browser loads the React application from Cloudflare Pages.

The frontend can contact the Go API directly through `VITE_API_URL`, or
use the Cloudflare Pages API proxy when requests use relative paths.

The Go API:

1. Connects to the configured PostgreSQL databases.
2. Verifies the market database schema.
3. Migrates the route tables.
4. Initializes authentication and verifies Upstash connectivity.
5. Registers HTTP endpoints.
6. Starts listening on the configured port.

Initialization happens before the HTTP listener starts. A failure during
database or authentication initialization therefore prevents `/health`
and the configured port from becoming available.

### Desktop automation

Cloud-hosted code does not control the user's Windows desktop.

The Desktop Controller uses two separate APIs:

| API | Responsibility |
|---|---|
| Cloud API | Stores and manages automation task profiles. |
| Local Windows agent | Lists local processes and starts or stops keyboard automation. |

The local agent uses a generated bearer token. The frontend keeps this
pairing token in memory.

### Route planning

The route workflow is:

1. Obtain the user's location through browser geolocation.
2. Upload screenshots.
3. Extract visible delivery and pickup services with Gemini.
4. Validate Portuguese address structure.
5. Resolve addresses through Geoapify.
6. Separate verified and incomplete services.
7. Group services sharing the same coordinates into destinations.
8. Send the complete destination set to the routing service.
9. Optimize one journey using VROOM and OSRM.
10. Split the optimized order into Google Maps segments.
11. Persist generated route records in PostgreSQL.
12. Persist the planner interface state in Upstash and IndexedDB.

The optimizer receives coordinates in **longitude, latitude** order.

Google Maps URLs use **latitude, longitude** order.

### Persistence responsibilities

| Storage | Data |
|---|---|
| Core PostgreSQL database | Saved automation task profiles. |
| Notes PostgreSQL database | Notes and completion state. |
| Portfolio PostgreSQL database | Holdings, settings, thresholds, and dividend payment models. |
| Market PostgreSQL database | Required market analysis schema; the current PDF handler does not implement analysis persistence. |
| Routes PostgreSQL database | Route plans, stops, services, segments, extraction cache, geocoding cache, and optimization cache. |
| Upstash | Authentication sessions and per-user planner snapshots. |
| IndexedDB | Device-local planner snapshots and remembered planner identity. |
| Service worker cache | Frontend application shell and build assets for offline loading. |
| In-process Go caches | Quotes, exchange rates, intraday data, and dividend history. |

<a id="file-index"></a>

## 3. Repository and file index

Each backend reference below includes function signatures, parameter
descriptions, behavior, and return values.

HTTP handlers receive `c *gin.Context`; their actual inputs are path
parameters, query parameters, request headers, cookies, JSON bodies, or
multipart fields.

### Entry points

| File | Reference |
|---|---|
| `cmd/cloud/main.go` | [Cloud API](#file-cloud-main) |
| `cmd/main.go` | [Local API](#file-local-main) |
| `cmd/localagent/main.go` | [Windows local agent](#file-localagent-main) |
| `cmd/migration/main.go` | [SQLite migration utility](#file-migration-main) |
| `pid_target.go` | [Standalone keyboard automation](#file-pid-target) |

### Authentication and database files

| File | Reference |
|---|---|
| `pkg/auth/session.go` | [Authentication and planner snapshots](#file-auth-session) |
| `pkg/database/postgres.go` | [Shared PostgreSQL connection](#file-database-postgres) |
| `pkg/database/processdb.go` | [Core database](#file-database-core) |
| `pkg/database/notedb.go` | [Notes database](#file-database-notes) |
| `pkg/database/portfoliodb.go` | [Portfolio database](#file-database-portfolio) |
| `pkg/database/marketdb.go` | [Market database](#file-database-market) |
| `pkg/database/routedb.go` | [Routes database](#file-database-routes) |

### Handler files

| File | Reference |
|---|---|
| `pkg/handlers/task.go` | [Task handlers](#file-handler-task) |
| `pkg/handlers/note.go` | [Note handlers](#file-handler-note) |
| `pkg/handlers/portfolio.go` | [Portfolio handlers](#file-handler-portfolio) |
| `pkg/handlers/dividends.go` | [Dividend estimates](#file-handler-dividends) |
| `pkg/handlers/threshold.go` | [Price thresholds](#file-handler-threshold) |
| `pkg/handlers/benchmark.go` | [Benchmark history](#file-handler-benchmark) |
| `pkg/handlers/market.go` | [PDF processing](#file-handler-market) |
| `pkg/handlers/market_quotes.go` | [Batch market quotes](#file-handler-market-quotes) |
| `pkg/handlers/monitoring.go` | [Prometheus endpoint](#file-handler-monitoring) |
| `pkg/handlers/alert.go` | [Grafana webhook](#file-handler-alert) |
| `pkg/handlers/process.go` | [Process inspection](#file-handler-process) |
| `pkg/handlers/automation.go` | [Automation HTTP handlers](#file-handler-automation) |
| `pkg/handlers/routes.go` | [Route generation](#file-handler-routes) |
| `pkg/handlers/routes_import.go` | [Screenshot extraction and geocoding](#file-handler-routes-import) |

### Service and logging files

| File | Reference |
|---|---|
| `pkg/services/automation.go` | [Automation manager](#file-service-automation) |
| `pkg/services/process.go` | [Windows process helper](#file-service-process) |
| `pkg/services/quote.go` | [Quotes, FX, and OHLC](#file-service-quote) |
| `pkg/services/cache.go` | [Generic TTL cache](#file-service-cache) |
| `pkg/services/dividends.go` | [Dividend history](#file-service-dividends) |
| `pkg/services/discord.go` | [Discord integration](#file-service-discord) |
| `pkg/services/market_processor.go` | [Go-to-Python bridge](#file-service-market-processor) |
| `pkg/services/market_compression.go` | [Compressed JSON helpers](#file-service-market-compression) |
| `pkg/services/stockmetrics.go` | [Stock metric generation](#file-service-stockmetrics) |
| `pkg/kafka/LogMessage.go` | [Kafka log model](#file-kafka-message) |
| `pkg/kafka/LogProducer.go` | [Kafka producer](#file-kafka-producer) |
| `internal/middleware/logging.go` | [HTTP logging middleware](#file-middleware-logging) |

### Model files

| File | Reference |
|---|---|
| `pkg/models/automation.go` | [Automation models](#file-model-automation) |
| `pkg/models/note.go` | [Note model](#file-model-note) |
| `pkg/models/holding.go` | [Portfolio models](#file-model-holding) |
| `pkg/models/threshold.go` | [Threshold model](#file-model-threshold) |
| `pkg/models/dividends.go` | [Dividend models](#file-model-dividends) |
| `pkg/models/market_document.go` | [Market document models](#file-model-market) |
| `pkg/models/route.go` | [Route models](#file-model-route) |

### Supporting backend services

| File or directory | Reference |
|---|---|
| `market_processor/market_processor.py` | [Python PDF processor](#market-processor) |
| `routing-service/app.py` | [Routing API](#file-routing-app) |
| `routing-service/start.sh` | [Routing startup](#file-routing-start) |
| `routing-service/prepare-map.sh` | [Map preprocessing](#file-routing-map) |
| `logger-service/` | [Java Kafka logger](#java-logger) |
| `riskEngineService/` | [Java risk engine scaffold](#java-risk) |
| `tests/` | [Connectivity programs](#connectivity) |

### Frontend and operations

- [Frontend file reference](#frontend)
- [Infrastructure file reference](#infrastructure)
- [Deployment commands](#deployment)
- [Known implementation gaps](#known-gaps)

### Finding a specific method

Use the file index to open the relevant file section, then search for
the exact method name.

Functions also have stable anchors. Examples:

- [`NewService`](#auth-newservice)
- [`SavePlanner`](#auth-saveplanner)
- [`ConnectPostgresDB`](#database-connectpostgresdb)
- [`CreateRoutePlan`](#routes-createrouteplan)
- [`ParseRouteScreenshots`](#routes-parseroutescreenshots)
- [`FetchQuote`](#services-fetchquote)
- [`JobManager.StartJob`](#automation-startjob)

<a id="configuration"></a>

## 4. Configuration

### Environment loading

Environment behavior differs by entry point:

| Entry point | Loads `.env` itself? |
|---|---|
| `cmd/main.go` | Yes, using `godotenv.Load()`. |
| `cmd/localagent/main.go` | Yes, using `godotenv.Load()`. |
| `cmd/cloud/main.go` | No. Variables must already exist in the process environment. |
| `cmd/migration/main.go` | No explicit dotenv loading. |
| Connectivity programs | Load `.env`; exact failure behavior varies by program. |
| Python market processor | Attempts to load a hardcoded Windows `.env` path. Existing process variables remain relevant in containers. |

A local `.env` file is not automatically copied into Cloud Run
configuration.

In dotenv files, quoted values can be valid. In Cloud Run's variable
value fields, enter the value itself without wrapping it in literal
quotes.

### Cloud authentication

| Variable | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` | HTTPS REST endpoint for Upstash. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash bearer token with the permissions required by session and planner commands. |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID accepted by backend ID-token validation. |
| `GOOGLE_ALLOWED_EMAIL` | Single Google account email authorized to sign in. |
| `FRONTEND_ORIGIN` | Exact browser origin accepted by CORS and mutation origin checks. |

`NewService` currently falls back to a project-specific Upstash URL if
`UPSTASH_REDIS_REST_URL` is empty. Configure it explicitly for another
installation.

The REST URL must:

- Use `https`.
- Include a host.
- Exclude URL user information.
- Exclude query parameters.
- Exclude a fragment.

### PostgreSQL

| Variable | Default or behavior |
|---|---|
| `DATABASE_URL` | Preferred shared PostgreSQL connection URL; required by the cloud entry point. |
| `POSTGRES_DB` | Core database name; defaults to `autoclicker`. |
| `ROUTES_DB_NAME` | Route database name; defaults to `route_db`. |
| `POSTGRES_HOST` | Fallback host: `localhost`. |
| `POSTGRES_PORT` | Fallback port: `5432`. |
| `POSTGRES_USER` | Fallback user: `autoclicker`. |
| `POSTGRES_PASSWORD` | Fallback password: `password`. |
| `POSTGRES_SSL_MODE` | Fallback SSL mode: `disable`. |
| `MAX_OPEN_CONNS` | Maximum open connections per pool; defaults to `5`. |
| `MAX_IDLE_CONNS` | Maximum idle connections per pool; defaults to `2`. |

`ConnectPostgresDB` replaces the database path in `DATABASE_URL` with the
requested database name while preserving connection credentials and
query parameters.

The application therefore expects the selected databases to exist on
the PostgreSQL server.

### Required database names

| Database | Selection |
|---|---|
| Core | `POSTGRES_DB`, default `autoclicker` |
| Notes | `notes_db` |
| Portfolio | `portfolio_db` |
| Market | `market_db` |
| Routes | `ROUTES_DB_NAME`, default `route_db` |

GORM migrations create or update tables within an existing database.
They do not create the PostgreSQL databases themselves.

`market_db` must already contain `public.market_document_analyses`.

### Server port

| Variable | Behavior |
|---|---|
| `PORT` | First choice for the cloud HTTP listener. |
| `API_PORT` | Used when `PORT` is empty. |
| Neither set | Cloud listener defaults to `8080`. |

The local API in `cmd/main.go` uses `0.0.0.0:8080` directly.

### Route extraction and optimization

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini credential used for screenshot extraction and PDF analysis. |
| `ROUTE_GEMINI_MODELS` | Comma-separated ordered screenshot model list. |
| `ROUTE_GEMINI_MODEL` | Optional legacy primary screenshot model, used before defaults when the model list is absent. |
| `GEOAPIFY_API_KEY` | Geoapify address verification credential. |
| `ROUTING_SERVICE_URL` | Base URL of the VROOM/OSRM API. |
| `ROUTING_API_KEY` | Bearer credential expected by the Python routing API. |
| `VROOM_BIN` | Routing service VROOM executable; defaults to `/usr/local/bin/vroom`. |
| `OSRM_HOST` | Routing service OSRM host; defaults to `127.0.0.1`. |
| `OSRM_PORT` | Routing service OSRM port; defaults to `5000`. |

> Current implementation mismatch:
> `requestOptimization` reads `ROUTING_SERVICE_URL` as both the endpoint
> and the bearer credential. The Python service expects
> `ROUTING_API_KEY`. See [known gaps](#known-gaps).

Model names in the source are configuration defaults, not a guarantee
that those models are available to every Gemini account.

### Python processor

| Variable | Purpose |
|---|---|
| `PYTHON_EXECUTABLE` | Explicit interpreter used by the Go PDF-processing service. |
| `GEMINI_API_KEY` | Credential used by the Google GenAI client. |

Without `PYTHON_EXECUTABLE`:

- Windows uses `market_processor/venv/Scripts/python.exe`.
- Other operating systems use `python3`.

### Desktop controller

| Variable | Purpose |
|---|---|
| `ALLOWED_ADDRESS` | Local agent listen address and accepted Host header. Use `127.0.0.1:8081` to match the current frontend. |
| `FRONTEND_ORIGIN` | Exact frontend origin accepted by the agent. |
| `LOCAL_DATABASE_URL` | Required by the local agent's startup validation. |
| `DATABASE_URL` or PostgreSQL variables | Actual connection settings used by the shared database helper. |

> The agent checks `LOCAL_DATABASE_URL`, but `InitCoreDB` uses
> `ConnectPostgresDB`, which reads `DATABASE_URL` or the PostgreSQL
> fallback variables. These are currently separate behaviors.

### Kafka

| Variable | Purpose |
|---|---|
| `KAFKA_BROKER` | Broker selected by the local API; defaults to `localhost:9092`. |
| `KAFKA_TLS_ENABLED` | Enables TLS when equal to `true`, ignoring case. |
| `KAFKA_CA_CERT_PATH` | Optional CA certificate file. |
| `KAFKA_CLIENT_CERT_PATH` | Optional mutual-TLS client certificate. |
| `KAFKA_CLIENT_KEY_PATH` | Matching client private key. |
| `KAFKA_SASL_USERNAME` | Optional SASL username. |
| `KAFKA_SASL_PASSWORD` | Optional SASL password. |
| `KAFKA_SASL_MECHANISM` | `SCRAM-SHA-512` selects SHA-512; otherwise the producer uses SHA-256. |
| `KAFKA_TOPIC_LOGS` | Topic selected by the Kafka connectivity program; defaults to `app-logs`. |

SASL credentials require TLS in the producer implementation.

### Alerts

| Variable | Purpose |
|---|---|
| `GRAFANA_WEBHOOK_TOKEN` | Bearer token checked by the Grafana webhook handler. |
| `DISCORD_WEBHOOK_URL` | Destination Discord webhook. |

### Frontend

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend base URL embedded during the Vite build. |
| `VITE_GOOGLE_CLIENT_ID` | Public Google OAuth client ID embedded during the build. |

An empty `VITE_API_URL` makes the frontend use relative API paths.

These values are build-time configuration. Changing them requires a
frontend rebuild.

### Cloudflare Pages proxy

| Variable | Purpose |
|---|---|
| `CLOUD_RUN_URL` | Target Cloud Run base URL and ID-token audience. |
| `GCP_CALLER_SERVICE_ACCOUNT_JSON` | Server-side service account credentials used for OAuth token exchange. |
| `GCP_INVOKER_SERVICE_ACCOUNT_EMAIL` | Service account for which the proxy requests a Cloud Run ID token. |

These belong to the server-side Pages Function environment, not to
`VITE_*` browser variables.

<a id="running"></a>

## 5. Running the project

### Prerequisites

- Go compatible with `go 1.26.0` in `go.mod`.
- Node.js and npm compatible with the frontend dependencies.
- Python with the dependencies in `market_processor/requirements.txt`.
- PostgreSQL with the required databases and market schema.
- Docker Desktop for containerized infrastructure.
- Google OAuth configuration and Upstash REST credentials for the cloud API.
- Gemini, Geoapify, and routing service credentials for route processing.
- Windows and RobotGo native build dependencies for desktop automation.
- Java 21 for the supporting Spring Boot projects.

### Start selected infrastructure

From the repository root:

```powershell
docker compose up -d postgres rabbitmq kafka
```

The Compose file also defines frontend and observability services.

The main Go API is not an active Compose service in the current file.

### Start the local API

```powershell
go run ./cmd
```

This entry point:

- Loads `.env`.
- Initializes Kafka logging.
- Initializes PostgreSQL databases.
- Exposes process and automation endpoints.
- Listens on port `8080`.

It does not use the cloud session authentication middleware.

### Build the cloud API

```powershell
go build -tags cloud -o server.exe ./cmd/cloud
```

For a Linux deployment, use the root `Dockerfile` or an appropriately
configured Linux build environment.

Cloud mode excludes the desktop automation implementation through Go
build tags.

### Start the Windows local agent

Set the required local agent and database variables, then run:

```powershell
go run ./cmd/localagent
```

The agent prints a temporary pairing token.

Open the Desktop Controller on the same computer and use that token
to pair the page with the agent.

### Start the frontend development server

```powershell
Set-Location frontend
npm install
npm run dev
```

### Build the frontend

```powershell
Set-Location frontend
npm run build
```

Output is written to `frontend/dist`.

> At the documented revision, planner store imports do not match the
> committed file location. Resolve that mismatch before expecting a
> successful frontend build. See [known gaps](#known-gaps).

### Rebuild the Docker frontend

From the repository root:

```powershell
docker compose build frontend_app
docker compose up -d --no-deps --force-recreate frontend_app
```

This updates the local Docker frontend. It does not update Cloudflare
Pages.

<a id="http-api"></a>

## 6. HTTP API reference

### Authentication conventions

Cloud endpoints under `/api/v1` require the
`autoclicker_session` cookie.

Authenticated mutations also require:

```http
Origin: <FRONTEND_ORIGIN>
X-Requested-With: XMLHttpRequest
```

The session cookie is:

- HttpOnly.
- Secure.
- SameSite=None.
- Scoped to `/`.
- Renewed on authenticated activity.

Session expiration is currently 600 seconds of inactivity.

### Authentication and health

| Method | Path | Handler | Access |
|---|---|---|---|
| `GET` | `/health` | Inline handler in cloud `main` | Public |
| `POST` | `/auth/google` | [`GoogleLogin`](#auth-googlelogin) | Google credential and valid origin |
| `GET` | `/auth/me` | [`Me`](#auth-me) | Session |
| `POST` | `/auth/logout` | [`Logout`](#auth-logout) | Session and mutation checks |
| `GET` | `/metrics` | [`GetPrometheusMetrics`](#monitoring-getmetrics) | Session in cloud mode |

### Task profiles

| Method | Path | Handler |
|---|---|---|
| `GET` | `/api/v1/tasks` | [`GetTasks`](#tasks-gettasks) |
| `GET` | `/api/v1/tasks/:id` | [`GetTaskByID`](#tasks-gettaskbyid) |
| `POST` | `/api/v1/tasks` | [`CreateTask`](#tasks-createtask) |
| `PUT` | `/api/v1/tasks/:id` | [`UpdateTask`](#tasks-updatetask) |
| `DELETE` | `/api/v1/tasks/:id` | [`DeleteTask`](#tasks-deletetask) |

### Notes

| Method | Path | Handler |
|---|---|---|
| `GET` | `/api/v1/notes` | [`GetNotes`](#notes-getnotes) |
| `POST` | `/api/v1/notes` | [`CreateNote`](#notes-createnote) |
| `PUT` | `/api/v1/notes/:id` | [`UpdateNote`](#notes-updatenote) |
| `DELETE` | `/api/v1/notes/:id` | [`DeleteNote`](#notes-deletenote) |

### Portfolio and thresholds

| Method | Path | Handler |
|---|---|---|
| `GET` | `/api/v1/portfolio/holdings` | [`GetHoldings`](#portfolio-getholdings) |
| `POST` | `/api/v1/portfolio/holdings` | [`CreateHolding`](#portfolio-createholding) |
| `PUT` | `/api/v1/portfolio/holdings/:id` | [`UpdateHolding`](#portfolio-updateholding) |
| `DELETE` | `/api/v1/portfolio/holdings/:id` | [`DeleteHolding`](#portfolio-deleteholding) |
| `GET` | `/api/v1/portfolio/summary` | [`GetPortfolioSummary`](#portfolio-summary) |
| `GET` | `/api/v1/portfolio/history` | [`GetPortfolioHistory`](#portfolio-history) |
| `GET` | `/api/v1/portfolio/buyingPower` | [`GetBuyingPower`](#portfolio-getbuyingpower) |
| `PUT` | `/api/v1/portfolio/buyingPower` | [`UpdateBuyingPower`](#portfolio-updatebuyingpower) |
| `GET` | `/api/v1/portfolio/dividends` | [`GetPortfolioDividends`](#dividends-getportfolio) |
| `GET` | `/api/v1/portfolio/thresholds` | [`GetPriceThresholds`](#thresholds-list) |
| `GET` | `/api/v1/portfolio/thresholds/:id` | [`GetPriceThreshold`](#thresholds-get) |
| `POST` | `/api/v1/portfolio/thresholds` | [`CreatePriceThreshold`](#thresholds-create) |
| `PUT` | `/api/v1/portfolio/thresholds/:id` | [`UpdatePriceThreshold`](#thresholds-update) |
| `DELETE` | `/api/v1/portfolio/thresholds/:id` | [`DeleteThreshold`](#thresholds-delete) |

### Market research

| Method | Path | Handler |
|---|---|---|
| `GET` | `/api/v1/market/quotes` | [`GetMarketQuotes`](#market-getquotes) |
| `GET` | `/api/v1/market/benchmark/history` | [`GetBenchmarkHistory`](#benchmark-history) |
| `POST` | `/api/v1/market/documents` | [`ProcessMarketPDF`](#market-processpdf) |

### Planner and routes

| Method | Path | Handler |
|---|---|---|
| `GET` | `/api/v1/route-planner/state` | [`GetPlanner`](#auth-getplanner) |
| `PUT` | `/api/v1/route-planner/state` | [`SavePlanner`](#auth-saveplanner) |
| `GET` | `/api/v1/routes` | [`ListRoutePlans`](#routes-list) |
| `POST` | `/api/v1/routes` | [`CreateRoutePlan`](#routes-createrouteplan) |
| `PATCH` | `/api/v1/routes/:id/segments/:segmentId` | [`SetRouteSegmentCompleted`](#routes-setcompleted) |
| `POST` | `/api/v1/routes/parse` | [`ParseRouteScreenshots`](#routes-parseroutescreenshots) |
| `POST` | `/api/v1/routes/verify-address` | [`VerifyRouteAddress`](#routes-verifyaddress) |

### Grafana webhook

| Mode | Path |
|---|---|
| Cloud | `POST /alerts/grafana` |
| Local API | `POST /api/v1/alerts/grafana` |

Both use [`GrafanaAlertWebhook`](#alerts-grafana).

### Local Windows agent

These paths belong to the local agent, not the cloud API.

| Method | Path | Handler |
|---|---|---|
| `GET` | `/local/health` | Inline health handler |
| `GET` | `/local/processes` | [`GetProcesses`](#process-getprocesses) |
| `GET` | `/local/processes/verify/:pid` | [`VerifyPID`](#process-verifypid) |
| `GET` | `/local/automation/status` | [`GetStatus`](#automation-handler-status) |
| `GET` | `/local/automation/logs` | [`GetLogs`](#automation-handler-logs) |
| `POST` | `/local/automation/start` | [`StartJob`](#automation-handler-start) |
| `POST` | `/local/automation/stop` | [`StopJob`](#automation-handler-stop) |

The agent requires the configured Host and Origin headers. Secured
paths additionally require its pairing bearer token.

The full local API exposes similar process and automation endpoints
under `/api/v1`.

<a id="entry-points"></a>

## 7. Backend entry points

<a id="file-cloud-main"></a>

### `cmd/cloud/main.go`

**Purpose:** Start the production cloud HTTP API.

| Function | Parameters | Behavior and result |
|---|---|---|
| `main()` | None. | Resolves the HTTP port, requires `DATABASE_URL`, initializes five database areas and Upstash authentication, configures middleware, registers endpoints, logs registered routes, and starts Gin on `0.0.0.0:<port>`. Terminates on initialization or listener failure. |

The cloud entry point does not initialize Kafka or desktop automation.

`GET /health` returns a static service status after startup. It does
not perform a fresh dependency check for every request.

<a id="file-local-main"></a>

### `cmd/main.go`

**Purpose:** Start the local API with desktop automation and Kafka logging.

| Function | Parameters | Behavior and result |
|---|---|---|
| `CORSMiddleware() gin.HandlerFunc` | None. | Returns middleware adding local CORS headers and responding to preflight requests with `204`. |
| `main()` | None. | Loads dotenv values, creates the Kafka producer, initializes databases, registers API and automation routes, and listens on `8080`. On shutdown, stops automation, shuts down HTTP, and closes database pools. |

The local CORS implementation uses a wildcard origin together with
credential headers. It is different from the restricted cloud CORS
implementation.

<a id="file-localagent-main"></a>

### `cmd/localagent/main.go`

**Purpose:** Run a paired Windows desktop controller.

Build constraint:

```go
//go:build windows && !cloud
```

| Function | Parameters | Behavior and result |
|---|---|---|
| `main()` | None. | Loads dotenv values, validates required settings, initializes task storage, generates a random pairing token, starts the local HTTP server, and handles shutdown. |
| `securityHeaders() gin.HandlerFunc` | None; reads `FRONTEND_ORIGIN` and `ALLOWED_ADDRESS`. | Adds security/CORS headers, rejects unexpected Host or Origin headers, and handles OPTIONS requests. Returns Gin middleware. |
| `requireToken(expected string) gin.HandlerFunc` | `expected`: generated pairing token. | Uses constant-time comparison against the bearer token. Requires the request marker on POST requests. Returns `401` or `403` on failure. |

<a id="file-migration-main"></a>

### `cmd/migration/main.go`

**Purpose:** Transfer selected SQLite models into PostgreSQL.

`MigrationTask` describes:

- A display name.
- Source SQLite file path.
- Target PostgreSQL database name.
- Models to migrate.

The current tasks use machine-specific Windows source paths.

| Function | Parameters | Behavior and result |
|---|---|---|
| `main()` | None. | Reads PostgreSQL configuration, defines portfolio and notes migrations, ensures target databases exist, and runs each migration. Terminates on failure. |
| `ensureDatabaseExists(host, port, user, password, sslMode, targetDBName string) error` | PostgreSQL server settings and target database name. | Connects to the administrative `postgres` database, checks `pg_database`, and creates the target when absent. Returns connection or creation errors. |
| `runMigration(task MigrationTask, host, port, user, password, sslMode string) error` | Migration definition and PostgreSQL connection settings. | Opens SQLite and PostgreSQL, migrates target table schemas, and copies each configured model. |
| `migrateModelInBatches(sourceDB *gorm.DB, targetDB *gorm.DB, model interface{}) error` | Source connection, target connection, and model prototype. | Constructs a model slice through reflection and copies batches of 300 records using conflict updates. Returns the first migration error. |
| `getEnv(key, fallback string) string` | Variable name and fallback value. | Returns the nonempty environment value, otherwise the fallback. |

This utility is not the missing market schema migration.

<a id="file-pid-target"></a>

### `pid_target.go`

**Purpose:** Standalone keyboard automation prototype.

| Function | Parameters | Behavior and result |
|---|---|---|
| `pressKey(key string) error` | Key name. | Briefly holds modifier keys or taps a normal key using RobotGo. Currently returns `nil`. |
| `verifyPID(pid int) bool` | Windows process ID. | Runs `tasklist` and checks whether the output contains the PID. Returns false on command failure or no match. |
| `main()` | CLI flags. | Validates the target process, parses keys and delays, observes focus, and repeatedly sends keys until interrupted. |

CLI flags:

| Flag | Default | Meaning |
|---|---|---|
| `-pid` | `0` | Required target process ID. |
| `-keys` | `tab,1` | Comma-separated key sequence. |
| `-key-delay` | `0.5` | Seconds between keys. |
| `-loop-delay` | `1.5` | Seconds between loops. |
| `-auto-focus` | `false` | Attempt to activate the target window when unfocused. |

<a id="authentication"></a>

## 8. Authentication and planner persistence

<a id="file-auth-session"></a>

### `pkg/auth/session.go`

**Purpose:** Validate Google sign-in, manage Redis-backed sessions,
enforce browser origin checks, and store planner snapshots.

### Types

| Type | Description |
|---|---|
| `Session` | Google subject identifier and email stored in Redis. |
| `Service` | Upstash endpoint/token, Google configuration, accepted origin, and HTTP client. |
| `plannerSnapshot` | Snapshot version, server timestamp, and raw planner JSON state. |

### Function reference

| Function or method | Parameters | Behavior and result |
|---|---|---|
| <a id="auth-command"></a>`(*Service).command(ctx context.Context, out any, args ...any) error` | `ctx`: request lifetime; `out`: pointer receiving the Redis result, or nil; `args`: Redis command and arguments. | Sends a JSON command array to Upstash using HTTPS POST and bearer authentication. Limits response decoding to 6 MiB. Returns transport, HTTP, command, or decode errors. |
| <a id="auth-newservice"></a>`NewService(ctx context.Context) (*Service, error)` | Initialization context. | Loads and validates settings, creates an HTTP client with an 8-second timeout, validates the HTTPS URL, and requires Redis `PING` to return `PONG`. |
| <a id="auth-close"></a>`(*Service).Close() error` | None. | Closes idle HTTP connections and returns nil. Does not delete Redis data. |
| <a id="auth-sessionkey"></a>`sessionKey(token string) string` | Raw session token. | Returns `session:` followed by the token's SHA-256 hex digest. |
| <a id="auth-newtoken"></a>`newToken() (string, error)` | None. | Generates 32 cryptographically random bytes and returns an unpadded URL-safe Base64 token. |
| <a id="auth-setcookie"></a>`(*Service).setCookie(c *gin.Context, token string, age int)` | Response context, cookie value, and maximum age in seconds. | Writes the secure HttpOnly session cookie. A negative age removes it. |
| <a id="auth-cors"></a>`(*Service).CORS() gin.HandlerFunc` | None; uses configured origin. | Returns middleware enforcing the configured browser origin and setting credentialed CORS headers. Handles preflight requests. |
| <a id="auth-checkorigin"></a>`(*Service).checkOrigin(c *gin.Context) bool` | Request context. | Requires an exact Origin match. Writes `403` and returns false on failure. |
| <a id="auth-googlelogin"></a>`(*Service).GoogleLogin(c *gin.Context)` | JSON `credential`; Origin header. | Validates the Google ID token against the configured client ID, checks verified email and allowed account, stores a 600-second session, sets the cookie, and returns authenticated identity. |
| <a id="auth-requiresession"></a>`(*Service).RequireSession() gin.HandlerFunc` | None. | Returns middleware validating the cookie through Redis `GETEX`, renewing the session TTL and cookie, and placing `Session` in Gin context. Enforces Origin and request-marker checks for mutations. |
| <a id="auth-me"></a>`(*Service).Me(c *gin.Context)` | Session previously placed in context. | Returns `authenticated`, `user_id`, and `email`. |
| <a id="auth-logout"></a>`(*Service).Logout(c *gin.Context)` | Session cookie. | Deletes the current Redis session and removes the cookie. Planner snapshots remain stored. Returns `503` if revocation fails. |
| <a id="auth-plannerkey"></a>`plannerKey(c *gin.Context) string` | Authenticated session in context. | Returns `route-planner:` followed by a SHA-256 digest of the Google subject. |
| <a id="auth-getplanner"></a>`(*Service).GetPlanner(c *gin.Context)` | Authenticated session. | Reads the user's snapshot. Returns `{"snapshot":null}` when absent, or the decoded snapshot. Uses `Cache-Control: no-store`. |
| <a id="auth-saveplanner"></a>`(*Service).SavePlanner(c *gin.Context)` | JSON `expected_version`, `version`, and `state`. | Validates the request and schema, performs an atomic Redis compare-and-set through Lua, and stores the snapshot with a 24-hour TTL. Returns `409` with the current snapshot on a version conflict. |

### Planner save contract

```json
{
  "expected_version": "previous-cloud-version",
  "version": "new-client-generated-version",
  "state": {
    "schema": 1,
    "origin": null,
    "complete": [],
    "incomplete": [],
    "plans": [],
    "selectedId": null,
    "tab": "complete",
    "screenshotCount": 0,
    "phase": "idle",
    "error": ""
  }
}
```

Validation limits:

| Item | Limit |
|---|---|
| Request body reader | 3 MiB |
| Serialized `state` | 2 MiB |
| Version string | 128 characters |
| Expected version string | 128 characters |
| State schema | Must equal `1` |

The backend checks the schema number but does not deeply validate every
field of planner state.

### Compare-and-set behavior

`savePlannerScript` is an embedded Redis Lua script.

It:

1. Reads the existing snapshot version.
2. Accepts a retry carrying the already-stored new version and refreshes TTL.
3. Rejects a different expected version.
4. Stores the new snapshot when the expected version matches.

This prevents a stale offline device from silently overwriting newer
cloud state.

### Retention

| Data | Expiration |
|---|---|
| Authentication session | 600 seconds, renewed by authenticated requests. |
| Planner snapshot | 86,400 seconds, renewed by accepted saves or idempotent save retries. |
| IndexedDB copy | No application TTL; subject to browser storage retention and user actions. |

Reading a planner snapshot does not itself renew its Redis TTL.

<a id="database"></a>

## 9. Database initialization

<a id="file-database-postgres"></a>

### `pkg/database/postgres.go`

**Purpose:** Centralize PostgreSQL connections and pool configuration.

| Function | Parameters | Behavior and result |
|---|---|---|
| <a id="database-connectpostgresdb"></a>`ConnectPostgresDB(dbName string) (*gorm.DB, error)` | Database name to select. | Builds a DSN from `DATABASE_URL` or fallback settings, opens GORM, configures its SQL pool, and pings with a 15-second context. Closes the pool if ping fails. |
| `getEnv(key, fallback string) string` | Variable name and fallback. | Returns a nonempty environment value or the fallback. It does not trim whitespace. |
| `getEnvInt(key string, fallback int) int` | Variable name and positive integer fallback. | Parses a positive integer. Logs and returns the fallback for invalid or nonpositive input. |

Pool connection lifetime is 30 minutes; idle connection lifetime is
5 minutes.

<a id="file-database-core"></a>

### `pkg/database/processdb.go`

| Function | Parameters | Behavior and result |
|---|---|---|
| `InitCoreDB()` | None. | Connects to `POSTGRES_DB`, default `autoclicker`, assigns global `DB`, and migrates `models.Task`. Terminates the process on failure. |

<a id="file-database-notes"></a>

### `pkg/database/notedb.go`

| Function | Parameters | Behavior and result |
|---|---|---|
| `InitNotesDB()` | None. | Connects to `notes_db`, assigns global `NotesDB`, and migrates `models.Note`. Terminates the process on failure. |

<a id="file-database-portfolio"></a>

### `pkg/database/portfoliodb.go`

| Function | Parameters | Behavior and result |
|---|---|---|
| `InitPortfolioDB()` | None. | Connects to `portfolio_db`, assigns global `PortfolioDB`, and migrates holdings, thresholds, settings, and dividend payments. Terminates on failure. |

<a id="file-database-market"></a>

### `pkg/database/marketdb.go`

| Function | Parameters | Behavior and result |
|---|---|---|
| `InitMarketDB() error` | None. | Connects to `market_db` and checks that `public.market_document_analyses` exists. Assigns `MarketDB` only after verification. Returns errors instead of terminating directly. |
| `CloseMarketDB()` | None. | Closes the market pool if present and clears the global pointer. |
| `closeMarketConnection(db *gorm.DB)` | GORM connection to close. | Handles nil connections, obtains the SQL pool, and closes it. Logs failures. |

<a id="file-database-routes"></a>

### `pkg/database/routedb.go`

| Function | Parameters | Behavior and result |
|---|---|---|
| `InitRouteDB() error` | None. | Selects `ROUTES_DB_NAME`, default `route_db`; opens PostgreSQL; migrates plans, stops, services, segments, and route caches; then assigns `RouteDB`. Closes the pool if migration fails. |

<a id="handlers"></a>

## 10. HTTP handlers

### Handler conventions

All functions in this section receive `c *gin.Context` and write their
HTTP response through Gin.

Unless specified otherwise:

- Malformed input usually returns `400`.
- Database failures usually return `500`.
- Successful reads and updates usually return `200`.
- Exact missing-record status handling differs between handlers.

Some CRUD handlers bind directly into persisted models. Their current
validation is not equivalent to a dedicated, fully restricted request DTO.

<a id="file-handler-task"></a>

### `pkg/handlers/task.go`

**Purpose:** CRUD operations for saved automation profiles.

| Function | Request parameters | Behavior and response |
|---|---|---|
| <a id="tasks-gettasks"></a>`GetTasks(c *gin.Context)` | None. | Reads all non-deleted task profiles from the core database. Returns a task array. |
| <a id="tasks-gettaskbyid"></a>`GetTaskByID(c *gin.Context)` | Path `id`: integer task ID. | Returns the selected task; invalid IDs return `400`, failed lookup returns `404`. |
| <a id="tasks-createtask"></a>`CreateTask(c *gin.Context)` | JSON task fields: `name`, `keys`, `key_delay`, `loop_delay`, `auto_focus`. | Binds and inserts a task. Returns `201` with the stored profile. |
| <a id="tasks-updatetask"></a>`UpdateTask(c *gin.Context)` | Path `id`; JSON task fields. | Loads the task, binds changes, saves, and returns the updated task. The final save error is not currently checked. |
| <a id="tasks-deletetask"></a>`DeleteTask(c *gin.Context)` | Path `id`. | Deletes the task using GORM. The model includes soft deletion. Returns a success message. |

Example task body:

```json
{
  "name": "Example",
  "keys": "tab,1",
  "key_delay": 0.5,
  "loop_delay": 1.5,
  "auto_focus": false
}
```

Comments referring to MySQL are historical. Current initialization uses
PostgreSQL.

<a id="file-handler-note"></a>

### `pkg/handlers/note.go`

| Function | Request parameters | Behavior and response |
|---|---|---|
| <a id="notes-getnotes"></a>`GetNotes(c *gin.Context)` | None. | Returns notes from `NotesDB`. |
| <a id="notes-createnote"></a>`CreateNote(c *gin.Context)` | JSON note fields, normally `content` and optionally `done`. | Inserts a note and returns it. |
| <a id="notes-updatenote"></a>`UpdateNote(c *gin.Context)` | Path `id`; JSON note fields. | Loads, modifies, and saves a note. The final save error is not currently checked. |
| <a id="notes-deletenote"></a>`DeleteNote(c *gin.Context)` | Path `id`. | Deletes the selected note and returns a message. |

<a id="file-handler-portfolio"></a>

### `pkg/handlers/portfolio.go`

**Purpose:** Holdings CRUD, valuation, aggregate history, and buying power.

| Function | Parameters | Behavior and result |
|---|---|---|
| <a id="portfolio-getholdings"></a>`GetHoldings(c *gin.Context)` | No request parameters. | Returns holdings ordered by symbol descending. |
| <a id="portfolio-createholding"></a>`CreateHolding(c *gin.Context)` | JSON holding fields. | Inserts a holding and returns it. |
| <a id="portfolio-updateholding"></a>`UpdateHolding(c *gin.Context)` | Path `id`; JSON holding fields. | Loads and updates a holding. The final save error is not currently checked. |
| <a id="portfolio-deleteholding"></a>`DeleteHolding(c *gin.Context)` | Path `id`. | Deletes a holding and returns a message. |
| <a id="portfolio-summary"></a>`GetPortfolioSummary(c *gin.Context)` | No request parameters. | Fetches holdings, calculates per-holding quotes concurrently, aggregates USD/EUR values and gains, and includes buying power. |
| <a id="portfolio-buildholdingquote"></a>`buildHoldingQuote(h models.Holding) models.HoldingQuote` | Holding and purchase information. | Retrieves quote/FX data and computes purchase costs, valuation, daily gains, and total gains. Quote failures are included in `QuoteFetchError`. |
| <a id="portfolio-fxorone"></a>`fxOrOne(from, to string) float64` | Source and target currency codes. | Returns the exchange rate. Despite its name, returns `0` when rate retrieval fails. |
| `min(a, b int) int` | Two integers. | Returns the smaller value. |
| <a id="portfolio-processquotes"></a>`processHoldingQuotes(holdings []models.Holding) []models.HoldingQuote` | Input holding slice. | Uses up to eight workers, preserves input positions, and converts worker panics into per-holding error results. |
| <a id="portfolio-history"></a>`GetPortfolioHistory(c *gin.Context)` | No request parameters. | Loads intraday series and creates aggregate OHLC arrays in USD and EUR. Returns empty arrays when no usable data exists. |
| <a id="portfolio-getbuyingpower"></a>`GetBuyingPower(c *gin.Context)` | No request parameters. | Gets or creates portfolio settings with ID `1`, then returns them. |
| <a id="portfolio-updatebuyingpower"></a>`UpdateBuyingPower(c *gin.Context)` | JSON `buying_power`: number. | Updates buying power in settings ID `1` and returns the settings. |

Typical holding payload:

```json
{
  "symbol": "NVDA",
  "shares": 3,
  "purchase_price": 211,
  "purchase_price_currency": "USD",
  "purchase_date": "2026-09-16T00:00:00Z"
}
```

History limitations:

- Current FX rates are applied across intraday points.
- Series are aligned by recent array positions.
- Aggregate high/low values sum per-asset bars.
- This is an approximation, not a reconstructed historical portfolio ledger.

<a id="file-handler-dividends"></a>

### `pkg/handlers/dividends.go`

**Purpose:** Estimate dividend amounts from Yahoo ex-dividend history.

| Function | Request parameters | Behavior and response |
|---|---|---|
| <a id="dividends-getportfolio"></a>`GetPortfolioDividends(c *gin.Context)` | Optional query `refresh=true`. | Loads holdings, requests dividend events with concurrency limited to four, calculates gross EUR amounts, and applies the hardcoded estimated rate of `0.28`. Returns per-holding errors and a `complete` flag. |

Response types:

| Type | Description |
|---|---|
| `HoldingDividendEstimate` | One holding's events, shares, original gross amount, EUR gross, estimated tax, estimated net, and optional error. |
| `PortfolioDividendEstimate` | Holding estimates, aggregate values, FX rate, calculation timestamp, and completeness. |

These are estimates derived from ex-dividend events and the current
holding quantity. They are not proof of broker payments or a tax ledger.

<a id="file-handler-threshold"></a>

### `pkg/handlers/threshold.go`

`PriceThresholdRequest` accepts:

| Field | Type | Rules |
|---|---|---|
| `symbol` | string | Required; normalized to uppercase; maximum 10 characters. |
| `condition` | string | Required; `above` or `below`. |
| `target_price` | number | Required and greater than zero. |
| `enabled` | optional boolean | Defaults to true on creation; preserves existing value on update when omitted. |

| Function | Request parameters | Behavior and response |
|---|---|---|
| <a id="thresholds-create"></a>`CreatePriceThreshold(c *gin.Context)` | JSON `PriceThresholdRequest`. | Validates and inserts a threshold. Returns the stored record. |
| <a id="thresholds-update"></a>`UpdatePriceThreshold(c *gin.Context)` | Path `id`; JSON request. | Loads, validates, and updates the record. |
| <a id="thresholds-list"></a>`GetPriceThresholds(c *gin.Context)` | None. | Returns records ordered by symbol and condition. |
| <a id="thresholds-get"></a>`GetPriceThreshold(c *gin.Context)` | Path `id`. | Returns one threshold. |
| <a id="thresholds-delete"></a>`DeleteThreshold(c *gin.Context)` | Path `id`. | Deletes one threshold. Returns `404` when no row was affected. |

<a id="file-handler-benchmark"></a>

### `pkg/handlers/benchmark.go`

| Function | Request parameters | Behavior and response |
|---|---|---|
| <a id="benchmark-history"></a>`GetBenchmarkHistory(c *gin.Context)` | None. | Fetches SPY intraday OHLC data and returns `symbol` and `points`. Returns an empty array for no data or `500` for provider failure. |

SPY is fixed in the implementation; the handler does not accept a
benchmark symbol parameter.

<a id="file-handler-market"></a>

### `pkg/handlers/market.go`

| Function | Request parameters | Behavior and response |
|---|---|---|
| <a id="market-processpdf"></a>`ProcessMarketPDF(c *gin.Context)` | Multipart `file`. | Opens the upload, writes it to a temporary file, invokes the Go market-processing service, removes the temporary file, and returns the Python result. |

The declared upload size is 25 MiB. The current implementation compares
size using equality rather than a greater-than limit check; it does not
correctly enforce the intended upper bound.

The handler currently does not save the analysis into `MarketDB`.

<a id="file-handler-market-quotes"></a>

### `pkg/handlers/market_quotes.go`

| Function | Request parameters | Behavior and response |
|---|---|---|
| <a id="market-getquotes"></a>`GetMarketQuotes(c *gin.Context)` | Query `symbols`: comma-separated tickers. | Trims, uppercases, and deduplicates symbols. Accepts 1–50 unique symbols. Fetches quotes with concurrency limited to five. Returns `quotes`, per-symbol `errors`, and UTC `timestamp`. |

Example:

```http
GET /api/v1/market/quotes?symbols=NVDA,XOM,O
```

A partial provider failure can still produce HTTP `200` with entries in
the `errors` object.

<a id="file-handler-monitoring"></a>

### `pkg/handlers/monitoring.go`

| Function | Request parameters | Behavior and response |
|---|---|---|
| <a id="monitoring-getmetrics"></a>`GetPrometheusMetrics(c *gin.Context)` | None. | Calls `PrometheusStockMetrics` and writes Prometheus text output, or an error response if generation fails. |

Cloud mode protects this endpoint with session authentication.

<a id="file-handler-alert"></a>

### `pkg/handlers/alert.go`

| Function | Request parameters | Behavior and response |
|---|---|---|
| <a id="alerts-grafana"></a>`GrafanaAlertWebhook(c *gin.Context)` | `Authorization: Bearer <GRAFANA_WEBHOOK_TOKEN>` and Grafana webhook JSON. | Rejects missing or incorrect credentials with `401`, binds the alert payload, returns `204` for no alerts, forwards alerts to Discord, and returns `202` on success. |

This handler forwards notifications. It does not execute trades.

<a id="file-handler-process"></a>

### `pkg/handlers/process.go`

| Function | Request parameters | Behavior and response |
|---|---|---|
| <a id="process-getprocesses"></a>`GetProcesses(c *gin.Context)` | Optional query `name`: case-insensitive substring. | Enumerates local PIDs with gopsutil, resolves accessible process names, filters them, and returns `{pid,name}` records. |
| <a id="process-verifypid"></a>`VerifyPID(c *gin.Context)` | Path `pid`: signed 32-bit integer representation. | Returns whether the process exists and its name when available. Invalid formatting returns `400`; a missing process returns `200` with `exists:false`. |

The file also declares its own `ProcessInfo` response structure.

<a id="file-handler-automation"></a>

### `pkg/handlers/automation.go`

Build constraint:

```go
//go:build !cloud
```

| Function | Request parameters | Behavior and response |
|---|---|---|
| <a id="automation-handler-start"></a>`StartJob(c *gin.Context)` | JSON `task_id` and `pid`, both required. | Calls the global automation manager. Returns `409` when the manager rejects startup. |
| <a id="automation-handler-stop"></a>`StopJob(c *gin.Context)` | None. | Requests cancellation of the active job and returns a message. |
| <a id="automation-handler-status"></a>`GetStatus(c *gin.Context)` | None. | Returns the manager's `JobStatus`. |
| <a id="automation-handler-logs"></a>`GetLogs(c *gin.Context)` | None. | Returns `{"logs":[...]}` from the manager's bounded log buffer. |

`ProcessDTO` is a process response type declared in this file.

<a id="file-handler-routes"></a>

### `pkg/handlers/routes.go`

**Purpose:** Validate route requests, call the cloud optimizer, cache
optimization results, persist plans, and construct Google Maps links.

### Request types

| Type | Fields |
|---|---|
| `RouteInputService` | `service_type` |
| `RouteInputStop` | `address`, `latitude`, `longitude`, `services` |
| `CreateRouteRequest` | `name`, `stops`, `round_trip` |
| `CloudRouteRequest` | `coordinates`, `round_trip` |
| `CloudRouteResponse` | `order`, `distance_m`, `duration_s` |

The `name` request field is not used as the saved plan name.

### Function reference

| Function | Parameters | Behavior and result |
|---|---|---|
| <a id="routes-mapsurl"></a>`mapsURL(stops []RouteInputStop) string` | Ordered stops including origin and destination. | Builds a Google Maps driving URL with coordinates formatted to six decimals. Returns an empty string for fewer than two stops. |
| <a id="routes-validorder"></a>`validOrder(order []int, count int) bool` | Optimizer indices and expected point count. | Requires at least two points, exact length, origin index zero first, and each index exactly once. |
| <a id="routes-validoptimization"></a>`validOptimization(result CloudRouteResponse, count int) bool` | Optimizer response and point count. | Validates the order plus finite, nonnegative distance and duration. |
| <a id="routes-requestoptimization"></a>`requestOptimization(ctx context.Context, payload CloudRouteRequest) (CloudRouteResponse, error)` | Request lifetime and longitude/latitude coordinate payload. | POSTs to `<ROUTING_SERVICE_URL>/optimize` with a 180-second HTTP timeout. Returns decoded output or an upstream error. Currently reads the wrong variable for the bearer credential. |
| <a id="routes-coordkey"></a>`coordKey(stop RouteInputStop) string` | One stop. | Returns a six-decimal latitude/longitude key used for destination deduplication. |
| <a id="routes-validpoint"></a>`validPoint(stop RouteInputStop) bool` | One stop. | Rejects nonfinite values, out-of-range latitude/longitude, and the `(0,0)` pair. |
| <a id="routes-createrouteplan"></a>`CreateRoutePlan(c *gin.Context)` | JSON route request. | Validates 2–150 input locations, merges equal coordinate keys, checks optimization cache, optimizes the whole journey on a cache miss, persists ordered stops/services/segments, and returns `201`. |
| <a id="routes-list"></a>`ListRoutePlans(c *gin.Context)` | None. | Returns up to 30 newest plans, preloading ordered stops, stop services, and ordered segments. |
| <a id="routes-setcompleted"></a>`SetRouteSegmentCompleted(c *gin.Context)` | Path `id`, path `segmentId`, JSON `completed`: boolean. | Updates a matching route segment and sets or clears its completion timestamp. Returns `404` when the segment is absent. |

### Route creation rules

- The first point is the starting location.
- Remaining points are destinations.
- Input allows a start plus 1–149 destinations.
- Equal six-decimal coordinate keys are merged.
- Delivery and pickup service records are retained under the merged stop.
- Optimization is performed once for the complete journey.
- Cached optimization results are validated before reuse.
- A round trip appends the starting point after the optimized destinations.
- Each generated link contains a start and up to ten subsequent stops.
- Each next segment starts where the preceding segment ends.
- The saved plan name is generated from the segment count.

For 100 unique destinations and no return leg, the backend produces
10 sequential Google Maps links.

These are segments of one optimized journey, not ten independently
optimized vehicle routes.

VROOM produces an optimized solution; the implementation does not
establish a mathematical proof of global optimality.

### Route creation example

```json
{
  "round_trip": false,
  "stops": [
    {
      "address": "Current location",
      "latitude": 40.537,
      "longitude": -7.268,
      "services": []
    },
    {
      "address": "Verified destination",
      "latitude": 40.55,
      "longitude": -7.25,
      "services": [
        {
          "service_type": "delivery"
        }
      ]
    }
  ]
}
```

<a id="file-handler-routes-import"></a>

### `pkg/handlers/routes_import.go`

**Purpose:** Extract route services from screenshots and verify their
addresses.

### Important types

| Type | Description |
|---|---|
| `ParsedRouteService` | Address, service kind, coordinates, status, and verification reason. |
| `routeParseResult` | Extraction cache wrapper containing services. |
| `routeModelAttempt` | Model name, processing stage, upstream status/request ID, finish reason, message, and duration. |
| `routeParseFailure` | Application HTTP status, error code, stage, message, and model-attempt details. |

### Function reference

| Function | Parameters | Behavior and result |
|---|---|---|
| `(*routeParseFailure).Error() string` | None; uses receiver. | Returns the failure message for the Go `error` interface. |
| <a id="routes-routehash"></a>`routeHash(value []byte) string` | Bytes to identify. | Returns their SHA-256 hex digest. |
| <a id="routes-normalizeaddress"></a>`normalizeRouteAddress(s string) string` | Address text. | Lowercases, trims, and collapses whitespace for cache and deduplication keys. |
| <a id="routes-validateaddress"></a>`validateRouteAddress(address string) string` | Extracted address. | Checks undefined fields, Portuguese postal code, locality after the postal code, and minimum street information. Returns an empty string when valid or a reason otherwise. |
| <a id="routes-requestid"></a>`routeRequestID() string` | None. | Generates a random request ID, with a timestamp fallback if random generation fails. |
| <a id="routes-safemessage"></a>`safeRouteProviderMessage(message string) string` | Provider diagnostic message only. | Redacts configured Gemini/Geoapify keys, collapses whitespace, and limits output to 1,200 runes. It is not a general-purpose sanitizer for uploaded or extracted content. |
| <a id="routes-configuredmodels"></a>`configuredRouteGeminiModels() []string` | Environment configuration. | Builds the ordered model list, removes `models/` prefixes, excludes blanks, and removes duplicates. |
| <a id="routes-respondfailure"></a>`respondRouteFailure(c *gin.Context, requestID string, started time.Time, imageIndex int, failure *routeParseFailure)` | Response context, correlation ID, operation start time, optional image number, and failure details. | Logs and returns structured diagnostic JSON including duration, parser version, revision, and attempts when present. |
| <a id="routes-decodeextraction"></a>`decodeRouteExtraction(text string) ([]ParsedRouteService, error)` | Model JSON text. | Requires a non-null `services` array, trims addresses, rejects empty addresses, and normalizes unknown service kinds to `unknown`. |
| <a id="routes-attemptgemini"></a>`attemptRouteGemini(ctx context.Context, model string, apiKey string, body []byte) (services []ParsedRouteService, attempt routeModelAttempt, attemptErr error)` | Parent context, model ID, Gemini key, and encoded request. | Executes one model attempt with a 60-second limit. Reads at most 2 MiB, validates provider status and generation completion, decodes services, and returns attempt diagnostics. |
| <a id="routes-extractgemini"></a>`extractRouteWithGemini(ctx context.Context, data []byte, mime string) ([]ParsedRouteService, error)` | Screenshot bytes and MIME type. | Builds the shared prompt/image payload and tries configured models in order using one API key. Stops on credential rejection or blocked content. |
| <a id="routes-parseimage"></a>`parseRouteImage(ctx context.Context, data []byte, mime string) ([]ParsedRouteService, error)` | Screenshot bytes and MIME type. | Looks up extraction results by image hash before invoking Gemini. Stores successful extraction output for reuse. |
| <a id="routes-geocode"></a>`geocodeRouteAddress(ctx context.Context, address string) (float64, float64, error)` | Address and request lifetime. | Checks the geocoding cache, queries Geoapify with a Portugal filter, verifies the postal code, caches coordinates, and returns latitude then longitude. |
| <a id="routes-resolveservice"></a>`resolveRouteService(ctx context.Context, service ParsedRouteService) ParsedRouteService` | One extracted service. | Resets coordinates/status, validates the address, geocodes it, and returns either `complete` with coordinates or `uncomplete` with a reason. |
| <a id="routes-parseroutescreenshots"></a>`ParseRouteScreenshots(c *gin.Context)` | Multipart `files`, 1–10 screenshots. | Validates PNG/JPEG/WebP content and per-image size up to 10 MiB, extracts services, verifies unique normalized addresses, and returns complete/incomplete service arrays and diagnostics. Uses a 240-second overall context. |
| <a id="routes-verifyaddress"></a>`VerifyRouteAddress(c *gin.Context)` | JSON `address`: required string. | Runs address verification for one address and returns a `ParsedRouteService`. An unverified address can be returned with HTTP `200` and an incomplete status. |

### Extraction behavior

The prompt preserves one record per visible service card.

Two cards at the same address remain two services. They can later become
one destination with multiple services.

The extraction intentionally avoids:

- Inventing missing address fields.
- Guessing hidden information.
- Extracting recipient identities or tracking identifiers.
- Merging separate service cards.

### Complete versus uncomplete

In this endpoint:

- `complete` means an address passed verification.
- `uncomplete` means an address needs attention.

These statuses do not mean a delivery has been completed.

Delivery route segment completion is a separate concept.

### Diagnostic response fields

Failures can include:

```json
{
  "error": "Human-readable failure",
  "code": "MACHINE_READABLE_CODE",
  "stage": "gemini",
  "request_id": "correlation-id",
  "parser_version": "gemini-fallback-diagnostics-v1",
  "revision": "cloud-run-revision",
  "duration_ms": 1200,
  "image_index": 1,
  "configured_models": [],
  "attempts": []
}
```

Use `request_id` and `revision` to correlate browser errors with backend
logs.

<a id="services"></a>

## 11. Backend services

<a id="file-service-automation"></a>

### `pkg/services/automation.go`

**Purpose:** Manage one active desktop keyboard automation job.

Build constraint:

```go
//go:build !cloud
```

`Manager` is the package-level `JobManager` instance.

| Method or function | Parameters | Behavior and result |
|---|---|---|
| `(*JobManager).InitKafka(writer *kafka.Writer)` | Existing Kafka writer. | Stores the writer under the manager mutex. |
| `(*JobManager).log(format string, args ...interface{})` | Formatting string and values. | Adds a timestamped line, retains at most 500 lines, and publishes through Kafka when configured. |
| `(*JobManager).GetLogs() []string` | None. | Returns a copy of buffered logs under a mutex. |
| `(*JobManager).clearLogs()` | None. | Clears the in-memory log buffer. |
| `(*JobManager).IsActive() bool` | None. | Returns whether a job is active under a mutex. |
| <a id="automation-startjob"></a>`(*JobManager).StartJob(taskID uint, pid int) error` | Saved task ID and target process ID. | Rejects a second active job, loads the task, resets logs, creates cancellation state, records status, and starts the worker goroutine. |
| `(*JobManager).StopJob() error` | None. | Closes the cancellation channel for an active job, updates status, and logs the stop. Calling it while idle succeeds. |
| `(*JobManager).stopFromWorker(reason string)` | Reason for an internal stop. | Marks the job stopped and records the reason without closing the cancellation channel again. |
| `(*JobManager).GetStatus() models.JobStatus` | None. | Returns the current job status under a mutex. |
| `waitOrCancel(cancel <-chan struct{}, duration time.Duration) bool` | Cancellation channel and wait duration. | Waits for the delay or cancellation. Returns false when cancelled, true when the delay completes. |
| `(*JobManager).worker(task models.Task, pid int, cancel <-chan struct{})` | Task profile, process ID, and cancellation channel. | Parses keys, checks PID existence and focus, optionally activates the process, sends keys, and waits between keys/loops. Stops on cancellation or process disappearance. |
| `pressKey(key string)` | Normalized key name. | Holds modifier keys briefly or taps other keys using RobotGo. |

Focus is checked before and during sequences. OS scheduling and focus
changes can still occur between a check and a key event.

<a id="file-service-process"></a>

### `pkg/services/process.go`

| Function | Parameters | Behavior and result |
|---|---|---|
| `ListProcesses() ([]models.ProcessInfo, error)` | None. | Runs Windows `tasklist /FO CSV /NH`, parses process names/PIDs, and returns valid process records. Returns command execution errors. |

This is separate from the gopsutil-based HTTP handler implementation.

<a id="file-service-quote"></a>

### `pkg/services/quote.go`

**Purpose:** Retrieve quotes, currency conversion rates, and intraday bars.

| Function | Parameters | Behavior and result |
|---|---|---|
| `yahooRequest(url string) (*http.Response, error)` | Yahoo request URL. | Creates a GET request with a browser User-Agent and executes it using the shared 6-second client. Caller closes the response body. |
| <a id="services-fetchquote"></a>`FetchQuote(symbol string) (Quote, error)` | Yahoo ticker symbol. | Checks cache, tries Yahoo's quote endpoint, selects pre/post-market price when applicable, then falls back to chart metadata. Caches successful results. |
| `fetchQuoteViaChart(symbol string) (Quote, error)` | Yahoo ticker symbol. | Fetches chart metadata and returns regular-session price, previous close, and currency. |
| `FetchFXRate(from, to string) (float64, error)` | Source and destination currency codes. | Returns `1` for empty/equal currencies, checks cache, tries the direct Yahoo FX pair, then the inverse pair. |
| `IntradaySeries(symbol string) ([]OHLCPoint, error)` | Yahoo ticker symbol. | Fetches current-day 5-minute OHLC bars, skips nil price entries, and caches the result. |

Types:

| Type | Description |
|---|---|
| `Quote` | Effective price, previous close, currency, and market session. |
| `OHLCPoint` | Unix timestamp and open/high/low/close values. |
| `yahooQuoteResponse` | Quote endpoint decoding structure. |
| `chartMetaResponse` | Chart metadata decoding structure. |
| `chartOHLCResponse` | Intraday chart decoding structure. |

<a id="file-service-cache"></a>

### `pkg/services/cache.go`

**Purpose:** Generic mutex-protected in-memory TTL storage.

| Function or method | Parameters | Behavior and result |
|---|---|---|
| `newTTLCache[T any]() *ttlCache[T]` | Generic value type. | Allocates an empty cache. |
| `(*ttlCache[T]).get(key string) (T, bool)` | Lookup key. | Returns a valid cached value and true, or the type's zero value and false when absent/expired. |
| `(*ttlCache[T]).set(key string, value T, ttl time.Duration)` | Key, value, and lifetime. | Stores the value and expiration time under a write lock. |

Configured caches:

| Cache | TTL |
|---|---|
| Quotes | 12 minutes |
| FX rates | 5 minutes |
| Intraday series | 30 seconds |

Expired entries are ignored but not actively removed.

Caches are per process and disappear on restart. They are not shared
across Cloud Run instances.

<a id="file-service-dividends"></a>

### `pkg/services/dividends.go`

| Function | Parameters | Behavior and result |
|---|---|---|
| `FetchDividendHistory(symbol string, purchaseDate time.Time, forceRefresh bool) ([]DividendEvent, error)` | Ticker, purchase date, and cache bypass flag. | Normalizes the ticker, validates the date, requests Yahoo dividend events, filters nonpositive/out-of-window events, deduplicates timestamps, sorts by ex-date, and caches for six hours. |

A future purchase date returns an empty slice.

`DividendEvent` contains:

- `ex_date`
- `amount_per_share`

The HTTP client timeout is 12 seconds and response reading is limited
to 8 MiB.

<a id="file-service-discord"></a>

### `pkg/services/discord.go`

| Function | Parameters | Behavior and result |
|---|---|---|
| `HandlerGrafanaAlert(payload GrafanaAlertWebhook) error` | Decoded Grafana alert payload. | Requires `DISCORD_WEBHOOK_URL`, builds a message, POSTs JSON with a 10-second client timeout, and requires a 2xx result. |
| `buildDiscordAlertMessage(payload GrafanaAlertWebhook) string` | Alert payload. | Formats status, summaries, symbols, conditions, values, and start timestamps into a Discord message. Truncates long output. |

Types:

| Type | Description |
|---|---|
| `GrafanaAlertWebhook` | Overall status and alert array. |
| `GrafanaAlert` | Labels, annotations, timestamps, values, and evaluation text. |
| `discordWebhookPayload` | Discord `content` body. |

<a id="file-service-market-processor"></a>

### `pkg/services/market_processor.go`

| Function | Parameters | Behavior and result |
|---|---|---|
| `ProcessMarketPDF(pdfPath string) (models.MarketDocumentResult, error)` | Local PDF path. | Resolves Python and script paths, executes the processor, captures stdout/stderr, decodes JSON output, and returns the market document result. |
| `getMarketProcessorPath() (string, error)` | None. | Resolves `market_processor/market_processor.py` relative to the working directory and verifies that it exists. |

`pythonMarketResult` is the subprocess response decoding structure.

The subprocess currently uses `exec.Command`, without a request-bound
cancellation context or explicit execution timeout.

<a id="file-service-market-compression"></a>

### `pkg/services/market_compression.go`

| Function | Parameters | Behavior and result |
|---|---|---|
| `CompressMarketJSON(value any) ([]byte, error)` | JSON-marshalable value. | Serializes the value and compresses it with gzip. Returns compressed bytes or an error. |
| `DecompressMarketJSON(value []byte, target any) error` | Compressed bytes and destination pointer. | Opens gzip data and decodes JSON into the target. Returns decompression or decoding errors. |

These helpers do not by themselves implement PDF-analysis persistence.

<a id="file-service-stockmetrics"></a>

### `pkg/services/stockmetrics.go`

| Function | Parameters | Behavior and result |
|---|---|---|
| `PrometheusStockMetrics() (string, error)` | None. | Loads enabled thresholds, deduplicates and sorts symbols, retrieves quotes, and generates Prometheus gauge text. Skips symbols whose quotes fail. |

Generated metrics:

```text
stock_price
stock_price_threshold_above
stock_price_threshold_below
```

Labels include `symbol` and `currency`.

<a id="kafka"></a>

## 12. Kafka and logging

<a id="file-kafka-message"></a>

### `pkg/kafka/LogMessage.go`

Defines the structured Kafka log envelope.

It contains timestamp, level, service, and message data.

There are no functions in this file.

<a id="file-kafka-producer"></a>

### `pkg/kafka/LogProducer.go`

| Function or method | Parameters | Behavior and result |
|---|---|---|
| `kafkaTLSConfig() (*tls.Config, error)` | Environment configuration. | Returns nil when TLS is disabled. Otherwise builds TLS 1.2+ configuration, optionally loads a CA and mutual-TLS certificate/key, and validates paired certificate settings. |
| `kafkaSASLMechanism() (sasl.Mechanism, error)` | Environment credentials and mechanism. | Returns nil when both credentials are absent, rejects partial credentials, and constructs SCRAM-SHA-256 or SCRAM-SHA-512 authentication. |
| `NewLogProducer(brokers []string, topic string, serviceName string) (*LogProducer, error)` | Broker addresses, output topic, and service label. | Validates configuration and constructs an asynchronous Kafka writer using least-bytes balancing and a delivery-error callback. Automatic topic creation is disabled. |
| `(*LogProducer).Close() error` | None. | Closes the writer when present. |
| `(*LogProducer).EmitAppLog(ctx context.Context, level, message string) error` | Context, severity, and message. | Encodes a structured log and writes it to Kafka. The encoded service field is currently hardcoded to `app`. |

Constructing the writer does not establish that every future delivery
will succeed. Asynchronous delivery errors are logged by the completion
callback.

<a id="file-middleware-logging"></a>

### `internal/middleware/logging.go`

| Function | Parameters | Behavior and result |
|---|---|---|
| `NetworkLogger(writer *kafka.Writer) gin.HandlerFunc` | Kafka writer used for HTTP events. | Returns Gin middleware that measures a request, runs downstream handlers, and publishes timestamp, method, route path, status, latency, and client IP. |

`NetworkLogPayload` defines the event shape.

The middleware currently ignores marshal/write errors and uses a
background context.

The configured writer determines the topic; this middleware does not
select `network-logs` independently.

<a id="models"></a>

## 13. Backend data models

These files declare data structures and GORM mappings. They do not
declare methods at the documented revision.

<a id="file-model-automation"></a>

### `pkg/models/automation.go`

| Type | Purpose |
|---|---|
| `ProcessInfo` | Process ID and executable name. |
| `Task` | Persisted automation profile: name, comma-separated keys, delays, autofocus, timestamps, and soft deletion. |
| `StartJobRequest` | Required task ID and target PID. |
| `JobStatus` | Current task identity, target PID, task name, and running flag. |

<a id="file-model-note"></a>

### `pkg/models/note.go`

| Type | Purpose |
|---|---|
| `Note` | Content, completion state, primary key, and creation/update timestamps. |

<a id="file-model-holding"></a>

### `pkg/models/holding.go`

| Type | Purpose |
|---|---|
| `PortfolioSettings` | Portfolio identifier, buying power, and update timestamp. |
| `Holding` | Symbol, shares, purchase price/currency/date, and timestamps. |
| `HoldingQuote` | Holding enriched with quotes, market session, costs, valuations, gains, conversions, and provider errors. |
| `PortfolioPoint` | Timestamped OHLC portfolio point. |
| `PortfolioHistory` | Separate USD and EUR point arrays. |
| `PortfolioSummary` | Aggregate valuation/gain fields, buying power, and enriched holdings. |

Some declared weekly and generic gain fields are not populated by the
current summary calculation.

<a id="file-model-threshold"></a>

### `pkg/models/threshold.go`

| Type or constant | Purpose |
|---|---|
| `PriceThreshold` | Symbol, condition, positive target, enabled state, and timestamps. |
| `ThresholdConditionAbove` | String constant `above`. |
| `ThresholdConditionBelow` | String constant `below`. |

The schema defines a unique symbol/condition combination.

<a id="file-model-dividends"></a>

### `pkg/models/dividends.go`

| Type | Purpose |
|---|---|
| `DividendPayment` | Recorded or expected dividend, linked holding, dates, eligible shares, currency, FX, taxes in EUR, received flag, and notes. |
| `DividendCalculated` | Payment enriched with gross, tax, and net calculations. |
| `DividendTotals` | Aggregate EUR gross, tax, and net values. |
| `DividendResponse` | Payment array and totals. |

The current registered dividend endpoint returns estimates from Yahoo;
it does not expose CRUD endpoints for these payment records.

<a id="file-model-market"></a>

### `pkg/models/market_document.go`

| Type | Purpose |
|---|---|
| `MarketDocumentResult` | Source filename, extracted companies, and AI summary. |
| `MarketCompany` | Company name, ticker, bullish flag, and bearish flag. |

Bullish and bearish can both be true when the document contains both
types of information.

<a id="file-model-route"></a>

### `pkg/models/route.go`

| Type | Purpose |
|---|---|
| `RoutePlan` | Generated plan name, internal cache key, distance in meters, duration in seconds, timestamp, stops, and segments. |
| `RouteStop` | Ordered destination coordinates/address linked to a plan. |
| `RouteService` | Delivery/pickup/unknown service linked to a stop. |
| `RouteSegment` | Google Maps URL, sequence, start/end stop indices, and completion state. |
| `RouteOptimizationCache` | Serialized optimization output keyed by coordinate/request hash. |
| `RouteImageCache` | Serialized screenshot extraction output keyed by image hash. |
| `RouteGeocodeCache` | Address and verified coordinates keyed by normalized-address hash. |

Plan/stop/segment relationships are persisted in PostgreSQL.

Planner snapshots in Redis are a separate storage layer.

<a id="market-processor"></a>

## 14. Python financial document processor

### `market_processor/market_processor.py`

**Purpose:** Extract PDF text, identify companies and sentiment, and
generate a summary through Gemini.

| Function | Parameters | Behavior and result |
|---|---|---|
| `extract_pdf_text(pdf_path: Path) -> str` | PDF filesystem path. | Validates the file, reads pages with pypdf, joins extracted text, and raises `ProcessingError` for unreadable or textless documents. |
| `build_gemini_client() -> genai.Client` | Reads `GEMINI_API_KEY`. | Creates the Google GenAI client or raises `ProcessingError` when the key is missing. |
| `_run_with_model_fallback(step_name: str, attempt)` | Diagnostic step label and callback accepting a model name. | Calls the callback for each model in `GEMINI_MODEL_CHAIN`; logs supported failures to stderr; returns the first successful result or raises `ProcessingError`. The callback/return are not fully annotated in the current source. |
| `analyse_market_text(client: genai.Client, text: str) -> dict[str, Any]` | GenAI client and extracted PDF text. | Applies the company extraction prompt and response schema through model fallback. Returns decoded JSON. |
| `analyse_market_text.<locals>.attempt(model_name: str) -> dict[str, Any]` | One model name. | Performs one structured extraction call, rejects empty output, and JSON-decodes the response. |
| `generate_summary(client: genai.Client, text: str) -> str` | Client and document text. | Generates the document summary through model fallback. |
| `generate_summary.<locals>.attempt(model_name: str) -> str` | One model name. | Performs one summary call and returns nonempty trimmed text. |
| `process_pdf(pdf_path: Path) -> dict[str, Any]` | PDF path. | Extracts text, creates the client, obtains company analysis and summary, and returns the combined result. |
| `parse_args() -> argparse.Namespace` | CLI arguments. | Defines and parses the positional PDF path argument. |
| `main() -> int` | Parsed CLI input. | Runs processing, writes result JSON to stdout, writes processing errors to stderr, and returns `0` or `1`. |

### Error type

`ProcessingError` identifies expected document and AI-processing
failures.

### Output

```json
{
  "source_file": "document.pdf",
  "companies": [
    {
      "company_name": "Example",
      "symbol": "EXAMPLE",
      "bullish": true,
      "bearish": false
    }
  ],
  "ai_summary": "Document summary."
}
```

### Related file

`market_processor/requirements.txt` declares:

- `google-genai`
- `pypdf`
- `python-dotenv`

The model chain is separate from the Go screenshot parser's
`ROUTE_GEMINI_MODELS` configuration.

<a id="routing-service"></a>

## 15. VROOM and OSRM routing service

<a id="file-routing-app"></a>

### `routing-service/app.py`

**Purpose:** Authenticate optimization requests, invoke VROOM against
OSRM, and validate the resulting route.

### Request model

`OptimizeRequest` contains:

| Field | Type | Rules |
|---|---|---|
| `coordinates` | List of longitude/latitude pairs | 2–150 points. First point is the depot. |
| `round_trip` | Boolean | Defaults to false. |

### Function reference

| Function | Parameters | Behavior and result |
|---|---|---|
| `health()` | None. | Async `GET /health` handler returning `{"status":"ok"}`. The source does not annotate its return type. |
| `optimize(request: OptimizeRequest, authorization: str = Header(default=""))` | Validated coordinate request and Authorization header. | Authenticates using constant-time bearer comparison, validates coordinates, writes a temporary VROOM input, executes VROOM, validates assignment/order/metrics, and returns `order`, `distance_m`, and `duration_s`. The source does not annotate its return type. |

Optimization details:

- One VROOM vehicle.
- First coordinate is the fixed start.
- Remaining coordinates become jobs.
- Optional fixed end at the depot for round trips.
- Zero service duration per job.
- OSRM routing profile `car`.
- VROOM command uses a 30-second exploration setting and two threads.
- Subprocess communication has a 90-second timeout.
- Temporary files are removed after execution.

### Routing error statuses

| Status | Meaning |
|---|---|
| `400` | Invalid coordinate values. |
| `401` | Missing or incorrect routing bearer credential. |
| `422` | Invalid request shape, VROOM optimization failure, or unassigned destinations. |
| `502` | VROOM execution/output/order/metric failure. |
| `503` | VROOM executable unavailable. |
| `504` | VROOM subprocess timed out. |

`/health` does not query OSRM or run a test optimization.

<a id="file-routing-start"></a>

### `routing-service/start.sh`

**Purpose:** Start and supervise the two routing processes.

Behavior:

1. Starts OSRM on `127.0.0.1:5000`.
2. Starts Uvicorn on `0.0.0.0:$PORT`, default `8080`.
3. Waits until either process exits.
4. Stops the other process and exits the container.

| Shell function | Parameters | Behavior |
|---|---|---|
| `cleanup()` | None; uses process IDs stored by the script. | Terminates API and OSRM processes and waits for them to exit. Registered as an EXIT trap. |

The script does not wait for a successful OSRM routing request before
starting Uvicorn.

The Docker entry point explicitly invokes Bash:

```dockerfile
CMD ["bash", "/app/start.sh"]
```

The Docker build also normalizes CRLF line endings.

<a id="file-routing-map"></a>

### `routing-service/prepare-map.sh`

**Purpose:** Build the OSRM road graph.

This script has no named functions.

It:

1. Downloads Portugal OSM data from Geofabrik.
2. Extracts an approximate Guarda-area bounding box.
3. Runs `osrm-extract` using the car profile.
4. Runs `osrm-contract`.
5. Removes source PBF files.

Bounding box:

```text
minimum longitude: -8.10
minimum latitude:   40.10
maximum longitude: -6.65
maximum latitude:   41.15
```

This is buffered geographic coverage, not an official district polygon.

Cross-border routing may require additional map coverage.

### Other routing files

| File | Purpose |
|---|---|
| `routing-service/Dockerfile` | Builds VROOM from source with submodules, builds OSRM using CMake, installs runtime dependencies, preprocesses the map, and starts Bash supervision. |
| `routing-service/requirements.txt` | FastAPI and Uvicorn dependencies. |
| `cloudbuild-routing.yaml` | Builds and pushes the routing image; does not deploy a Cloud Run service. |

<a id="java-services"></a>

## 16. Java services

The Java folders contain supporting service code. Their presence does
not establish that all services build successfully or run in the
production cloud deployment.

<a id="java-logger"></a>

### 16.1 `logger-service`

Base source directory:

```text
logger-service/src/main/java/com/example/loggerservice/
```

#### `LoggerServiceApplication.java`

| Method | Parameters | Behavior and result |
|---|---|---|
| `main(String[] args)` | Command-line arguments. | Starts the Spring Boot application. Returns void. |

#### `dto/LogMessage.java`

Declares a Java record with:

- `Instant timestamp`
- `String level`
- `String service`
- `String message`

Generated record API:

| Method | Parameters | Result |
|---|---|---|
| `LogMessage(Instant timestamp, String level, String service, String message)` | All record components. | Creates an immutable log message. |
| `timestamp()` | None. | Returns the timestamp. |
| `level()` | None. | Returns severity. |
| `service()` | None. | Returns service label. |
| `message()` | None. | Returns log text. |

Java also generates record equality, hash, and string representation
methods.

The declared package is `com.bruno.loggerservice.dto`, which differs
from the surrounding application package hierarchy.

#### `service/LogConsumerService.java`

| Method | Parameters | Behavior and result |
|---|---|---|
| `consume(LogMessage message)` | Deserialized Kafka log event. | Consumes topic `app-logs` in group `logger-group` and writes service, level, and message through SLF4J. Returns void. |

#### Other logger files

| File | Description |
|---|---|
| `build.gradle` | Spring Boot, Kafka, web, Lombok, and Java 21 build configuration. |
| `settings.gradle` | Gradle project settings. |
| `gradlew`, `gradlew.bat`, `gradle/wrapper/*` | Gradle wrapper and distribution configuration. |
| `Dockerfile` | Container build/runtime definition. |
| `src/main/resources/application.yaml` | Spring runtime configuration. |
| `src/test/java/com/example/demo/DemoApplicationTests.java` | Spring context-loading smoke test. |
| `Gemini.md` | Supplementary project notes. |
| `pom.xml` | Empty at the documented revision. |

The context-loading test's `contextLoads()` method takes no parameters,
returns void, and relies on Spring test initialization.

<a id="java-risk"></a>

### 16.2 `riskEngineService`

Base source directory:

```text
riskEngineService/src/main/java/com/bruno/riskEngineService/
```

This is an incomplete risk/event-processing scaffold. It must not be
treated as an operational trading service.

#### `RiskEngineServiceApplication.java`

| Method | Parameters | Behavior and result |
|---|---|---|
| `main(String[] args)` | Command-line arguments. | Starts Spring Boot. Returns void. |

#### `config/RabbitConfig.java`

| Method | Parameters | Intended behavior and result |
|---|---|---|
| `orderQueue()` | None. | Returns a durable queue named `trade.orders.queue`. |
| `orderExchange()` | None. | Returns a direct exchange named `trade.orders.exchange`. |
| `binding(Queue orderQueue, DirectExchange orderExchange)` | Queue and exchange beans. | Returns a binding using routing key `trade.orders.binding`. |

#### `listener/OrderEventConsumer.java`

| Method | Parameters | Intended behavior and result |
|---|---|---|
| `OrderEventConsumer(RiskEngineService riskEngineService)` | Risk-processing service dependency. | Stores the injected dependency. |
| `consume(OrderEvent orderEvent)` | Incoming order event. | Delegates to `processOrderEvent`. Returns void. |

The current listener references a configuration identifier inconsistent
with `RabbitConfig`.

#### `model/OrderEvent.java`

Declares a sealed event interface and executed/rejected/cancelled
records.

| Method | Parameters | Result |
|---|---|---|
| `orderId()` | None. | Order identifier. |
| `symbol()` | None. | Instrument symbol. |
| `quantity()` | None. | Order quantity. |
| `price()` | None. | Order price. |
| `timestamp()` | None. | Event timestamp. |
| `OrderRejected.reason()` | None. | Rejection reason. |

Record constructors accept their declared components:

| Record | Constructor parameters |
|---|---|
| `OrderExecuted` | `String orderId, String symbol, double quantity, double price, Instant timestamp` |
| `OrderRejected` | Same parameters plus `String reason` |
| `OrderCancelled` | `String orderId, String symbol, double quantity, double price, Instant timestamp` |

The source currently places multiple public records in one file and
contains unresolved imports.

#### `repository/ExecutionLog.java`

**Purpose:** Intended JPA entity for execution records.

| Method | Parameters | Result or effect |
|---|---|---|
| `ExecutionLog()` | None. | Creates an empty entity. |
| `ExecutionLog(String orderId, String symbol, String action, double quantity, double price, String status, Instant timestamp)` | Initial execution fields. | Assigns all supplied fields. |
| `getId()` | None. | Returns `Long id`. |
| `setId(Long id)` | Identifier. | Assigns the identifier. |
| `getOrderId()` | None. | Returns order ID. |
| `setOrderId(String orderId)` | Order ID. | Assigns order ID. |
| `getSymbol()` | None. | Returns symbol. |
| `setSymbol(String symbol)` | Symbol. | Assigns symbol. |
| `getAction()` | None. | Returns action. |
| `setAction(String action)` | Action string. | Assigns action. |
| `getQuantity()` | None. | Returns quantity. |
| `setQuantity(double quantity)` | Quantity. | Assigns quantity. |
| `getPrice()` | None. | Returns price. |
| `setPrice(double price)` | Price. | Assigns price. |
| `getStatus()` | None. | Returns status. |
| `setStatus(String status)` | Status string. | Assigns status. |
| `getTimestamp()` | None. | Returns event timestamp. |
| `setTimestamp(Instant timestamp)` | Timestamp. | Assigns timestamp. |

#### `repository/PortfolioPosition.java`

**Purpose:** Intended JPA entity for a position.

| Method | Parameters | Result or effect |
|---|---|---|
| `PortfolioPosition()` | None. | Creates an empty entity. |
| `PortfolioPosition(String symbol, float shares, BigDecimal purchasePrice, BigDecimal purchasePriceCurrency, Instant purchaseDate)` | Initial position fields. | Assigns supplied values. |
| `getSymbol()` | None. | Returns symbol. |
| `setSymbol(String symbol)` | Symbol. | Assigns symbol. |
| `getShares()` | None. | Returns shares. |
| `setShares(float shares)` | Share quantity. | Assigns shares. |
| `getPurchasePrice()` | None. | Returns purchase price. |
| `setPurchasePrice(BigDecimal purchasePrice)` | Purchase price. | Assigns purchase price. |
| `getPurchasePriceCurrency()` | None. | Returns the current `BigDecimal` currency field. |
| `setPurchasePriceCurrency(BigDecimal purchasePriceCurrency)` | Current numeric field value. | Assigns the field. |
| `getPurchaseDate()` | None. | Returns purchase date. |
| `setPurchaseDate(Instant purchaseDate)` | Purchase date. | Assigns purchase date. |

`purchasePriceCurrency` is currently numeric, which does not match the
string currency-code representation used in the Go holding model.

#### `service/RiskEngineService.java`

| Method | Parameters | Intended behavior and result |
|---|---|---|
| `RiskEngineService(ExecutionLogRepository logRepository, PortfolioPositionRepository positionRepository)` | Execution and position repositories. | Stores dependencies. |
| `processOrderEvent(OrderEvent orderEvent)` | Executed, rejected, or cancelled event. | Intended to dispatch events, log executions, and update positions. Current source contains compile-time inconsistencies and missing repository definitions. |
| `updatePortfolioPosition(String symbol, double quantity, double price, Instant timestamp)` | Position update information. | Currently logs an update message; persistence is a TODO. |

#### Other risk-engine files

| File | Description |
|---|---|
| `build.gradle` | Java 21, Spring AMQP, JPA, validation, and PostgreSQL dependencies. |
| `settings.gradle` | Gradle project settings. |
| `gradlew`, `gradlew.bat`, `gradle/wrapper/*` | Gradle wrapper. |
| `Dockerfile` | Container definition. |
| `src/main/resources/application.yaml` | Runtime configuration. |
| `src/test/java/com/bruno/riskEngineService/RiskEngineServiceApplicationTests.java` | Context-loading smoke test; `contextLoads()` has no parameters and returns void. |

<a id="frontend"></a>

## 17. Frontend file reference

Frontend documentation is file-level. Internal component functions are
not individually documented here.

### Application and authentication

| File | Description |
|---|---|
| `frontend/index.html` | HTML entry document and React root element. |
| `frontend/src/main.jsx` | Mounts React, wraps the application in `AuthGate`, imports global styles, and registers the production planner service worker. |
| `frontend/src/App.jsx` | Main application shell, sidebar/mobile navigation, active workspace selection, and top-level tab rendering. |
| `frontend/src/AuthGate.jsx` | Checks the cloud session, handles Google sign-in/logout, remembers planner identity, and allows access to saved local planner data when appropriate. |
| `frontend/src/index.css` | Global styles and reusable visual classes. |

### Workspace components

| File | Description |
|---|---|
| `frontend/src/components/PortfolioTab.jsx` | Investment workspace with overview, holdings, stock exploration, AI research, thresholds, heatmap, and monitoring sections. |
| `frontend/src/components/PortfolioPerformanceChart.jsx` | Fetches portfolio/SPY history, normalizes points, aligns the overlapping period, and renders comparative performance. |
| `frontend/src/components/TradingViewTechnicalChart.jsx` | Embeds a TradingView advanced chart for a selected symbol. |
| `frontend/src/components/MarketHeatmap.jsx` | Embeds TradingView's S&P 500 sector heatmap. |
| `frontend/src/components/MarketSummaryTab.jsx` | PDF upload, AI research results, company sentiment, current quotes, and active-page quote refresh behavior. |
| `frontend/src/components/NotesTab.jsx` | Notes CRUD interface with pending and completed lists. |
| `frontend/src/components/KafkaLogsTab.jsx` | Embeds the `/kafka-ui/` interface in an iframe. Requires a reachable proxy or hosted Kafka UI. |

### Desktop controller components

| File | Description |
|---|---|
| `frontend/src/components/ControllerTab.jsx` | Loads saved profiles from the cloud API, pairs with the Windows local agent, selects/verifies PIDs, and manages automation status and logs. |
| `frontend/src/components/TaskManager.jsx` | Creates, edits, and deletes saved keyboard automation profiles. |
| `frontend/src/components/ProcessSelector.jsx` | Dropdown for selecting a process by PID and executable name. |
| `frontend/src/components/CommandSelector.jsx` | Dropdown for selecting an automation task profile. |
| `frontend/src/components/ExecutionControl.jsx` | Reusable execution control showing the current PID/command and execution button. |
| `frontend/src/components/LogPanel.jsx` | Displays execution or controller messages. |
| `frontend/src/components/WorkerLogPanel.jsx` | Displays worker output and scrolls to new log entries. |
| `frontend/src/components/Header.jsx` | Reusable controller title and status indicator. |

### Route planner files

| File | Description |
|---|---|
| `frontend/src/components/RoutePlannerTab.jsx` | Location display with coordinates, screenshot extraction, verified/incomplete lists, automatic route generation, restore controls, Google Maps links, and route completion interaction. |
| `frontend/src/components/plannerStore.js` | Committed planner store implementation: identity context, IndexedDB access, local versioning, cloud synchronization, restore choices, offline state, and explicit conflict resolution. Its current location does not match its imports. |
| `frontend/public/planner-sw.js` | Caches the built application shell for offline navigation. Excludes API/auth traffic and removes old application caches during activation. |

### HTTP and service modules

| File | Description |
|---|---|
| `frontend/src/services/http.js` | Shared Axios clients for authentication and `/api/v1`; includes credentials and the request marker. Chooses direct or relative backend URLs from `VITE_API_URL`. |
| `frontend/src/services/api.js` | Frontend API wrappers for tasks, notes, holdings, valuation, thresholds, market research, quotes, and routes. Also retains local-style process/automation wrappers that are not cloud endpoints. |
| `frontend/src/services/localAgent.js` | Direct requests to `http://127.0.0.1:8081/local`, in-memory pairing token, local health/process/status/log requests, and automation controls. |

### Hosting and build files

| File | Description |
|---|---|
| `frontend/functions/_middleware.js` | Cloudflare Pages server-side proxy for API/auth/health paths. Obtains Google service-account tokens and forwards requests to Cloud Run. |
| `frontend/nginx.conf` | Serves the SPA and proxies local API/auth and monitoring paths. Current API/auth upstream is host port `8081`. |
| `frontend/Dockerfile` | Builds Vite assets in a Node stage and serves them through Nginx. |
| `frontend/package.json` | Frontend dependencies and `dev`, `build`, and `preview` scripts. |
| `frontend/vite.config.js` | React plugin and generation of the build-specific offline precache manifest. |
| `frontend/tailwind.config.js` | Tailwind scan paths and theme configuration. |
| `frontend/postcss.config.js` | PostCSS/Tailwind/Autoprefixer configuration. |
| `frontend/.env.production` | Production build-time frontend settings. |

### Generated files

| File or directory | Description |
|---|---|
| `frontend/dist/` | Vite production build output. |
| `frontend/dist/planner-precache.js` | Generated application build identifier and asset list used by the service worker. |

### Planner restore and offline behavior

The planner is designed to:

- Save state locally before relying on network synchronization.
- Offer a choice when previous journey data is available.
- Restore coordinates, extracted services, routes, and completion state.
- Avoid rerunning interrupted AI/optimization work automatically.
- Keep unsynchronized local changes when connectivity is lost.
- Require explicit resolution when the cloud version has changed.
- Keep planner data independent of a short-lived login session.

Offline operation requires a previous successful online load and
successful local asset/data storage.

Google Maps navigation, new Gemini extraction, new geocoding, and new
cloud optimization still require their respective network services.

The current frontend stores route-completion changes in planner state.
That state is not automatically equivalent to updating the PostgreSQL
segment-completion endpoint.

<a id="infrastructure"></a>

## 18. Infrastructure and operational files

| File or directory | Description |
|---|---|
| `Dockerfile` | Production Go cloud API plus Python PDF processor. Builds `./cmd/cloud` with the `cloud` tag. |
| `Dockerfile_go` | Alternative cloud build with explicit amd64 output, isolated Python environment, and unprivileged runtime user. |
| `docker-compose.yml` | Local PostgreSQL, RabbitMQ, frontend, Kafka, logger, Kafka UI, Vector, Loki, Prometheus, and Grafana services. |
| `cloudbuild.yaml` | Builds the root API image, pushes it, and deploys `autoclicker-api` in `europe-west1`. Uses `BUILD_ID` tags and Cloud Logging. |
| `cloudbuild-routing.yaml` | Builds/pushes the routing image using `COMMIT_SHA`; requires a supplied commit substitution for manual builds. |
| `.dockerignore` | Excludes files from Docker build context. |
| `.gcloudignore` | Excludes files from Cloud Build source uploads. |
| `.gitignore` | Version-control exclusions. |
| `.env.example` | Historical starter environment configuration; incomplete for the current cloud implementation. |
| `go.mod` | Go module name, toolchain requirement, and dependencies. |
| `go.sum` | Go dependency checksums. |
| `initdb/schema.sql` | Historical MySQL-style schema; not a PostgreSQL initialization script. |
| `prometheus/prometheus.yml` | Scrape configuration for Prometheus, Vector, and local stock metrics. |
| `vector/vector.yaml` | Consumes application/network Kafka topics, forwards logs to Loki, and exports derived metrics. |
| `grafana/provisioning/datasources/prometheus.yml` | Provisioned Prometheus datasource configuration. |
| `grafana/alterting/stock-alerts.yml` | Empty at the documented revision; directory name is spelled `alterting`. |
| `.github/workflows/cleanup-routes.yml` | Scheduled/manual PostgreSQL route cleanup using `NEON_ROUTES_DATABASE_URL`. |
| `scripts/cleanup_routes.sql` | Deletes route services, segments, stops, and plans while retaining route caches. |
| `backups/` | PostgreSQL dump artifacts committed to the repository. |
| `setup.md` | Additional setup instructions. |
| `docs/DIVIDENDS_TRACKING.md` | Dividend-related design/documentation. |
| `docs/LOCAL_WINDOWS_CONTROLLER.md` | Local controller setup/documentation. |
| `docs/market_platform_execution_plan.md` | Market-platform planning material; distinguish plans from implemented code. |

### Local ports

| Service | Host port |
|---|---|
| Local API | `8080` |
| Windows agent | `8081`, when configured to match the frontend |
| Frontend Nginx | `80` |
| PostgreSQL | `5432` |
| RabbitMQ | `5672` |
| RabbitMQ management | `15672` |
| Kafka external listener | `9092` |
| Kafka UI | `8082` |
| Vector Prometheus exporter | `9598` |
| Loki | `3100` |
| Prometheus | `9090` |
| Grafana | `3000` |

The routing container's public API normally uses `8080`; its internal
OSRM listener uses `5000`.

### Route cleanup

The GitHub workflow checks Portugal local time before scheduled cleanup.

The SQL deletes all rows from:

```text
route_services
route_segments
route_stops
route_plans
```

It retains:

```text
route_optimization_caches
route_image_caches
route_geocode_caches
```

This is a scheduled deletion policy, not a per-route 24-hour TTL.

Redis planner snapshots are not deleted by this SQL script.

<a id="connectivity"></a>

## 19. Connectivity checks

These are executable integration programs, not isolated Go unit tests.

They require real credentials and reachable services.

| File and method | Inputs | Behavior |
|---|---|---|
| `tests/neon_connection/main.go` — `main()` | `.env` PostgreSQL settings. | Connects to core, notes, and portfolio databases, queries `current_database()`, and closes each pool. Does not test market or routes. |
| `tests/kafka_connection/main.go` — `main()` | `.env` broker and certificate settings. | Establishes a TLS Kafka connection, publishes a test event, and reads the topic until the event is found. |
| `tests/rabbitmq_connection/main.go` — `main()` | `.env` `RABBITMQ_URL`. | Declares a durable test queue, publishes a persistent message, consumes a message, and acknowledges it. |
| `tests/redis_connection/main.go` — `main()` | `.env` Redis setting. | Attempts Redis PING/SET/GET/DELETE using go-redis. Currently reads an HTTPS REST variable into a TCP Redis URL parser, so it is incompatible with the deployed REST integration. |

### Example commands

```powershell
go run ./tests/neon_connection
go run ./tests/kafka_connection
go run ./tests/rabbitmq_connection
```

Do not use the current Redis connectivity program as evidence that the
Upstash REST integration is broken.

### Test Upstash REST using `.env`

Run from the repository root. This reads the token from `.env`; it does
not prompt for or print the token.

```powershell
& {
    $Upstash = @{}

    Get-Content -LiteralPath ".env" | ForEach-Object {
        if ($_ -match '^\s*(UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN)\s*=(.*)$') {
            $Upstash[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }

    if (
        !$Upstash.UPSTASH_REDIS_REST_URL -or
        !$Upstash.UPSTASH_REDIS_REST_TOKEN
    ) {
        throw "Missing Upstash URL or token in .env"
    }

    Invoke-RestMethod `
      -Uri $Upstash.UPSTASH_REDIS_REST_URL `
      -Method Post `
      -Headers @{
          Authorization = "Bearer $($Upstash.UPSTASH_REDIS_REST_TOKEN)"
      } `
      -ContentType "application/json" `
      -Body '["SET","connection-test","working","EX",60]'
}
```

Expected result:

```text
result
------
OK
```

This verifies the local REST URL/token and write access. It does not
change Cloud Run environment variables.

<a id="deployment"></a>

## 20. Deployment

### Backend: Cloud Build and Cloud Run

From the repository root:

```powershell
gcloud builds submit . `
  --project=autoclicker-api-511212 `
  --config=cloudbuild.yaml
```

The pipeline:

1. Builds using the root `Dockerfile`.
2. Pushes the image tagged with `BUILD_ID`.
3. Deploys the image to `autoclicker-api`.
4. Waits for Cloud Run deployment completion.

The YAML uses:

```yaml
options:
  logging: CLOUD_LOGGING_ONLY
```

A successful Docker build does not guarantee a successful Cloud Run
startup. The deployment step can fail if runtime initialization exits.

### Update a runtime variable without rebuilding

Example:

```powershell
gcloud run services update autoclicker-api `
  --project=autoclicker-api-511212 `
  --region=europe-west1 `
  --update-env-vars="UPSTASH_REDIS_REST_URL=https://stirred-mallard-218027.upstash.io"
```

This creates a revision with updated configuration and the existing
image.

Updating a local `.env` alone does not update the cloud service.

### Routing image build

For a manual PowerShell build:

```powershell
$Commit = (git rev-parse HEAD).Trim()

gcloud builds submit . `
  --project=autoclicker-api-511212 `
  --config=cloudbuild-routing.yaml `
  --substitutions="COMMIT_SHA=$Commit"
```

The current routing YAML builds and pushes the image only. Deployment
is a separate operation.

### Frontend: Cloudflare Pages

Use:

```text
Build command: npm run build
Output directory: dist
Root directory: frontend
```

Set the required `VITE_*` values before building.

If using the Pages Function proxy, configure its server-side environment
variables and deploy the Functions alongside the frontend.

A Docker frontend rebuild does not deploy to Cloudflare Pages.

### When redeployment is required

| Change | Required action |
|---|---|
| Go source | Rebuild and redeploy backend. |
| Python processor source | Rebuild and redeploy backend image. |
| Cloud Run runtime environment | Update service configuration; no source rebuild needed. |
| React/JSX/CSS | Rebuild and deploy frontend. |
| `VITE_*` variable | Rebuild and deploy frontend. |
| Nginx configuration | Rebuild/recreate the frontend container. |
| Routing executable, map, or API source | Rebuild and deploy routing image. |
| Redis data | No application rebuild by itself. |

<a id="troubleshooting"></a>

## 21. Troubleshooting

### Cloud Run reports failure to listen on port 8080

The port message can be a consequence of startup failure.

The cloud process initializes databases and authentication before
opening the listener.

Check the latest attempted revision's stderr:

```powershell
$Revision = (
    gcloud run services describe autoclicker-api `
      --project=autoclicker-api-511212 `
      --region=europe-west1 `
      --format="value(status.latestCreatedRevisionName)"
).Trim()

Write-Host "Checking revision: $Revision"

gcloud logging read `
  "resource.type=`"cloud_run_revision`" AND resource.labels.service_name=`"autoclicker-api`" AND resource.labels.revision_name=`"$Revision`" AND logName=`"projects/autoclicker-api-511212/logs/run.googleapis.com%2Fstderr`"" `
  --project=autoclicker-api-511212 `
  --freshness=1d `
  --order=asc `
  --limit=100 `
  --format="value(textPayload)"
```

Fix the first application initialization failure shown in the logs.

Examples:

| Log | Meaning |
|---|---|
| Missing database parameter | Empty selected database name. |
| Market table missing | Required market schema has not been applied. |
| Upstash URL must be HTTPS | Runtime URL failed validation before connecting. |
| Upstash HTTP 401 | REST credentials were rejected. |
| Session store unavailable | The request could not complete a Redis session operation. |

Increasing startup timeouts does not correct invalid credentials or
malformed configuration.

### `403 Forbidden`

Determine whether the response comes from:

- Google Cloud Run IAM.
- The Cloudflare proxy.
- Go Origin validation.
- The Grafana webhook token check.

The responding server and response body help identify the layer.

Direct browser calls to Cloud Run must be permitted at the Cloud Run
invocation layer before application session checks can run.

### `401 Unauthorized`

Possible causes:

- Missing session cookie.
- Expired session.
- Browser blocked the cross-site cookie.
- Rejected Google credential.
- Invalid local agent pairing token.
- Invalid routing bearer token.

A private browser window starts without the prior authentication
cookie.

### API `404`

Verify:

1. Correct service and port.
2. Correct method.
3. Correct path.
4. Whether the endpoint exists in cloud mode.
5. Whether Nginx or the Pages proxy forwards the path.

For example:

```text
GET /api/v1/routes
POST /api/v1/routes/parse
```

These are different operations.

Process and automation execution endpoints are not registered in the
cloud API.

### Screenshot parsing `502`

Inspect response fields:

- `code`
- `stage`
- `request_id`
- `revision`
- `attempts`

A Gemini model `404` differs from an application endpoint `404`.

Model fallback reuses the same API key and extraction prompt. Credential
rejections stop fallback.

### Address cannot be verified

Check:

- `GEOAPIFY_API_KEY`.
- Presence of street, postal code, and locality.
- Provider postal code matching.
- Map/address availability.
- The service's returned `reason`.

The current geocoder filters results to Portugal.

### Route optimizer returns `401`

Check that the Go client sends the same secret that the Python routing
service reads as `ROUTING_API_KEY`.

At the documented revision, the Go client incorrectly uses
`ROUTING_SERVICE_URL` as the bearer value.

### Frontend fails to resolve `plannerStore`

The committed implementation is:

```text
frontend/src/components/plannerStore.js
```

Its callers import:

```text
frontend/src/services/plannerStore.js
```

The store also imports `./http`, which matches the services directory.

The file location/imports must be made consistent.

### Local reverse proxy reaches the wrong backend

The current Nginx API/auth upstream is:

```text
host.docker.internal:8081
```

The local full API listens on:

```text
0.0.0.0:8080
```

The local Windows agent normally uses `8081` but exposes `/local`
paths and does not provide the cloud auth API.

Choose and configure the intended backend consistently.

<a id="known-gaps"></a>

## 22. Known implementation gaps

The following are observed source-level issues at the documented
revision. This README does not modify them.

| Area | Current condition | Consequence |
|---|---|---|
| Planner store location | File committed under `components`, imported from `services`. | Frontend module resolution fails until corrected. |
| Routing authentication | Go reads `ROUTING_SERVICE_URL` for the bearer credential. | Standard routing secret configuration can produce `401`. |
| Local agent database settings | Requires `LOCAL_DATABASE_URL` but shared connection code reads `DATABASE_URL`/PostgreSQL settings. | The required variable alone does not configure task storage. |
| Local Nginx upstream | API/auth forwarded to `8081`, local full API listens on `8080`. | Requests can reach the wrong service. |
| Redis connectivity program | Passes an HTTPS REST endpoint into go-redis URL parsing. | The test does not match production REST integration. |
| Market upload limit | Uses equality against 25 MiB. | Intended maximum size is not correctly enforced. |
| PDF analysis persistence | Market schema is required, but the active handler does not save/reuse analyses. | Repeated PDF processing can repeat AI calls. |
| PDF subprocess lifetime | No context-bound execution timeout. | Processing may continue beyond the originating request. |
| Market migration | Startup refers to migration `001`, but the required migration file is not present in the inspected tree. | A fresh installation needs the schema supplied separately. |
| Java risk engine | Missing types/imports and inconsistent numeric/pattern code. | Cannot be considered a working risk-processing implementation. |
| Java logger packages | DTO is declared under a different package hierarchy. | Build/runtime serializer configuration needs verification. |
| Kafka routing | Local HTTP middleware receives the same producer writer used for `app-logs`; Vector separately expects `network-logs`. | Network events are not automatically routed to the expected topic. |
| Kafka event shapes | Automation logs can be plain text; HTTP logs and structured app logs use different JSON shapes. | Consumers expecting one `LogMessage` schema may fail to decode some events. |
| Cloud metrics | `/metrics` requires a session in cloud mode. | An unauthenticated Prometheus scrape cannot use it directly. |
| Local CORS | Wildcard origin with credential allowance. | Does not provide the same browser behavior as restricted credentialed CORS. |
| In-memory caches | Expired items are not actively evicted. | Key counts can grow during a long-lived process. |
| Route retention | SQL deletes route records on a schedule, independently of Redis. | Restored planner snapshots may reference route records already removed from PostgreSQL. |
| Planner completion | Frontend snapshot changes and PostgreSQL segment updates are separate paths. | Completion can diverge between stores. |
| Shared application data | Planner snapshots are user-scoped, but most PostgreSQL entities have no user ownership field. | Do not assume general multi-user isolation. |
| Environment example | Retains historical MySQL values and omits current cloud variables. | It is not a complete cloud configuration template. |
| Routing health | Static API health response does not check OSRM readiness. | HTTP health success does not prove optimization availability. |
| Main API health | Static health response after startup. | Does not continuously verify database or Redis availability. |

### Scope boundaries

The application currently supports a single allowed Google email.

The Java risk-engine folder is not evidence of active automated
trading.

Generated Google Maps links contain an already optimized stop order.
Google Maps navigation remains an external service, with its own
client behavior and waypoint support.

<a id="maintenance"></a>

## 23. Documentation maintenance

When changing the project:

1. Update the relevant file reference.
2. Update function signatures and parameter descriptions.
3. Update the HTTP endpoint table when route registration changes.
4. Document new environment variables.
5. Distinguish implemented behavior from planned behavior.
6. Update persistence, retention, and authentication descriptions.
7. Remove resolved items from known implementation gaps.
8. Update the documentation baseline commit after reviewing changes.

### Reference source

- Repository: https://github.com/santosbruno98/autoclicker
- Documented revision:
  https://github.com/santosbruno98/autoclicker/tree/df24db831e191fa4d6f70d557cb0c200eef0a025

### Navigation

[Back to contents](#contents) · [File index](#file-index) ·
[HTTP API](#http-api) · [Known gaps](#known-gaps)