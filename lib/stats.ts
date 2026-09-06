import { ensureSchema, getStore } from './store';

/**
 * Reads back what the usage log has been recording all along.
 *
 * Every restoration already writes its status, duration, output size and
 * referral, and until now nothing could read any of it. The owner is spending
 * real money on a product with no revenue yet, and had no way to see how much,
 * on how many photographs, how often it failed, or whether the bot was
 * bringing anyone — the answers were all sitting in the table unasked.
 */

export type Window = { days: number; label: string };

export type Stats = {
  generatedAt: string;
  windows: Array<{
    label: string;
    days: number;
    total: number;
    ok: number;
    failed: number;
    /** Share of attempts that produced a photograph, as a percentage. */
    successRate: number;
    estimatedCostUsd: number;
    medianSeconds: number | null;
    /** The number the async-processing decision hangs on. */
    p95Seconds: number | null;
    /** Where the visitors came from, biggest first. */
    referrals: Array<{ source: string; count: number }>;
    /** Distinct callers, so repeat use is visible against reach. */
    visitors: number;
  }>;
};

/**
 * Per-image prices for the model in use, by output tier (docs/DISCUSSION.md
 * §10.2). Providers bill per produced image at a tier, not per megapixel, so
 * the recorded output size picks the tier rather than scaling a rate.
 */
const TIER_PRICES: Array<{ maxMegapixels: number; usd: number }> = [
  { maxMegapixels: 1.4, usd: 0.067 },
  { maxMegapixels: 4.5, usd: 0.101 },
  { maxMegapixels: Infinity, usd: 0.15 },
];

function priceFor(megapixels: number | null): number {
  const mp = megapixels ?? 3.15;
  return TIER_PRICES.find((tier) => mp <= tier.maxMegapixels)?.usd ?? 0.101;
}

function percentile(sorted: number[], fraction: number): number | null {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

type Row = {
  status: string;
  duration_ms: number | null;
  output_megapixels: number | null;
  referral: string | null;
  subject: string;
};

export const DEFAULT_WINDOWS: Window[] = [
  { days: 1, label: 'today' },
  { days: 7, label: 'last 7 days' },
  { days: 30, label: 'last 30 days' },
];

/** Returns null when the store is absent, so callers can say so plainly. */
export async function collectStats(windows: Window[] = DEFAULT_WINDOWS): Promise<Stats | null> {
  const store = await getStore();
  if (!store) return null;

  await ensureSchema(store);
  const now = Date.now();

  const results = await Promise.all(
    windows.map(async ({ days, label }) => {
      const since = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
      const query = await store.db
        .prepare(
          `SELECT status, duration_ms, output_megapixels, referral, subject
             FROM usage_log WHERE created_at >= ?`,
        )
        .bind(since)
        .all<Row>();

      const rows = query.results ?? [];
      const ok = rows.filter((row) => row.status === 'ok');
      const durations = ok
        .map((row) => row.duration_ms)
        .filter((ms): ms is number => typeof ms === 'number' && ms > 0)
        .sort((a, b) => a - b);

      const byReferral = new Map<string, number>();
      for (const row of rows) {
        // Anything without a tag came straight to the site.
        const source = row.referral?.trim() || 'direct';
        byReferral.set(source, (byReferral.get(source) ?? 0) + 1);
      }

      const seconds = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);

      return {
        label,
        days,
        total: rows.length,
        ok: ok.length,
        failed: rows.length - ok.length,
        successRate: rows.length ? Math.round((ok.length / rows.length) * 1000) / 10 : 0,
        // Only successful calls are billed, so failures are excluded.
        estimatedCostUsd: Math.round(ok.reduce((sum, row) => sum + priceFor(row.output_megapixels), 0) * 100) / 100,
        medianSeconds: seconds(percentile(durations, 0.5)),
        p95Seconds: seconds(percentile(durations, 0.95)),
        referrals: [...byReferral.entries()]
          .map(([source, count]) => ({ source, count }))
          .sort((a, b) => b.count - a.count),
        visitors: new Set(rows.map((row) => row.subject)).size,
      };
    }),
  );

  return { generatedAt: new Date(now).toISOString(), windows: results };
}
