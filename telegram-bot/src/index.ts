/** Telegram entry point for Bot. Run separately after adding the two environment variables. */
type TelegramUpdate = { update_id: number; message?: { chat: { id: number }; text?: string; from?: { first_name?: string } } };

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.APP_URL;
if (!token || !appUrl) throw new Error('Set TELEGRAM_BOT_TOKEN and APP_URL before starting the Telegram bot.');
const api = `https://api.telegram.org/bot${token}`;

async function telegram(method: string, body: Record<string, unknown>) {
  const response = await fetch(`${api}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Telegram API ${method} failed: ${response.status}`);
}

async function handleUpdate(update: TelegramUpdate) {
  const message = update.message;
  if (!message?.text || !message.text.startsWith('/start')) return;
  const firstName = message.from?.first_name ? ` ${message.from.first_name}` : '';
  await telegram('sendMessage', {
    chat_id: message.chat.id,
    text: `هلا${firstName} 👋\n\nBot يساعدك تنظّف وتحسّن صورك بدون ذكاء اصطناعي. افتح النظام وارفع صورتك، ثم عدّل الإضاءة والألوان والوضوح بنفسك.`,
    reply_markup: { inline_keyboard: [[{ text: 'فتح نظام الصور ✦', web_app: { url: appUrl } }]] },
  });
}

async function poll(offset = 0): Promise<never> {
  const response = await fetch(`${api}/getUpdates?timeout=25&offset=${offset}`);
  const payload = (await response.json()) as { result: TelegramUpdate[] };
  for (const update of payload.result) { await handleUpdate(update); offset = update.update_id + 1; }
  return poll(offset);
}

void poll();
