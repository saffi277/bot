import { ensureSchema, getStore, today, type Store } from './store';

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
    global: readLimit('DAILY_GLOBAL_CAP', 16),
  };
}

function scopeKey(subject: Subject): string {
  return `${subject.kind}:${subject.id}`;
}

/** Claims one slot in a single SQL statement. This prevents two concurrent
 * requests from both observing the final available slot. */
async function claim(store: Store, scope: string, day: string, limit: number): Promise<boolean> {
  if (limit <= 0) return false;
  const result = await store.db
    .prepare(
      `INSERT INTO usage_counters (scope, day, count)
       SELECT ?, ?, 1 WHERE ? > 0
       ON CONFLICT(scope, day) DO UPDATE SET count = count + 1 WHERE count < ?`,
    )
    .bind(scope, day, limit, limit)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

async function unclaim(store: Store, scope: string, day: string): Promise<void> {
  await store.db
    .prepare('UPDATE usage_counters SET count = count - 1 WHERE scope = ? AND day = ? AND count > 0')
    .bind(scope, day)
    .run();
}

/** Reserves the global budget and the caller quota before any provider call. */
export async function reserve(subject: Subject): Promise<LimitVerdict> {
  const { guest, user, global } = limits();
  const subjectLimit = subject.kind === 'user' ? user : guest;

  const store = await getStore();
  if (!store) {
    // Fail closed: without durable counters there is no ceiling on spending.
    return { allowed: false, reason: 'unavailable', remaining: 0, limit: subjectLimit };
  }

  try {
    await ensureSchema(store);
    const day = today();
    if (!(await claim(store, 'global', day, global))) {
      return { allowed: false, reason: 'global', remaining: 0, limit: subjectLimit };
    }
    if (!(await claim(store, scopeKey(subject), day, subjectLimit))) {
      // No model request happened; compensate the global reservation. A D1
      // failure is intentionally conservative and holds the slot.
      await unclaim(store, 'global', day).catch(() => undefined);
      return { allowed: false, reason: 'subject', remaining: 0, limit: subjectLimit };
    }
    return {
      allowed: true,
      remaining: await remainingFor(store, scopeKey(subject), day, subjectLimit),
      limit: subjectLimit,
    };
  } catch {
    return { allowed: false, reason: 'unavailable', remaining: 0, limit: subjectLimit };
  }
}

/** Call this only when the provider confirms it rejected the request before work. */
export async function release(subject: Subject): Promise<void> {
  const store = await getStore();
  if (!store) return;
  try {
    await ensureSchema(store);
    const day = today();
    await unclaim(store, scopeKey(subject), day);
    await unclaim(store, 'global', day);
  } catch {
    // Holding an extra slot is safer than allowing uncapped model spending.
  }
}

/** Read-only view for the UI, so the visitor always sees what is left. */
export async function peek(subject: Subject): Promise<{ remaining: number; limit: number; available: boolean }> {
  const { guest, user } = limits();
  const subjectLimit = subject.kind === 'user' ? user : guest;

  const store = await getStore();
  if (!store) return { remaining: 0, limit: subjectLimit, available: false };

  try {
    await ensureSchema(store);
    return { remaining: await remainingFor(store, scopeKey(subject), today(), subjectLimit), limit: subjectLimit, available: true };
  } catch {
    return { remaining: 0, limit: subjectLimit, available: false };
  }
}

async function remainingFor(store: Store, scope: string, day: string, limit: number): Promise<number> {
  const row = await store.db
    .prepare('SELECT count FROM usage_counters WHERE scope = ? AND day = ?')
    .bind(scope, day)
    .first<{ count: number }>();
  return Math.max(0, limit - (row?.count ?? 0));
}
