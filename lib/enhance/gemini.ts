import { EnhanceProvider, EnhanceRequest, EnhanceResult, ProviderError } from './provider';

/**
 * Gemini image model provider, called over plain REST.
 *
 * No SDK: this runs on Cloudflare Workers, where the Node SDK is not a safe
 * bet, and the request shape here is small enough that a dependency buys
 * nothing.
 *
 * Model choice is recorded in docs/DISCUSSION.md §10 — this is the family the
 * closest comparable product runs on, which is why it was picked over the
 * cheaper but four-year-older open models.
 */

/** Overridable so the pipeline can be exercised end to end against a stub, and
 *  so a Vertex AI endpoint can be swapped in without touching this file. */
const API_BASE =
  process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.1-flash-image';
const REQUEST_TIMEOUT_MS = 90_000;

/**
 * The instruction is deliberately conservative. The product promise is
 * restoration, not reinvention: a face that comes back sharper must still be
 * the same person, and nothing absent from the original may be invented.
 */
const RESTORE_PROMPT = [
  'Restore and enhance this photograph.',
  'Sharpen facial features, recover skin and hair texture, reduce blur, noise and compression artifacts, and correct faded or shifted colors.',
  'Preserve the identity of every person exactly: do not alter face shape, proportions, age, expression, or skin tone.',
  'Preserve the original composition, framing, pose, clothing and background.',
  'If a detail is unclear, preserve the source rather than inventing a replacement.',
  'Do not add, remove or invent any object, person or body part that is not present in the original.',
  'Return only the restored photograph.',
].join(' ');

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked to stay well under the argument limit for large images.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Reads intrinsic dimensions from the encoded bytes, so billing is measured on
 *  what the provider actually returned rather than on what we asked for. */
function readDimensions(buffer: ArrayBuffer): { width: number; height: number } {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // PNG: IHDR width/height sit at a fixed offset.
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG: walk the segment markers to the frame header.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      // SOF0..SOF15, excluding the non-frame markers DHT/JPGA/DAC.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }

  return { width: 0, height: 0 };
}

export class GeminiProvider implements EnhanceProvider {
  readonly name = 'gemini';
  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(apiKey = process.env.GEMINI_API_KEY, model = process.env.ENHANCE_MODEL || DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async enhance(request: EnhanceRequest): Promise<EnhanceResult> {
    if (!this.apiKey) {
      throw new ProviderError('GEMINI_API_KEY is not set.', 'not_configured', 503, true);
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${API_BASE}/${this.model}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: RESTORE_PROMPT },
                {
                  inline_data: {
                    mime_type: request.inputContentType,
                    data: toBase64(request.image),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { imageSize: request.maxOutputEdge >= 2048 ? '2K' : '1K' },
          },
        }),
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        throw new ProviderError('The model took too long to respond.', 'timeout', 504);
      }
      throw new ProviderError(`Could not reach the model: ${(error as Error).message}`, 'upstream');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(
        `Model returned ${response.status}: ${detail.slice(0, 400)}`,
        'upstream',
        response.status === 429 ? 429 : 502,
        response.status >= 400 && response.status < 500,
      );
    }

    const payload = (await response.json()) as GeminiResponse;

    if (payload.promptFeedback?.blockReason) {
      throw new ProviderError(`Blocked: ${payload.promptFeedback.blockReason}`, 'rejected', 422, true);
    }

    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts
      .map((part) => part.inlineData ?? part.inline_data)
      .find((data): data is { mimeType?: string; mime_type?: string; data?: string } => Boolean(data?.data));

    if (!imagePart?.data) {
      throw new ProviderError('The model returned no image.', 'no_image', 502);
    }

    const image = fromBase64(imagePart.data);
    const { width, height } = readDimensions(image);

    return {
      image,
      contentType:
        ('mimeType' in imagePart ? imagePart.mimeType : undefined) ??
        ('mime_type' in imagePart ? imagePart.mime_type : undefined) ??
        'image/png',
      width,
      height,
      outputMegapixels: Number(((width * height) / 1_000_000).toFixed(3)),
      model: this.model,
      requestId: request.requestId,
      durationMs: Date.now() - startedAt,
    };
  }
}
