/**
 * D1 access for the daily counters and the usage log.
 *
 * Only counters and metadata live here — never images (docs/ARCHITECTURE.md §2).
 *
 * The binding is resolved lazily through `cloudflare:workers`, which only
 * exists inside the Workers runtime, so the import is dynamic and failure is
 * reported rather than thrown. Callers decide what to do when the store is
 * absent; the enhance route fails closed, because a spend limiter that cannot
 * count must not let spending through.
 */

export type Store = {
  db: D1Database;
};

let cached: Store | null | undefined;
let schemaReady = false;

async function resolveBinding(): Promise<D1Database | null> {
  const name = process.env.D1_BINDING || 'DB';
  try {
    const workers = (await import(/* @vite-ignore */ 'cloudflare:workers')) as {
      env?: Record<string, unknown>;
    };
    const binding = workers.env?.[name];
    return binding && typeof (binding as D1Database).prepare === 'function' ? (binding as D1Database) : null;
  } catch {
    return null;
  }
}

/** Returns the store, or null when D1 is not provisioned for this deployment. */
export async function getStore(): Promise<Store | null> {
  if (cached !== undefined) return cached;
  const db = await resolveBinding();
  cached = db ? { db } : null;
  return cached;
}

/** Creates the tables on first use, so no separate migration step is needed. */
export async function ensureSchema(store: Store): Promise<void> {
  if (schemaReady) return;
  await store.db.batch([
    store.db.prepare(
      `CREATE TABLE IF NOT EXISTS usage_counters (
         scope TEXT NOT NULL,
         day   TEXT NOT NULL,
         count INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (scope, day)
       )`,
    ),
    store.db.prepare(
      `CREATE TABLE IF NOT EXISTS usage_log (
         request_id        TEXT PRIMARY KEY,
         created_at        TEXT NOT NULL,
         subject           TEXT NOT NULL,
         model             TEXT,
         output_megapixels REAL,
         duration_ms       INTEGER,
         status            TEXT NOT NULL,
         detail            TEXT
       )`,
    ),
    store.db.prepare(`CREATE INDEX IF NOT EXISTS usage_log_created_at ON usage_log (created_at)`),
  ]);
  schemaReady = true;
}

/** UTC day key. Counters reset at midnight UTC. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
