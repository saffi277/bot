/** Shared Telegram Bot API helpers, extracted from the webhook route. */

/** Overridable so the bot's flow can be walked end to end against a stub. */
const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org/bot';

export type TelegramMessage = {
  message_id?: number;
  chat: { id: number };
  text?: string;
  from?: { first_name?: string };
};

export type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: { id: string; data?: string; message?: TelegramMessage };
};

export type TelegramConfig = {
  token: string | undefined;
  secret: string | undefined;
  appUrl: string;
  /** Public bot handle, needed by the Telegram Login widget on the page. */
  botUsername: string | undefined;
};

export function getConfig(): TelegramConfig {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN,
    secret: process.env.TELEGRAM_WEBHOOK_SECRET,
    appUrl: (process.env.APP_URL || 'https://saffi277-bot-photo.koorymoe.chatgpt.site').replace(/\/$/, ''),
    botUsername: process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, ''),
  };
}

export async function telegram(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`${API_BASE}${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Telegram ${method} failed with ${response.status}`);
  }
}

/** Builds the site link carrying the referral tag, so the bot's contribution is measurable. */
export function siteLink(appUrl: string, startParameter?: string): string {
  const source = startParameter ? `telegram-${encodeURIComponent(startParameter)}` : 'telegram';
  return `${appUrl}/?ref=${source}`;
}
