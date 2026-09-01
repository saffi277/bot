# صفّي — bot

AI photo restoration. A website that restores and enhances photographs, and a
Telegram bot that introduces the service and sends people to it.

## How the pieces fit

- **`app/`** — the website. **This is the product.** Upload a photo, it is
  restored automatically, compare before and after, download.
- **`app/api/enhance/`** — the restoration endpoint.
- **`app/api/telegram/`** — the bot webhook. It shows a three-step guide and
  links to the site. **It does not process images.**
- **`lib/`** — the provider port, the daily limits, and the usage log.
- **`docs/`** — decisions and why they were made. Read these before changing
  anything: `DISCUSSION.md`, `ARCHITECTURE.md`, `REVIEW.md`.

## Running it

```bash
npm install
npm run dev     # vinext dev
npm run build   # vinext build
npm run lint    # eslint
```

Copy `.env.example` and fill it in. The site runs without a model key — it
reports that it is not configured rather than failing — so the interface, the
limits and the bot can all be exercised before the key exists.

## Two things bound the bill

Both are environment variables, tunable without a redeploy:

- **`MAX_OUTPUT_EDGE`** — images are downscaled in the browser before upload.
  Providers bill on output megapixels, so an uncapped phone photo costs roughly
  fifteen times a capped one.
- **`DAILY_GLOBAL_CAP`** — a ceiling across all visitors, above the per-visitor
  limits. Per-user limits alone do not bound the bill; this is what fixes the
  monthly maximum.

Counters live in D1. If that binding is missing the service refuses to process
rather than spending without a ceiling.
