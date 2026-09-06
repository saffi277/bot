/**
 * Guards the service catalogue.
 *
 * Every rule here protects money or a promise made to a visitor, and none of
 * them is enforced by the type system: `units` is a number, and nothing stops
 * it from being 1 on a service that calls the model four times. That mistake
 * would not fail a build, would not show on screen, and would quietly let real
 * spending run at four times the cap the owner set.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'lib', 'enhance', 'operations.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { OPERATIONS, DEFAULT_OPERATION, findOperation, catalogue, RESTORE_PROMPT } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);

assert.ok(OPERATIONS.length > 0, 'The catalogue must not be empty');

const ids = OPERATIONS.map((operation) => operation.id);
assert.equal(new Set(ids).size, ids.length, 'Two services share an id; the wrong one would run');

for (const operation of OPERATIONS) {
  assert.ok(operation.id && /^[a-z0-9_]+$/.test(operation.id), `Bad id: ${operation.id}`);
  assert.ok(['enhance', 'creative'].includes(operation.kind), `${operation.id}: unknown kind`);
  assert.ok(operation.label?.trim(), `${operation.id}: needs a label the visitor can read`);
  assert.ok(operation.hint?.trim(), `${operation.id}: needs a line saying what it does`);
  assert.ok(operation.prompt?.trim(), `${operation.id}: needs a prompt`);

  assert.ok(
    Number.isInteger(operation.units) && operation.units >= 1,
    `${operation.id}: units must be a whole number of model calls, got ${operation.units}`,
  );
  // A single press costing more than the whole guest allowance can never
  // succeed — the reservation is all-or-nothing, so the service would be dead
  // on arrival for every visitor who is not signed in.
  assert.ok(operation.units <= 5, `${operation.id}: ${operation.units} units exceeds a signed-in day's allowance`);
}

// The default is what runs when a client sends nothing. A creative default
// would spend a visitor's quota making a picture they never asked for.
const fallback = findOperation(null);
assert.ok(fallback, 'The default operation must resolve');
assert.equal(fallback.id, DEFAULT_OPERATION);
assert.equal(fallback.kind, 'enhance', 'The default must be the one-button enhance path, never a creative service');

assert.equal(findOperation('no_such_service'), null, 'An unknown id must not silently fall back');
assert.equal(findOperation(''), fallback, 'An empty id means "no choice made", so the default applies');

// Prompts are the product's instructions to the model and stay server-side.
for (const entry of catalogue()) {
  assert.ok(!('prompt' in entry), `${entry.id}: the prompt must not reach the browser`);
  assert.ok(entry.units >= 1 && entry.label && entry.kind, `${entry.id}: the front end needs kind, label and units`);
}

/**
 * The restoration prompt carries two promises that must never be edited away,
 * and they pull against each other — which is why both are checked.
 *
 * It must sharpen faces, because a soft face in a sharp image is the failure
 * everyone opening this kind of tool is trying to escape. And it must hold the
 * person's identity fixed, because a face that came back sharper but belonging
 * to someone else is worse than no restoration at all.
 *
 * The assertions match on meaning rather than on one sentence: an earlier
 * version of this check was pinned to exact wording, and it fired when the
 * prompt was corrected rather than when it was broken.
 */
assert.match(
  RESTORE_PROMPT,
  /identity of every person must survive unchanged/i,
  'The prompt no longer protects the subject\'s identity',
);
assert.match(
  RESTORE_PROMPT,
  /\bfaces?\b[^.]*\b(focus|sharpen)/i,
  'The prompt no longer asks for faces to be brought into focus — the whole product',
);
assert.match(
  RESTORE_PROMPT,
  /do not beautify/i,
  'The prompt no longer forbids beautifying, so the result may not look like the person',
);
assert.doesNotMatch(
  RESTORE_PROMPT,
  /leave it soft/i,
  'The prompt tells the model to return a soft face, which is the one thing it must not do',
);

/**
 * Every operation that can see a face must protect it. A creative service is
 * exactly where this gets forgotten — the visible goal there is a different
 * picture, and "different" is one careless prompt away from "different person".
 */
for (const operation of OPERATIONS) {
  assert.match(
    operation.prompt,
    /identity of every person must survive unchanged/i,
    `${operation.id}: prompt does not protect the subject's identity`,
  );
  assert.match(
    operation.prompt,
    /no added border|no border/i,
    `${operation.id}: prompt does not forbid added borders and watermarks`,
  );
}

const enhance = OPERATIONS.filter((o) => o.kind === 'enhance');
const creative = OPERATIONS.filter((o) => o.kind === 'creative');
const worst = Math.max(...OPERATIONS.map((o) => o.units));
console.log(
  `operations verified: ${OPERATIONS.length} (${enhance.length} enhance, ${creative.length} creative), ` +
    `costliest press = ${worst} unit${worst === 1 ? '' : 's'}`,
);
