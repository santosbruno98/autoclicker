import React, { useEffect, useState } from 'react';
import {
  GoogleOAuthProvider,
  GoogleLogin,
} from '@react-oauth/google';

import { authAPI } from './services/http';
import RoutePlannerTab from './components/RoutePlannerTab';

import {
  PlannerIdentity,
  lastPlannerUser,
  readPlanner,
  rememberPlannerUser,
  resetPlannerSession,
} from './services/plannerStore';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [remembered, setRemembered] = useState(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function accept(data) {
    if (
      data?.authenticated !== true ||
      !data.user_id
    ) {
      throw new Error(
        'Authentication response is missing user_id. ' +
        'Deploy the updated backend.'
      );
    }

    const identity = {
      user_id: data.user_id,
      email: data.email,
    };

    await rememberPlannerUser(identity);
    resetPlannerSession();

    setRemembered(identity);
    setLocalOnly(false);
    setUser(identity);
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      let saved = null;

      try {
        const identity = await lastPlannerUser();

        if (
          identity &&
          await readPlanner(identity.user_id)
        ) {
          saved = identity;
        }

        if (!cancelled) {
          setRemembered(saved);
        }

        if (!navigator.onLine) {
          if (!cancelled && saved) {
            setUser(saved);
            setLocalOnly(true);
          }

          return;
        }

        const { data } = await authAPI.get(
          '/auth/me',
          { timeout: 10000 }
        );

        if (!cancelled) {
          await accept(data);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }

        if (!err.response && saved) {
          setUser(saved);
          setLocalOnly(true);
        } else if (err.response?.status !== 401) {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setChecking(false);
        }
      }
    }

    boot();

    const expired = () => {
      resetPlannerSession();
      setUser(null);
      setLocalOnly(false);

      setError(
        'Sign in again to synchronize. ' +
        'Your saved journey remains on this device.'
      );
    };

    window.addEventListener('auth:expired', expired);

    return () => {
      cancelled = true;
      window.removeEventListener('auth:expired', expired);
    };
  }, []);

  async function login(result) {
    setBusy(true);
    setError('');

    try {
      const { data } = await authAPI.post(
        '/auth/google',
        { credential: result.credential }
      );

      await accept(data);
    } catch (err) {
      setError(
        err.response?.data?.error || err.message
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError('');

    try {
      await authAPI.post('/auth/logout', {});
      resetPlannerSession();
      await rememberPlannerUser(null);

      setUser(null);
      setRemembered(null);
      setLocalOnly(false);
    } catch (err) {
      setError(
        err.response?.data?.error || err.message
      );
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <div className="p-8 text-slate-300">
        Checking session and saved journey…
      </div>
    );
  }

  if (user) {
    return (
      <PlannerIdentity.Provider
        value={{ ...user, localOnly }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 px-6 py-3 text-sm text-slate-200">
          <span>
            {user.email}
            {localOnly ? ' · Saved device copy' : ''}
          </span>

          {localOnly ? (
            <button
              className="terminal-button-secondary"
              onClick={() => {
                resetPlannerSession();
                setUser(null);
                setLocalOnly(false);
              }}
            >
              Sign in to synchronize
            </button>
          ) : (
            <button
              className="terminal-button-secondary"
              disabled={busy}
              onClick={logout}
            >
              Sign out
            </button>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="bg-slate-900 px-6 py-3 text-red-300"
          >
            {error}
          </p>
        )}

        {localOnly ? (
          <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8">
            <RoutePlannerTab />
          </main>
        ) : (
          children
        )}
      </PlannerIdentity.Provider>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
      <section className="w-full max-w-md space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
        <h1 className="text-2xl font-bold">
          MyPlatform
        </h1>

        <p>
          Sign in to access and synchronize your workspace.
        </p>

        {clientId ? (
          <GoogleOAuthProvider clientId={clientId}>
            <GoogleLogin
              onSuccess={login}
              onError={() =>
                setError('Google sign-in failed.')
              }
              useOneTap={false}
            />
          </GoogleOAuthProvider>
        ) : (
          <p>Missing VITE_GOOGLE_CLIENT_ID.</p>
        )}

        {busy && <p>Signing in…</p>}

        {error && (
          <p role="alert" className="text-red-300">
            {error}
          </p>
        )}

        {remembered && (
          <button
            className="terminal-button-secondary"
            onClick={() => {
              resetPlannerSession();
              setUser(remembered);
              setLocalOnly(true);
            }}
          >
            Open saved journey on this device
          </button>
        )}

        <p className="text-xs text-slate-400">
          The local view does not authenticate you or
          grant access to backend APIs.
        </p>
      </section>
    </div>
  );
}