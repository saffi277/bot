# bot

Image enhancement system with a Telegram bot as the entry point.

## Project structure

- `app/` — the primary web application and browser-based, non-AI image processor.
- `app/telegram-bot/` — the Telegram `/start` entry point that opens the web application.

The first release keeps images in the visitor's browser: it does not upload, store, or send them to a server.
