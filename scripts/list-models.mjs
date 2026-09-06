/**
 * Asks Google which models the key can actually use.
 *
 *   npm run models
 *
 * This exists because of one failure that cannot be diagnosed any other way.
 * When the model name is wrong, Google answers 400, the site says "something
 * went wrong before processing", and that sentence is identical to the one it
 * shows for a restricted key or an account without billing. Worse, the name
 * cannot be checked by guessing from outside: Google validates the API key
 * before it looks at the model, so every wrong guess and every right one come
 * back with the same authentication error unless you hold the key.
 *
 * So the check has to run where the key is. It lists what the key can reach,
 * and says plainly whether the model this project is configured to call is
 * among them.
 *
 * English output, like every tool here: the owner's terminal reverses Arabic.
 */

const key = process.env.GEMINI_API_KEY;
const configured = process.env.ENHANCE_MODEL || 'gemini-3.1-flash-image';
const base = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta/models';

if (!key) {
  console.error('\nGEMINI_API_KEY is not set here.');
  console.error('It lives in .env.local for local runs, and in the hosting settings for the deployed site.');
  console.error('This check must run where the key is - Google will not answer without it.\n');
  process.exit(1);
}

let payload;
try {
  const response = await fetch(`${base}?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  const text = await response.text();
  if (!response.ok) {
    console.error(`\nGoogle answered ${response.status}:\n`);
    console.error(text.slice(0, 800));
    console.error('\nA 400 with API_KEY_INVALID means this key is wrong or was revoked.');
    console.error('A 403 usually means the key is restricted, or the API is not enabled on the project.\n');
    process.exit(1);
  }
  payload = JSON.parse(text);
} catch (error) {
  console.error(`\nCould not reach Google - ${error.message}\n`);
  process.exit(1);
}

const models = payload.models ?? [];
// A model this project can use has to be able to generate, not only embed.
const usable = models.filter((model) => (model.supportedGenerationMethods ?? []).includes('generateContent'));
// Image output is what this product is; the name is the only reliable signal
// the list API gives for it.
const imaging = usable.filter((model) => /image/i.test(model.name));

const short = (model) => model.name.replace(/^models\//, '');
const found = usable.find((model) => short(model) === configured);

console.log(`\nModels this key can reach: ${models.length} (${usable.length} can generate)`);
console.log('-'.repeat(58));

console.log('\nIMAGE MODELS');
if (imaging.length) {
  for (const model of imaging) console.log(`  ${short(model)}`);
} else {
  console.log('  none - this key cannot reach any image model.');
  console.log('  That alone would explain every restoration failing.');
}

console.log(`\nCONFIGURED: ${configured}`);
if (found) {
  console.log('  [ OK ] this key can call it.');
} else {
  console.log('  [FAIL] this key cannot call it, so every restoration fails at the model.');
  console.log('         Set ENHANCE_MODEL to one of the image models listed above,');
  console.log('         in .env.local and in the hosting settings. No code change needed.');
}
console.log('');
process.exit(found ? 0 : 1);
