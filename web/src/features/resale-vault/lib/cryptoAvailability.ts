/**
 * Crypto/storage capability detection.
 *
 * The vault NEVER falls back to a weak signing method. If `crypto.subtle`
 * is unavailable (non-secure context, ancient browser, locked-down webview),
 * every signing/verification entry point throws `CryptoUnavailableError`
 * explicitly instead of silently producing an unsigned or hash-only
 * "signature".
 */

export class CryptoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoUnavailableError';
  }
}

/** True when `crypto.subtle` (Web Crypto's asymmetric/hash API) is available in this context. */
export function isSubtleCryptoAvailable(): boolean {
  return typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle !== 'undefined';
}

/** True when this environment exposes an `indexedDB` global at all (does not test structured-clone support — see signingKeyRepository.ts for that probe). */
export function isIndexedDbAvailable(): boolean {
  return typeof globalThis.indexedDB !== 'undefined';
}

/**
 * Returns the SubtleCrypto instance, or throws `CryptoUnavailableError` with
 * an explicit, user-facing explanation. Call this at the top of every
 * signing/verification function — never guess or silently degrade.
 */
export function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new CryptoUnavailableError(
      'Web Crypto (crypto.subtle) is not available in this browser or context. ' +
        'This usually means the page is not served over HTTPS (or localhost). ' +
        'TeslaSync will not fall back to a weaker signing method — report ' +
        'signing and verification are disabled until Web Crypto is available.',
    );
  }
  return subtle;
}
