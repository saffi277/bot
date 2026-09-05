/**
 * Abstract port for photo restoration providers.
 *
 * Every model call in this project goes through this interface. Nothing else
 * may talk to a provider directly. The point is that moving to a dedicated GPU
 * server later (see docs/DISCUSSION.md) is a matter of adding one file here,
 * not rewriting callers.
 *
 * The provider is a dumb executor: it knows nothing about Telegram, users,
 * daily limits, or pricing tiers. Those are policy, and policy lives in the API
 * route (docs/ARCHITECTURE.md §3.3).
 */

export type EnhanceRequest = {
  /** Raw image bytes, already downscaled by the client to maxOutputEdge. */
  image: ArrayBuffer;
  /** MIME type of the input, so the provider need not sniff it. */
  inputContentType: string;
  /** Longest edge of the output. Guards against a 15x cost blowup. */
  maxOutputEdge: number;
  /**
   * Instruction for the model, chosen by the caller from lib/enhance/operations.
   * It lives there rather than here because which service ran is policy, and
   * this port is meant to know nothing about policy.
   */
  prompt: string;
  /** Trace id carried through logs and into the provider call. */
  requestId: string;
};

export type EnhanceResult = {
  image: ArrayBuffer;
  contentType: string;
  width: number;
  height: number;
  /** Output megapixels — the unit providers bill on. */
  outputMegapixels: number;
  /** Model that actually ran, for cost attribution across models. */
  model: string;
  requestId: string;
  /** Wall-clock duration. Decides whether async processing is needed. */
  durationMs: number;
};

export interface EnhanceProvider {
  readonly name: string;
  /** False when credentials are missing, so callers can degrade gracefully. */
  isConfigured(): boolean;
  enhance(request: EnhanceRequest): Promise<EnhanceResult>;
}

/** Thrown when the provider itself fails. The API route decides what the user sees. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'rejected' | 'no_image' | 'upstream' | 'timeout',
    readonly status = 502,
    /** True only when the upstream rejected before doing model work. */
    readonly safeToRelease = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
