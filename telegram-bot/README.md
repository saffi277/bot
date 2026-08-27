# Telegram entry point

The Telegram webhook is now part of the website at `/api/telegram`. `/start` gives users a short introduction, a button that opens the web app, and a concise explanation of the service.

Before running it, set:

```bash
export TELEGRAM_BOT_TOKEN="token-from-BotFather"
export APP_URL="https://your-app-url.example"
export TELEGRAM_WEBHOOK_SECRET="a-long-random-secret"
```

Register the webhook with `node telegram-bot/register-webhook.mjs` after the website is live. The first version intentionally does not process images in Telegram; the website is the primary product experience.
