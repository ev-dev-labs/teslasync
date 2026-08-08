import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { PackRepositoryProvider } from '../packRepositoryContext';
import { createInMemoryPackRepository } from '../../lib/packRepository';
import { useCatalog } from '../useCatalog';
import { usePackActions } from '../usePackActions';
import { CATALOG_ENTRIES, EFFICIENCY_INSIGHTS_ENVELOPE } from '../../lib/catalogFixtures';
import type { VerificationResult } from '../../lib/verifyEnvelope';
import type { PackRepository } from '../../lib/packRepository';

const verification: VerificationResult = {
  status: 'signature-valid',
  recomputedDigestSha256Hex: 'a'.repeat(64),
  recomputedPublisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
  claimedFingerprintMismatch: false,
  recognizedPublisherName: 'TeslaSync Labs (Sample Publisher)',
  summary: 'ok',
};

function makeWrapper(repository: PackRepository) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PackRepositoryProvider repository={repository}>{children}</PackRepositoryProvider>
      </QueryClientProvider>
    );
  };
}

describe('useCatalog', () => {
  it('lists every bundled catalog entry, all marked not-installed initially', async () => {
    const repository = createInMemoryPackRepository();
    const { result } = renderHook(() => useCatalog(), { wrapper: makeWrapper(repository) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries).toHaveLength(CATALOG_ENTRIES.length);
    expect(result.current.entries.every((e) => e.installedVersion === null)).toBe(true);
  });

  it('marks an entry up-to-date once its exact version is installed', async () => {
    const repository = createInMemoryPackRepository();
    const wrapper = makeWrapper(repository);

    const { result: actions } = renderHook(() => usePackActions(), { wrapper });
    await act(async () => {
      await actions.current.install.mutateAsync({ envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification, enabled: true });
    });

    const { result } = renderHook(() => useCatalog(), { wrapper });
    await waitFor(() => {
      const entry = result.current.entries.find((e) => e.envelope.manifest.id === EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id);
      expect(entry?.isUpToDate).toBe(true);
    });
  });
});
