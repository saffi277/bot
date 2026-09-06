import { GeminiProvider } from '@/lib/enhance/gemini';
import { findOperation } from '@/lib/enhance/operations';
import { ProviderError } from '@/lib/enhance/provider';
import { release, reserve } from '@/lib/ratelimit';
import { downloadFile, getConfig, sendPhoto, siteLink, telegram, TelegramMessage, TelegramUpdate } from '@/lib/telegram';
import { record } from '@/lib/usage-log';

/**
 * The bot restores photographs itself, and also opens the site — the visitor
 * picks which after /start. It used to be a guide alone; the owner changed
 * that, and docs/ARCHITECTURE.md §5 was updated to match rather than contradict
 * it.
 *
 * The link is a plain `url` button rather than a `web_app` one on purpose.
 * Every visit ends in saving a file, and downloads inside a Mini App's
 * embedded browser are unreliable across platforms; the external browser
 * costs a little context and gets the photo onto the phone.
 */

/** Longest edge Telegram itself compresses a photo to, near enough. */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Three-step guide, walked with "next" buttons so nothing arrives as a wall of text. */
const GUIDE = [
  {
    title: '١ · ارفع صورتك',
    body: 'افتح الموقع واسحب الصورة، أو الصقها، أو اختَرها من جهازك.\n\nندعم JPG وPNG وWebP وHEIC (صيغة الآيفون) حتى ١٥ ميغابايت.',
    next: 'وبعدين؟ ←',
  },
  {
    title: '٢ · يشتغل عليها تلقائياً',
    body: 'الذكاء الاصطناعي يشدّ ملامح الوجه، يرجّع تفاصيل الجلد والشعر، يشيل التشويش، ويصلّح الألوان الباهتة.\n\nبلا أدوات ولا ضبط يدوي — تأخذ عادةً بين ٥ و٢٠ ثانية.',
    next: 'وبعدها؟ ←',
  },
  {
    title: '٣ · قارن ونزّل',
    body: 'اسحب المقبض بين الصورتين تشوف الفرق بعينك، وبعدها نزّل النتيجة.\n\nملاحظة: صفّي يرمّم الموجود بالصورة ويحافظ على ملامح الشخص — ما يخترع أشياء ناقصة.',
    next: null,
  },
];

/**
 * `next` is the step this keyboard advances TO, so the welcome can point at
 * step 0 and the guide steps at the one after them.
 *
 * The start parameter rides along in callback_data: without it the referral
 * tag is lost the moment the visitor taps anything, and every conversion after
 * the first message is attributed to nobody. Telegram caps callback_data at 64
 * bytes, hence the trim.
 */
function guideKeyboard(next: number | null, appUrl: string, startParameter?: string) {
  const rows: Array<Array<Record<string, unknown>>> = [];
  const tag = startParameter ? `:${startParameter.slice(0, 40)}` : '';
  if (next !== null && GUIDE[next]) {
    const label = next === 0 ? 'وريني شلون ←' : (GUIDE[next - 1]?.next as string);
    rows.push([{ text: label, callback_data: `guide:${next}${tag}` }]);
  }
  rows.push([{ text: 'افتح صفّي ✦', url: siteLink(appUrl, startParameter) }]);
  return { inline_keyboard: rows };
}

async function sendStep(token: string, appUrl: string, chatId: number, step: number, startParameter?: string) {
  const entry = GUIDE[step];
  if (!entry) return;
  await telegram(token, 'sendMessage', {
    chat_id: chatId,
    text: `*${entry.title}*\n\n${entry.body}`,
    parse_mode: 'Markdown',
    reply_markup: guideKeyboard(entry.next ? step + 1 : null, appUrl, startParameter),
  });
}

/**
 * The first thing after /start: where does this person want to work? Both
 * answers are real products, so neither is buried behind the other.
 */
async function sendWelcome(token: string, appUrl: string, message: TelegramMessage) {
  const firstName = message.from?.first_name ? ` ${message.from.first_name}` : '';
  const startParameter = message.text?.split(' ')[1];
  const tag = startParameter ? `:${startParameter.slice(0, 40)}` : '';

  await telegram(token, 'sendMessage', {
    chat_id: message.chat.id,
    text:
      `هلا${firstName} 👋\n\n` +
      'أهلاً بك في *صفّي* — ترميم وتحسين الصور بالذكاء الاصطناعي.\n\n' +
      'صورة قديمة؟ مشوّشة؟ ألوانها باهتة؟ ترجعلك أوضح.\n\n' +
      '*وين تحب تسوي صورك؟*',
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'هنا بالبوت 🤖', callback_data: `here${tag}` }],
        [{ text: 'بالموقع ✦', url: siteLink(appUrl, startParameter) }],
        [{ text: 'شلون يشتغل؟', callback_data: `guide:0${tag}` }],
      ],
    },
  });
}

/** Asks for the photo, and says the one thing that changes the bill. */
async function askForPhoto(token: string, chatId: number) {
  await telegram(token, 'sendMessage', {
    chat_id: chatId,
    text:
      '*دزّ الصورة* 📸\n\n' +
      'أرسلها **كصورة** لا كملف، وأنا أرمّمها وأرجّعها لك.\n\n' +
      'تأخذ شوية — لا تعيد الإرسال، أنا شغّال عليها.',
    parse_mode: 'Markdown',
  });
}

let provider: GeminiProvider | null = null;
function getProvider(): GeminiProvider {
  if (!provider) provider = new GeminiProvider();
  return provider;
}

function maxOutputEdge(): number {
  const parsed = Number.parseInt(process.env.MAX_OUTPUT_EDGE ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2048;
}

/**
 * Restores one photo and sends it back.
 *
 * Every guard the website relies on is reused rather than reimplemented: the
 * same operation, the same reserve() before any spending, the same release()
 * when the provider rejects before doing work. A second copy of these rules
 * would be a second place for them to drift, and the one that drifts is the
 * one that spends money.
 *
 * The Telegram user id is the subject, so a person gets the signed-in
 * allowance — they are identified here, unlike an anonymous site visitor.
 */
async function restorePhoto(token: string, chatId: number, fileId: string, userId: number) {
  const operation = findOperation(null);
  if (!operation) return;

  const service = getProvider();
  if (!service.isConfigured()) {
    await telegram(token, 'sendMessage', {
      chat_id: chatId,
      text: 'الترميم لسه ما انفعّل. جرّب بعدين — أو افتح الموقع من /start.',
    });
    return;
  }

  const subject = { kind: 'user' as const, id: String(userId) };
  const verdict = await reserve(subject, operation.units);
  if (!verdict.allowed) {
    const text =
      verdict.reason === 'unavailable'
        ? 'الخدمة تحت الصيانة حالياً. جرّب بعد شوي.'
        : verdict.reason === 'global'
          ? 'وصلنا الحد اليومي للخدمة. جرّب باچر إن شاء الله.'
          // Arabic-Indic, like the rest of the bot's copy: a Latin numeral
          // inside an Arabic sentence is the reordering bug that has already
          // cost this project six fixes.
          : `خلص رصيدك اليوم (${String(verdict.limit).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)])} صور). يتجدّد باچر.`;
    await telegram(token, 'sendMessage', { chat_id: chatId, text });
    return;
  }

  const requestId = crypto.randomUUID();
  const subjectKey = `user:${userId}`;

  try {
    const { bytes, contentType } = await downloadFile(token, fileId);
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      await release(subject, operation.units);
      await telegram(token, 'sendMessage', { chat_id: chatId, text: 'الصورة كبيرة. المسموح حتى ١٥ ميغابايت.' });
      return;
    }

    const result = await service.enhance({
      image: bytes,
      inputContentType: contentType,
      maxOutputEdge: maxOutputEdge(),
      prompt: operation.prompt,
      requestId,
    });

    await sendPhoto(token, chatId, result.image, result.contentType, 'تفضّل — صورتك بعد الترميم ✦');
    await record({
      requestId,
      subject: subjectKey,
      status: 'ok',
      model: result.model,
      outputMegapixels: result.outputMegapixels,
      durationMs: result.durationMs,
      referral: 'telegram-bot',
    });
  } catch (error) {
    // Refund only when the provider says it rejected before doing work; a
    // timeout may still have been billed, so the slot is held.
    if (error instanceof ProviderError && error.safeToRelease) await release(subject, operation.units);
    const detail = error instanceof Error ? error.message : String(error);
    await record({ requestId, subject: subjectKey, status: 'error', detail, referral: 'telegram-bot' });

    const text =
      error instanceof ProviderError && error.code === 'rejected'
        ? 'ما گدرنا نعالج هذي الصورة. رصيدك ما انخصم — جرّب صورة ثانية.'
        : 'صار خلل أثناء المعالجة. جرّب مرة ثانية بعد شوي.';
    await telegram(token, 'sendMessage', { chat_id: chatId, text }).catch(() => undefined);
  }
}

/**
 * Runs work after the webhook has already answered.
 *
 * Restoration takes far longer than Telegram waits, and a late reply makes it
 * redeliver the same update — a second charge for one photo. So the update is
 * acknowledged first and the work continues here.
 */
async function runAfterResponse(work: Promise<unknown>): Promise<void> {
  try {
    const workers = (await import(/* @vite-ignore */ 'cloudflare:workers')) as {
      waitUntil?: (promise: Promise<unknown>) => void;
    };
    if (typeof workers.waitUntil === 'function') {
      workers.waitUntil(work);
      return;
    }
  } catch {
    // Not inside the Workers runtime; fall through and await instead.
  }
  await work;
}

/**
 * Compares in time that does not depend on where the first difference is.
 * `!==` returns as soon as two bytes differ, which leaks the matching prefix
 * length to anyone who can measure replies. Impractical over the internet, but
 * the correct comparison costs nothing and the token it guards controls the bot.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET() {
  const { token, botUsername } = getConfig();
  return Response.json({
    status: token ? 'ready' : 'needs_configuration',
    // The page renders the sign-in widget only when this is set, so an
    // unconfigured bot degrades to guest mode instead of a broken button.
    botUsername: botUsername ?? null,
  });
}

export async function POST(request: Request) {
  const { token, secret, appUrl } = getConfig();
  if (!token) return Response.json({ error: 'Telegram bot is not configured yet.' }, { status: 503 });

  // A missing secret is an unconfigured bot, not an open door: without this
  // the check below was skipped entirely and anyone who learned the URL could
  // drive the bot. Fail closed, like every other gate here (CLAUDE.md §6).
  if (!secret) return Response.json({ error: 'Telegram bot is not configured yet.' }, { status: 503 });
  if (!constantTimeEqual(request.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) {
    return Response.json({ error: 'Unauthorized webhook request.' }, { status: 401 });
  }

  try {
    const update = (await request.json()) as TelegramUpdate;

    const message = update.message;

    if (message?.text?.startsWith('/start')) {
      await sendWelcome(token, appUrl, message);
    } else if (message?.text?.startsWith('/help')) {
      await sendStep(token, appUrl, message.chat.id, 0);
    }

    // A photo is the request itself. Telegram sends every size it made; the
    // last is the largest, and its own compression already caps it near
    // 1280px — which is why no downscale is needed on this path.
    if (message?.photo?.length && message.from?.id) {
      const largest = message.photo[message.photo.length - 1];
      await telegram(token, 'sendMessage', { chat_id: message.chat.id, text: 'وصلت ✦ أشتغل عليها…' });
      await runAfterResponse(restorePhoto(token, message.chat.id, largest.file_id, message.from.id));
      return Response.json({ ok: true });
    }

    // A photo sent as a file arrives uncompressed, so a 12MP phone original
    // would reach the provider at roughly fifteen times the cost of the
    // compressed one. Refusing is cheaper than charging for that.
    if (message?.document) {
      await telegram(token, 'sendMessage', {
        chat_id: message.chat.id,
        text: 'أرسلها **كصورة** لا كملف — بهذي الطريقة تطلع أسرع وأرخص. جرّب مرة ثانية 📸',
        parse_mode: 'Markdown',
      });
    }

    if (update.callback_query) {
      const query = update.callback_query;
      await telegram(token, 'answerCallbackQuery', { callback_query_id: query.id });
      const [kind, rawStep, startParameter] = query.data?.split(':') ?? [];

      if (kind === 'here' && query.message) {
        await askForPhoto(token, query.message.chat.id);
      } else if (kind === 'guide' && query.message) {
        const step = Number.parseInt(rawStep ?? '', 10);
        if (Number.isInteger(step)) {
          await sendStep(token, appUrl, query.message.chat.id, step, startParameter || undefined);
        }
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    // Telegram redelivers an update we answer with 5xx, so a half-sent guide
    // arrives twice. Redelivery cannot fix a failed sendMessage, so the update
    // is acknowledged and the failure is left in the logs instead.
    console.error('Telegram update failed', error);
    return Response.json({ ok: true, handled: false });
  }
}
