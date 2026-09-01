import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../lib/ratelimit.ts', import.meta.url), 'utf8');
const match = source.match(/`(INSERT INTO usage_counters[\s\S]*?WHERE count < \?)`/);
assert.ok(match, 'Could not find the atomic claim statement in lib/ratelimit.ts');
const claimSql = match[1];

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE usage_counters (
  scope TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, day)
)`);

const day = '2026-09-02';
const claim = (scope, limit) => db.prepare(claimSql).run(scope, day, limit, limit).changes === 1;
const unclaim = (scope) => db.prepare(
  'UPDATE usage_counters SET count = count - 1 WHERE scope = ? AND day = ? AND count > 0',
).run(scope, day);

async function reserve(subject, subjectLimit, globalLimit) {
  // Starts all reservations in the same microtask turn, as HTTP requests do
  // when a burst reaches a Worker simultaneously.
  await Promise.resolve();
  if (!claim('global', globalLimit)) return false;
  if (!claim(subject, subjectLimit)) {
    unclaim('global');
    return false;
  }
  return true;
}

const burst = await Promise.all(
  Array.from({ length: 30 }, (_, index) => reserve(`guest:${index}`, 2, 5)),
);
assert.equal(burst.filter(Boolean).length, 5, 'Only five provider calls may pass a global cap of five');
assert.equal(
  db.prepare('SELECT count FROM usage_counters WHERE scope = ? AND day = ?').get('global', day).count,
  5,
  'The persisted global counter must not exceed the cap',
);

const sameGuest = await Promise.all(Array.from({ length: 30 }, () => reserve('guest:one', 2, 30)));
assert.equal(sameGuest.filter(Boolean).length, 2, 'A single guest may not exceed its personal cap');

console.log('rate-limit atomicity verified: global 5/30, subject 2/30');
