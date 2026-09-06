/**
 * Guards what the bot accepts before it spends anything.
 *
 * Two rules live on this path and neither is enforced by a type:
 *
 *   1. A file we are going to refuse must be refused BEFORE its bytes are
 *      pulled. Buffering a 20MB refusal into a Worker that is about to hold a
 *      restored image too is how a runtime runs out of memory, and the failure
 *      would land on whichever request happened to be next.
 *   2. The image type must be read from the bytes, never from a header.
 *      Telegram's file host serves application/octet-stream often enough, and
 *      forwarding that label made the provider reject photographs that were
 *      perfectly fine.
 *
 * Both are checked against a real HTTP server rather than a mocked fetch, so a
 * pass here means the request sequence itself is right - including which
 * requests were never made.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** State the stub reads per test, and the log each test asserts against. */
let scenario = {};
let hits = [];

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  hits.push(url.pathname);

  if (url.pathname.endsWith('/getFile')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(scenario.getFile));
    return;
  }

  if (scenario.downloadStatus && scenario.downloadStatus !== 200) {
    response.writeHead(scenario.downloadStatus);
    response.end('no');
    return;
  }

  const headers = { 'content-type': scenario.serveType ?? 'application/octet-stream' };
  // Announced separately from the body so a lying content-length is testable.
  if (scenario.announce !== undefined) headers['content-length'] = String(scenario.announce);
  // Node adds a content-length of its own unless the response is chunked. That
  // would mean the header check always fires first and the check after it -
  // the one reading the buffered length - would never actually be exercised.
  if (scenario.chunked) headers['transfer-encoding'] = 'chunked';
  response.writeHead(200, headers);
  response.end(scenario.body ?? Buffer.alloc(0));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${port}/bot`;

/** Loads a TS module the way the other verifiers here do. */
async function load(relative) {
  const source = readFileSync(join(root, relative), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}

const { downloadFile, TelegramFileError } = await load('lib/telegram.ts');
const { sniffImageType, SIGNATURE_BYTES } = await load('lib/image-type.ts');

const LIMIT = 15 * 1024 * 1024;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

let passed = 0;
async function check(name, run) {
  hits = [];
  await run();
  passed += 1;
  console.log(`PASS  ${name}`);
}

async function expectFileError(code, promise) {
  const error = await promise.then(
    () => null,
    (thrown) => thrown,
  );
  assert.ok(error instanceof TelegramFileError, `expected a TelegramFileError, got ${error}`);
  assert.equal(error.code, code);
}

await check('a size Telegram reports over the limit is refused without downloading', async () => {
  scenario = { getFile: { ok: true, result: { file_path: 'photos/big.jpg', file_size: 20 * 1024 * 1024 } } };
  await expectFileError('too_large', downloadFile('T', 'f', LIMIT));
  // The whole point: the second request never happened.
  assert.deepEqual(hits, ['/botT/getFile'], 'the file was downloaded despite a reported size over the limit');
});

await check('an unreported size is caught by content-length, still before the body', async () => {
  scenario = {
    getFile: { ok: true, result: { file_path: 'photos/big.jpg' } },
    announce: 20 * 1024 * 1024,
    body: JPEG,
  };
  await expectFileError('too_large', downloadFile('T', 'f', LIMIT));
});

await check('a body that announced no size at all is refused after buffering', async () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(4096, 1)]);
  // No declared size and no content-length at all, so neither earlier check
  // can see this coming: only the buffered length is left to catch it, which
  // is the whole reason that last check exists.
  scenario = { getFile: { ok: true, result: { file_path: 'photos/x.jpg' } }, body: big, chunked: true };
  await expectFileError('too_large', downloadFile('T', 'f', 128));
});

await check('a file within the limit comes back with its bytes', async () => {
  scenario = { getFile: { ok: true, result: { file_path: 'photos/ok.jpg', file_size: JPEG.length } }, body: JPEG };
  const { bytes } = await downloadFile('T', 'f', LIMIT);
  assert.equal(bytes.byteLength, JPEG.length);
  assert.deepEqual(hits, ['/botT/getFile', '/file/botT/photos/ok.jpg'], 'unexpected request sequence');
});

await check('a failed getFile is reported as unavailable, not as too large', async () => {
  scenario = { getFile: { ok: false, description: 'file not found' } };
  await expectFileError('unavailable', downloadFile('T', 'f', LIMIT));
});

await check('a file host that refuses is unavailable too', async () => {
  scenario = { getFile: { ok: true, result: { file_path: 'photos/ok.jpg' } }, downloadStatus: 404 };
  await expectFileError('unavailable', downloadFile('T', 'f', LIMIT));
});

await check('a JPEG served as octet-stream is identified as a JPEG', async () => {
  scenario = { getFile: { ok: true, result: { file_path: 'photos/ok.jpg' } }, body: JPEG, serveType: 'application/octet-stream' };
  const { bytes, contentType } = await downloadFile('T', 'f', LIMIT);
  // The header says one thing and the bytes say another. The bytes win - this
  // is the case that was reaching the provider mislabelled.
  assert.equal(contentType, 'application/octet-stream', 'the header is still reported as-is');
  assert.equal(sniffImageType(bytes.slice(0, SIGNATURE_BYTES)), 'image/jpeg', 'sniffing must override the header');
});

await check('bytes that are not an image we accept are rejected, however they are labelled', async () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32, 0)]);
  scenario = { getFile: { ok: true, result: { file_path: 'photos/trap.jpg' } }, body: pdf, serveType: 'image/jpeg' };
  const { bytes } = await downloadFile('T', 'f', LIMIT);
  assert.equal(sniffImageType(bytes.slice(0, SIGNATURE_BYTES)), null, 'a PDF labelled image/jpeg must not pass');
});

server.close();
console.log(`\nbot intake verified: ${passed}/${passed}`);
