/** Shared Telegram Bot API helpers, extracted from the webhook route. */

const API_BASE = 'https://api.telegram.org/bot';

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
};

export function getConfig(): TelegramConfig {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN,
    secret: process.env.TELEGRAM_WEBHOOK_SECRET,
    appUrl: (process.env.APP_URL || 'https://saffi277-bot-photo.koorymoe.chatgpt.site').replace(/\/$/, ''),
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
