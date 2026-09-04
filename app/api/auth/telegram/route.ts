import { getConfig } from '@/lib/telegram';
import { clearCookie, issueCookie, LoginPayload, verifyLogin } from '@/lib/telegram-auth';

/**
 * Where Telegram's login widget lands.
 *
 * The widget can be configured to redirect (GET, fields in the query string)
 * or to post; both are accepted so the front end can switch without a backend
 * change. A verified visitor gets the signed cookie and is sent back to the
 * site; an unverified one is sent back with an error the page can show.
 */

function redirect(appUrl: string, cookie?: string, error?: string) {
  const target = error ? `${appUrl}/?auth=${error}` : `${appUrl}/?auth=ok`;
  const headers = new Headers({ location: target });
  if (cookie) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}

async function handle(request: Request, payload: LoginPayload) {
  const { token, appUrl } = getConfig();
  if (!token) return redirect(appUrl, undefined, 'not_configured');

  const identity = await verifyLogin(payload, token);
  if (!identity) return redirect(appUrl, undefined, 'invalid');

  return redirect(appUrl, await issueCookie(identity, token));
}

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return handle(request, params);
}

export async function POST(request: Request) {
  let payload: LoginPayload = {};
  try {
    const type = request.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      payload = (await request.json()) as LoginPayload;
    } else {
      payload = Object.fromEntries((await request.formData()).entries()) as LoginPayload;
    }
  } catch {
    return redirect(getConfig().appUrl, undefined, 'invalid');
  }
  return handle(request, payload);
}

/** Sign-out. */
export async function DELETE() {
  return new Response(null, { status: 204, headers: { 'set-cookie': clearCookie() } });
}
