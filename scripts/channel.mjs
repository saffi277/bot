/**
 * Shows the state of the agent channel before anyone writes to it.
 *
 * docs/REVIEW.md is the only channel between the two agents, and every failure
 * it has had came from writing blind: round 11 never existed, round 16 was
 * claimed twice on the same day, and a round was appended after a later one
 * because its author did not know that one had landed. Nobody was careless —
 * nobody could see the file's state without reading 900 lines of it.
 *
 *   npm run channel Codex           # what is new for Codex
 *   npm run channel "Claude Code"
 *   npm run channel                 # open tasks and the last two rounds
 *
 * State is derived from the round headings themselves. A tracking file would
 * be one more thing for two agents to write at once and conflict over.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const review = join(root, 'docs', 'REVIEW.md');

/** `## جولة 15 — Claude Code — 2026-09-04` */
const HEADING = /^##\s*جولة\s*(\d+)\s*—\s*(.+?)\s*—\s*(.+?)\s*$/;

const lines = readFileSync(review, 'utf8').split('\n');

const rounds = [];
lines.forEach((line, index) => {
  const match = HEADING.exec(line);
  if (match) {
    rounds.push({ number: Number(match[1]), author: match[2], date: match[3], start: index });
  }
});
rounds.forEach((round, i) => {
  round.end = i + 1 < rounds.length ? rounds[i + 1].start : lines.length;
});

if (!rounds.length) {
  console.error('لم أجد أي جولة في docs/REVIEW.md — هل تغيّرت صيغة العناوين؟');
  process.exit(1);
}

const authors = [...new Set(rounds.map((r) => r.author))];
const me = process.argv.slice(2).join(' ').trim();

/** Tolerates "codex" for "Codex" — the caller is typing their own name. */
function resolve(name) {
  if (!name) return null;
  const hit = authors.find((a) => a.toLowerCase() === name.toLowerCase());
  return hit ?? null;
}

const identity = resolve(me);
if (me && !identity) {
  console.error(`\n❌ لا أعرف الوكيل "${me}".`);
  console.error(`   الأسماء الموجودة في القناة: ${authors.join(' · ')}\n`);
  process.exit(1);
}

const bar = '─'.repeat(60);

// ── 1. Open tasks, lifted from the table at the top of the file ──────
const tableStart = lines.findIndex((l) => l.includes('المهام المفتوحة'));
if (tableStart !== -1) {
  console.log(`\n${bar}\n📋 المهام المفتوحة\n${bar}`);
  for (let i = tableStart + 1; i < rounds[0].start; i += 1) {
    const line = lines[i];
    if (line.startsWith('## ')) break;
    // Struck-through rows are finished work; the point here is what is left.
    if (line.trim() && !line.includes('~~') && !/^\|[\s-|]*\|$/.test(line.trim())) {
      console.log(line);
    }
  }
}

// ── 2. What landed since this agent last wrote ───────────────────────
console.log(`\n${bar}`);
if (identity) {
  const mine = [...rounds].reverse().find((r) => r.author === identity);
  const fresh = rounds.filter((r) => r.number > (mine?.number ?? 0) && r.author !== identity);

  if (!mine) {
    console.log(`👋 لم تكتب في القناة بعد يا ${identity} — اقرأ آخر جولتين أدناه.\n${bar}`);
    for (const round of rounds.slice(-2)) print(round);
  } else if (!fresh.length) {
    console.log(`✅ لا جديد لك منذ جولتك ${mine.number}.\n${bar}`);
  } else {
    console.log(`📬 ${fresh.length} جولة جديدة لك منذ جولتك ${mine.number}\n${bar}`);
    for (const round of fresh) print(round);
  }
} else {
  console.log(`📖 آخر جولتين (مرّر اسمك لترى ما يخصّك)\n${bar}`);
  for (const round of rounds.slice(-2)) print(round);
}

function print(round) {
  console.log(`\n${lines.slice(round.start, round.end).join('\n').trimEnd()}\n`);
}

// ── 3. The heading to use next, so two agents stop colliding ─────────
const next = Math.max(...rounds.map((r) => r.number)) + 1;
const today = new Date().toISOString().slice(0, 10);

console.log(bar);
console.log('✍️  عنوان جولتك التالية — انسخه كما هو:\n');
console.log(`## جولة ${next} — ${identity ?? '<اسمك>'} — ${today}`);
console.log(`\n   أضِفه في نهاية الملف. لا تعدّل ما كتبه الآخر.`);
console.log(`${bar}\n`);
