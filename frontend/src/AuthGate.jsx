import React, { useCallback, useEffect, useState } from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { authAPI } from './services/http';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function AuthenticationScreen({ onAuthenticated, error, setError, busy }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-8 shadow-xl text-center">
        <div className="text-3xl mb-3">🔐</div>

        <h1 className="text-2xl font-bold mb-2">MyPlatform</h1>

        <p className="text-slate-400 text-sm mb-8">
          Sign in with your authorized Google account to access the dashboard.
        </p>

        <div className="flex justify-center">
          <GoogleLogin
            onSuccess={onAuthenticated}
            onError={() => setError('Google sign-in failed. Please try again.')}
            useOneTap={false}
          />
        </div>

        {busy && (
          <p className="mt-5 text-sm text-blue-400">
            Verifying your account...
          </p>
        )}

        {error && (
          <p className="mt-5 rounded bg-red-950 border border-red-800 p-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <p className="text-xs text-slate-500 mt-8">
          Sessions expire after 10 minutes of inactivity.
        </p>
      </div>
    </div>
  );
}

export default function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const checkSession = useCallback(async () => {
    try {
      const response = await authAPI.get('/auth/me');

      if (response.data?.authenticated !== true) {
        throw new Error('Invalid authentication response');
      }

      setUser(response.data);
      return true;
    } catch (err) {
      setUser(null);

      if (err.response?.status !== 401) {
        setError('Unable to verify the session. Check the API connection.');
      }

      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkSession();

    const handleExpiredSession = () => {
      setUser(null);
      setError('Your session expired. Please sign in again.');
    };

    window.addEventListener('auth:expired', handleExpiredSession);

    return () => {
      window.removeEventListener('auth:expired', handleExpiredSession);
    };
  }, [checkSession]);

  const handleGoogleSuccess = async (credentialResponse) => {
    if (!credentialResponse.credential) {
      setError('Google did not return an identity credential.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const response = await authAPI.post('/auth/google', {
        credential: credentialResponse.credential,
      });

      if (response.data?.authenticated !== true) {
        throw new Error('Invalid authentication response');
      }

      setUser(response.data);
    } catch (err) {
      setError(
        err.response?.data?.error ||
        'Unable to authenticate. Check your Google account and backend configuration.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await authAPI.post('/auth/logout', {});
      setUser(null);
      setError('');
    } catch (err) {
      setError('Unable to log out. Please try again.');
    }
  };

  if (!clientId) {
    return (
      <div className="min-h-screen bg-slate-950 text-red-300 p-8">
        Missing VITE_GOOGLE_CLIENT_ID in the frontend build.
      </div>
    );
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      {checking ? (
        <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center">
          Checking session...
        </div>
      ) : !user ? (
        <AuthenticationScreen
          onAuthenticated={handleGoogleSuccess}
          error={error}
          setError={setError}
          busy={busy}
        />
      ) : (
        <>
          <div className="bg-slate-900 text-slate-200 border-b border-slate-700 px-6 py-2 flex justify-end items-center gap-4 text-sm">
            <span className="text-slate-400">{user.email}</span>

            <button
              onClick={handleLogout}
              className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1"
            >
              Sign out
            </button>
          </div>

          {children}
        </>
      )}
    </GoogleOAuthProvider>
  );
}