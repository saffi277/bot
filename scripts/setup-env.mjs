/**
 * Writes .env.local for local development.
 *
 * The two random secrets are the part people get wrong: reusing the bot token,
 * or picking something short and memorable. Both are generated here instead of
 * being invented by hand. The bot token is left blank on purpose — it comes
 * from BotFather and belongs only in this file, which .gitignore already
 * excludes, never in the repository or a chat window.
 *
 *   npm run setup:env
 *
 * When run in a terminal it asks for the two Telegram values it cannot invent
 * and writes them itself, because the alternative is telling someone to open a
 * dotfile and edit it by hand — which is where a stray space or a quote turns
 * into a bot that never answers and no error explaining why. Piped or in CI it
 * skips the questions and leaves those blank.
 *
 * An existing .env.local is never overwritten: it is read, and only the keys
 * that are missing or empty get filled in, so re-running it is safe.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.env.local');

const secret = () => randomBytes(32).toString('hex');

/** Keys we manage, with how each value is obtained. */
const MANAGED = [
  {
    key: 'TELEGRAM_BOT_TOKEN',
    value: '',
    note: 'From @BotFather. Keep it here only - never paste it into a chat.',
  },
  {
    key: 'TELEGRAM_BOT_USERNAME',
    value: '',
    note: 'Bot username, without the @',
  },
  {
    key: 'TELEGRAM_WEBHOOK_SECRET',
    value: secret,
    note: 'Generated. Without it the webhook refuses every update.',
  },
  {
    key: 'TELEGRAM_SESSION_SECRET',
    value: secret,
    note: 'Generated. Deliberately separate from the bot token.',
  },
  {
    key: 'APP_URL',
    value: 'http://localhost:3000',
    note: 'Change to the deployed site address.',
  },
  {
    key: 'ADMIN_TOKEN',
    value: secret,
    note: 'Generated. Opens /api/stats, which reports usage and spending.',
  },
  {
    key: 'GEMINI_API_KEY',
    value: '',
    // Written blank on purpose. Omitting the line entirely made a filled file
    // look complete while the site still reported itself unconfigured, with
    // nothing on screen to say which key was missing.
    note: 'Optional for now. Needed only to actually restore photos; the site runs without it and says so.',
  },
];

/** Reads existing assignments so nothing already set is clobbered. */
function readExisting() {
  if (!existsSync(target)) return {};
  const found = {};
  for (const line of readFileSync(target, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) found[match[1]] = match[2];
  }
  return found;
}

const existing = readExisting();

/**
 * Only asks for values that are still missing, so re-running does not
 * interrogate someone about things they already set.
 */
async function ask() {
  const answers = {};
  if (!process.stdin.isTTY) return answers;

  const needed = [
    { key: 'TELEGRAM_BOT_TOKEN', q: 'Bot token from @BotFather  (looks like 1234567890:AA...)' },
    { key: 'TELEGRAM_BOT_USERNAME', q: 'Bot username, no @         (e.g. saffi_photo_bot)' },
  ].filter((entry) => !existing[entry.key]);
  if (!needed.length) return answers;

  console.log('\nTwo values I cannot invent. Press Enter to skip either one.\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (const entry of needed) {
    // Trimmed because a trailing space pasted from a chat window is invisible
    // and produces a token Telegram rejects with no useful message.
    const value = (await rl.question(`  ${entry.q}\n  > `)).trim();
    if (value) answers[entry.key] = value.replace(/^@/, '');
    console.log('');
  }
  rl.close();
  return answers;
}

const provided = await ask();
const lines = ['# Written by: npm run setup:env   -   git-ignored, never committed', ''];
const filled = [];
const entered = [];
const kept = [];
const blank = [];

for (const entry of MANAGED) {
  const current = provided[entry.key] ?? existing[entry.key];
  let value;
  if (current) {
    value = current;
    // What the person typed is theirs, not something we invented — saying
    // "generated" about a token they pasted would be a small lie in the one
    // place they are checking our work.
    if (provided[entry.key]) entered.push(entry.key);
    else kept.push(entry.key);
  } else {
    value = typeof entry.value === 'function' ? entry.value() : entry.value;
    if (value) filled.push(entry.key);
    else blank.push(entry.key);
  }
  lines.push(`# ${entry.note}`);
  lines.push(`${entry.key}=${value}`);
  lines.push('');
}

// Anything the file already had that we do not manage is preserved verbatim.
const extra = Object.keys(existing).filter((key) => !MANAGED.some((m) => m.key === key));
if (extra.length) {
  lines.push('# Values that were already here');
  for (const key of extra) lines.push(`${key}=${existing[key]}`);
  lines.push('');
}

writeFileSync(target, lines.join('\n'));

console.log('\nWrote .env.local\n');
if (entered.length) console.log(`  you entered : ${entered.join(', ')}`);
if (filled.length) console.log(`  generated   : ${filled.join(', ')}`);
if (kept.length) console.log(`  unchanged   : ${kept.join(', ')}`);
// GEMINI_API_KEY is separated out: it is not a launch blocker like the others,
// and listing it beside them would make the bot look unlaunchable without it.
const required = blank.filter((key) => key !== 'GEMINI_API_KEY');
if (required.length) {
  console.log(`\n  STILL NEEDED: ${required.join(', ')}`);
  console.log('  Open .env.local and paste each value after the = sign.');
}
if (blank.includes('GEMINI_API_KEY')) {
  console.log('\n  GEMINI_API_KEY left empty. The bot and site both work without it;');
  console.log('  the site simply reports that restoration is not switched on yet.');
}
console.log(`\n   📄 ${target}`);
console.log('  Git-ignored - this file is never pushed.');
console.log(required.length ? '  Open it, fill the rest, then:  npm run dev\n' : '  Ready. Run:  npm run dev\n');
