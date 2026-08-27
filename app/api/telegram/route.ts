type TelegramMessage = {
  chat: { id: number };
  text?: string;
  from?: { first_name?: string };
};

type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: { id: string; message?: TelegramMessage };
};

const siteUrl = 'https://saffi277-bot-photo.koorymoe.chatgpt.site';

function getConfig() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN,
    secret: process.env.TELEGRAM_WEBHOOK_SECRET,
    appUrl: process.env.APP_URL || siteUrl,
  };
}

async function telegram(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telegram ${method} failed with ${response.status}`);
}

async function sendWelcome(token: string, appUrl: string, message: TelegramMessage) {
  const firstName = message.from?.first_name ? ` ${message.from.first_name}` : '';
  const startParameter = message.text?.split(' ')[1];
  const referral = startParameter ? `?ref=telegram-${encodeURIComponent(startParameter)}` : '?ref=telegram';
  await telegram(token, 'sendMessage', {
    chat_id: message.chat.id,
    text: `هلا${firstName} 👋\n\nأهلاً بك في bot. هنا تعدّل صورتك بنفسك: إضاءة، ألوان، تباين ووضوح — بدون ذكاء اصطناعي وبدون رفع الصورة إلى خادم.`,
    reply_markup: {
      inline_keyboard: [
        [{ text: 'فتح محرر الصور ✦', web_app: { url: `${appUrl}${referral}` } }],
        [{ text: 'شنو يگدر يسوي؟', callback_data: 'help' }],
      ],
    },
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
    }
    if (update.callback_query?.message) {
      await telegram(token, 'answerCallbackQuery', { callback_query_id: update.callback_query.id });
      await telegram(token, 'sendMessage', {
        chat_id: update.callback_query.message.chat.id,
        text: 'ترفع الصورة، تختار إعداد سريع أو تضبط الأدوات بنفسك، وبعدها تنزّل النتيجة مباشرة. صورتك تبقى داخل متصفحك.',
      });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Unable to process Telegram update.' }, { status: 500 });
  }
}
