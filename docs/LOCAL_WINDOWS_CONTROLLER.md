
# Local Windows Controller — MyPlatform

## Purpose

Allow keyboard automation only on the Windows PC currently
running the MyPlatform browser.

The Cloudflare Pages website provides the interface.
A Windows-only Go agent executes automation locally.

No IP-based OS detection, MAC address matching, or
cloud-to-PC command queue is required.

## Architecture

### Cloud

- Cloudflare Pages hosts the React frontend.
- Google authentication restricts access to MyPlatform.
- Cloud Run provides Notes, Tasks, Portfolio, and other APIs.
- PostgreSQL stores the existing task definitions.

### Windows PC

- `cmd/localagent/main.go` starts the local Go agent.
- The agent listens on `127.0.0.1:8081`.
- `pkg/services/automation.go` runs existing automation tasks.
- `pkg/handlers/process.go` discovers and verifies processes.
- The agent loads task definitions from PostgreSQL.

### Frontend

- `frontend/src/services/api.js` handles cloud APIs.
- `frontend/src/services/localAgent.js` handles localhost requests.
- `frontend/src/App.jsx` displays connection and automation status.

## Installation

From the repository root on Windows:

1. Create `cmd/localagent/main.go`.
2. Create `frontend/src/services/localAgent.js`.
3. Replace `frontend/src/App.jsx`.
4. Create this documentation file.

Make sure your local `.env` contains a valid `DATABASE_URL`
for the task database.

Never commit `.env` or database credentials.

## Starting the agent

Run:

    go run ./cmd/localagent

The terminal displays:

    Local controller listening on http://127.0.0.1:8081
    LOCAL ACCESS TOKEN (do not share): <random-token>

A new token is generated every time the agent starts.

Keep the terminal open while using automation.

## Connecting MyPlatform

1. Open https://autoclicker-2d1.pages.dev on the same Windows PC.
2. Sign in with your authorized Google account.
3. Open the Controller tab.
4. Wait for the local agent to show ONLINE / LOCKED.
5. Paste the access token displayed in the local terminal.
6. Click Authorize this browser.
7. Select a process and task.
8. Start or stop automation.

The Controller shows OFFLINE when the agent cannot be reached.

## Security

### Local network isolation

The agent binds to 127.0.0.1, not 0.0.0.0.

Other devices on the network cannot connect directly to it.

### Origin validation

The agent only accepts browser requests with:

    Origin: https://autoclicker-2d1.pages.dev

Requests with other origins are rejected.

### Host validation

The agent rejects unexpected Host headers.

This reduces exposure to DNS rebinding attacks.

### Token authentication

The agent generates a cryptographically random 256-bit token.

Sensitive endpoints require:

    Authorization: Bearer <token>

The token is held only in browser memory.

It is not saved to localStorage, cookies, PostgreSQL,
Cloud Run, or GitHub.

### Request validation

The agent restricts HTTP methods and CORS headers.

State-changing requests require:

    X-Requested-With: XMLHttpRequest

### Local shutdown

Press Ctrl+C in the agent terminal to stop the server
and request that active automation stop.

## API endpoints

Public local health check:

    GET /local/health

Token-protected endpoints:

    GET  /local/processes
    GET  /local/processes/verify/:pid
    GET  /local/automation/status
    GET  /local/automation/logs
    POST /local/automation/start
    POST /local/automation/stop

All endpoints use:

    http://127.0.0.1:8081

## Testing

Start the agent:

    go run ./cmd/localagent

Check that requests without the approved Origin are rejected:

    curl.exe -i http://127.0.0.1:8081/local/health

Expected:

    HTTP/1.1 403 Forbidden

Check the health endpoint with the approved Origin:

    curl.exe -i -H "Origin: https://autoclicker-2d1.pages.dev" http://127.0.0.1:8081/local/health

Expected:

    HTTP/1.1 200 OK

Check authorization without a token:

    curl.exe -i -H "Origin: https://autoclicker-2d1.pages.dev" http://127.0.0.1:8081/local/automation/status

Expected:

    HTTP/1.1 401 Unauthorized

## Troubleshooting

### Controller shows OFFLINE

- Check whether the local Go agent is running.
- Check whether port 8081 is already occupied.
- Inspect browser developer tools for CORS errors.
- Check browser Local Network Access restrictions.

### Controller shows ONLINE / LOCKED

The agent is running, but the browser has not been authorized.

Paste the current token from the agent terminal.

### HTTP 401

The access token is incorrect or the agent restarted.

Restarting the agent generates a different token.

### HTTP 403

The request has an unexpected Origin or Host header.

Do not disable these checks to work around browser errors.

### Tasks are missing

Tasks are retrieved from Cloud Run.

Verify Google authentication and PostgreSQL connectivity.

## Limitations

This is an initial implementation and must be tested
on Windows before being treated as production-ready.

- The agent uses loopback HTTP.
- Browser Local Network Access policies may require permission.
- The existing automation manager can focus windows.
- Task definitions from PostgreSQL are trusted.
- The agent does not yet enforce an executable allowlist.
- The agent does not yet enforce a maximum task duration.
- The agent does not yet have a system-tray emergency-stop button.

Do not run the agent as Administrator.

Avoid automating elevated applications, password fields,
or security prompts.

Do not expose port 8081 through a tunnel or port-forward.

## Future improvements

- Maximum automation duration.
- Allowlist of approved executable names.
- Local confirmation before starting automation.
- Windows system-tray emergency stop.
- Improved agent availability detection.
- Integration tests for authorization and request validation.