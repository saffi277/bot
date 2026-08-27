# Telegram entry point

This service makes the Telegram bot a simple acquisition channel: `/start` gives users a short introduction and a button that opens the web app.

Before running it, set:

```bash
export TELEGRAM_BOT_TOKEN="token-from-BotFather"
export APP_URL="https://your-app-url.example"
```

The first version intentionally does not process images in Telegram; the website is the primary product experience.
