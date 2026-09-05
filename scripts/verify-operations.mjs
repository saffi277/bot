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

// The restoration prompt carries the one rule the whole promise rests on.
assert.match(RESTORE_PROMPT, /Never reconstruct a face/, 'The face rule is missing from the restoration prompt');

const enhance = OPERATIONS.filter((o) => o.kind === 'enhance');
const creative = OPERATIONS.filter((o) => o.kind === 'creative');
const worst = Math.max(...OPERATIONS.map((o) => o.units));
console.log(
  `operations verified: ${OPERATIONS.length} (${enhance.length} enhance, ${creative.length} creative), ` +
    `costliest press = ${worst} unit${worst === 1 ? '' : 's'}`,
);
