/**
 * Service worker for the installed app.
 *
 * Its job is narrow on purpose. Restoration needs the network and the daily
 * counters live in the database, so nothing about a photo is ever cached — the
 * result belongs to one visitor and must not sit in a shared store. What is
 * cached is the shell, so opening the installed icon shows the interface
 * instead of a browser error when the connection is poor, and an offline page
 * that says so plainly rather than failing blank.
 */

const VERSION = 'saffi-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // Individually, so one missing file cannot fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API: quotas, sign-in state and restored photographs are
  // all per-visitor and per-moment. A stale answer here would show someone
  // another person's allowance, or a result that is not theirs.
  if (url.pathname.startsWith('/api/')) return;

  // Network first, so a running app always gets the current interface; the
  // cache is the fallback for a bad connection, not the default source.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await caches.match('/');
          if (shell) return shell;
        }
        return new Response('لا يوجد اتصال بالإنترنت.', {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }),
  );
});
