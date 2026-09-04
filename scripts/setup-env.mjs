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
 * An existing .env.local is never overwritten: it is read, and only the keys
 * that are missing or empty get filled in, so re-running it is safe.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
    note: 'من @BotFather — الصقه هنا، ولا ترسله في أي محادثة',
  },
  {
    key: 'TELEGRAM_BOT_USERNAME',
    value: '',
    note: 'معرّف البوت بلا @',
  },
  {
    key: 'TELEGRAM_WEBHOOK_SECRET',
    value: secret,
    note: 'وُلِّد تلقائياً — بدونه يرفض الويبهوك كل تحديث',
  },
  {
    key: 'TELEGRAM_SESSION_SECRET',
    value: secret,
    note: 'وُلِّد تلقائياً — مستقل عن التوكن عمداً',
  },
  {
    key: 'APP_URL',
    value: 'http://localhost:3000',
    note: 'غيّره إلى عنوان الموقع بعد النشر',
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
const lines = ['# مُولَّد بـ npm run setup:env — هذا الملف لا يدخل الگت (.gitignore)', ''];
const filled = [];
const kept = [];
const blank = [];

for (const entry of MANAGED) {
  const current = existing[entry.key];
  let value;
  if (current) {
    value = current;
    kept.push(entry.key);
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
  lines.push('# قيم كانت موجودة مسبقاً');
  for (const key of extra) lines.push(`${key}=${existing[key]}`);
  lines.push('');
}

writeFileSync(target, lines.join('\n'));

console.log('\n✅ كُتب .env.local\n');
if (filled.length) console.log(`   وُلِّد تلقائياً: ${filled.join(' · ')}`);
if (kept.length) console.log(`   بقي كما هو:    ${kept.join(' · ')}`);
if (blank.length) {
  console.log(`\n⚠️  ينقصه منك: ${blank.join(' · ')}`);
  console.log('   افتح .env.local وألصق القيمة أمام كل واحد.');
}
console.log('\n   الملف محمي بـ .gitignore — لن يُرفع إلى الگت.');
console.log('   بعد تعبئته:  npm run dev\n');
