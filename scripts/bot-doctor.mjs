/**
 * Diagnoses why the Telegram bot is silent.
 *
 * A misconfigured Telegram bot does not error — it simply never answers, and
 * the cause is invisible from the outside: a webhook pointing at the wrong
 * host, a secret that no longer matches, a token that was revoked. Each of
 * those looks identical from the chat window. This asks Telegram directly and
 * says which one it is.
 *
 *   node scripts/bot-doctor.mjs
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
const sessionSecret = process.env.TELEGRAM_SESSION_SECRET;
const api = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org/bot';

const rows = [];
const note = (ok, label, detail, fix) => rows.push({ ok, label, detail, fix });
/** Worth saying, but not a reason to hold the launch. */
const warn = (label, detail, fix) => rows.push({ ok: false, soft: true, label, detail, fix });


async function call(method) {
  const response = await fetch(`${api}${token}/${method}`);
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.description || `HTTP ${response.status}`);
  return payload.result;
}

console.log('\nTelegram bot check\n' + '-'.repeat(58));

if (!token) {
  note(false, 'token', 'not set', 'Create a bot with @BotFather, then set TELEGRAM_BOT_TOKEN');
} else {
  try {
    const me = await call('getMe');
    note(true, 'token', `@${me.username} - ${me.first_name}`, null);

    if (username && username !== me.username) {
      note(false, 'bot username', `set to "${username}" but the bot is "${me.username}"`,
        `Change TELEGRAM_BOT_USERNAME to ${me.username}`);
    } else if (!username) {
      note(false, 'bot username', 'TELEGRAM_BOT_USERNAME not set',
        `Set it to ${me.username} - without it the site shows no sign-in button`);
    } else {
      note(true, 'bot username', `@${username}`, null);
    }

    const hook = await call('getWebhookInfo');
    const expected = appUrl ? `${appUrl}/api/telegram` : null;

    if (!hook.url) {
      note(false, 'webhook', 'not registered - the bot will answer nothing',
        'Run: node telegram-bot/register-webhook.mjs');
    } else if (expected && hook.url !== expected) {
      note(false, 'webhook', `points at ${hook.url}`,
        `Expected ${expected} - fix APP_URL and register again`);
    } else {
      note(true, 'webhook', hook.url, null);
    }

    // A pending backlog with a stored error is the clearest signal that
    // Telegram is delivering and our endpoint is refusing.
    if (hook.last_error_message) {
      const when = hook.last_error_date ? new Date(hook.last_error_date * 1000).toISOString().slice(0, 16) : '';
      note(false, 'last error', `${hook.last_error_message} (${when})`,
        'Telegram reaches us but the route refuses - check the secret and the deploy');
    }
    if (hook.pending_update_count > 0) {
      note(false, 'pending updates', `${hook.pending_update_count} undelivered`,
        'The site is not responding - check that it is deployed and up');
    }

    note(Boolean(hook.has_custom_certificate) === false, 'certificate', 'standard', null);

    if (!secret) {
      note(false, 'webhook secret', 'not set - the webhook refuses every update',
        'Set TELEGRAM_WEBHOOK_SECRET to the value you registered, or the bot never answers');
    } else {
      note(true, 'webhook secret', 'set', null);
    }

    // Its own key on purpose: signing sessions with the bot token means
    // rotating the token silently signs every visitor out.
    if (!sessionSecret) {
      note(false, 'session secret', 'not set - Telegram sign-in is off',
        'Set TELEGRAM_SESSION_SECRET (32+ random chars, NOT the bot token). The site runs in guest mode until you do');
    } else if (sessionSecret === token) {
      note(false, 'session secret', 'same as the bot token',
        'Make it a separate value - otherwise rotating the token signs every user out');
    } else if (sessionSecret.length < 32) {
      note(false, 'session secret', `too short (${sessionSecret.length} chars)`,
        'Use at least 32 random characters');
    } else {
      note(true, 'session secret', 'set, and separate from the token', null);
    }

    const commands = await call('getMyCommands');
    if (!commands.length) {
      note(false, 'commands', 'not registered',
        'Run register-webhook.mjs - without it users see no command menu');
    } else {
      note(true, 'commands', commands.map((c) => `/${c.command}`).join(' '), null);
    }
  } catch (error) {
    note(false, 'reaching Telegram', error.message,
      error.message.includes('Unauthorized')
        ? 'The token is invalid or was revoked - create a new one with @BotFather'
        : 'Check the network and that the token is correct');
  }
}

if (!appUrl) {
  note(false, 'site address', 'APP_URL not set',
    'Without it the "open Saffi" button has nowhere to go');
} else {
  note(true, 'site address', appUrl, null);
  await checkSite(appUrl);
}

/**
 * Asks the site itself, rather than trusting that APP_URL being set means it
 * works.
 *
 * A perfectly configured bot pointing at a site that was never deployed, or
 * deployed without its counter database, used to pass this check completely —
 * it only ever confirmed the address existed as a string. The site already
 * publishes everything needed on two public routes; nobody was asking.
 */
async function checkSite(base) {
  const get = async (path) => {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15000) });
    return { response, body: await response.json() };
  };

  let enhance;
  try {
    enhance = await get('/api/enhance');
  } catch (error) {
    note(false, 'site reachable', `${base} did not answer (${error.message})`,
      'Deploy the site, or fix APP_URL. Telegram cannot deliver to an address that is not there');
    return;
  }

  note(true, 'site reachable', `answered from ${base}`, null);

  // Fails closed by design: no counters means no spending ceiling, so the
  // route refuses everything rather than risk an unbounded bill.
  if (enhance.body.storage) {
    note(true, 'counter database', 'bound', null);
  } else {
    note(false, 'counter database', 'not bound - ALL processing is refused',
      'Bind D1 in the hosting settings (D1_BINDING, default DB). Without it nothing can be processed at all');
  }

  if (enhance.body.configured) {
    note(true, 'model key', 'set on the site', null);
  } else {
    warn('model key', 'not set on the site yet - restoration will politely refuse',
      'Add GEMINI_API_KEY in the hosting settings when you are ready to spend. Everything else works without it');
  }

  const count = enhance.body.operations?.length ?? 0;
  note(count > 0, 'services', count ? `${count} offered` : 'none reached the site',
    count ? null : 'The catalogue did not load; the interface will have nothing to show');

  // Printed so the owner sees the ceiling that is actually in force, rather
  // than the one being assumed.
  note(true, 'daily cap', `${enhance.body.dailyCap} image(s) across everyone`, null);
  note(true, 'output limit', `${enhance.body.maxOutputEdge}px longest edge`, null);

  try {
    const telegramSide = await get('/api/telegram');
    const remote = telegramSide.body.botUsername;
    if (!remote) {
      warn('bot on the site', 'TELEGRAM_BOT_USERNAME is not set there',
        'Sign-in will not appear on the site until it is added in the hosting settings');
    } else if (username && remote !== username) {
      note(false, 'bot on the site', `site says @${remote}, here it is @${username}`,
        'The two environments disagree - fix whichever is wrong');
    } else {
      note(true, 'bot on the site', `@${remote}`, null);
    }
  } catch {
    warn('bot on the site', 'could not be read', null);
  }

  // Confirms middleware.ts actually shipped; it is easy to have locally and
  // miss in the deployed build.
  const csp = enhance.response.headers.get('content-security-policy');
  note(Boolean(csp), 'security headers', csp ? 'present' : 'missing',
    csp ? null : 'middleware.ts did not ship, or the deploy is older than it');

  if (!process.env.ADMIN_TOKEN) {
    warn('usage report', 'ADMIN_TOKEN not set',
      'Optional. Set it here and in the hosting settings to use: npm run stats');
  } else {
    note(true, 'usage report', 'ready - run: npm run stats', null);
  }
}

for (const row of rows) {
  const mark = row.ok ? '[ OK ]' : row.soft ? '[note]' : '[FAIL]';
  console.log(`${mark} ${row.label.padEnd(18)} ${row.detail}`);
  if (row.fix) console.log(`       -> ${row.fix}`);
}

// Only real blockers set the exit code. Treating "the model key is not added
// yet" as a failure would make the tool cry wolf about the intended state.
const blocking = rows.filter((r) => !r.ok && !r.soft).length;
const notes = rows.filter((r) => r.soft).length;
console.log('-'.repeat(58));
if (blocking) {
  console.log(`${blocking} problem(s) blocking launch`);
} else {
  console.log(notes ? `Ready to launch - send it /start  (${notes} note(s) above)` : 'Ready to launch - send it /start');
}
process.exit(blocking ? 1 : 0);
