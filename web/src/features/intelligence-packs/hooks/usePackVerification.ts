import { useQuery } from '@tanstack/react-query';

import { intelPackQueryKeys } from './queryKeys';
import { verifyPackEnvelope, type VerificationResult } from '../lib/verifyEnvelope';
import type { SignedPackEnvelope } from '../lib/manifestTypes';
import { canonicalStringify } from '../lib/canonicalJson';

export function packEnvelopeIdentity(envelope: SignedPackEnvelope): string {
  // The claimed digest is only another input; it cannot identify verified content.
  return canonicalStringify({
    envelopeVersion: envelope.envelopeVersion,
    manifest: envelope.manifest,
    signature: envelope.signature,
    contentDigestSha256Hex: envelope.contentDigestSha256Hex ?? null,
  });
}

/**
 * Cryptographic verification of a single envelope. Deliberately NOT
 * retried on failure — `CryptoUnavailableError` / `Ed25519UnsupportedError`
 * are platform limitations that a query retry cannot fix, and retrying a
 * `signature-invalid` result (which resolves, it doesn't throw) would be
 * pointless anyway. The thrown platform-limitation errors surface via
 * TanStack Query's `error` field so the UI can render them as an explicit,
 * actionable failure state rather than a silent fallback.
 */
export function usePackVerification(envelope: SignedPackEnvelope | null | undefined) {
  const cacheKey = envelope == null ? 'none' : packEnvelopeIdentity(envelope);
  const snapshot = envelope == null ? null : structuredClone(envelope);

  return useQuery<VerificationResult>({
    queryKey: intelPackQueryKeys.verify(cacheKey),
    queryFn: () => {
      if (!snapshot) throw new Error('Cannot verify a missing pack envelope.');
      return verifyPackEnvelope(snapshot);
    },
    enabled: envelope != null,
    retry: false,
    staleTime: Infinity,
  });
}
