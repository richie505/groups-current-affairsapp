import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

// Every page in the app used to do `api.get(path).then(setData)` with no
// rejection handling, so a 404/500/dropped connection left the page stuck on
// its loading spinner forever. This centralises the three states a fetch can
// actually be in — loading, loaded, failed — so pages can render an
// ErrorState with a Retry instead of hanging.
//
// `path` may be null to skip fetching entirely (e.g. a dependent resource
// whose parent id isn't chosen yet); `data` stays null and no request fires.
//
// Responses are guarded against races: when `path` changes faster than the
// network responds (rapid navigation, or clicking through the admin content
// tree), a stale in-flight response must not overwrite the newer one.
export default function useResource(path, { skip = false } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (!path || skip) {
      setData(null);
      setError(null);
      return undefined;
    }
    let active = true;
    setData(null);
    setError(null);
    api
      .get(path)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((e) => {
        if (active) setError(e);
      });
    return () => {
      active = false;
    };
  }, [path, skip, reloadToken]);

  return { data, error, loading: !data && !error && !!path && !skip, reload, setData };
}
