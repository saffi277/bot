import { collectStats } from '@/lib/stats';

/**
 * The owner's view of what the service is doing and costing.
 *
 * It is behind ADMIN_TOKEN because the answer describes the business: how many
 * customers, how often it fails, what is being spent. When no token is
 * configured the route replies 404 rather than 401 — an endpoint that
 * announces itself as merely locked invites someone to start guessing.
 */

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(request: Request) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length < 16) return notFound();

  // Accepts either header so it works from a browser tab or from curl.
  const presented =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-admin-token') ??
    new URL(request.url).searchParams.get('token') ??
    '';
  if (!constantTimeEqual(presented, expected)) return notFound();

  const stats = await collectStats();
  if (!stats) {
    return Response.json({ error: 'No counter store is bound, so nothing has been recorded.' }, { status: 503 });
  }

  return Response.json(stats, {
    headers: {
      // Never cached anywhere: it is per-owner and changes every request.
      'cache-control': 'no-store, private',
    },
  });
}
