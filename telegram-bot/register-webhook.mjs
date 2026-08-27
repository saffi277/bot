const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.APP_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !appUrl || !secret) {
  throw new Error('Set TELEGRAM_BOT_TOKEN, APP_URL, and TELEGRAM_WEBHOOK_SECRET first.');
}

const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/telegram`;
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: webhookUrl, secret_token: secret, allowed_updates: ['message', 'callback_query'] }),
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(`Webhook registration failed: ${JSON.stringify(result)}`);

await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ commands: [{ command: 'start', description: 'فتح محرر الصور' }] }),
});

console.log(`Telegram webhook is ready at ${webhookUrl}`);
