import { measure, type Bitmap, type Measurements } from './analyze';

/**
 * Chooses which restoration path a photograph takes.
 *
 * The owner asked for Remini's four treatments and Remini's single button at
 * the same time (2026-09-06), and those are only compatible if the product
 * does the diagnosing. This is that diagnosis.
 *
 * The order of the rules is the whole design. They are checked worst-damage
 * first, because a photograph can be several things at once — an old scan is
 * usually also soft and also speckled — and the path that repairs the most
 * severe problem is the one that should run. Reordering these rules changes
 * which model runs for a large share of real photographs, so the reasoning for
 * each position is written down rather than left to be rediscovered.
 */

export type PathId = 'dust_scratch' | 'recover' | 'super_focus' | 'high_fidelity';

export type Path = {
  id: PathId;
  /** What the customer is told, if anything is shown at all. */
  label: string;
  /** Why this path was chosen, in the owner's language, for the usage log. */
  reason: string;
};

const PATHS: Record<PathId, Omit<Path, 'reason'>> = {
  dust_scratch: { id: 'dust_scratch', label: 'ترميم صورة متضررة' },
  recover: { id: 'recover', label: 'استرجاع صورة قديمة' },
  super_focus: { id: 'super_focus', label: 'توضيح صورة مشوّشة' },
  high_fidelity: { id: 'high_fidelity', label: 'تحسين وتنقية' },
};

/**
 * Thresholds, gathered here because they are the part that will need tuning
 * against real photographs and should never be hunted for inside the logic.
 *
 * These are starting points derived from what each measurement means, not from
 * a labelled set — there isn't one yet. `npm run route` renders the decision
 * for a real photograph so they can be corrected by looking rather than by
 * guessing.
 */
export const THRESHOLDS = {
  /** Above this share of isolated specks, damage dominates. */
  speckle: 0.004,
  /**
   * And above this, it is not damage any more.
   *
   * Real dust is sparse — a scanned print carries specks in fractions of a
   * percent. A reading far above that is not a damaged photograph but a noisy
   * or heavily textured one, and sending it down the scratch-repair path would
   * treat its texture as something to erase.
   */
  speckleCeiling: 0.06,
  /** Below this saturation, the original is effectively black and white. */
  greyscale: 12,
  /** Small enough that detail must be rebuilt, not merely sharpened. */
  smallMegapixels: 0.6,
  /** Below this Laplacian spread the frame is genuinely soft. */
  soft: 4.5,
  /** Very soft: nothing in the frame holds an edge. */
  verySoft: 2.5,
};

export function choosePath(m: Measurements): Path {
  // Damage first. Dust and scratches survive every other treatment - a model
  // asked to sharpen a scratched print returns a sharper scratch - so this is
  // decided before anything else regardless of focus or size.
  if (m.speckle > THRESHOLDS.speckle && m.speckle < THRESHOLDS.speckleCeiling) {
    return { ...PATHS.dust_scratch, reason: 'خدوش أو غبار على الصورة' };
  }

  // Old prints next. Greyscale or tiny means the detail is not there to
  // sharpen and has to be rebuilt, which is a different job from focusing.
  // Checked before softness because an old scan is nearly always soft too, and
  // treating it as merely out of focus would sharpen an absence.
  if (m.megapixels < THRESHOLDS.smallMegapixels || m.colorfulness < THRESHOLDS.greyscale) {
    const reason =
      m.colorfulness < THRESHOLDS.greyscale ? 'صورة قديمة بالأبيض والأسود' : 'دقة منخفضة جداً';
    return { ...PATHS.recover, reason };
  }

  // A modern colour photograph that simply missed focus. The size and colour
  // checks above have already ruled out the cases where softness means
  // something else, so a low score here can be taken at face value.
  if (m.sharpness < THRESHOLDS.soft) {
    const reason = m.sharpness < THRESHOLDS.verySoft ? 'الصورة مشوّشة بشدة' : 'الصورة خارج الفوكس';
    return { ...PATHS.super_focus, reason };
  }

  // Nothing is wrong with it; make it better. This is the common case, and it
  // is deliberately last so that it is what remains rather than what is
  // guessed at.
  return { ...PATHS.high_fidelity, reason: 'صورة سليمة — تحسين عام' };
}

/** Measures and routes in one step, which is how callers should use this. */
export function routeImage(image: Bitmap): { path: Path; measurements: Measurements } {
  const measurements = measure(image);
  return { path: choosePath(measurements), measurements };
}
