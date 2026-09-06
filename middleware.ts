import { NextResponse, type NextRequest } from 'next/server';

/**
 * Security headers for every response.
 *
 * The site had none, which left several ordinary attacks open: any page
 * anywhere could frame it and trick a visitor into clicking through their own
 * quota, a browser could be talked into interpreting an uploaded file as
 * script by guessing its type, and a single injected tag could exfiltrate a
 * restored photograph to another host.
 *
 * The policy is written tight because this site loads almost nothing from
 * outside: one font stylesheet, its font files, and images the page itself
 * creates as blob: URLs from the visitor's own upload and the result.
 */

const CSP = [
  "default-src 'self'",
  // Vite's dev client and the framework's inline bootstrap need these two in
  // development. They are dropped in production, where the bundle is static.
  process.env.NODE_ENV === 'production'
    ? "script-src 'self'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  // Google Fonts serves the stylesheet; the styles themselves are inlined by
  // the framework, so 'unsafe-inline' cannot be dropped here without breaking
  // rendering.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // blob: is the before/after comparison; data: is the canvas re-encode.
  "img-src 'self' blob: data:",
  // Only our own API. Telegram's login widget posts back to us, not from us.
  "connect-src 'self'",
  // The Telegram login widget is an iframe from telegram.org.
  "frame-src https://oauth.telegram.org https://telegram.org",
  "form-action 'self'",
  // Nobody may frame us: without this a hostile page can overlay the upload
  // button and spend a visitor's daily allowance on a photo they never chose.
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

const HEADERS: Record<string, string> = {
  'content-security-policy': CSP,
  // Stops a browser from second-guessing a declared type and running an upload
  // as script.
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  // Nothing here needs a camera, a microphone or a location.
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  // A year, subdomains included. The site is HTTPS-only in production.
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'cross-origin-opener-policy': 'same-origin',
};

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(HEADERS)) {
    // HSTS over plain HTTP is meaningless and confuses local development.
    if (name === 'strict-transport-security' && request.nextUrl.protocol !== 'https:') continue;
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  // Everything except the build output, which is served with its own headers.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
