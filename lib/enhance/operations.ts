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

/**
 * Two kinds, because the owner and Codex were each right about a different
 * thing and the disagreement dissolves once they are separated.
 *
 * `enhance` is the one-button path: the visitor uploads and the model decides
 * what the photograph needs. No menu, no choice to get wrong — Codex's
 * position, and the flow fixed in docs/DISCUSSION.md.
 *
 * `creative` is a service the visitor deliberately picks, because it makes a
 * *different* picture rather than a better version of theirs. Someone looking
 * to put themselves onto a character will never find it behind a button
 * labelled "restore", which is the owner's point.
 *
 * They also differ in money, which is why the distinction is in the type and
 * not just in the copy: enhancement is one call, and a creative service that
 * returns several variants costs one call each.
 */
export type OperationKind = 'enhance' | 'creative';

export type Operation = {
  /** Stable id sent by the client. Never translated — it is a wire value. */
  id: string;
  kind: OperationKind;
  /** Arabic label shown to the visitor. */
  label: string;
  /** One line telling the visitor what this does to their photo. */
  hint: string;
  /**
   * Quota cost of one run, which must equal the number of model calls made.
   * At $0.101 per 2K image, a service returning four variants costs the owner
   * $0.40 per press and eats four of a visitor's daily allowance.
   */
  units: number;
  /** Instruction sent to the model. */
  prompt: string;
};

/**
 * The most important string in the product.
 *
 * It has been wrong twice, in opposite directions. First it told the model to
 * preserve the source wherever detail was unclear, which on a photograph
 * missing a third of its emulsion means leaving the holes — no restoration at
 * all. Then the correction overshot: "if facial detail is lost, leave it soft"
 * instructed the model to hand back a blurred face, which is the one thing the
 * owner is asking for and the single reason anyone opens Remini. A sharp
 * background around a soft face is not a restored photograph.
 *
 * The distinction that actually holds is recover versus replace. Every feature
 * the photograph contains, however faintly, is brought into focus — that is
 * the product. What is genuinely absent is not fabricated, because a rebuilt
 * face is a different person and that breaks the promise entirely.
 *
 * Beautifying is refused separately and on purpose. Smoothing skin, reshaping
 * a jaw or whitening teeth all raise the same complaint against tools in this
 * category: the person in the result is not the person in the photograph. The
 * owner asked for light adjustment, and restraint is part of the instruction
 * rather than something hoped for.
 *
 * Only a real key can settle whether this reads as well to the model as it
 * does to us. `npm run bakeoff` exists for exactly that comparison.
 */
export const RESTORE_PROMPT = [
  'Restore and enhance this photograph.',
  'Bring the entire image into sharp focus: recover fine detail and the real texture of skin, hair and fabric, and remove blur, softness, noise and compression artifacts.',
  'Faces are the priority. Bring every face into clear, natural focus — recover the eyes, eyebrows, lashes, lips, hair and skin texture the photograph already contains, however faintly. Never hand back a soft face in a sharp image.',
  'Recover, do not replace: sharpen the features that are present rather than substituting new ones. Where detail is genuinely absent, stay restrained and plausible instead of inventing a different face.',
  'The identity of every person must survive unchanged — do not alter face shape, proportions, age, expression, skin tone, or the position and spacing of the eyes, nose and mouth.',
  'Do not beautify: no skin smoothing that erases pores, freckles or wrinkles, no reshaping, no added makeup, no teeth whitening, no slimming. The person must remain recognisably themselves.',
  'Correct faded or shifted colours and white balance with a light hand, keeping skin tones natural and avoiding oversaturation.',
  'Repair physical damage — tears, cracks, missing emulsion, scratches, stains, fading — by reconstructing what the surrounding image implies.',
  'Preserve the original composition, framing, pose, clothing and background.',
  'Do not add objects, people or elements that the original does not imply.',
  'Return only the restored photograph, with no added border, frame, margin, watermark, signature or decoration, and keep the original framing and aspect ratio.',
].join(' ');

export const OPERATIONS: readonly Operation[] = [
  {
    id: 'restore',
    kind: 'enhance',
    label: 'ترميم وتحسين',
    hint: 'يشدّ الملامح، يرجّع تفاصيل الجلد والشعر، يشيل التشويش، ويصلّح الألوان الباهتة وأضرار الصورة',
    units: 1,
    prompt: RESTORE_PROMPT,
  },
  // Creative services go here as they are decided. Each one needs a name, a
  // line of copy, and an honest unit count — and the unit count is the part
  // that must not be guessed, because it is the owner's money.
];

/**
 * Used when a client sends no operation. It is the one-button path, so the
 * default must always be an `enhance` service — falling back to a creative one
 * would spend a visitor's quota on a picture they never asked for.
 */
export const DEFAULT_OPERATION = 'restore';

/** Returns the operation, or null for an id we do not offer. */
export function findOperation(id: string | null | undefined): Operation | null {
  return OPERATIONS.find((operation) => operation.id === (id || DEFAULT_OPERATION)) ?? null;
}

/** What the front end needs to render the catalogue. The prompt stays server-side. */
export function catalogue(): Array<Omit<Operation, 'prompt'>> {
  return OPERATIONS.map((operation) => ({
    id: operation.id,
    kind: operation.kind,
    label: operation.label,
    hint: operation.hint,
    units: operation.units,
  }));
}
