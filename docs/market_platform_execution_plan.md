# Market Platform — Execution Plan

**Status:** Planning only — no implementation started  
**Repository:** `santosbruno98/autoclicker`  
**Starting branch:** `feature/pdf_processing` (confirm current working branch before changes)  
**Priority:** Frontend first; AI summary persistence second  
**Last updated:** 2026-10-16

## Objectives

Build a cohesive, mobile-friendly investment research platform while preserving existing Portfolio, Holdings, Alerts, Heatmap, PDF upload, Grafana, Prometheus and other working features. Stop repeated Gemini calls for already-processed PDF content by persisting full results in PostgreSQL and coordinating processing with Redis. Keep desktop automation out of the eventual cloud deployment, without removing local functionality.

## Ground rules

- Work in small, reviewable phases. **Do not start the next phase until the previous one is tested and accepted.**
- Preserve existing functionality; inspect current files before replacing any components.
- Avoid unrelated refactors, new paid services and breaking API changes.
- Keep existing `/api/v1/market/documents` response fields compatible (`source_file`, `companies`, `ai_summary`).
- Never expose API keys, cloud credentials or database connections in React.
- Separate persistent AI analysis from frequently changing stock prices.
- Document any decisions or deviations in the log at the end of this file.

## Phase 0 — Baseline and safety checks

- [ ] Confirm branch, local changes and working Docker services.
- [ ] Record current frontend routes, components and API contracts.
- [ ] Verify Holdings, Alerts CRUD, Market Summary PDF upload, Market Heatmap, Grafana and Prometheus still work.
- [ ] Confirm `/api/v1/market/quotes` availability and response shape.
- [ ] Take a database backup before schema changes in later phases.

**Done when:** baseline features and known issues are documented.

## Phase 1 — Frontend experience (FIRST IMPLEMENTATION PHASE)

### 1A. Navigation and layout

- [ ] Introduce a consistent responsive navigation structure: Overview, Portfolio, Stock Explorer, AI Research, Screener, Alerts and Monitoring.
- [ ] Keep existing Holdings, Alerts and Heatmap reachable; do not remove functionality.
- [ ] Make the navigation usable on Firefox mobile and desktop.
- [ ] Establish consistent loading, error, empty and success states.

### 1B. Stock Explorer UI

- [ ] Add ticker/company search and a company detail page or panel.
- [ ] Design price, historical chart, company profile, key statistics, financials and related news sections.
- [ ] Reuse existing Go quote endpoint for live prices where supported.
- [ ] Show explicit unavailable states for data not yet backed by an API; never fabricate prices, news or fundamentals.
- [ ] Add links from companies in Market Summary to Stock Explorer.

### 1C. AI Research UI (frontend-only groundwork)

- [ ] Preserve existing PDF upload and current AI summary display.
- [ ] Add a **Saved Documents** panel: search, document list, detail view, processing status and cached-result indicator.
- [ ] Prepare API client methods for document history and detail; handle not-yet-implemented endpoints gracefully until Phase 2.
- [ ] Preserve selected analysis while navigating between sub-tabs during a session.
- [ ] Display the original PDF filename rather than the temporary processing filename when the backend provides it.
- [ ] Display all extracted companies, sentiment and AI text without truncating stored results.
- [ ] Refresh live prices only while the relevant view is active **and** the browser tab is visible; stop polling on exit, avoid overlapping requests and refresh on return.

### 1D. Monitoring UI

- [ ] Organize Monitoring into Service Health, Cloud Free Tier, AI Usage and Usage Alerts.
- [ ] Retain Grafana and Prometheus access.
- [ ] Design a Google Cloud **API project** usage view for Cloud Run requests, CPU, memory and estimated free-tier consumption, if Cloud Run is actually in use.
- [ ] Design separate Gemini request/token usage cards (tokens are not Cloud Run free-tier units).
- [ ] Include future Oracle hosting metrics without requiring Oracle integration now.
- [ ] Show clear **not configured / data unavailable** states until backend integrations exist.

### 1E. Frontend validation and release gate

- [ ] Test desktop and Firefox mobile layouts.
- [ ] Verify existing Holdings and Alerts workflows have not regressed.
- [ ] Verify upload, summary, company links and price polling behavior.
- [ ] Verify no unexpected calls to unfinished endpoints or repeated AI processing due to UI remounting.
- [ ] Review screenshots and accept Phase 1 before backend persistence work.

**Done when:** the frontend layout and flows are approved, with placeholders clearly identified for features awaiting backend APIs.

## Phase 2 — AI summary persistence and duplicate prevention (SECOND IMPLEMENTATION PHASE)

### 2A. Database and Redis foundation

- [ ] Add Redis to Docker Compose with appropriate persistence/configuration for processing coordination.
- [ ] Configure Go Redis client and connection settings.
- [ ] Add PostgreSQL `market_document_analyses` model/migration with: original filename, SHA-256 content hash (unique), request timestamps, status/metadata, AI summary and **complete AI response JSONB**.
- [ ] Decide whether to store raw model response and usage metadata separately from normalized output; preserve both when available.
- [ ] Establish a migration/backup/rollback procedure.

### 2B. Safe upload and deduplication flow

- [ ] Validate PDF type and size (correct existing maximum-size comparison).
- [ ] Calculate SHA-256 from file bytes; **never deduplicate by filename alone**.
- [ ] Look up completed analysis in PostgreSQL before invoking Python/Gemini, even if Redis has expired or restarted.
- [ ] Use an atomic Redis lock (`SET NX` with expiration) to prevent concurrent duplicate processing; define lock renewal/recovery for long-running jobs.
- [ ] Track Redis metadata including `file_name`, `request_timestamp`, `was_requested` and processing `status`, keyed by hash.
- [ ] For already-processed PDFs, return stored result with `cached: true` and do not invoke Gemini.
- [ ] For in-progress duplicates, return a clear processing response without starting a second job.
- [ ] Persist successful AI output to PostgreSQL **before** marking the request completed; record failures and allow safe retries.
- [ ] Preserve original filename in saved metadata and API responses.

### 2C. Python/Gemini output capture

- [ ] Keep current summary and company extraction behavior.
- [ ] Capture complete structured output, model/version, timestamps and token usage metadata when supplied by Gemini.
- [ ] Do not silently drop fields returned by the AI processor.
- [ ] Define handling for malformed/partial model responses and Gemini errors.
- [ ] Ensure Linux-compatible Python execution for eventual cloud deployment; keep local Windows support.

### 2D. History API and frontend integration

- [ ] Keep `POST /api/v1/market/documents` compatible; add cache/status metadata.
- [ ] Add `GET /api/v1/market/documents` for paginated saved-analysis history.
- [ ] Add `GET /api/v1/market/documents/:id` for complete saved analysis.
- [ ] Add `DELETE /api/v1/market/documents/:id` with deliberate confirmation and defined cache invalidation.
- [ ] Connect Phase 1 Saved Documents UI to the real endpoints.
- [ ] Keep market quotes live and separate from stored AI content.

### 2E. Verification and release gate

- [ ] First upload: one Gemini request, one PostgreSQL record.
- [ ] Same bytes + same filename: zero additional Gemini requests.
- [ ] Same bytes + different filename: zero additional Gemini requests.
- [ ] Same filename + changed bytes: new analysis.
- [ ] Two simultaneous identical uploads: only one Gemini request.
- [ ] Redis restart/cache expiry: PostgreSQL result still returned.
- [ ] Go restart/browser refresh: saved history and full AI output remain available.
- [ ] Failed processing: no false completed state; retry is possible.
- [ ] All existing portfolio and monitoring features still work.

**Done when:** deduplication, permanent history and full AI-output preservation pass all checks.

## Phase 3 — Data quality and research features

- [ ] Improve company-to-ticker resolution; never invent tickers for private companies or ambiguous listings.
- [ ] Add historical price data and company fundamentals through an explicitly selected data provider.
- [ ] Connect Stock Explorer charts, financials, news and Screener filters to real APIs.
- [ ] Support watchlists and links between reports, companies and alerts.
- [ ] Add portfolio analytics and dividend views after verifying underlying data.

## Phase 4 — Cloud usage monitoring

- [ ] Confirm whether the Google Cloud API project uses Cloud Run, Gemini API, or both.
- [ ] Integrate Google Cloud Monitoring metrics for actual deployed services.
- [ ] Calculate free-tier utilization only against verified billing mode, region and account-wide allowances; label estimates.
- [ ] Record Gemini usage per application request and aggregate by day/month; distinguish app-tracked usage from provider-wide totals.
- [ ] Configure budget alerts and Discord notifications where available.
- [ ] Never treat monitoring estimates as guaranteed billing caps.

## Phase 5 — Optional always-on cloud deployment

- [ ] Create a separate cloud Compose configuration; preserve local development setup.
- [ ] Disable desktop process automation in cloud mode without deleting it.
- [ ] Validate ARM64/Linux compatibility for Go, Python, Kafka and other images.
- [ ] Add durable PostgreSQL volumes/backups and appropriate Redis configuration.
- [ ] Protect web access with authentication (e.g., Cloudflare Access); do not expose databases or Kafka publicly.
- [ ] Test an eligible free VM's resource limits before committing to a provider.
- [ ] Set up GitHub-based deployment and verify access from Firefox on the phone.

## Execution order / checkpoints

| Order | Milestone | State |
|---|---|---|
| 0 | Baseline review | Not started |
| 1 | Frontend navigation and research UI | Not started |
| 2 | Frontend testing and approval | Not started |
| 3 | PostgreSQL + Redis + AI persistence | Not started |
| 4 | History API and frontend connection | Not started |
| 5 | Duplicate-upload and regression tests | Not started |
| 6 | Data quality / additional research | Deferred |
| 7 | Google Cloud usage monitoring integration | Deferred |
| 8 | Always-on cloud deployment | Deferred |

## Open decisions

1. Confirm the actual active Git branch before implementation.
2. Confirm which frontend views should be navigation destinations versus Portfolio sub-tabs.
3. Confirm which Google Cloud API product is deployed (Cloud Run versus Gemini API usage).
4. Decide whether deleting an analysis should permit a fresh Gemini request on the next upload (recommended: yes).
5. Decide whether the raw PDF itself should be retained; the initial plan stores its hash and analysis, not the original binary.
6. Decide on authentication/authorization before remote deployment.

## Change log

| Date | Phase | Decision / change | Result |
|---|---|---|---|
| 2026-10-16 | Planning | Created phased plan; frontend first, persistence second | Pending implementation |

## Resume instructions

When resuming this project, open this file, check the last completed milestone and the change log, inspect the current Git branch and uncommitted changes, then continue with **only the next unchecked phase**. Do not assume work was completed merely because it was discussed.
