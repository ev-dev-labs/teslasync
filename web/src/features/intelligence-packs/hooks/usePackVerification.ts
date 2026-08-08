import { useQuery } from '@tanstack/react-query';

import { intelPackQueryKeys } from './queryKeys';
import { verifyPackEnvelope, type VerificationResult } from '../lib/verifyEnvelope';
import type { SignedPackEnvelope } from '../lib/manifestTypes';

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
  const cacheKey =
    envelope == null
      ? 'none'
      : (envelope.contentDigestSha256Hex ??
        `${envelope.manifest.id}:${envelope.manifest.version}:${JSON.stringify(envelope.signature)}`);

  return useQuery<VerificationResult>({
    queryKey: intelPackQueryKeys.verify(cacheKey),
    queryFn: () => verifyPackEnvelope(envelope as SignedPackEnvelope),
    enabled: envelope != null,
    retry: false,
    staleTime: Infinity,
  });
}
