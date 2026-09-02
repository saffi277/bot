/**
 * Runs a folder of photographs through the live restoration endpoint and
 * writes one page holding every before/after comparison.
 *
 * The project rests on a question no test can answer: does the result reach
 * the quality bar the owner has in mind? That is decided by eye, on
 * photographs the owner recognises. This turns that judgement from an hour of
 * uploading files one at a time into opening a single file.
 *
 *   node scripts/quality-report.mjs ./test-images
 *   node scripts/quality-report.mjs ./test-images --url http://localhost:3000
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const IMAGE_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif',
};

// Standard-tier prices per output image, for the estimate in the summary.
const PRICE_BY_MEGAPIXEL = { '1K': 0.067, '2K': 0.101, '4K': 0.151 };

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

function priceFor(megapixels) {
  if (megapixels <= 1.3) return PRICE_BY_MEGAPIXEL['1K'];
  if (megapixels <= 4.5) return PRICE_BY_MEGAPIXEL['2K'];
  return PRICE_BY_MEGAPIXEL['4K'];
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const folder = resolve(process.argv[2] ?? './test-images');
const base = (argValue('url', 'http://localhost:3000')).replace(/\/$/, '');

let names;
try {
  names = (await readdir(folder)).filter((name) => extname(name).toLowerCase() in IMAGE_TYPES).sort();
} catch {
  console.error(`لم أقدر أقرأ المجلد: ${folder}`);
  process.exit(1);
}
if (!names.length) {
  console.error(`ماكو صور بالمجلد: ${folder}`);
  process.exit(1);
}

const status = await fetch(`${base}/api/enhance`).then((r) => r.json()).catch(() => null);
if (!status?.configured) {
  console.error('المزوّد غير مهيّأ — اضبط GEMINI_API_KEY قبل التشغيل.');
  process.exit(1);
}
console.log(`${names.length} صورة · الرصيد المتاح: ${status.remaining}/${status.limit}\n`);

const rows = [];
let stopped = null;

for (const [index, name] of names.entries()) {
  const bytes = await readFile(join(folder, name));
  const type = IMAGE_TYPES[extname(name).toLowerCase()];
  const form = new FormData();
  form.append('image', new File([bytes], name, { type }));

  process.stdout.write(`[${index + 1}/${names.length}] ${name} … `);
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(`${base}/api/enhance`, { method: 'POST', body: form });
  } catch (error) {
    console.log(`تعذّر الاتصال (${error.message})`);
    rows.push({ name, ok: false, detail: 'تعذّر الاتصال بالخادم' });
    continue;
  }

  if (response.status === 429) {
    const payload = await response.json().catch(() => ({}));
    console.log('توقّف — الحد اليومي');
    stopped = { at: index, reason: payload.error ?? 'الحد اليومي' };
    break;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    console.log(`فشل (${response.status})`);
    rows.push({ name, ok: false, detail: payload.error ?? `HTTP ${response.status}` });
    continue;
  }

  const out = Buffer.from(await response.arrayBuffer());
  const width = Number(response.headers.get('x-output-width')) || 0;
  const height = Number(response.headers.get('x-output-height')) || 0;
  const durationMs = Number(response.headers.get('x-duration-ms')) || Date.now() - startedAt;
  const megapixels = (width * height) / 1_000_000;

  rows.push({
    name, ok: true, width, height, durationMs, megapixels,
    before: `data:${type};base64,${bytes.toString('base64')}`,
    after: `data:${response.headers.get('content-type') ?? 'image/png'};base64,${out.toString('base64')}`,
  });
  console.log(`${(durationMs / 1000).toFixed(1)}s · ${width}×${height}`);
}

const done = rows.filter((r) => r.ok);
const times = done.map((r) => r.durationMs);
const cost = done.reduce((sum, r) => sum + priceFor(r.megapixels), 0);
const p95 = percentile(times, 95);

const cards = rows.map((row, i) => row.ok
  ? `<figure class="card">
      <figcaption><b>${row.name}</b><span><bdi dir="ltr">${row.width}×${row.height}</bdi> · ${row.durationMs < 950 ? "أقل من ثانية" : `${(row.durationMs / 1000).toFixed(1)} ثانية`}</span></figcaption>
      <div class="frame" data-i="${i}">
        <img class="layer" src="${row.before}" alt="قبل">
        <div class="layer clip" style="clip-path:inset(0 0 0 50%)"><img src="${row.after}" alt="بعد"></div>
        <span class="tag l">قبل</span><span class="tag r">بعد</span>
        <input class="range" type="range" min="0" max="100" value="50" aria-label="قارن ${row.name}">
      </div>
    </figure>`
  : `<figure class="card bad"><figcaption><b>${row.name}</b><span>${row.detail}</span></figcaption></figure>`).join('\n');

await writeFile('quality-report.html', `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
<title>تقرير جودة الترميم</title><style>
*{box-sizing:border-box}body{margin:0;background:#0a0b0d;color:#f3f1ee;
font-family:'IBM Plex Sans Arabic','Noto Sans Arabic','Segoe UI',Tahoma,sans-serif;padding:28px}
h1{font-size:26px;margin:0 0 4px}.sub{color:#a9adb6;font-size:13px;margin:0 0 22px}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:26px}
.stat{background:#121419;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px 16px;min-width:120px}
.stat b{display:block;font-size:20px;color:#f6a723;unicode-bidi:plaintext}.stat span{color:#a9adb6;font-size:11.5px}
.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(420px,1fr))}
.card{background:#121419;border:1px solid rgba(255,255,255,.08);border-radius:16px;margin:0;padding:12px}
.card.bad{border-color:rgba(255,138,117,.35)}.card.bad span{color:#ff8a75}
figcaption{display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-bottom:10px;font-size:13px}
figcaption span{color:#a9adb6;font-size:11.5px;white-space:nowrap}
figcaption bdi{font-variant-numeric:tabular-nums}
.frame{position:relative;aspect-ratio:4/3;border-radius:11px;overflow:hidden;background:#08090b}
.layer{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.clip img{width:100%;height:100%;object-fit:contain}
.tag{position:absolute;bottom:8px;font-size:10.5px;padding:3px 8px;border-radius:6px;
background:rgba(8,9,11,.72);border:1px solid rgba(255,255,255,.1)}
.tag.l{left:8px}.tag.r{right:8px;color:#ffc46b}
.range{position:absolute;inset:auto 0 0;width:100%;margin:0;opacity:0;height:100%;cursor:ew-resize}
</style>
<h1>تقرير جودة الترميم</h1>
<p class="sub">اسحب على أي صورة لمقارنة قبل وبعد${stopped ? ` — توقّف عند الصورة ${stopped.at + 1}: ${stopped.reason}` : ''}</p>
<div class="stats">
  <div class="stat"><b>${done.length}/${names.length}</b><span>نجحت</span></div>
  <div class="stat"><b>${times.length ? (times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1) : 0}s</b><span>متوسط الزمن</span></div>
  <div class="stat"><b>${(p95 / 1000).toFixed(1)}s</b><span>p95 ${p95 > 20000 ? '⚠ فوق العتبة' : ''}</span></div>
  <div class="stat"><b>$${cost.toFixed(2)}</b><span>تكلفة تقديرية</span></div>
  <div class="stat"><b>$${done.length ? (cost / done.length).toFixed(3) : '0'}</b><span>للصورة</span></div>
</div>
<div class="grid">${cards}</div>
<script>
for (const frame of document.querySelectorAll('.frame')) {
  const clip = frame.querySelector('.clip'), range = frame.querySelector('.range');
  range.addEventListener('input', () => { clip.style.clipPath = 'inset(0 0 0 ' + range.value + '%)'; });
}
</script>
</html>`);

console.log(`\n${'─'.repeat(46)}`);
console.log(`نجحت      : ${done.length}/${names.length}`);
if (times.length) {
  console.log(`متوسط الزمن: ${(times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1)}s`);
  console.log(`p95        : ${(p95 / 1000).toFixed(1)}s${p95 > 20000 ? '  ⚠ فوق 20s — راجع قرار المعالجة غير المتزامنة' : ''}`);
}
console.log(`التكلفة    : $${cost.toFixed(2)} (${done.length ? (cost / done.length).toFixed(3) : 0} للصورة)`);
if (stopped) console.log(`توقّف      : ${stopped.reason}`);
console.log(`\n📄 quality-report.html — افتحه بالمتصفح`);
