/**
 * Identifies an image by its bytes rather than by what the caller claims.
 *
 * `File.type` on an upload is whatever the client put in the multipart header.
 * Anyone can send arbitrary bytes labelled `image/jpeg`, and before this check
 * those bytes were forwarded to the provider — which means a stranger could
 * spend the owner's budget on payloads that were never photographs, and the
 * daily cap would drain without a single real customer being served.
 *
 * The signatures below are the first bytes each format is defined to start
 * with, so this rejects before any reservation is made rather than discovering
 * the problem when the provider complains.
 */

/** Formats the provider accepts, keyed by the MIME type we forward. */
const SIGNATURES: Array<{ type: string; matches: (bytes: Uint8Array) => boolean }> = [
  {
    // SOI marker, then the start of any JFIF/EXIF/raw APPn segment.
    type: 'image/jpeg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    // \x89 P N G \r \n \x1a \n — the full eight-byte header.
    type: 'image/png',
    matches: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    // RIFF container whose form type is WEBP: "RIFF" ???? "WEBP".
    type: 'image/webp',
    matches: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/** Longest signature we inspect, so only a header slice needs reading. */
export const SIGNATURE_BYTES = 12;

/**
 * Returns the real MIME type, or null when the bytes are not an image we
 * accept. The returned value — never the caller's — is what should be sent on.
 */
export function sniffImageType(header: ArrayBuffer | Uint8Array): string | null {
  const bytes = header instanceof Uint8Array ? header : new Uint8Array(header);
  if (bytes.length < SIGNATURE_BYTES) return null;
  return SIGNATURES.find((signature) => signature.matches(bytes))?.type ?? null;
}
