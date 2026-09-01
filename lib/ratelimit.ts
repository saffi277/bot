import { ensureSchema, getStore, today } from './store';

/**
 * The bill's safety valve. Every path that can call a provider goes through
 * here first (docs/ARCHITECTURE.md §1.6).
 *
 * Three layers, because per-user limits alone do not bound the bill: 5,000 new
 * users at 5 images each is a large bill in a single day with every individual
 * limit still respected. The global cap is what actually fixes the monthly
 * ceiling — see docs/DISCUSSION.md §8.5.
 *
 * All three read from the environment so they can be retuned without a deploy.
 */

export type Subject = { kind: 'guest'; id: string } | { kind: 'user'; id: string };

export type LimitVerdict =
  | { allowed: true; remaining: number; limit: number }
  | { allowed: false; reason: 'subject' | 'global' | 'unavailable'; remaining: 0; limit: number };

function readLimit(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function limits() {
  return {
    guest: readLimit('LIMIT_GUEST_DAILY', 2),
    user: readLimit('LIMIT_USER_DAILY', 5),
    global: readLimit('DAILY_GLOBAL_CAP', 25),
  };
}

function scopeKey(subject: Subject): string {
  return `${subject.kind}:${subject.id}`;
}

/**
 * Reserves one unit against both the subject's daily limit and the global cap.
 *
 * Reserving up front (rather than counting after the fact) means a burst of
 * concurrent requests cannot slip past the cap while the first is still in
 * flight. A failed call releases its unit through `release`.
 */
export async function reserve(subject: Subject): Promise<LimitVerdict> {
  const { guest, user, global } = limits();
  const subjectLimit = subject.kind === 'user' ? user : guest;

  const store = await getStore();
  if (!store) {
    // Fail closed: without durable counters there is no ceiling on spending.
    return { allowed: false, reason: 'unavailable', remaining: 0, limit: subjectLimit };
  }

  await ensureSchema(store);
  const day = today();

  const [subjectRow, globalRow] = await Promise.all([
    store.db.prepare('SELECT count FROM usage_counters WHERE scope = ? AND day = ?')
      .bind(scopeKey(subject), day)
      .first<{ count: number }>(),
    store.db.prepare('SELECT count FROM usage_counters WHERE scope = ? AND day = ?')
      .bind('global', day)
      .first<{ count: number }>(),
  ]);

  const usedBySubject = subjectRow?.count ?? 0;
  const usedGlobally = globalRow?.count ?? 0;

  if (usedBySubject >= subjectLimit) {
    return { allowed: false, reason: 'subject', remaining: 0, limit: subjectLimit };
  }
  if (usedGlobally >= global) {
    return { allowed: false, reason: 'global', remaining: 0, limit: subjectLimit };
  }

  const bump = `INSERT INTO usage_counters (scope, day, count) VALUES (?, ?, 1)
                ON CONFLICT (scope, day) DO UPDATE SET count = count + 1`;
  await store.db.batch([
    store.db.prepare(bump).bind(scopeKey(subject), day),
    store.db.prepare(bump).bind('global', day),
  ]);

  return { allowed: true, remaining: Math.max(0, subjectLimit - usedBySubject - 1), limit: subjectLimit };
}

/** Gives a reserved unit back when the call failed, so a provider outage does
 *  not silently eat the visitor's daily allowance. */
export async function release(subject: Subject): Promise<void> {
  const store = await getStore();
  if (!store) return;
  const day = today();
  const drop = `UPDATE usage_counters SET count = MAX(0, count - 1) WHERE scope = ? AND day = ?`;
  await store.db
    .batch([
      store.db.prepare(drop).bind(scopeKey(subject), day),
      store.db.prepare(drop).bind('global', day),
    ])
    .catch(() => undefined);
}

/** Read-only view for the UI, so the visitor always sees what is left. */
export async function peek(subject: Subject): Promise<{ remaining: number; limit: number; available: boolean }> {
  const { guest, user } = limits();
  const subjectLimit = subject.kind === 'user' ? user : guest;

  const store = await getStore();
  if (!store) return { remaining: 0, limit: subjectLimit, available: false };

  await ensureSchema(store);
  const row = await store.db
    .prepare('SELECT count FROM usage_counters WHERE scope = ? AND day = ?')
    .bind(scopeKey(subject), today())
    .first<{ count: number }>();

  return { remaining: Math.max(0, subjectLimit - (row?.count ?? 0)), limit: subjectLimit, available: true };
}
