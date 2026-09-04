import { ensureSchema, getStore } from './store';

/**
 * Per-request cost and latency record.
 *
 * Without it the bill is a guess: there is no way to check the per-image cost
 * estimate against reality, and no way to settle whether asynchronous
 * processing is needed — that decision is defined as p95 of durationMs over
 * 20s, or an error rate over 2% (docs/DISCUSSION.md §8.4).
 */

export type UsageRecord = {
  requestId: string;
  subject: string;
  status: 'ok' | 'error';
  model?: string;
  outputMegapixels?: number;
  durationMs?: number;
  detail?: string;
  /** Where the visitor came from, e.g. telegram-promo7. Optional by design:
   *  most visits carry no tag and must not be treated as failures. */
  referral?: string;
};

export async function record(entry: UsageRecord): Promise<void> {
  const store = await getStore();
  if (!store) return;

  try {
    await ensureSchema(store);
    await store.db
      .prepare(
        `INSERT OR REPLACE INTO usage_log
           (request_id, created_at, subject, model, output_megapixels, duration_ms, status, detail, referral)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.requestId,
        new Date().toISOString(),
        entry.subject,
        entry.model ?? null,
        entry.outputMegapixels ?? null,
        entry.durationMs ?? null,
        entry.status,
        entry.detail?.slice(0, 500) ?? null,
        entry.referral ?? null,
      )
      .run();
  } catch {
    // Logging must never take down a request the visitor already paid for in time.
  }
}
