/**
 * Verifies Telegram Login and the session cookie.
 *
 * Two separate keys are exercised on purpose. Telegram's payload is verified
 * with a key derived from the bot token, because that is Telegram's scheme and
 * we do not choose it. Our own cookie is signed with TELEGRAM_SESSION_SECRET,
 * so rotating the bot token does not sign every visitor out and neither key
 * does two jobs. A test that used one value for both would pass even if the
 * separation were undone, so each case below states which key it uses.
 */

import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const BOT_TOKEN = 'test-bot-token-000';
const OTHER_TOKEN = 'a-different-bot-token';
const SESSION_SECRET = 'session-secret-at-least-32-characters';
const OTHER_SESSION_SECRET = 'a-different-session-secret-value-xx';

/**
 * Loads the module under test without depending on --experimental-strip-types:
 * that flag needs a Node build carrying the TypeScript parser, and the same
 * v22 line ships both with and without it, so the test silently became
 * unrunnable for anyone on the wrong build. TypeScript is already a
 * devDependency, so transpiling here works on every Node that can run the app.
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'lib', 'telegram-auth.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = join(mkdtempSync(join(tmpdir(), 'auth-')), 'telegram-auth.mjs');
writeFileSync(compiled, js);

const { issueCookie, readCookie, verifyLogin } = await import(pathToFileURL(compiled).href);

/** Signs a login payload exactly as Telegram does, so valid cases are real. */
function sign(fields, token) {
  const checkString = Object.keys(fields)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const key = createHash('sha256').update(token).digest();
  return createHmac('sha256', key).update(checkString).digest('hex');
}

function payload(overrides = {}, token = BOT_TOKEN) {
  const fields = {
    id: '12345',
    first_name: 'صفاء',
    auth_date: String(Math.floor(Date.now() / 1000)),
    ...overrides,
  };
  return { ...fields, hash: sign(fields, token) };
}

/** A Request carrying only the cookie header, which is all readCookie needs. */
function requestWith(setCookie) {
  const value = setCookie.split(';')[0];
  return new Request('https://example.test/', { headers: { cookie: value } });
}

const results = [];
async function check(name, run, expected) {
  let actual;
  try {
    actual = (await run()) ? 'accepted' : 'rejected';
  } catch {
    actual = 'threw';
  }
  results.push({ name, actual, expected, ok: actual === expected });
}

const DAY = 24 * 60 * 60;

// ── Telegram Login: verified with the bot token ──────────────────────
await check('valid signature', () => verifyLogin(payload(), BOT_TOKEN), 'accepted');
await check('forged hash', () => verifyLogin({ ...payload(), hash: 'f'.repeat(64) }, BOT_TOKEN), 'rejected');
await check('field edited after signing', async () => {
  const p = payload();
  return verifyLogin({ ...p, id: '99999' }, BOT_TOKEN);
}, 'rejected');
await check('no hash at all', () => {
  const p = payload();
  delete p.hash;
  return verifyLogin(p, BOT_TOKEN);
}, 'rejected');
await check('signed by a different bot token', () => verifyLogin(payload({}, OTHER_TOKEN), BOT_TOKEN), 'rejected');

// Replay: Telegram's payload stays valid forever unless we bound its age.
const now = Math.floor(Date.now() / 1000);
await check('older than 24h (replay)', () => verifyLogin(payload({ auth_date: String(now - DAY - 60) }), BOT_TOKEN), 'rejected');
await check('23h old still accepted', () => verifyLogin(payload({ auth_date: String(now - 23 * 60 * 60) }), BOT_TOKEN), 'accepted');

// ── Session cookie: signed with the session secret ───────────────────
await check('cookie round-trips an Arabic name', async () => {
  const cookie = await issueCookie({ id: '12345', name: 'صفاء' }, SESSION_SECRET);
  const identity = await readCookie(requestWith(cookie), SESSION_SECRET);
  return identity?.id === '12345' && identity?.name === 'صفاء';
}, 'accepted');

// The payload is swapped for a different identity while the original
// signature is kept, which is exactly what an edited cookie looks like.
await check('edited cookie rejected', async () => {
  const cookie = await issueCookie({ id: '12345', name: 'صفاء' }, SESSION_SECRET);
  const [name, signed] = cookie.split(';')[0].split('=');
  const signature = signed.split('.')[1];
  const forged = Buffer.from(JSON.stringify({ id: '999', exp: now + DAY })).toString('base64');
  return readCookie(requestWith(`${name}=${forged}.${signature}`), SESSION_SECRET);
}, 'rejected');

await check('cookie from a different session secret rejected', async () => {
  const cookie = await issueCookie({ id: '12345' }, OTHER_SESSION_SECRET);
  return readCookie(requestWith(cookie), SESSION_SECRET);
}, 'rejected');

await check('no cookie header', () => readCookie(new Request('https://example.test/'), SESSION_SECRET), 'rejected');

// The separation itself: a cookie signed with the session secret must not
// verify under the bot token, or the two keys are interchangeable in practice.
await check('bot token cannot verify a session cookie', async () => {
  const cookie = await issueCookie({ id: '12345' }, SESSION_SECRET);
  return readCookie(requestWith(cookie), BOT_TOKEN);
}, 'rejected');

for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.actual})`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`\n${failed.length} of ${results.length} checks failed`);
  process.exit(1);
}
console.log(`\ntelegram auth verified: ${results.length}/${results.length}`);
