/**
 * Guards the automatic path chooser.
 *
 * The owner wants Remini's four treatments behind Remini's single button, so
 * nobody ever chooses a path by hand - which means a routing mistake is
 * invisible. There is no screen where a wrong choice shows up: the customer
 * simply gets a worse restoration than they should have, for the same money,
 * and no one can tell why.
 *
 * So each path is checked against an image built to be that case and nothing
 * else, and - just as important - against the neighbouring cases, since the
 * rules are ordered and the ordering is the actual design.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Bundles the two modules by hand. route.ts imports analyze.ts, and the
 * data-URL loader used by the other verifiers here cannot resolve a relative
 * import, so the import line is dropped and the sources concatenated.
 */
function load() {
  const analyze = readFileSync(join(root, 'lib', 'enhance', 'analyze.ts'), 'utf8');
  const route = readFileSync(join(root, 'lib', 'enhance', 'route.ts'), 'utf8')
    .replace(/^import[^;]+;\n/m, '');
  const js = ts.transpileModule(analyze + '\n' + route, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}

const { measure, choosePath, routeImage, THRESHOLDS } = await load();

// choosePath is exercised directly too: routeImage bundles measuring with
// deciding, and a rule that only ever runs behind the measurement cannot be
// checked against a reading we choose ourselves.

/**
 * Box-blurs in place, which is how softness is simulated here.
 *
 * An earlier version of this file faked blur by drawing larger blocks, and
 * that is not blur at all - it is a sharp photograph of big shapes, and it
 * measured as sharp because it is. Real softness is a smooth gradient where an
 * edge used to be, so the test has to actually produce one.
 */
function blurImage({ data, width, height }, radius) {
  const copy = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = x + dx, sy = y + dy;
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
          const j = (sy * width + sx) * 4;
          r += copy[j]; g += copy[j + 1]; b += copy[j + 2]; n += 1;
        }
      }
      const i = (y * width + x) * 4;
      data[i] = r / n; data[i + 1] = g / n; data[i + 2] = b / n;
    }
  }
}

/**
 * Builds a test image. A checkerboard is the sharpest thing a raster can hold,
 * so it is the baseline; `blur` softens it the way a lens would.
 */
function makeImage({ width, height, cell = 2, grey = false, specks = 0, flat = false, blur = 0 }) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const on = flat ? 1 : (Math.floor(x / cell) + Math.floor(y / cell)) % 2;
      const base = flat ? 128 : on ? 210 : 40;
      data[i] = base;
      // A colour image is given a real hue spread; a greyscale one gets none,
      // which is what separates an old print from a modern photograph here.
      data[i + 1] = grey ? base : Math.max(0, base - 55);
      data[i + 2] = grey ? base : Math.max(0, base - 95);
      data[i + 3] = 255;
    }
  }

  // Blur before the specks: dust sits on top of a soft scan, it is not part
  // of the image that went out of focus.
  if (blur) blurImage({ data, width, height }, blur);

  // Isolated specks, standing in for dust and scratches on a scan.
  for (let n = 0; n < specks; n += 1) {
    const x = 2 + Math.floor(random() * (width - 4));
    const y = 2 + Math.floor(random() * (height - 4));
    const i = (y * width + x) * 4;
    const value = random() > 0.5 ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = value;
  }

  return { data, width, height };
}

let passed = 0;
function check(name, run) {
  run();
  passed += 1;
  console.log(`PASS  ${name}`);
}

check('a sharp modern colour photo takes the general enhancement path', () => {
  const { path } = routeImage(makeImage({ width: 1200, height: 900, cell: 2 }));
  assert.equal(path.id, 'high_fidelity');
});

check('a soft modern colour photo is sent to the focus path', () => {
  // Colour and size are fine; the detail has been blurred away.
  const { path, measurements } = routeImage(makeImage({ width: 1200, height: 900, cell: 6, blur: 11 }));
  assert.ok(measurements.sharpness < THRESHOLDS.soft, `sharpness was ${measurements.sharpness}`);
  assert.equal(path.id, 'super_focus');
});

check('a black and white original goes to recovery, not to focus', () => {
  // The ordering that matters most: an old scan is soft AND grey, and
  // sharpening an absence is not the same job as rebuilding it.
  const { path } = routeImage(makeImage({ width: 1200, height: 900, cell: 6, grey: true, blur: 11 }));
  assert.equal(path.id, 'recover');
});

check('a tiny image goes to recovery however sharp it is', () => {
  const { path, measurements } = routeImage(makeImage({ width: 400, height: 300, cell: 2 }));
  assert.ok(measurements.megapixels < THRESHOLDS.smallMegapixels);
  assert.equal(path.id, 'recover');
});

check('a speckled scan is treated as damage before anything else', () => {
  // Also grey and soft, so this only passes if damage really is checked first.
  const { path } = routeImage(makeImage({ width: 1200, height: 900, cell: 6, grey: true, blur: 11, specks: 9000 }));
  assert.equal(path.id, 'dust_scratch');
});

check('every path carries an Arabic label and a reason', () => {
  for (const image of [
    makeImage({ width: 1200, height: 900, cell: 2 }),
    makeImage({ width: 1200, height: 900, cell: 6, blur: 11 }),
    makeImage({ width: 400, height: 300, cell: 2 }),
    makeImage({ width: 1200, height: 900, cell: 6, blur: 11, specks: 9000 }),
  ]) {
    const { path } = routeImage(image);
    assert.ok(path.label && /[؀-ۿ]/.test(path.label), `${path.id}: label must be Arabic`);
    assert.ok(path.reason && /[؀-ۿ]/.test(path.reason), `${path.id}: reason must be Arabic`);
  }
});

check('routing the same image twice gives the same answer', () => {
  // A router that is a model would not satisfy this, and a customer resending
  // a photo would silently get a different treatment and a different result.
  const image = makeImage({ width: 900, height: 700, cell: 3 });
  assert.deepEqual(routeImage(image).path, routeImage(image).path);
});

check('an image too small to sample falls back instead of crashing', () => {
  const { path } = routeImage({ data: new Uint8ClampedArray(4 * 4), width: 2, height: 2 });
  assert.ok(path.id, 'a path must always be returned');
});

check('the rules can be checked against readings directly, without an image', () => {
  // Guards the ordering itself: a frame that is damaged AND grey AND soft all
  // at once must still be treated as damaged.
  const worst = { megapixels: 0.3, sharpness: 1, colorfulness: 2, speckle: 0.01, brightness: 100 };
  assert.equal(choosePath(worst).id, 'dust_scratch');
  assert.equal(choosePath({ ...worst, speckle: 0 }).id, 'recover');
  assert.equal(choosePath({ ...worst, speckle: 0, megapixels: 8, colorfulness: 40 }).id, 'super_focus');
  assert.equal(
    choosePath({ megapixels: 8, sharpness: 30, colorfulness: 40, speckle: 0, brightness: 128 }).id,
    'high_fidelity',
  );
});

check('measurements are plain finite numbers, never NaN', () => {
  const m = measure(makeImage({ width: 600, height: 400, cell: 5 }));
  for (const [key, value] of Object.entries(m)) {
    assert.ok(Number.isFinite(value), `${key} was ${value}`);
  }
});

console.log(`\nrouting verified: ${passed}/${passed}`);
