/**
 * Report signer.
 *
 * Turns an assembled `VaultReport` into a `SignedVaultReport`:
 *   1. Canonicalize the report to stable UTF-8 bytes (`canonicalJson.ts`).
 *   2. Compute a SHA-256 digest of those bytes — displayed for manual/
 *      independent tamper-checking, but NEVER treated as proof of
 *      authorship by itself (see `DIGEST_IS_NOT_A_SIGNATURE_NOTE`).
 *   3. Sign the SAME bytes with ECDSA P-256 (Web Crypto hashes internally
 *      with SHA-256 again as part of the ECDSA algorithm — this is
 *      separate from, and in addition to, the digest above).
 *   4. Embed the signer's public JWK inline so the resulting report is
 *      self-contained and independently verifiable without access to this
 *      browser's key registry.
 *
 * Fails loudly (throws `CryptoUnavailableError`) when Web Crypto is not
 * available. Never falls back to an unsigned or hash-only "signature".
 */
import { requireSubtleCrypto } from './cryptoAvailability';
import { toCanonicalBytes } from './canonicalJson';
import { SIGNING_ALGORITHM } from './constants';
import {
  generateSigningKey,
  getActiveSigningKeyRecord,
  getPrivateKeyHandle,
} from './signingKeyRepository';
import type { SignedVaultReport, VaultReport, VaultSignature } from './types';

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]!);
  return btoa(binary);
}

/** SHA-256 digest of the report's canonical bytes, as lowercase hex. Computed independently of the ECDSA signature. */
export async function digestReport(report: VaultReport): Promise<string> {
  const subtle = requireSubtleCrypto();
  const bytes = toCanonicalBytes(report);
  // `.slice()` copies into a plain `ArrayBuffer`-backed Uint8Array — the
  // Web Crypto TS lib types require `BufferSource`, and a bare
  // `Uint8Array<ArrayBufferLike>` (as returned by TextEncoder) doesn't
  // always satisfy that structurally. Same pattern used elsewhere in this
  // repo (see `features/intelligence-packs/lib/packCrypto.ts`).
  const digest = await subtle.digest('SHA-256', bytes.slice());
  return bytesToHex(digest);
}

/**
 * Signs `report` with the active local signing key (generating one first
 * if this is the very first report signed in this browser). Returns the
 * fully self-contained `SignedVaultReport`.
 *
 * Throws `CryptoUnavailableError` if Web Crypto is unavailable — there is
 * no fallback signing path.
 */
export async function signReport(report: VaultReport): Promise<SignedVaultReport> {
  const subtle = requireSubtleCrypto();

  let activeKey = await getActiveSigningKeyRecord();
  if (!activeKey) {
    activeKey = await generateSigningKey();
  }
  const privateKey = await getPrivateKeyHandle(activeKey.key_id);
  if (!privateKey) {
    throw new Error(
      `Signing key "${activeKey.key_id}" is registered but its private key material is not ` +
        'resident in this session (this can happen if key persistence was unsupported and the ' +
        'page reloaded). Generate a new signing key and try again.',
    );
  }

  const bytes = toCanonicalBytes(report);
  const digestHex = await digestReport(report);

  const signatureBuffer = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, bytes.slice());

  const signature: VaultSignature = {
    alg: SIGNING_ALGORITHM,
    key_id: activeKey.key_id,
    public_key_jwk: activeKey.public_jwk,
    signature_b64: bytesToBase64(signatureBuffer),
    signed_at: new Date().toISOString(),
  };

  return {
    report,
    digest_sha256_hex: digestHex,
    signature,
    local_key_status: {
      persisted: activeKey.persisted,
      revoked: activeKey.revoked_at !== null,
    },
  };
}
