/**
 * The second stage of a restoration: colour, brightness and contrast.
 *
 * The first stage is a model that repairs the face and recovers detail. It
 * returns a sharp photograph that is still flat — the owner tested exactly
 * that and said so (docs/REVIEW.md, 2026-09-06): the face improved, the
 * colours did not move. Everything a customer then describes as quality —
 * brighter, warmer, whites that read white, blacks with depth — is this stage.
 *
 * And it is arithmetic, not inference. That is the whole reason it lives here
 * rather than in a prompt:
 *
 *   It costs nothing. A grade added to every photograph adds nothing to the
 *   bill, so it does not have to be rationed the way model calls do.
 *
 *   It is instant, so a customer can try filters and see each one immediately
 *   instead of waiting on a round trip per press.
 *
 *   It is deterministic. The same photograph and the same numbers always give
 *   the same result — a property a model cannot offer, and the reason someone
 *   resending a photo is not quietly handed something different.
 *
 * There is no DOM here on purpose. These are plain functions over an RGBA
 * buffer, so the browser can run them for free on the customer's machine and
 * the Worker can run the identical code later through a WASM decoder. Two
 * implementations of a grade would drift, and the one that drifts is the one
 * the customer sees.
 */

/**
 * An RGBA buffer. Both types are accepted because both occur: the browser
 * hands over a Uint8ClampedArray from canvas, and a WASM decoder in the Worker
 * hands over a plain Uint8Array. They differ in exactly one way that matters
 * here — see clamp8.
 */
export type Pixels = Uint8ClampedArray | Uint8Array;

export type Grade = {
  /** Overall gain. Lifts a dull frame. */
  exposure: number;
  /** Spread around mid-grey. */
  contrast: number;
  /** Pulls the darkest tones down so the image has a true black, not a grey floor. */
  blacks: number;
  /** Shifts white balance towards daylight. */
  warmth: number;
  /** Colour intensity. */
  saturation: number;
  /** Local contrast, recovered against a blurred copy. Reads as sharpness. */
  clarity: number;
  /** Brightens and evens skin only — see isSkin below. */
  skin: number;
};

/** Every control at rest. Applying this must leave an image untouched. */
export const NEUTRAL: Grade = {
  exposure: 0, contrast: 0, blacks: 0, warmth: 0, saturation: 0, clarity: 0, skin: 0,
};

/**
 * The grade the owner's Remini comparison implied: brighter, punchier, warmer,
 * with skin lifted and whites brought up off grey. It is the starting point a
 * photograph gets when nobody has chosen anything.
 */
export const DEFAULT_GRADE: Grade = {
  exposure: 12, contrast: 22, blacks: 18, warmth: 10, saturation: 20, clarity: 30, skin: 14,
};

/** Controls are authored on a -100..100 scale and used as fractions. */
const f = (value: number) => value / 100;

/**
 * Holds a value inside a byte.
 *
 * A Uint8ClampedArray would do this on assignment, so in the browser this
 * function looks redundant — and a test written only against that type could
 * never catch its removal. The Worker path is a plain Uint8Array, where
 * assignment *wraps* instead: an overexposed highlight at 260 becomes 4, and a
 * bright sky comes back full of black speckles. NaN is worse still, wrapping
 * silently to 0. So the clamp is explicit, and the test runs against the
 * unclamped type where its absence actually shows.
 */
const clamp8 = (value: number) => (Number.isFinite(value) ? (value < 0 ? 0 : value > 255 ? 255 : value) : 0);

/**
 * Is this pixel plausibly skin?
 *
 * Warm (red above green above blue), neither crushed nor blown, and not
 * strongly coloured. It is a coarse test and it will catch wood, sand and
 * terracotta — which is acceptable, because the alternative considered was
 * lifting the whole frame, and that washes out the clothing and the sky along
 * with the face. Being wrong about a brick wall costs far less than being
 * wrong about every pixel.
 */
function isSkin(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return r > g && g > b && max > 60 && max < 250 && max - min < 120;
}

/**
 * Blurs into a fresh buffer, for the clarity pass to measure against.
 *
 * Separable box blur — horizontal then vertical — because a square kernel of
 * this radius applied directly is radius² work per pixel and would make a
 * slider drag stutter on a phone. Two passes give the same result for a box.
 */
function boxBlur(source: Pixels, width: number, height: number, radius: number): Uint8ClampedArray {
  const horizontal = new Uint8ClampedArray(source.length);
  const output = new Uint8ClampedArray(source.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let d = -radius; d <= radius; d += 1) {
        const sx = x + d;
        if (sx < 0 || sx >= width) continue;
        const j = (y * width + sx) * 4;
        r += source[j]; g += source[j + 1]; b += source[j + 2]; n += 1;
      }
      const i = (y * width + x) * 4;
      horizontal[i] = r / n; horizontal[i + 1] = g / n; horizontal[i + 2] = b / n;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let d = -radius; d <= radius; d += 1) {
        const sy = y + d;
        if (sy < 0 || sy >= height) continue;
        const j = (sy * width + x) * 4;
        r += horizontal[j]; g += horizontal[j + 1]; b += horizontal[j + 2]; n += 1;
      }
      const i = (y * width + x) * 4;
      output[i] = r / n; output[i + 1] = g / n; output[i + 2] = b / n; output[i + 3] = source[i + 3];
    }
  }

  return output;
}

/** Blur radius that scales with the image, so clarity looks the same at any size. */
export function clarityRadius(width: number, height: number): number {
  return Math.max(1, Math.round(Math.max(width, height) / 220));
}

/**
 * Applies a grade in place.
 *
 * The order below is the design, not an accident of writing. Clarity runs
 * first so that local contrast is recovered from the original tones rather
 * than from tones the curve has already stretched; saturation runs last so it
 * acts on the finished image. Reordering these produces a different look from
 * the same numbers, which is why the numbers the owner picks by eye are only
 * meaningful alongside this order.
 */
export function applyGrade(
  pixels: Pixels,
  width: number,
  height: number,
  grade: Grade,
): void {
  const exposure = f(grade.exposure);
  const contrast = f(grade.contrast);
  const blacks = f(grade.blacks);
  const warmth = f(grade.warmth);
  const saturation = f(grade.saturation);
  const clarity = f(grade.clarity);
  const skin = f(grade.skin);

  // A neutral grade must not touch a single byte, so the blur is skipped too:
  // it is by far the most expensive step here and would be pure waste.
  const blurred = clarity ? boxBlur(pixels, width, height, clarityRadius(width, height)) : null;

  for (let i = 0; i < pixels.length; i += 4) {
    let r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];

    if (blurred) {
      r += (r - blurred[i]) * clarity * 1.5;
      g += (g - blurred[i + 1]) * clarity * 1.5;
      b += (b - blurred[i + 2]) * clarity * 1.5;
    }

    if (exposure) {
      const k = 1 + exposure;
      r *= k; g *= k; b *= k;
    }

    if (blacks) {
      const k = (1 + blacks) / (1 + blacks * 0.35);
      const lift = blacks * 26;
      r = (r - lift) * k; g = (g - lift) * k; b = (b - lift) * k;
    }

    if (contrast) {
      const k = 1 + contrast;
      r = (r - 128) * k + 128;
      g = (g - 128) * k + 128;
      b = (b - 128) * k + 128;
    }

    if (warmth) {
      r *= 1 + warmth * 0.16;
      b *= 1 - warmth * 0.13;
    }

    // Read against the values as they now stand: a face that has just been
    // lifted and warmed is more recognisably skin than it was in a dull frame.
    if (skin && isSkin(r, g, b)) {
      const lift = skin * 34;
      r += lift; g += lift * 0.93; b += lift * 0.86;
    }

    if (saturation) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const k = 1 + saturation;
      r = luma + (r - luma) * k;
      g = luma + (g - luma) * k;
      b = luma + (b - luma) * k;
    }

    pixels[i] = clamp8(r);
    pixels[i + 1] = clamp8(g);
    pixels[i + 2] = clamp8(b);
    // Alpha is deliberately untouched: a grade changes how a photograph looks,
    // never which of it is there.
  }
}

/** Combines grades, so a filter, a lighting choice and a focus choice stack. */
export function mergeGrades(...grades: Array<Partial<Grade>>): Grade {
  const total = { ...NEUTRAL };
  for (const grade of grades) {
    for (const key of Object.keys(total) as Array<keyof Grade>) {
      total[key] += grade[key] ?? 0;
    }
  }
  return total;
}
