/**
 * Report verifier.
 *
 * Independent verification workflow for a `SignedVaultReport` — works on
 * both reports signed in this browser and reports imported from elsewhere,
 * since every signature embeds its own public JWK inline (self-contained
 * verification, no dependency on the verifier's own key registry).
 *
 * Two independent checks are performed and reported separately:
 *   - `digestMatches`: recomputed SHA-256 of the canonical report bytes
 *     equals the stored `digest_sha256_hex`. This alone is NOT proof of
 *     authorship (see DIGEST_IS_NOT_A_SIGNATURE_NOTE) — a report could be
 *     re-digested by anyone.
 *   - `signatureValid`: the ECDSA signature verifies against the embedded
 *     public JWK over the same canonical bytes. This is what actually
 *     proves "signed by whoever holds the private key for this JWK" — see
 *     LOCAL_ATTESTATION_NOTE for what that does and does NOT prove.
 *
 * Additionally cross-checks the embedded public key against this
 * browser's OWN local key registry to report whether the signature was
 * produced by a key this browser recognizes, and whether that local key
 * has since been revoked (tamper/trust signal, not a cryptographic
 * requirement — an externally-signed report is neither more nor less
 * cryptographically valid for being "unknown").
 */
import { requireSubtleCrypto } from './cryptoAvailability';
import { toCanonicalBytes } from './canonicalJson';
import { LOCAL_ATTESTATION_NOTE, SIGNING_ALGORITHM } from './constants';
import { listSigningKeys } from './signingKeyRepository';
import type { SignedVaultReport, VerificationResult } from './types';

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Timing-insensitive-enough equality for two hex/base64 strings of report-verification data (not secret material). */
function stringsEqual(a: string, b: string): boolean {
  return a === b;
}

/**
 * Verifies a `SignedVaultReport`. Never throws for "invalid signature" —
 * that is reported via the returned `valid`/`errors` fields so the UI can
 * render a clear tamper/mismatch state. DOES throw `CryptoUnavailableError`
 * if Web Crypto itself is unavailable, since no verification can happen at
 * all in that case (and pretending otherwise would be dishonest).
 */
export async function verifyReport(signed: SignedVaultReport): Promise<VerificationResult> {
  const subtle = requireSubtleCrypto();
  const errors: string[] = [];
  const keyId = signed.signature?.key_id ?? 'unknown';

  if (signed.signature?.alg !== SIGNING_ALGORITHM) {
    errors.push(
      `Unsupported signature algorithm "${String(signed.signature?.alg)}" — expected "${SIGNING_ALGORITHM}".`,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = toCanonicalBytes(signed.report);
  } catch (err) {
    return {
      digestMatches: false,
      signatureValid: false,
      valid: false,
      keyId,
      isKnownLocalKey: false,
      localKeyRevoked: null,
      errors: [
        `Report content could not be canonicalized (it may be malformed or tampered with): ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
      attestationNote: LOCAL_ATTESTATION_NOTE,
    };
  }

  const recomputedDigest = bytesToHex(await subtle.digest('SHA-256', bytes.slice()));
  const digestMatches = stringsEqual(recomputedDigest, signed.digest_sha256_hex);
  if (!digestMatches) {
    errors.push(
      'SHA-256 digest mismatch: the report content does not match the digest recorded at signing time (it may have been edited after signing).',
    );
  }

  let signatureValid = false;
  if (signed.signature?.alg === SIGNING_ALGORITHM && signed.signature?.public_key_jwk && signed.signature?.signature_b64) {
    try {
      const publicKey = await subtle.importKey(
        'jwk',
        signed.signature.public_key_jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify'],
      );
      const signatureBytes = base64ToBytes(signed.signature.signature_b64);
      signatureValid = await subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        signatureBytes.slice(),
        bytes.slice(),
      );
      if (!signatureValid) {
        errors.push(
          'ECDSA signature verification failed: either the report content was altered after signing, or the signature does not correspond to the embedded public key.',
        );
      }
    } catch (err) {
      errors.push(
        `Could not verify signature (malformed key or signature data): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    errors.push('Report is missing a usable signature, public key, or algorithm tag.');
  }

  let isKnownLocalKey = false;
  let localKeyRevoked: boolean | null = null;
  try {
    const localKeys = await listSigningKeys();
    const match = localKeys.find((k) => k.key_id === keyId);
    if (match) {
      isKnownLocalKey = true;
      localKeyRevoked = match.revoked_at !== null;
      if (localKeyRevoked) {
        errors.push(
          `This report was signed with local key "${keyId}", which has since been revoked in this browser's key registry. The signature is still cryptographically valid for the content at signing time, but the key is no longer trusted for new signatures.`,
        );
      }
    }
  } catch {
    // Local registry lookup is a best-effort trust signal, not required for
    // cryptographic validity — silently leave isKnownLocalKey/localKeyRevoked
    // at their "unknown" defaults if it fails.
  }

  return {
    digestMatches,
    signatureValid,
    valid: digestMatches && signatureValid,
    keyId,
    isKnownLocalKey,
    localKeyRevoked,
    errors,
    attestationNote: LOCAL_ATTESTATION_NOTE,
  };
}
