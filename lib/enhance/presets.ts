import { DEFAULT_GRADE, mergeGrades, NEUTRAL, type Grade } from './grade';

/**
 * The choices offered after a photograph comes back.
 *
 * The owner asked for what Remini shows on its result screen: filters, several
 * lighting options, and more than one focus setting. Built as three separate
 * features that would be three sets of image code to keep in step; built as
 * named grades they are one engine and a list of data, and adding a filter
 * later is a line here rather than a change to anything that runs.
 *
 * They stack, which is why they are grouped rather than merged into one long
 * menu: a customer picks at most one from each group, and the three chosen
 * grades add together (see mergeGrades). A single flat list would make
 * "warm" and "brighter" mutually exclusive for no reason a customer could see.
 *
 * Every value here is a starting point, not a measurement. They were derived
 * from the Remini frames the owner supplied and are meant to be corrected by
 * eye in tools/grade.html — that is what that tool is for.
 */

export type PresetGroup = 'filter' | 'light' | 'focus';

export type Preset = {
  id: string;
  group: PresetGroup;
  /** Arabic, shown on the result screen. */
  label: string;
  /** Adjustments this preset contributes, added to the others. */
  grade: Partial<Grade>;
};

/**
 * The grade every photograph gets before anyone chooses anything.
 *
 * It is the default because a customer who never touches the controls should
 * still receive the finished look, not a flat frame waiting to be improved.
 */
export const BASE_GRADE: Grade = DEFAULT_GRADE;

export const PRESETS: readonly Preset[] = [
  // Filters: the overall look. "طبيعي" is deliberately empty rather than
  // absent, so the result screen has something to show as selected and a
  // customer can always get back to the plain grade.
  { id: 'natural', group: 'filter', label: 'طبيعي', grade: {} },
  { id: 'warm', group: 'filter', label: 'دافئ', grade: { warmth: 18, saturation: 8 } },
  { id: 'cool', group: 'filter', label: 'بارد', grade: { warmth: -20, saturation: 4 } },
  { id: 'cinema', group: 'filter', label: 'سينمائي', grade: { contrast: 16, blacks: 20, saturation: -8, warmth: 6 } },
  { id: 'vivid', group: 'filter', label: 'زاهي', grade: { saturation: 26, contrast: 8 } },
  // Saturation is driven fully negative rather than to a fixed grey, so the
  // conversion follows the luma weights already in applyGrade instead of
  // needing a second, differently-behaved code path.
  { id: 'mono', group: 'filter', label: 'أبيض وأسود', grade: { saturation: -100, contrast: 14, blacks: 12 } },
  { id: 'vintage', group: 'filter', label: 'قديم', grade: { warmth: 26, saturation: -18, contrast: -6, blacks: -8 } },

  // Lighting.
  { id: 'as_is', group: 'light', label: 'كما هي', grade: {} },
  { id: 'brighter', group: 'light', label: 'أفتح', grade: { exposure: 14 } },
  { id: 'face', group: 'light', label: 'إبراز الوجه', grade: { skin: 16, exposure: 4 } },
  { id: 'deep', group: 'light', label: 'ظل عميق', grade: { blacks: 22, contrast: 10 } },

  // Focus. Clarity is local contrast, which is what "sharper" means to an eye
  // looking at a photograph, and it is bounded on purpose: past this the
  // result stops looking like a photograph and starts looking processed.
  { id: 'soft', group: 'focus', label: 'ناعم', grade: { clarity: -15 } },
  { id: 'medium', group: 'focus', label: 'متوسط', grade: {} },
  { id: 'sharp', group: 'focus', label: 'حاد', grade: { clarity: 20 } },
  { id: 'very_sharp', group: 'focus', label: 'حاد جداً', grade: { clarity: 40 } },
];

/** The preset chosen in each group when the customer has chosen nothing. */
export const DEFAULT_PRESETS: Record<PresetGroup, string> = {
  filter: 'natural',
  light: 'as_is',
  focus: 'medium',
};

export function findPreset(group: PresetGroup, id: string | null | undefined): Preset | null {
  const wanted = id || DEFAULT_PRESETS[group];
  return PRESETS.find((preset) => preset.group === group && preset.id === wanted) ?? null;
}

/**
 * Resolves a customer's three choices into the single grade to apply.
 *
 * An unknown id falls back to that group's default rather than throwing: this
 * is a display choice with no cost attached, and refusing to render a
 * photograph because a stale filter name arrived would be a worse failure than
 * showing the standard look.
 */
export function resolveGrade(choice: Partial<Record<PresetGroup, string>> = {}): Grade {
  const groups: PresetGroup[] = ['filter', 'light', 'focus'];
  const chosen = groups.map((group) => findPreset(group, choice[group])?.grade ?? NEUTRAL);
  return mergeGrades(BASE_GRADE, ...chosen);
}

/** What the result screen renders. The shape is data, so the screen holds no list. */
export function presetCatalogue(): Array<Omit<Preset, 'grade'>> {
  return PRESETS.map(({ id, group, label }) => ({ id, group, label }));
}
