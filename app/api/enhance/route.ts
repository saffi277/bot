import { GeminiProvider } from '@/lib/enhance/gemini';
import { EnhanceProvider, ProviderError } from '@/lib/enhance/provider';
import { limits, peek, release, reserve, Subject } from '@/lib/ratelimit';
import { getConfig } from '@/lib/telegram';
import { readCookie, TelegramIdentity } from '@/lib/telegram-auth';
import { record } from '@/lib/usage-log';

/**
 * The restoration endpoint.
 *
 * Order matters: identity, then limits, then the provider. The provider is
 * never reached unless a unit has been reserved, which is what keeps the bill
 * bounded (docs/ARCHITECTURE.md §1.6).
 */

// Matches the ceiling the page and the bot both advertise. It disagreed at 12
// before, so a size the product promised to accept was refused by the server.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

function maxOutputEdge(): number {
  const parsed = Number.parseInt(process.env.MAX_OUTPUT_EDGE ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2048;
}

let provider: EnhanceProvider | null = null;
function getProvider(): EnhanceProvider {
  if (!provider) provider = new GeminiProvider();
  return provider;
}

/**
 * A signed-in visitor is identified by their Telegram id and gets the larger
 * allowance; everyone else is a guest keyed by IP.
 *
 * Cloudflare's header is authoritative in production. x-forwarded-for is
 * accepted only in development because it is otherwise spoofable.
 */
async function identify(request: Request): Promise<{ subject: Subject; identity: TelegramIdentity | null }> {
  const { sessionSecret } = getConfig();
  const identity = sessionSecret ? await readCookie(request, sessionSecret) : null;
  if (identity) return { subject: { kind: 'user', id: identity.id }, identity };

  const cloudflareIp = request.headers.get('cf-connecting-ip')?.trim();
  const localIp = process.env.NODE_ENV === 'production'
    ? undefined
    : request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return { subject: { kind: 'guest', id: cloudflareIp || localIp || 'unknown' }, identity: null };
}

function fail(message: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error: message, ...extra }, { status });
}

/** Status probe: lets the page render an honest state before anyone uploads. */
export async function GET(request: Request) {
  const { subject, identity } = await identify(request);
  const quota = await peek(subject);
  return Response.json({
    // Contract with the front end, fixed in docs/REVIEW.md round 7.
    signedIn: Boolean(identity),
    name: identity?.name,
    ready: getProvider().isConfigured() && quota.available,
    configured: getProvider().isConfigured(),
    storage: quota.available,
    remaining: quota.remaining,
    limit: quota.limit,
    maxOutputEdge: maxOutputEdge(),
    dailyCap: limits().global,
  });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const { subject } = await identify(request);
  const subjectKey = `${subject.kind}:${subject.id}`;
  // B7 — where the visitor came from, so the bot's contribution is measurable.
  const referral = request.headers.get('x-ref')?.slice(0, 60) || undefined;

  const service = getProvider();
  if (!service.isConfigured()) {
    return fail('الخدمة لم تُفعَّل بعد. مفتاح النموذج غير مضبوط.', 503, { code: 'not_configured' });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get('image');
    if (value instanceof File) file = value;
  } catch {
    return fail('تعذّرت قراءة الملف المرسل.', 400, { code: 'bad_request' });
  }

  if (!file) {
    return fail('ما وصلتنا صورة. اختر صورة وحاول مرة ثانية.', 400, { code: 'no_file' });
  }
  if (!ACCEPTED.includes(file.type)) {
    return fail('ندعم صور JPG وPNG وWebP فقط.', 415, { code: 'bad_type' });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail('حجم الصورة كبير. المسموح حتى ١٥ ميغابايت.', 413, { code: 'too_large' });
  }

  // Reserve before any spending can happen.
  const verdict = await reserve(subject);
  if (!verdict.allowed) {
    if (verdict.reason === 'unavailable') {
      return fail('الخدمة تحت الصيانة حالياً. جرّب بعد شوي.', 503, { code: 'storage_unavailable' });
    }
    if (verdict.reason === 'global') {
      return fail('وصلنا الحد اليومي للخدمة. جرّب باچر إن شاء الله.', 429, { code: 'daily_cap' });
    }
    return fail(
      `خلص رصيدك اليوم (${verdict.limit} ${verdict.limit === 1 ? 'صورة' : 'صور'}). يتجدّد باچر.`,
      429,
      { code: 'quota', remaining: 0, limit: verdict.limit },
    );
  }

  try {
    const result = await service.enhance({
      image: await file.arrayBuffer(),
      inputContentType: file.type,
      maxOutputEdge: maxOutputEdge(),
      requestId,
    });

    await record({
      requestId,
      subject: subjectKey,
      status: 'ok',
      model: result.model,
      outputMegapixels: result.outputMegapixels,
      durationMs: result.durationMs,
      referral,
    });

    return new Response(result.image, {
      headers: {
        'content-type': result.contentType,
        'cache-control': 'no-store',
        'x-request-id': requestId,
        'x-duration-ms': String(result.durationMs),
        'x-output-width': String(result.width),
        'x-output-height': String(result.height),
        'x-remaining': String(verdict.remaining),
        'x-daily-limit': String(verdict.limit),
      },
    });
  } catch (error) {
    const isProviderError = error instanceof ProviderError;
    if (isProviderError && error.safeToRelease) await release(subject);
    const detail = error instanceof Error ? error.message : String(error);
    await record({ requestId, subject: subjectKey, status: 'error', detail, referral });

    if (isProviderError && error.code === 'rejected') {
      return fail('ما گدرنا نعالج هذي الصورة. رصيدك ما انخصم.', 422, { code: 'rejected' });
    }
    if (isProviderError && error.code === 'timeout') {
      return fail('المعالجة أخذت وقت أطول من المتوقع. نحتفظ بالحجز حمايةً من تكرار كلفة محتملة.', 504, { code: 'timeout' });
    }
    if (isProviderError && error.code === 'no_image') {
      return fail('النموذج ما رجّع صورة. نحتفظ بالحجز لأن الطلب قد يكون احتُسب.', 502, { code: 'no_image' });
    }

    console.error(`[enhance:${requestId}]`, detail);
    return fail(
      isProviderError && error.safeToRelease
        ? 'صار خلل قبل المعالجة. رصيدك ما انخصم.'
        : 'صار خلل أثناء المعالجة. احتفظنا بالحجز حمايةً من كلفة محتملة.',
      502,
      { code: 'upstream' },
    );
  }
}
