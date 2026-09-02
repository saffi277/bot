type TelegramFields = {
  id: string;
  first_name: string;
  auth_date: string;
  hash: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

export type TelegramIdentity = {
  id: string;
  name: string;
};

const encoder = new TextEncoder();
const SESSION_COOKIE = 'saffi_tg_session';
const AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  // Copying produces a plain ArrayBuffer-backed view accepted by both Node's
  // Web Crypto types and Cloudflare Workers' implementation.
  const keyBytes = Uint8Array.from(key);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value)));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function validText(value: string | undefined, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value);
}

/** Validates the legacy Telegram Login Widget payload exactly as documented by Telegram. */
export async function verifyTelegramLogin(
  values: URLSearchParams,
  botToken = process.env.TELEGRAM_BOT_TOKEN,
  now = Math.floor(Date.now() / 1000),
): Promise<TelegramIdentity | null> {
  if (!botToken) return null;
  const entries = [...values.entries()];
  const allowed = new Set(['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash']);
  if (entries.some(([key]) => !allowed.has(key))) return null;
  if (new Set(entries.map(([key]) => key)).size !== entries.length) return null;

  const fields = Object.fromEntries(entries) as Partial<TelegramFields>;
  if (!validText(fields.id, 24) || !/^\d+$/.test(fields.id)) return null;
  if (!validText(fields.first_name, 128) || !validText(fields.auth_date, 16) || !/^\d+$/.test(fields.auth_date)) return null;
  if (!validText(fields.hash, 64) || !/^[a-f0-9]{64}$/i.test(fields.hash)) return null;
  if (fields.last_name !== undefined && !validText(fields.last_name, 128)) return null;
  if (fields.username !== undefined && !/^[A-Za-z0-9_]{5,32}$/.test(fields.username)) return null;
  if (fields.photo_url !== undefined && !validText(fields.photo_url, 2048)) return null;

  const authDate = Number(fields.auth_date);
  if (!Number.isSafeInteger(authDate) || authDate > now + 300 || now - authDate > AUTH_MAX_AGE_SECONDS) return null;

  const dataCheckString = entries
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const expected = await hmac(await sha256(botToken), dataCheckString);
  const received = Uint8Array.from(fields.hash.match(/.{2}/g) ?? [], (hex) => Number.parseInt(hex, 16));
  if (!sameBytes(expected, received)) return null;

  return { id: fields.id, name: fields.first_name };
}

type SessionPayload = TelegramIdentity & { exp: number };

async function signSession(payload: string, secret: string): Promise<string> {
  return base64Url(await hmac(await sha256(`session:${secret}`), payload));
}

export async function createTelegramSession(
  identity: TelegramIdentity,
  secret = process.env.TELEGRAM_SESSION_SECRET,
  now = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (!secret || secret.length < 32) return null;
  const payload = base64Url(encoder.encode(JSON.stringify({ ...identity, exp: now + SESSION_MAX_AGE_SECONDS } satisfies SessionPayload)));
  return `v1.${payload}.${await signSession(payload, secret)}`;
}

export async function readTelegramSession(
  request: Request,
  secret = process.env.TELEGRAM_SESSION_SECRET,
  now = Math.floor(Date.now() / 1000),
): Promise<TelegramIdentity | null> {
  if (!secret || secret.length < 32) return null;
  const rawCookie = request.headers.get('cookie')?.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${SESSION_COOKIE}=`));
  const value = rawCookie?.slice(SESSION_COOKIE.length + 1);
  if (!value) return null;
  const [version, payload, signature, ...extra] = value.split('.');
  if (version !== 'v1' || !payload || !signature || extra.length > 0) return null;
  const expected = fromBase64Url(await signSession(payload, secret));
  const received = fromBase64Url(signature);
  const decoded = fromBase64Url(payload);
  if (!expected || !received || !decoded || !sameBytes(expected, received)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decoded)) as Partial<SessionPayload>;
    if (!validText(parsed.id, 24) || !/^\d+$/.test(parsed.id) || !validText(parsed.name, 128)) return null;
    if (!Number.isSafeInteger(parsed.exp) || parsed.exp <= now) return null;
    return { id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}

export function sessionCookie(value: string, secure = process.env.NODE_ENV === 'production'): string {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
