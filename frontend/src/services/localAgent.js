
// Local Windows agent API.
// This never uses the Cloudflare /api/v1 proxy.

const BASE = 'http://127.0.0.1:8081/local';

let accessToken = '';

export function authorizeLocalAgent(token) {
  accessToken = String(token || '').trim();
}

export function clearLocalAgentAuthorization() {
  accessToken = '';
}

export function hasLocalAgentAuthorization() {
  return Boolean(accessToken);
}

async function request(path, options = {}) {
  const headers = {
    'X-Requested-With': 'XMLHttpRequest',
    ...(accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : {}),
    ...(options.body
      ? { 'Content-Type': 'application/json' }
      : {}),
  };

  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      body.error || `Local agent HTTP ${response.status}`
    );
  }

  return body;
}

export const checkLocalAgent = () =>
  request('/health');

export const fetchLocalProcesses = (name = '') =>
  request(
    `/processes${name
      ? `?name=${encodeURIComponent(name)}`
      : ''}`
  );

export const verifyLocalPID = (pid) =>
  request(`/processes/verify/${encodeURIComponent(pid)}`);

export const fetchLocalAutomationStatus = () =>
  request('/automation/status');

export const fetchLocalAutomationLogs = () =>
  request('/automation/logs');

export const startLocalJob = (payload) =>
  request('/automation/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const stopLocalJob = () =>
  request('/automation/stop', {
    method: 'POST',
  });
