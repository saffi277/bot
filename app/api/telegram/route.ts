import { getConfig, siteLink, telegram, TelegramMessage, TelegramUpdate } from '@/lib/telegram';

/**
 * The bot is an acquisition channel, not the product: it explains the service
 * once and hands the visitor to the site. It never receives or processes
 * images (docs/ARCHITECTURE.md §1.1).
 *
 * The link is a plain `url` button rather than a `web_app` one on purpose.
 * Every visit ends in saving a file, and downloads inside a Mini App's
 * embedded browser are unreliable across platforms; the external browser
 * costs a little context and gets the photo onto the phone.
 */

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

async function sendWelcome(token: string, appUrl: string, message: TelegramMessage) {
  const firstName = message.from?.first_name ? ` ${message.from.first_name}` : '';
  const startParameter = message.text?.split(' ')[1];
  await telegram(token, 'sendMessage', {
    chat_id: message.chat.id,
    text:
      `هلا${firstName} 👋\n\n` +
      'أهلاً بك في *صفّي* — ترميم وتحسين الصور بالذكاء الاصطناعي.\n\n' +
      'صورة قديمة؟ مشوّشة؟ ألوانها باهتة؟ ارفعها وتطلع أوضح بضغطة وحدة.\n\n' +
      'خلّي أوريك شلون بثلاث خطوات 👇',
    parse_mode: 'Markdown',
    reply_markup: guideKeyboard(0, appUrl, startParameter),
  });
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
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return Response.json({ error: 'Unauthorized webhook request.' }, { status: 401 });
  }

  try {
    const update = (await request.json()) as TelegramUpdate;

    if (update.message?.text?.startsWith('/start')) {
      await sendWelcome(token, appUrl, update.message);
    } else if (update.message?.text?.startsWith('/help')) {
      await sendStep(token, appUrl, update.message.chat.id, 0);
    }

    if (update.callback_query) {
      const query = update.callback_query;
      await telegram(token, 'answerCallbackQuery', { callback_query_id: query.id });
      const [, rawStep, startParameter] = query.data?.split(':') ?? [];
      const step = Number.parseInt(rawStep ?? '', 10);
      if (query.message && Number.isInteger(step)) {
        await sendStep(token, appUrl, query.message.chat.id, step, startParameter || undefined);
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
