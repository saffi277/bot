/**
 * Prints the exact instruction the product sends to the model, and writes it
 * to a file that is easy to copy out of an editor.
 *
 *   npm run prompt
 *
 * Why this exists: image models have no free API tier, so the quality question
 * - "is the result strong enough?" - cannot be answered through this codebase
 * without billing. It CAN be answered by hand in Google AI Studio's web
 * interface, which is free. That test is only worth anything if the prompt
 * pasted there is the one the product actually uses, so it is read from
 * lib/enhance/operations.ts rather than copied by hand into a document that
 * would drift the first time the prompt is improved.
 *
 * It takes an operation id and defaults to the one-button restore path.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'lib', 'enhance', 'operations.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { OPERATIONS, DEFAULT_OPERATION } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);

const wanted = process.argv[2] || DEFAULT_OPERATION;
const operation = OPERATIONS.find((entry) => entry.id === wanted);

if (!operation) {
  console.error(`\nNo service called "${wanted}". Available:`);
  for (const entry of OPERATIONS) console.error(`  ${entry.id}`);
  console.error('');
  process.exit(1);
}

const target = join(root, 'prompt-for-testing.txt');
writeFileSync(target, operation.prompt + '\n');

console.log(`\nService: ${operation.id}\n`);
console.log(operation.prompt);
console.log(`\n${'-'.repeat(58)}`);
console.log(`Also written to  prompt-for-testing.txt  (easier to copy from an editor)`);
console.log('Git-ignored, so it cannot drift from the real prompt in the repo.\n');
console.log('To test the quality without billing:');
console.log('  1. Open  https://aistudio.google.com');
console.log(`  2. Pick an image model (e.g. ${'gemini-3.1-flash-image'})`);
console.log('  3. Attach your photo, paste this text, run it.');
console.log('The web interface is free; only the API needs a billing account.\n');
