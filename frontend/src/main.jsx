import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import AuthGate from './AuthGate';

import './index.css';

ReactDOM.createRoot(
  document.getElementById('root')
).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>
);

if (
  import.meta.env.PROD &&
  'serviceWorker' in navigator
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/planner-sw.js', {
        updateViaCache: 'none',
      })
      .catch((error) => {
        console.error(
          'Offline shell registration failed:',
          error
        );
      });
  });
}