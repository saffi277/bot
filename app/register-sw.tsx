'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, which is what makes the site installable.
 *
 * Kept as its own client component so the layout stays a server component:
 * registration needs the browser, and marking the whole layout client-side to
 * get it would push the entire tree across the boundary for one line of setup.
 *
 * Failure is deliberately silent. A browser with service workers disabled, or
 * a page served over plain HTTP in development, simply does not install — the
 * site itself works exactly the same either way, so there is nothing to report
 * to the visitor.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  return null;
}
