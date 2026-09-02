import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.TELEGRAM_AUTH_MODULE;
assert.ok(modulePath, 'TELEGRAM_AUTH_MODULE must point to compiled telegram-auth.js');
const { createTelegramSession, readTelegramSession, verifyTelegramLogin } = await import(pathToFileURL(modulePath).href);

const botToken = '123456:telegram-test-token';
const now = 1_700_000_000;
const data = new URLSearchParams({ id: '123456789', first_name: 'Saffi', username: 'saffi_bot', auth_date: String(now) });
const check = [...data.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
data.set('hash', createHmac('sha256', createHash('sha256').update(botToken).digest()).update(check).digest('hex'));

const identity = await verifyTelegramLogin(data, botToken, now + 60);
assert.deepEqual(identity, { id: '123456789', name: 'Saffi' });

const forged = new URLSearchParams(data);
forged.set('first_name', 'Attacker');
assert.equal(await verifyTelegramLogin(forged, botToken, now + 60), null);

const expired = new URLSearchParams(data);
expired.set('auth_date', String(now - 86_401));
assert.equal(await verifyTelegramLogin(expired, botToken, now), null);

const secret = '0123456789abcdef0123456789abcdef';
const session = await createTelegramSession(identity, secret, now);
assert.ok(session);
const request = new Request('https://example.test', { headers: { cookie: `saffi_tg_session=${session}` } });
assert.deepEqual(await readTelegramSession(request, secret, now + 60), identity);
assert.equal(await readTelegramSession(new Request('https://example.test', { headers: { cookie: `saffi_tg_session=${session}x` } }), secret, now + 60), null);

console.log('telegram login verification and signed session verified');
