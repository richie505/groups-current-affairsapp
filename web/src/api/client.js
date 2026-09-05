const TOKEN_KEY = 'appsc_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// WHAT HAPPENS WHEN A SESSION ENDS WHILE THE APP IS OPEN.
//
// Nothing did. The session was checked once, on mount, and every request after
// that threw its 401 into whichever screen made it — so an expired token (they
// last thirty days), a deleted account, or a password changed on another
// device all produced the same thing: an error card reading "Session expired,
// please log in again" with no login button on it, on a page that would keep
// saying that until the user thought to reload.
//
// One place, because a 401 means the same thing wherever it arrives. The token
// is dropped, the cached API responses go with it (they are this account's
// notes and progress, and the next person to open the app must not be served
// them), and the app is sent to the login screen with a note saying why.
//
// A hard location change rather than a router navigate: this module has no
// router, and every piece of in-memory state — half-answered quizzes,
// half-loaded screens — belongs to a session that no longer exists.
let signingOut = false;

function onSessionEnded(message) {
  if (signingOut) return; // several in-flight requests will all 401 at once
  signingOut = true;
  setToken(null);
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_API_CACHE' });
  } catch {
    /* no service worker — nothing cached to clear */
  }
  const reason = encodeURIComponent(message || 'Your session ended. Please sign in again.');
  window.location.assign(`/login?ended=${reason}`);
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const error = new Error((data && data.error) || `Request failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    // Everything except the sign-in call itself: a 401 from /auth/login means
    // "wrong password" and belongs on the login form, not in a redirect loop
    // back to the page the user is already on.
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/reset')) {
      onSessionEnded(error.message);
    }
    throw error;
  }
  return data;
}

/**
 * Downloads a file from the API and hands it to the browser.
 *
 * A plain `<a href="/api/...">` cannot do this. Authentication here is a bearer
 * token in a header, and a link navigation carries no headers — so the link
 * would arrive unauthenticated, get a 401, and the browser would render the
 * error as a page. Fetching with the token and saving the response as a blob is
 * how a header-authenticated download works.
 *
 * The filename comes from Content-Disposition where the server sent one, so the
 * server stays the single authority on what the file is called and the two
 * cannot disagree.
 */
export async function download(path, fallbackName = 'download') {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* not JSON — keep the status message */
    }
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match ? match[1] : fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick rather than immediately: Safari has not finished
  // with the URL when click() returns, and revoking synchronously gives it an
  // empty file. See https://bugs.webkit.org/show_bug.cgi?id=185241
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};
