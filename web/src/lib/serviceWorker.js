// Service worker registration and the one message we send it.
//
// Registered only in production builds: in dev the worker would sit in front
// of Vite's module graph and serve stale chunks after every edit.

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // After load, so fetching the worker never competes with the first paint.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // No offline support this session. Nothing else breaks, and telling the
      // student their cache setup failed would mean nothing to them.
    });
  });
}

// Logging out must take the cached API responses with it — otherwise the next
// person to open the app on the same phone can be served the previous
// student's progress out of the cache.
export function clearCachedApiData() {
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_API_CACHE' });
}
