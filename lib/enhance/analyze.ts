/**
 * Measures a photograph so the product can pick its own restoration path.
 *
 * The owner uses Remini by pressing one button, and Remini decides internally
 * what the picture needs. Reproducing that means the four Topaz paths cannot
 * become four buttons — the customer would have to diagnose their own
 * photograph, which is the job we are being paid to do.
 *
 * So the choice is made from the pixels. Everything here is arithmetic over an
 * already-decoded image: no model call, no cost, no latency worth measuring,
 * and the same picture always routes the same way. That last property matters
 * more than it sounds — a router that is a model would make the bill and the
 * result both unpredictable, and a customer who resends the same photo would
 * have no idea why they got something different.
 *
 * Each measurement below is a proxy, not a truth. The comments say what each
 * one actually detects and where it lies, because a heuristic whose limits are
 * undocumented gets trusted well past them.
 */

/** A decoded image: 8-bit RGBA, as any decoder in this project produces. */
export type Bitmap = {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
};

export type Measurements = {
  megapixels: number;
  /**
   * Normalised focus estimate, roughly 0 (featureless) upward. Derived from the
   * variance of a Laplacian, the standard blur measure: a sharp edge produces a
   * large second derivative, a blurred one does not.
   *
   * It cannot tell a photograph that is out of focus from one that is simply of
   * a smooth subject — a clear picture of a blank wall scores low. That is why
   * a low score alone never selects a path; it is always read together with
   * size and detail.
   */
  sharpness: number;
  /**
   * How much colour the image carries, 0 for greyscale upward. Separates
   * black-and-white and sepia originals — almost always old prints — from
   * colour photographs.
   */
  colorfulness: number;
  /**
   * Fraction of pixels that are isolated specks sitting on an otherwise even
   * surround — much lighter or darker than all four immediate neighbours,
   * where those neighbours agree with each other. Dust and scratches on a
   * scanned print look exactly like this.
   *
   * The surround condition is not optional. Without it, fine repeating detail
   * scores at the maximum: in a checkerboard every pixel differs from all four
   * of its neighbours, so a perfectly sharp, undamaged photograph of a
   * patterned shirt reads as heavily scratched. That was a real defect here,
   * caught by a test rather than by a customer.
   */
  speckle: number;
  /** Mean luminance, 0-255. Used only to describe the frame, never to route. */
  brightness: number;
};

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Samples rather than reading every pixel.
 *
 * A 12MP photograph is 48MB of RGBA, and every statistic here converges long
 * before the whole frame is read. The step is chosen so roughly a quarter of a
 * million pixels are examined whatever the input size, which keeps the cost of
 * routing flat instead of growing with the customer's camera.
 */
function stride(width: number, height: number): number {
  return Math.max(1, Math.round(Math.sqrt((width * height) / 250_000)));
}

export function measure(image: Bitmap): Measurements {
  const { data, width, height } = image;
  const step = stride(width, height);

  let sum = 0;
  let count = 0;
  let laplacianSum = 0;
  let laplacianSquares = 0;
  let laplacianCount = 0;
  let colorSum = 0;
  let speckles = 0;

  const at = (x: number, y: number) => (y * width + x) * 4;

  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const i = at(x, y);
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const centre = luma(r, g, b);

      sum += centre;
      count += 1;

      // Saturation as max-minus-min: cheap, and enough to separate a grey scan
      // from a colour photograph, which is all it is asked to do.
      colorSum += Math.max(r, g, b) - Math.min(r, g, b);

      // Focus is measured across the sampling stride, because blur is a loss
      // of detail at the scale being sampled.
      const up = at(x, y - step), down = at(x, y + step);
      const left = at(x - step, y), right = at(x + step, y);
      const n = luma(data[up], data[up + 1], data[up + 2]);
      const s = luma(data[down], data[down + 1], data[down + 2]);
      const w = luma(data[left], data[left + 1], data[left + 2]);
      const e = luma(data[right], data[right + 1], data[right + 2]);

      // Damage is measured across immediate neighbours instead: a speck of
      // dust is one pixel wide, and a stride steps straight over it.
      const iUp = at(x, y - 1), iDown = at(x, y + 1);
      const iLeft = at(x - 1, y), iRight = at(x + 1, y);
      const nUp = luma(data[iUp], data[iUp + 1], data[iUp + 2]);
      const nDown = luma(data[iDown], data[iDown + 1], data[iDown + 2]);
      const nLeft = luma(data[iLeft], data[iLeft + 1], data[iLeft + 2]);
      const nRight = luma(data[iRight], data[iRight + 1], data[iRight + 2]);

      // Discrete Laplacian: how far this pixel sits from the average of its
      // neighbours. Its variance across the frame is the focus estimate.
      const laplacian = n + s + w + e - 4 * centre;
      laplacianSum += laplacian;
      laplacianSquares += laplacian * laplacian;
      laplacianCount += 1;

      // A speck differs from all four neighbours *and* sits on an even
      // surround. Requiring all four rules out edges, which differ from only
      // some of their neighbours. Requiring the neighbours to agree with each
      // other rules out fine texture, where every pixel differs from all of
      // its neighbours and nothing is damaged at all.
      const neighbours = [nUp, nDown, nLeft, nRight];
      const spread = Math.max(...neighbours) - Math.min(...neighbours);
      if (spread < 30) {
        const brighter = neighbours.every((value) => centre - value > 45);
        const darker = neighbours.every((value) => value - centre > 45);
        if (brighter || darker) speckles += 1;
      }
    }
  }

  if (!count || !laplacianCount) {
    // An image too small to sample tells us nothing; report neutral values and
    // let the router fall back to its default rather than divide by zero.
    return { megapixels: (width * height) / 1e6, sharpness: 0, colorfulness: 0, speckle: 0, brightness: 128 };
  }

  const mean = laplacianSum / laplacianCount;
  const variance = laplacianSquares / laplacianCount - mean * mean;

  return {
    megapixels: Number(((width * height) / 1e6).toFixed(3)),
    // Square-rooted so the scale is comparable to pixel values rather than
    // their squares, which makes the thresholds in route.ts legible.
    sharpness: Number(Math.sqrt(Math.max(0, variance)).toFixed(2)),
    colorfulness: Number((colorSum / count).toFixed(2)),
    speckle: Number((speckles / count).toFixed(5)),
    brightness: Number((sum / count).toFixed(1)),
  };
}
