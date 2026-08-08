/**
 * Top-level verification orchestration: turns a parsed `SignedPackEnvelope`
 * into a `VerificationResult` that the UI can render directly.
 *
 * This is the ONE place that combines:
 *   - SHA-256 content digest (recomputed independently, always).
 *   - Ed25519 signature verification (key-possession proof only).
 *   - The publisher-fingerprint recognition check (local trust allowlist).
 *
 * and keeps those three concerns visibly distinct in the result shape,
 * because collapsing them into a single boolean is exactly the kind of
 * "signature == trustworthy" confusion this feature must not create.
 */

import { canonicalBytes } from './canonicalJson';
import { CryptoUnavailableError, Ed25519UnsupportedError, base64ToBytes, sha256Hex, verifyEd25519 } from './packCrypto';
import { isRecognizedPublisher } from './trust';
import type { SignedPackEnvelope } from './manifestTypes';

export type VerificationStatus =
  /** No `signature` block at all. Preview-only until an explicit local-dev trust decision. */
  | 'unsigned'
  /** Ed25519 signature check passed: signer possesses the embedded public key, content unaltered since signing. */
  | 'signature-valid'
  /** Ed25519 signature check failed: forged, corrupted, or the content was altered after signing. */
  | 'signature-invalid'
  /** The publisher-claimed digest field didn't match the independently recomputed one (tamper signal, distinct from signature failure so the UI can name the exact mismatch). */
  | 'digest-mismatch'
  /** Platform cannot perform the check at all (no secure context / no Web Crypto). Installation must fail explicitly — see callers. */
  | 'crypto-unavailable'
  /** Platform has Web Crypto but this build doesn't implement Ed25519. Installation must fail explicitly. */
  | 'ed25519-unsupported';

export interface VerificationResult {
  status: VerificationStatus;
  /** SHA-256 hex digest of `canonicalStringify(manifest)`, independently recomputed — never trusted from the input. */
  recomputedDigestSha256Hex: string;
  /** SHA-256 hex fingerprint of the signing public key, or `null` when unsigned. Independently recomputed from `signature.publicKeyBase64` — never trusted from `manifest.publisher.fingerprint`. */
  recomputedPublisherFingerprint: string | null;
  /** `true` when `manifest.publisher.fingerprint` (a claim INSIDE the signed data) disagrees with the fingerprint recomputed from the actual signing key. */
  claimedFingerprintMismatch: boolean;
  /** Non-null when `recomputedPublisherFingerprint` is present in the local `KNOWN_PUBLISHER_FINGERPRINTS` allowlist. */
  recognizedPublisherName: string | null;
  /** Human-readable one-liner summarizing `status`, safe to render directly. */
  summary: string;
}

async function fingerprintOfPublicKeyBase64(publicKeyBase64: string): Promise<string | null> {
  const bytes = base64ToBytes(publicKeyBase64);
  if (bytes == null) return null;
  try {
    return await sha256Hex(bytes);
  } catch {
    return null;
  }
}

/**
 * Verifies a parsed, schema-valid envelope. Never mutates its input.
 * Throws `CryptoUnavailableError` / `Ed25519UnsupportedError` ONLY when the
 * platform itself cannot even attempt the check on a SIGNED envelope —
 * callers (install flow) must treat that as a hard installation failure,
 * not silently downgrade to "unsigned" behavior. Unsigned envelopes never
 * touch Ed25519 at all and so never throw for that reason.
 */
export async function verifyPackEnvelope(envelope: SignedPackEnvelope): Promise<VerificationResult> {
  const messageBytes = canonicalBytes(envelope.manifest);
  const recomputedDigestSha256Hex = await sha256Hex(messageBytes);

  if (envelope.signature == null) {
    return {
      status: 'unsigned',
      recomputedDigestSha256Hex,
      recomputedPublisherFingerprint: null,
      claimedFingerprintMismatch: false,
      recognizedPublisherName: null,
      summary: 'This pack is unsigned. It has not been checked in any way and is preview-only unless you explicitly trust it via the local-development flow.',
    };
  }

  if (envelope.contentDigestSha256Hex && envelope.contentDigestSha256Hex !== recomputedDigestSha256Hex) {
    return {
      status: 'digest-mismatch',
      recomputedDigestSha256Hex,
      recomputedPublisherFingerprint: null,
      claimedFingerprintMismatch: false,
      recognizedPublisherName: null,
      summary: 'The publisher-supplied content digest does not match the recomputed digest. This manifest has been altered — do not trust it.',
    };
  }

  // Let CryptoUnavailableError / Ed25519UnsupportedError propagate — the
  // caller must fail installation explicitly rather than catch-and-degrade.
  let signatureValid: boolean;
  try {
    signatureValid = await verifyEd25519({
      publicKeyBase64: envelope.signature.publicKeyBase64,
      signatureBase64: envelope.signature.signatureBase64,
      message: messageBytes,
    });
  } catch (err) {
    if (err instanceof CryptoUnavailableError || err instanceof Ed25519UnsupportedError) throw err;
    signatureValid = false;
  }

  const recomputedPublisherFingerprint = await fingerprintOfPublicKeyBase64(envelope.signature.publicKeyBase64);
  const claimedFingerprintMismatch = Boolean(
    envelope.manifest.publisher.fingerprint &&
      recomputedPublisherFingerprint &&
      envelope.manifest.publisher.fingerprint.toLowerCase() !== recomputedPublisherFingerprint.toLowerCase(),
  );

  if (!signatureValid) {
    return {
      status: 'signature-invalid',
      recomputedDigestSha256Hex,
      recomputedPublisherFingerprint,
      claimedFingerprintMismatch,
      recognizedPublisherName: null,
      summary: 'Ed25519 signature verification failed. This manifest is forged, corrupted, or was altered after signing \u2014 do not trust it.',
    };
  }

  const recognized = isRecognizedPublisher(recomputedPublisherFingerprint);
  return {
    status: 'signature-valid',
    recomputedDigestSha256Hex,
    recomputedPublisherFingerprint,
    claimedFingerprintMismatch,
    recognizedPublisherName: recognized?.name ?? null,
    summary: recognized
      ? `Signature verified: the signer possesses the private key for a recognized publisher ("${recognized.name}"). This proves key possession and content integrity, not that the publisher's intentions are trustworthy.`
      : 'Signature verified: the signer possesses the embedded public key and the content has not changed since signing. This key is not in this build\u2019s recognized-publisher list \u2014 verifying a signature proves key possession, not publisher trustworthiness.',
  };
}
