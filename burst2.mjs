import { readFile } from 'node:fs/promises';
const img = await readFile(process.argv[2] + '/t.png');
const header = process.argv[3];

const fire = (n) => {
  const form = new FormData();
  form.append('image', new File([img], 'x.png', { type: 'image/png' }));
  return fetch('http://localhost:3000/api/enhance', {
    method: 'POST', body: form, headers: { [header]: `10.0.0.${n}` },
  }).then(async (r) => ({ status: r.status, code: r.ok ? 'ok' : (await r.json().catch(() => ({}))).code }));
};

const results = await Promise.all(Array.from({ length: 30 }, (_, i) => fire(i + 1)));
const hits = Number(await (await fetch('http://localhost:4599/__hits')).text());
const ok = results.filter((r) => r.status === 200).length;
const byCode = {};
for (const r of results) byCode[r.code ?? r.status] = (byCode[r.code ?? r.status] ?? 0) + 1;
console.log(`ترويسة: ${header}`);
console.log(`  نجاح: ${ok} · نداءات المزوّد: ${hits} · التوزيع:`, byCode);
