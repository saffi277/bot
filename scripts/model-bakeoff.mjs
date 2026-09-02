/**
 * Runs the same photographs through several image models and lays the results
 * side by side, so the choice is made by looking rather than by argument.
 *
 * This is lab equipment, not part of the product: it calls the model API
 * directly with the owner's key instead of going through /api/enhance, so it
 * neither consumes the service's daily budget nor depends on the app running.
 *
 *   node scripts/model-bakeoff.mjs ./my-photos
 *   node scripts/model-bakeoff.mjs ./my-photos --models a,b --yes
 */

import { createInterface } from 'node:readline/promises';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY = process.env.GEMINI_API_KEY;

const TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif',
};

/** Per-image price at the size this tool requests, and a one-line note on where
 *  each model sits. Prices move — treat them as an estimate, not an invoice. */
const CATALOGUE = {
  'gemini-2.5-flash-image': { price: 0.039, note: 'الطبقة المجانية · 500 صورة/يوم بلا بطاقة' },
  'gemini-3.1-flash-image': { price: 0.101, note: 'متوسط · سريع' },
  'gemini-3-pro-image': { price: 0.134, note: 'الأقوى للوجوه · بلا طبقة مجانية' },
};

/**
 * Kept in step with lib/enhance/gemini.ts so the comparison reflects what the
 * product will actually send.
 *
 * The earlier wording told the model to preserve the source wherever detail
 * was unclear, which on a photograph missing a third of its emulsion means
 * leaving the holes — no restoration at all. It only produced a good result by
 * disobeying. The distinction that matters is not whether the model invents,
 * but what it is allowed to invent: physical damage may be reconstructed from
 * what surrounds it, a face may not.
 */
const RESTORE_PROMPT = [
  'Restore and enhance this photograph.',
  'Sharpen detail, recover skin, hair and fabric texture, reduce blur, noise and compression artifacts, and correct faded or shifted colors.',
  'Repair physical damage — tears, cracks, missing emulsion, scratches, stains, fading — by reconstructing what the surrounding image implies.',
  'Never reconstruct a face: if facial detail is lost, leave it soft rather than inventing features. The identity of every person must survive unchanged — do not alter face shape, proportions, age, expression, or skin tone.',
  'Preserve the original composition, framing, pose, clothing and background.',
  'Do not add objects, people or elements that the original does not imply.',
  'Return only the restored photograph, with no added border, frame, margin, watermark, signature or decoration, and keep the original framing and aspect ratio.',
].join(' ');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const folder = resolve(process.argv[2] ?? './test-images');
const models = arg('models', Object.keys(CATALOGUE).join(',')).split(',').map((m) => m.trim()).filter(Boolean);
const assumeYes = process.argv.includes('--yes');

if (!KEY) {
  console.error('اضبط GEMINI_API_KEY قبل التشغيل.');
  process.exit(1);
}

let names;
try {
  names = (await readdir(folder)).filter((n) => extname(n).toLowerCase() in TYPES).sort();
} catch {
  console.error(`لم أقدر أقرأ المجلد: ${folder}`);
  process.exit(1);
}
if (!names.length) {
  console.error(`ماكو صور بالمجلد: ${folder}`);
  process.exit(1);
}

// Show the bill before spending a cent of it.
const estimate = models.reduce((sum, m) => sum + (CATALOGUE[m]?.price ?? 0.134) * names.length, 0);
console.log(`\n${names.length} صورة × ${models.length} نموذج = ${names.length * models.length} نداء\n`);
for (const model of models) {
  const entry = CATALOGUE[model] ?? { price: 0.134, note: 'غير معروف — يُقدَّر بسعر الطبقة العليا' };
  console.log(`  ${model.padEnd(26)} $${(entry.price * names.length).toFixed(2).padStart(6)}   ${entry.note}`);
}
console.log(`\n  التكلفة التقديرية الإجمالية: $${estimate.toFixed(2)}\n`);

if (!assumeYes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('تكمل؟ اكتب y للموافقة: ')).trim().toLowerCase();
  rl.close();
  if (answer !== 'y' && answer !== 'yes') {
    console.log('أُلغي. ما انصرف ولا فلس.');
    process.exit(0);
  }
}

async function run(model, bytes, mimeType) {
  const startedAt = Date.now();
  const response = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: RESTORE_PROMPT },
          { inline_data: { mime_type: mimeType, data: bytes.toString('base64') } },
        ],
      }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: '2K' } },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} — ${detail.slice(0, 160)}`);
  }

  const payload = await response.json();
  if (payload.promptFeedback?.blockReason) throw new Error(`مرفوضة: ${payload.promptFeedback.blockReason}`);

  const part = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.inlineData ?? p.inline_data)
    .find((d) => d?.data);
  if (!part?.data) throw new Error('ما رجّع صورة');

  return {
    dataUrl: `data:${part.mimeType ?? part.mime_type ?? 'image/png'};base64,${part.data}`,
    durationMs: Date.now() - startedAt,
  };
}

const rows = [];
const totals = Object.fromEntries(models.map((m) => [m, { ok: 0, failed: 0, ms: [] }]));

for (const [index, name] of names.entries()) {
  const bytes = await readFile(join(folder, name));
  const mimeType = TYPES[extname(name).toLowerCase()];
  const cells = [];

  for (const model of models) {
    process.stdout.write(`[${index + 1}/${names.length}] ${name} · ${model} … `);
    try {
      const result = await run(model, bytes, mimeType);
      cells.push({ model, ...result });
      totals[model].ok += 1;
      totals[model].ms.push(result.durationMs);
      console.log(`${(result.durationMs / 1000).toFixed(1)}s`);
    } catch (error) {
      // One model failing must not cost the whole run.
      cells.push({ model, error: error.message });
      totals[model].failed += 1;
      console.log(`فشل — ${error.message}`);
    }
  }

  rows.push({ name, original: `data:${mimeType};base64,${bytes.toString('base64')}`, cells });
}

const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

const summary = models.map((m) => {
  const t = totals[m];
  const price = (CATALOGUE[m]?.price ?? 0.134) * t.ok;
  return `<div class="sum"><b>${m}</b>
    <span>${t.ok}/${names.length} نجحت${t.failed ? ` · ${t.failed} فشلت` : ''}</span>
    <span><bdi dir="ltr">${(mean(t.ms) / 1000).toFixed(1)}s</bdi> متوسط · <bdi dir="ltr">$${price.toFixed(2)}</bdi></span></div>`;
}).join('');

const body = rows.map((row) => `<section class="row">
  <h2>${row.name}</h2>
  <div class="strip">
    <figure><div class="shot"><img src="${row.original}" alt="الأصل"></div><figcaption>الأصل</figcaption></figure>
    ${row.cells.map((cell) => cell.error
      ? `<figure class="bad"><div class="shot err">${cell.error}</div><figcaption>${cell.model}</figcaption></figure>`
      : `<figure><div class="shot"><img src="${cell.dataUrl}" alt="${cell.model}"></div>
         <figcaption>${cell.model}<span><bdi dir="ltr">${(cell.durationMs / 1000).toFixed(1)}s</bdi></span></figcaption></figure>`).join('')}
  </div>
</section>`).join('\n');

await writeFile('model-bakeoff.html', `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
<title>مقارنة النماذج</title><style>
*{box-sizing:border-box}body{margin:0;background:#0a0b0d;color:#f3f1ee;padding:26px;
font-family:'IBM Plex Sans Arabic','Noto Sans Arabic','Segoe UI',Tahoma,sans-serif}
h1{font-size:25px;margin:0 0 4px}.lead{color:#a9adb6;font-size:13px;margin:0 0 22px}
.sums{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:28px}
.sum{background:#121419;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px 16px;min-width:200px}
.sum b{display:block;color:#f6a723;font-size:13.5px;margin-bottom:5px}
.sum span{display:block;color:#a9adb6;font-size:11.5px}
.row{margin-bottom:30px}.row h2{font-size:14.5px;margin:0 0 10px;color:#a9adb6;font-weight:600}
.strip{display:grid;gap:12px;grid-template-columns:repeat(${models.length + 1},1fr)}
figure{margin:0}.shot{aspect-ratio:1;background:#08090b;border:1px solid rgba(255,255,255,.08);
border-radius:12px;overflow:hidden;display:grid;place-items:center}
.shot img{width:100%;height:100%;object-fit:contain}
.shot.err{color:#ff8a75;font-size:11px;padding:14px;text-align:center;line-height:1.6}
figcaption{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:#a9adb6;margin-top:7px}
figcaption span{color:#f6a723}
figure:first-child figcaption{color:#f3f1ee;font-weight:600}
@media(max-width:900px){.strip{grid-template-columns:1fr 1fr}}
</style>
<h1>مقارنة النماذج</h1>
<p class="lead">${names.length} صورة · ${models.length} نموذج · العمود الأول هو الأصل</p>
<div class="sums">${summary}</div>
${body}
</html>`);

console.log(`\n${'─'.repeat(46)}`);
for (const model of models) {
  const t = totals[model];
  console.log(`${model.padEnd(26)} ${t.ok}/${names.length} · ${(mean(t.ms) / 1000).toFixed(1)}s · $${((CATALOGUE[model]?.price ?? 0.134) * t.ok).toFixed(2)}`);
}
console.log(`\n📄 model-bakeoff.html — افتحه وقارن بعينك`);
