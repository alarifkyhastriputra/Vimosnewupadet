
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { LanguageProvider } from './LanguageContext.tsx';

// Catch third-party cross-origin script errors (e.g. ad network blockages or CORS errors)
if (typeof window !== 'undefined') {
  const isScriptError = (msg: unknown) => {
    if (!msg) return false;
    const str = String(msg).toLowerCase();
    return str.includes('script error') || str.includes('profitableratecpmnetwork') || str.includes('invoke.js');
  };

  const oldOnError = window.onerror;
  window.onerror = function (msg, url, lineNo, columnNo, error) {
    if (isScriptError(msg) || isScriptError(url)) {
      return true; // Completely suppress cross-origin script errors
    }
    if (typeof oldOnError === 'function') {
      return oldOnError(msg, url, lineNo, columnNo, error);
    }
    return false;
  };

  window.addEventListener('error', (event) => {
    if (isScriptError(event.message) || isScriptError(event.filename)) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const reasonMsg = event.reason?.message || event.reason;
    if (isScriptError(reasonMsg)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>
);
