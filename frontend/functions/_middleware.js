
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_IAM_ENDPOINT =
  'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/';

const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeJSON(value) {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

async function createCallerAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);

  const header = encodeJSON({
    alg: 'RS256',
    typ: 'JWT',
  });

  const payload = encodeJSON({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: GOOGLE_TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  });

  const unsignedJWT = `${header}.${payload}`;

  const pem = credentials.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  const binary = atob(pem);
  const keyBytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(unsignedJWT)
  );

  const assertion = `${unsignedJWT}.${base64Url(new Uint8Array(signature))}`;

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token exchange failed: ${response.status}`);
  }

  const result = await response.json();

  if (!result.access_token) {
    throw new Error('Google did not return an access token');
  }

  return result.access_token;
}

async function createCloudRunIdToken(env, audience) {
  const credentials = JSON.parse(env.GCP_CALLER_SERVICE_ACCOUNT_JSON);

  if (
    credentials.type !== 'service_account' ||
    !credentials.client_email ||
    !credentials.private_key
  ) {
    throw new Error('Invalid Google service account credentials');
  }

  const accessToken = await createCallerAccessToken(credentials);

  const account = encodeURIComponent(
    env.GCP_INVOKER_SERVICE_ACCOUNT_EMAIL
  );

  const response = await fetch(
    `${GOOGLE_IAM_ENDPOINT}${account}:generateIdToken`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audience,
        includeEmail: true,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Google IAM token generation failed: ${response.status}`);
  }

  const result = await response.json();

  if (!result.token) {
    throw new Error('Google IAM did not return an ID token');
  }

  return result.token;
}

function isApiPath(pathname) {
  return (
    pathname === '/auth' ||
    pathname.startsWith('/auth/') ||
    pathname === '/api/v1' ||
    pathname.startsWith('/api/v1/') ||
    pathname === '/health'
  );
}

export async function onRequest(context) {
  const { request, env } = context;
  const incomingURL = new URL(request.url);

  if (!isApiPath(incomingURL.pathname)) {
    return context.next();
  }

  if (
    !env.CLOUD_RUN_URL ||
    !env.GCP_CALLER_SERVICE_ACCOUNT_JSON ||
    !env.GCP_INVOKER_SERVICE_ACCOUNT_EMAIL
  ) {
    return Response.json(
      { error: 'Cloudflare API proxy is not configured' },
      { status: 503 }
    );
  }

  try {
    const cloudRunBase = env.CLOUD_RUN_URL.replace(/\/+$/, '');
    const cloudRunURL = new URL(cloudRunBase);

    if (cloudRunURL.protocol !== 'https:') {
      throw new Error('Cloud Run URL must use HTTPS');
    }

    const idToken = await createCloudRunIdToken(
      env,
      cloudRunBase
    );

    const target = new URL(
      incomingURL.pathname + incomingURL.search,
      cloudRunBase
    );

    const headers = new Headers(request.headers);

    // Cloud Run IAM authenticates the server-side proxy.
    headers.set('Authorization', `Bearer ${idToken}`);

    // Never forward a client-supplied alternate identity token.
    headers.delete('X-Serverless-Authorization');

    // The browser Origin is forwarded unchanged so Go can
    // enforce its existing CSRF/origin validation.
    headers.delete('Host');

    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : request.body,
      redirect: 'manual',
    });

    const responseHeaders = new Headers(upstream.headers);

    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.delete('Access-Control-Allow-Origin');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Cloudflare API proxy failure:', error.message);

    return Response.json(
      { error: 'Backend connection unavailable' },
      {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
