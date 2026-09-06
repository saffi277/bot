/** Shared Telegram Bot API helpers, extracted from the webhook route. */

/** Overridable so the bot's flow can be walked end to end against a stub. */
const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org/bot';

/** One of the sizes Telegram generates for an uploaded photo. */
export type TelegramPhotoSize = {
  file_id: string;
  width: number;
  height: number;
};

export type TelegramMessage = {
  message_id?: number;
  chat: { id: number };
  text?: string;
  from?: { id?: number; first_name?: string };
  /** Present when sent as a photo. Ascending sizes; the last is the largest. */
  photo?: TelegramPhotoSize[];
  /** Present when sent as a file, which skips Telegram's compression. */
  document?: { file_id: string; mime_type?: string; file_size?: number };
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
  /**
   * Signs our own session cookie. Deliberately not the bot token: rotating the
   * token would otherwise sign every visitor out, and one key should not serve
   * two unrelated purposes. Unset means sign-in stays off and the site runs in
   * guest mode, which is a supported state.
   */
  sessionSecret: string | undefined;
};

export function getConfig(): TelegramConfig {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN,
    secret: process.env.TELEGRAM_WEBHOOK_SECRET,
    appUrl: (process.env.APP_URL || 'https://saffi277-bot-photo.koorymoe.chatgpt.site').replace(/\/$/, ''),
    botUsername: process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, ''),
    sessionSecret: process.env.TELEGRAM_SESSION_SECRET || undefined,
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

/**
 * Why a download can fail in a way worth telling the visitor about.
 *
 * `too_large` is the only one the person can act on — everything else is ours
 * to apologise for — so it is separated rather than folded into a generic
 * Error the caller would have to match on message text.
 */
export class TelegramFileError extends Error {
  constructor(
    readonly code: 'too_large' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'TelegramFileError';
  }
}

/**
 * Downloads a file the visitor sent. Telegram keeps files on a second host,
 * reachable only after getFile resolves the path.
 *
 * Note the size: Telegram compresses anything sent as a photo to roughly
 * 1280px, which lands under MAX_OUTPUT_EDGE on its own. That is what replaces
 * the browser's canvas downscale on this path — there is no canvas in a
 * Worker, and sending a phone original straight to the provider would multiply
 * the bill about fifteen times.
 *
 * `maxBytes` is checked against the size Telegram reports *before* any bytes
 * are pulled. The size was previously read only after the whole file had been
 * buffered, which meant a file we were always going to refuse was still
 * downloaded in full into a Worker whose memory is shared with the image about
 * to be sent to the provider. Refusing first costs nothing and cannot run the
 * runtime out of memory.
 */
export async function downloadFile(
  token: string,
  fileId: string,
  maxBytes = Infinity,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const lookup = await fetch(`${API_BASE}${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const payload = (await lookup.json()) as {
    ok: boolean;
    result?: { file_path?: string; file_size?: number };
    description?: string;
  };
  if (!payload.ok || !payload.result?.file_path) {
    throw new TelegramFileError('unavailable', `getFile failed: ${payload.description ?? lookup.status}`);
  }

  const declared = payload.result.file_size;
  if (typeof declared === 'number' && declared > maxBytes) {
    throw new TelegramFileError('too_large', `file is ${declared} bytes, over the ${maxBytes} limit`);
  }

  // The file host mirrors whatever API_BASE points at, so a stubbed base in
  // tests serves the download too.
  const base = API_BASE.replace(/\/bot$/, '/file/bot');
  const file = await fetch(`${base}${token}/${payload.result.file_path}`);
  if (!file.ok) throw new TelegramFileError('unavailable', `file download failed with ${file.status}`);

  // getFile can omit file_size. The response header is the second chance to
  // refuse before buffering, so an unreported size is not an unbounded read.
  const announced = Number.parseInt(file.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(announced) && announced > maxBytes) {
    throw new TelegramFileError('too_large', `file is ${announced} bytes, over the ${maxBytes} limit`);
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    throw new TelegramFileError('too_large', `file is ${bytes.byteLength} bytes, over the ${maxBytes} limit`);
  }

  return {
    bytes,
    contentType: file.headers.get('content-type') || 'image/jpeg',
  };
}

/**
 * Sends an image back. This cannot go through `telegram()` above, which pins
 * a JSON content type; uploading bytes needs multipart.
 */
export async function sendPhoto(
  token: string,
  chatId: number,
  image: ArrayBuffer,
  contentType: string,
  caption?: string,
): Promise<void> {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('photo', new Blob([image], { type: contentType }), 'saffi.jpg');

  const response = await fetch(`${API_BASE}${token}/sendPhoto`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Telegram sendPhoto failed with ${response.status}`);
}
