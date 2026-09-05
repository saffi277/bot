import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../lib/ratelimit.ts', import.meta.url), 'utf8');
const match = source.match(/`(INSERT INTO usage_counters[\s\S]*?WHERE count \+ \? <= \?)`/);
assert.ok(match, 'Could not find the atomic claim statement in lib/ratelimit.ts');
const claimSql = match[1];

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE usage_counters (
  scope TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, day)
)`);

const day = '2026-09-02';
const claim = (scope, limit, units = 1) =>
  db.prepare(claimSql).run(scope, day, units, units, limit, units, units, limit).changes === 1;
const unclaim = (scope, units = 1) => db.prepare(
  'UPDATE usage_counters SET count = count - ? WHERE scope = ? AND day = ? AND count >= ?',
).run(units, scope, day, units);

async function reserve(subject, subjectLimit, globalLimit, units = 1) {
  // Starts all reservations in the same microtask turn, as HTTP requests do
  // when a burst reaches a Worker simultaneously.
  await Promise.resolve();
  if (!claim('global', globalLimit, units)) return false;
  if (!claim(subject, subjectLimit, units)) {
    unclaim('global', units);
    return false;
  }
  return true;
}

const countOf = (scope) =>
  db.prepare('SELECT count FROM usage_counters WHERE scope = ? AND day = ?').get(scope, day)?.count ?? 0;
const fresh = () => db.exec('DELETE FROM usage_counters');

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

// ── Multi-unit operations ────────────────────────────────────────────
// An operation costing more than one model call must charge that much, or
// real spending drifts above the cap while the counter still looks healthy.

fresh();
assert.equal(claim('global', 10, 3), true, 'A 3-unit claim must fit under a cap of 10');
assert.equal(countOf('global'), 3, 'A 3-unit claim must move the counter by 3, not 1');

fresh();
// 4 units against a cap of 10: two succeed, the third would reach 12.
assert.equal(claim('global', 10, 4), true);
assert.equal(claim('global', 10, 4), true);
assert.equal(claim('global', 10, 4), false, 'A claim that would exceed the cap must be refused whole');
assert.equal(countOf('global'), 8, 'A refused claim must leave the counter untouched — no partial charge');

fresh();
assert.equal(claim('global', 3, 5), false, 'A claim larger than the whole cap must be refused');
assert.equal(countOf('global'), 0);

fresh();
claim('global', 10, 4);
unclaim('global', 4);
assert.equal(countOf('global'), 0, 'A refund must return exactly what was charged');

// Concurrency again, this time with costly operations: 20 simultaneous
// 3-unit reservations against a cap of 10 may only let three through.
fresh();
const costly = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve(`guest:c${i}`, 9, 10, 3)));
assert.equal(costly.filter(Boolean).length, 3, 'Three 3-unit operations exhaust a cap of ten');
assert.equal(countOf('global'), 9, 'The persisted total must equal units actually granted');

console.log('rate-limit atomicity verified: global 5/30, subject 2/30, and multi-unit claims are all-or-nothing');
