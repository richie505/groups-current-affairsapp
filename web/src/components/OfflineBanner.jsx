import { useEffect, useState } from 'react';
import { IconAlert } from './Icon';

// A quiet strip under the navbar when the device has no connection.
//
// The service worker keeps already-visited notes and questions readable
// offline, which is the point — but silently serving yesterday's data looks
// identical to the app being broken. This says which one it is, and warns
// that answers won't be saved, because a student who works through twenty
// questions on a train and loses the lot would rightly be furious.

export default function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div role="status" aria-live="polite" className="border-b border-amber-300 bg-amber-50 px-4 py-2">
      <p className="mx-auto flex max-w-6xl items-start gap-2 text-sm text-amber-900">
        <IconAlert className="mt-0.5 shrink-0" />
        <span>
          <span className="font-medium">You're offline.</span> Notes and questions you've already opened still work.
          Anything new won't load, and answers won't be saved until you're back on.
        </span>
      </p>
    </div>
  );
}
