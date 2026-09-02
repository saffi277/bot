import { createTelegramSession, sessionCookie, verifyTelegramLogin } from '@/lib/telegram-auth';

async function authorize(request: Request, values: URLSearchParams): Promise<Response> {
  const identity = await verifyTelegramLogin(values);
  if (!identity) return new Response('Telegram login could not be verified.', { status: 401 });

  const session = await createTelegramSession(identity);
  if (!session) return new Response('Telegram session is not configured.', { status: 503 });

  const destination = new URL('/', request.url);
  return Response.redirect(destination, 303, { headers: { 'set-cookie': sessionCookie(session) } });
}

/** The legacy widget redirects here with signed query parameters. */
export async function GET(request: Request) {
  return authorize(request, new URL(request.url).searchParams);
}

/** Kept for API clients and test harnesses that submit the same widget fields as a form. */
export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return new Response('Expected form-encoded Telegram login data.', { status: 415 });
  }
  return authorize(request, new URLSearchParams(await request.text()));
}
