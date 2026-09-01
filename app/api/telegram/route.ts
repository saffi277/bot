import { getConfig, siteLink, telegram, TelegramMessage, TelegramUpdate } from '@/lib/telegram';

/**
 * The bot is an acquisition channel, not the product: it explains the service
 * once and hands the visitor to the site. It never receives or processes
 * images (docs/ARCHITECTURE.md §1.1).
 */

/** Three-step guide, walked with "next" buttons so nothing arrives as a wall of text. */
const GUIDE = [
  {
    title: '١ · ارفع صورتك',
    body: 'افتح الموقع واسحب الصورة، أو الصقها، أو اختَرها من جهازك.\n\nندعم JPG وPNG وWebP حتى 15 ميغابايت.',
    next: 'وبعدين؟ ←',
  },
  {
    title: '٢ · يشتغل عليها تلقائياً',
    body: 'الذكاء الاصطناعي يشدّ ملامح الوجه، يرجّع تفاصيل الجلد والشعر، يشيل التشويش، ويصلّح الألوان الباهتة.\n\nبلا أدوات ولا ضبط يدوي — تأخذ عادةً بين 5 و20 ثانية.',
    next: 'وبعدها؟ ←',
  },
  {
    title: '٣ · قارن ونزّل',
    body: 'اسحب المقبض بين الصورتين تشوف الفرق بعينك، وبعدها نزّل النتيجة.\n\nملاحظة: صفّي يرمّم الموجود بالصورة ويحافظ على ملامح الشخص — ما يخترع أشياء ناقصة.',
    next: null,
  },
];

function guideKeyboard(step: number, appUrl: string, startParameter?: string) {
  const rows: Array<Array<Record<string, unknown>>> = [];
  if (GUIDE[step]?.next) {
    rows.push([{ text: GUIDE[step].next as string, callback_data: `guide:${step + 1}` }]);
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
    reply_markup: guideKeyboard(step, appUrl, startParameter),
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
  const { token } = getConfig();
  return Response.json({ status: token ? 'ready' : 'needs_configuration' });
}

export async function POST(request: Request) {
  const { token, secret, appUrl } = getConfig();
  if (!token) return Response.json({ error: 'Telegram bot is not configured yet.' }, { status: 503 });
  if (secret && request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
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
      const step = Number.parseInt(query.data?.split(':')[1] ?? '', 10);
      if (query.message && Number.isInteger(step)) {
        await sendStep(token, appUrl, query.message.chat.id, step);
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Unable to process Telegram update.' }, { status: 500 });
  }
}
