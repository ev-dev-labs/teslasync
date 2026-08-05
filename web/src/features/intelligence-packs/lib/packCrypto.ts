/**
 * Web Crypto primitives for Intelligence-Pack verification: SHA-256 content
 * digests and Ed25519 signature verification.
 *
 * ── Security posture (read this before calling anything below) ──────────
 *
 * - `crypto.subtle` (SubtleCrypto) only exists in a *secure context*
 *   (HTTPS or literal `localhost`). If it is unavailable we throw
 *   `CryptoUnavailableError` — there is NO fallback to a weaker,
 *   non-cryptographic hash or a hand-rolled JS Ed25519 implementation.
 *   Weak fallbacks are exactly the failure mode this module exists to
 *   prevent (a bundled pure-JS signature verifier would itself be an
 *   unaudited trust-critical dependency and a supply-chain risk).
 * - Ed25519 support inside `crypto.subtle` ("Secure Curves", W3C) is newer
 *   than SHA-256 support and is feature-detected independently. When
 *   `crypto.subtle` exists but the browser build doesn't implement the
 *   Ed25519 algorithm identifier, we throw `Ed25519UnsupportedError` —
 *   again, no fallback. Pack installation MUST fail explicitly in this
 *   case; see `verifyEnvelope.ts`.
 * - `verifyEd25519()` proves the signer possessed the private key matching
 *   `publicKeyBase64` and that `message` has not been altered since it was
 *   signed. It proves NOTHING about whether that key belongs to a
 *   publisher you should trust — that is a separate, local policy decision
 *   (see `trust.ts` / `KNOWN_PUBLISHER_FINGERPRINTS`). Never conflate the
 *   two in UI copy.
 */

export class CryptoUnavailableError extends Error {
  constructor() {
    super('SHA-256/Ed25519 requires a secure context (HTTPS or localhost) with Web Crypto (crypto.subtle) available.');
    this.name = 'CryptoUnavailableError';
  }
}

export class Ed25519UnsupportedError extends Error {
  constructor() {
    super('This browser\'s Web Crypto implementation does not support the Ed25519 algorithm. Pack installation cannot proceed without a weaker, unsafe fallback — please use an up-to-date Chromium, Firefox, or Safari build.');
    this.name = 'Ed25519UnsupportedError';
  }
}

function getSubtle(): SubtleCrypto | null {
  if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
  return null;
}

/** SHA-256 hex digest of raw bytes. Throws `CryptoUnavailableError` — never silently degrades. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = getSubtle();
  if (subtle == null) throw new CryptoUnavailableError();
  // `bytes` may be a view over a larger buffer (e.g. produced by
  // `Uint8Array.prototype.slice` callers upstream); `.slice()` here forces a
  // tight, standalone `ArrayBuffer` so `BufferSource` typing is satisfied
  // without an `as unknown as ArrayBuffer` cast.
  const digestBuffer = await subtle.digest('SHA-256', bytes.slice());
  return Array.from(new Uint8Array(digestBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Convenience overload accepting a UTF-8 string. */
export async function sha256HexOfString(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

/**
 * Standard (non-URL-safe) base64 decode → bytes. Returns `null` (never
 * throws) on malformed input so callers can treat a corrupt
 * publicKey/signature field as "invalid", not a crash.
 */
export function base64ToBytes(b64: string): Uint8Array | null {
  if (typeof b64 !== 'string' || b64.length === 0) return null;
  // Reject anything outside the standard base64 alphabet up front — `atob`
  // is lenient about some inputs in ways that vary by engine.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) return null;
  try {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Standard (non-URL-safe) base64 encode. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;

let ed25519SupportCache: Promise<boolean> | null = null;

/**
 * Feature-detects Web Crypto Ed25519 support by attempting a harmless
 * `importKey` of a zeroed 32-byte raw key. Cached for the session — the
 * result cannot change while the page is open.
 *
 * Browser support note: Ed25519 in `crypto.subtle` ("Secure Curves") is a
 * comparatively recent addition (roughly: Chrome/Edge 137+, Firefox 130+,
 * Safari 17+ — exact versions vary by OS and are evolving). Older/locked-down
 * browsers, and ANY non-secure-context origin, will report unsupported.
 */
export function isEd25519Supported(): Promise<boolean> {
  if (ed25519SupportCache) return ed25519SupportCache;
  ed25519SupportCache = (async () => {
    const subtle = getSubtle();
    if (subtle == null) return false;
    try {
      const key = await subtle.importKey('raw', new Uint8Array(ED25519_PUBLIC_KEY_BYTES), { name: 'Ed25519' }, false, [
        'verify',
      ]);
      return Boolean(key);
    } catch {
      return false;
    }
  })();
  return ed25519SupportCache;
}

/** Test-only: clears the cached support probe so tests can simulate flips in support. */
export function _resetEd25519SupportCacheForTests(): void {
  ed25519SupportCache = null;
}

export interface VerifyEd25519Input {
  publicKeyBase64: string;
  signatureBase64: string;
  message: Uint8Array;
}

/**
 * Verifies an Ed25519 signature over `message` using Web Crypto.
 *
 * Returns `false` (not a throw) for structurally malformed keys/signatures
 * (wrong decoded length, bad base64) — those are "signature invalid"
 * outcomes, indistinguishable in the UI from a tampered/forged signature.
 * Throws `CryptoUnavailableError` / `Ed25519UnsupportedError` when the
 * platform itself cannot perform the check at all — those are distinct,
 * actionable states the caller must surface explicitly (see
 * `verifyEnvelope.ts`), never silently coerced to `false`.
 */
export async function verifyEd25519({ publicKeyBase64, signatureBase64, message }: VerifyEd25519Input): Promise<boolean> {
  const subtle = getSubtle();
  if (subtle == null) throw new CryptoUnavailableError();
  if (!(await isEd25519Supported())) throw new Ed25519UnsupportedError();

  const publicKeyBytes = base64ToBytes(publicKeyBase64);
  const signatureBytes = base64ToBytes(signatureBase64);
  if (publicKeyBytes == null || publicKeyBytes.length !== ED25519_PUBLIC_KEY_BYTES) return false;
  if (signatureBytes == null || signatureBytes.length !== ED25519_SIGNATURE_BYTES) return false;

  try {
    const key = await subtle.importKey('raw', publicKeyBytes.slice(), { name: 'Ed25519' }, false, ['verify']);
    return await subtle.verify('Ed25519', key, signatureBytes.slice(), message.slice());
  } catch {
    // A malformed (but right-length) key/signature can still throw inside
    // `importKey`/`verify` (e.g. a public key that isn't a valid curve
    // point). Treat that the same as "signature invalid".
    return false;
  }
}
