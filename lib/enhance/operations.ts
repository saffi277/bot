/**
 * The catalogue of services the site offers.
 *
 * One place defines what a service is called, what it does, what it costs, and
 * how the model is instructed. Adding a service is a data change here, not a
 * new route, a new provider, or a new counter — which is the point: the daily
 * cap in lib/ratelimit.ts only bounds the bill while every service passes
 * through it, and services scattered across their own endpoints is exactly how
 * one of them ends up not doing so.
 *
 * `units` is what one run costs against the caller's daily quota, and it must
 * equal the number of model calls the operation makes. An operation that runs
 * the model twice and charges one unit would let real spending drift to twice
 * the cap while the counter still looked correct.
 *
 * The list is deliberately short. The owner asked for Remini's services or
 * more, and the actual list is still being established — guessing at it here
 * would put invented features in front of customers. Everything needed to add
 * them is in place; what is missing is the list, not the machinery.
 */

export type Operation = {
  /** Stable id sent by the client. Never translated — it is a wire value. */
  id: string;
  /** Arabic label shown to the visitor. */
  label: string;
  /** One line telling the visitor what this does to their photo. */
  hint: string;
  /** Quota cost of one run. Must equal the number of model calls made. */
  units: number;
  /** Instruction sent to the model. */
  prompt: string;
};

/**
 * The first real test showed the earlier wording contradicted itself: it asked
 * the model to preserve the source wherever detail was unclear, which on a
 * photograph missing a third of its emulsion means leaving the holes — no
 * restoration at all. It produced a good result only by disobeying.
 *
 * The line that matters is not whether the model invents, but what it may
 * invent. Physical damage is reconstructed from what surrounds it; a face
 * never is, because a rebuilt face is a different person and that breaks the
 * whole promise.
 */
export const RESTORE_PROMPT = [
  'Restore and enhance this photograph.',
  'Sharpen detail, recover skin, hair and fabric texture, reduce blur, noise and compression artifacts, and correct faded or shifted colors.',
  'Repair physical damage — tears, cracks, missing emulsion, scratches, stains, fading — by reconstructing what the surrounding image implies.',
  'Never reconstruct a face: if facial detail is lost, leave it soft rather than inventing features. The identity of every person must survive unchanged — do not alter face shape, proportions, age, expression, or skin tone.',
  'Preserve the original composition, framing, pose, clothing and background.',
  'Do not add objects, people or elements that the original does not imply.',
  'Return only the restored photograph, with no added border, frame, margin, watermark, signature or decoration, and keep the original framing and aspect ratio.',
].join(' ');

export const OPERATIONS: readonly Operation[] = [
  {
    id: 'restore',
    label: 'ترميم وتحسين',
    hint: 'يشدّ الملامح، يرجّع تفاصيل الجلد والشعر، يشيل التشويش، ويصلّح الألوان الباهتة وأضرار الصورة',
    units: 1,
    prompt: RESTORE_PROMPT,
  },
];

/** The operation used when a client sends none, so older callers keep working. */
export const DEFAULT_OPERATION = 'restore';

/** Returns the operation, or null for an id we do not offer. */
export function findOperation(id: string | null | undefined): Operation | null {
  return OPERATIONS.find((operation) => operation.id === (id || DEFAULT_OPERATION)) ?? null;
}

/** What the front end needs to render the catalogue. The prompt stays server-side. */
export function catalogue(): Array<Omit<Operation, 'prompt'>> {
  return OPERATIONS.map((operation) => ({
    id: operation.id,
    label: operation.label,
    hint: operation.hint,
    units: operation.units,
  }));
}
