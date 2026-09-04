/**
 * Telegram Login verification and the session cookie it issues.
 *
 * Telegram signs the login payload with a key derived from the bot token, so
 * anyone holding the token can verify a visitor's identity without Telegram
 * being contacted again. That makes the check cheap, but it also means a
 * forged or replayed payload must be rejected on our side — nothing upstream
 * will do it for us.
 *
 * The cookie carries the identity onward. It is signed with the same secret
 * rather than encrypted: its contents are not sensitive (a Telegram id and a
 * first name), but they must not be editable by the person holding them.
 */

const COOKIE = 'saffi_tg';
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type TelegramIdentity = { id: string; name?: string };

/** Fields Telegram's login widget posts back. */
export type LoginPayload = Record<string, string>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * btoa only accepts Latin-1, so a Telegram first name in Arabic throws before
 * the cookie is ever issued — which is every user this product is built for.
 * Encoding to UTF-8 bytes first makes the payload safe for any script.
 */
function encodeBase64(text: string): string {
  const bytes = encoder.encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return decoder.decode(bytes);
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare: a fast reject leaks how much of the digest matched. */
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(key: ArrayBuffer | Uint8Array, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}

/**
 * Verifies a Telegram Login payload.
 *
 * Per Telegram's scheme the signing key is SHA-256 of the bot token, and the
 * signed message is every field except `hash`, sorted by key, joined by
 * newlines.
 */
export async function verifyLogin(payload: LoginPayload, botToken: string): Promise<TelegramIdentity | null> {
  const { hash, ...fields } = payload;
  if (!hash || !fields.id) return null;

  // A stale payload is a replay: the same signature stays valid forever
  // otherwise, so age is the only thing bounding it.
  const authDate = Number.parseInt(fields.auth_date ?? '', 10);
  if (!Number.isFinite(authDate)) return null;
  if (Math.floor(Date.now() / 1000) - authDate > MAX_AUTH_AGE_SECONDS) return null;

  const checkString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');

  const secretKey = await crypto.subtle.digest('SHA-256', encoder.encode(botToken));
  const expected = await hmacHex(secretKey, checkString);
  if (!equal(expected, hash.toLowerCase())) return null;

  return { id: String(fields.id), name: fields.first_name || undefined };
}

/** Signs the identity so the cookie cannot be edited by its holder. */
export async function issueCookie(identity: TelegramIdentity, botToken: string): Promise<string> {
  const body = JSON.stringify({
    id: identity.id,
    name: identity.name,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });
  const value = encodeBase64(body);
  const signature = await hmacHex(encoder.encode(botToken), value);
  const cookie = `${value}.${signature}`;

  return [
    `${COOKIE}=${cookie}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ].join('; ');
}

/** Reads the identity back, or null when the cookie is absent, edited or expired. */
export async function readCookie(request: Request, botToken: string): Promise<TelegramIdentity | null> {
  const header = request.headers.get('cookie');
  if (!header) return null;

  const raw = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return null;

  const [value, signature] = raw.split('.');
  if (!value || !signature) return null;

  const expected = await hmacHex(encoder.encode(botToken), value);
  if (!equal(expected, signature)) return null;

  try {
    const parsed = JSON.parse(decodeBase64(value)) as { id?: string; name?: string; exp?: number };
    if (!parsed.id || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}

/** Clears the cookie, for sign-out. */
export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
