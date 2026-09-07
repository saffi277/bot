/**
 * Guards the grading stage.
 *
 * This is the half of a restoration that costs nothing, and that is exactly
 * why it needs a test: nothing about it shows up on a bill, so a fault here
 * announces itself only as photographs that quietly look wrong.
 *
 * Three of the properties below are the reasons this stage is arithmetic
 * rather than a prompt - neutrality, determinism and bounded output. If they
 * do not hold, the argument for building it this way does not either.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** presets.ts imports grade.ts; the data-URL loader cannot resolve that, so
 *  the import line is dropped and the two sources concatenated. */
function load() {
  const grade = readFileSync(join(root, 'lib', 'enhance', 'grade.ts'), 'utf8');
  const presets = readFileSync(join(root, 'lib', 'enhance', 'presets.ts'), 'utf8')
    .replace(/^import[^;]+;\n/m, '');
  const js = ts.transpileModule(grade + '\n' + presets, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}

const {
  applyGrade, mergeGrades, NEUTRAL, DEFAULT_GRADE,
  PRESETS, DEFAULT_PRESETS, findPreset, resolveGrade, presetCatalogue,
} = await load();

const W = 40, H = 30;

/** A picture with skin, sky and neutral tones, so each control has something
 *  of its own to act on. */
function photo() {
  const pixels = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      if (y < H / 3) {
        // Skin: warm, r > g > b, mid-light.
        pixels[i] = 205; pixels[i + 1] = 160; pixels[i + 2] = 130;
      } else if (y < (2 * H) / 3) {
        // Sky: blue-dominant, so the skin test must not claim it.
        pixels[i] = 90; pixels[i + 1] = 140; pixels[i + 2] = 210;
      } else {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = (x * 6) % 256;
      }
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

let passed = 0;
const check = (name, run) => { run(); passed += 1; console.log(`PASS  ${name}`); };

check('a neutral grade changes nothing, byte for byte', () => {
  const pixels = photo();
  const before = Uint8ClampedArray.from(pixels);
  applyGrade(pixels, W, H, NEUTRAL);
  assert.deepEqual(pixels, before, 'zeroed controls must leave the photograph untouched');
});

check('the same input and numbers always give the same output', () => {
  // The property a model cannot offer, and the reason this stage is code.
  const a = photo(), b = photo();
  applyGrade(a, W, H, DEFAULT_GRADE);
  applyGrade(b, W, H, DEFAULT_GRADE);
  assert.deepEqual(a, b);
});

check('a blown highlight stays bright and a crushed shadow stays dark', () => {
  /**
   * The real failure mode, and it is not an out-of-range byte.
   *
   * Writing 260 into a plain Uint8Array does not store 260 - it wraps and
   * stores 4. The value is inside 0-255 and completely wrong, so checking the
   * range proves nothing at all; an earlier version of this test did exactly
   * that and passed with the clamp deleted.
   *
   * What a wrap actually looks like is a bright sky coming back full of black
   * specks. So that is what is checked: brightness that should saturate must
   * saturate, and darkness that should bottom out must bottom out.
   *
   * A plain Uint8Array on purpose - the Worker path is this type. A
   * Uint8ClampedArray would hide the defect by clamping on assignment.
   */
  const up = { ...NEUTRAL, exposure: 100, contrast: 100, blacks: 100, saturation: 100, warmth: 100, skin: 100 };
  const white = new Uint8Array(W * H * 4).fill(255);
  applyGrade(white, W, H, up);
  for (let i = 0; i < white.length; i += 4) {
    assert.ok(white[i] > 200, `white wrapped to ${white[i]} - a highlight came back dark`);
  }

  const down = { ...NEUTRAL, exposure: -100, contrast: -100, blacks: -100, saturation: -100, warmth: -100 };
  const black = new Uint8Array(W * H * 4);
  applyGrade(black, W, H, down);
  for (let i = 0; i < black.length; i += 4) {
    assert.ok(black[i] < 140, `black wrapped to ${black[i]} - a shadow came back bright`);
  }

  // And nothing anywhere may be NaN, which wraps silently to 0.
  const pixels = Uint8Array.from(photo());
  applyGrade(pixels, W, H, up);
  for (const byte of pixels) assert.ok(Number.isFinite(byte) && byte >= 0 && byte <= 255);
});

check('the skin lift reaches skin and leaves the sky alone', () => {
  const pixels = photo();
  const before = Uint8ClampedArray.from(pixels);
  applyGrade(pixels, W, H, { ...NEUTRAL, skin: 50 });

  const skinAt = 4;                       // first row: skin
  const skyAt = (Math.floor(H / 2) * W) * 4;  // middle band: sky
  assert.ok(pixels[skinAt] > before[skinAt], 'skin was not lifted');
  assert.equal(pixels[skyAt], before[skyAt], 'the sky must not move when only skin is lifted');
  assert.equal(pixels[skyAt + 2], before[skyAt + 2], 'the sky must not move when only skin is lifted');
});

check('alpha is never touched', () => {
  const pixels = photo();
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 128;
  applyGrade(pixels, W, H, DEFAULT_GRADE);
  for (let i = 3; i < pixels.length; i += 4) assert.equal(pixels[i], 128);
});

check('grades add together, so three choices stack', () => {
  const total = mergeGrades({ exposure: 10 }, { exposure: 5, warmth: 4 });
  assert.equal(total.exposure, 15);
  assert.equal(total.warmth, 4);
  assert.equal(total.contrast, 0, 'unmentioned controls stay at rest');
});

check('every preset has a unique id within its group and an Arabic label', () => {
  const seen = new Set();
  for (const preset of PRESETS) {
    const key = `${preset.group}:${preset.id}`;
    assert.ok(!seen.has(key), `duplicate preset ${key}`);
    seen.add(key);
    assert.ok(/[؀-ۿ]/.test(preset.label), `${key}: label must be Arabic`);
    assert.ok(['filter', 'light', 'focus'].includes(preset.group), `${key}: unknown group`);
  }
});

check('every preset except the neutral ones actually changes the picture', () => {
  // A filter that does nothing is worse than no filter: the customer presses
  // it, sees no change, and concludes the product is broken.
  const neutralIds = new Set(Object.values(DEFAULT_PRESETS));
  for (const preset of PRESETS) {
    const pixels = photo();
    const before = Uint8ClampedArray.from(pixels);
    applyGrade(pixels, W, H, mergeGrades(preset.grade));
    const moved = !pixels.every((byte, i) => byte === before[i]);
    if (neutralIds.has(preset.id)) {
      assert.equal(moved, false, `${preset.id}: a default preset must be a no-op on its own`);
    } else {
      assert.ok(moved, `${preset.id}: preset has no visible effect`);
    }
  }
});

check('an unknown or missing choice falls back to the standard look', () => {
  assert.deepEqual(resolveGrade({ filter: 'no_such_filter' }), resolveGrade({}));
  assert.deepEqual(resolveGrade(), resolveGrade({ filter: 'natural', light: 'as_is', focus: 'medium' }));
  assert.equal(findPreset('filter', 'no_such_filter'), null);
});

check('the default resolved grade is the finished look, not a flat frame', () => {
  // Someone who touches nothing must still receive the graded photograph.
  const resolved = resolveGrade();
  assert.deepEqual(resolved, DEFAULT_GRADE);
  assert.notDeepEqual(resolved, NEUTRAL);
});

check('the catalogue carries no grade values into the browser', () => {
  // Not a secret, but the numbers are ours to change: a screen that copied
  // them would keep applying last month's look after we corrected it.
  for (const entry of presetCatalogue()) {
    assert.ok(!('grade' in entry), `${entry.id}: grade values must stay server-side`);
    assert.ok(entry.id && entry.group && entry.label);
  }
});

console.log(`\ngrade verified: ${passed}/${passed}`);
