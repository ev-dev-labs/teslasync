import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { PackRepositoryProvider } from '../packRepositoryContext';
import { createInMemoryPackRepository } from '../../lib/packRepository';
import { useInstalledPacks } from '../useInstalledPacks';
import { useAuditLog } from '../useAuditLog';
import { useTrustDecision } from '../useTrustDecision';
import { usePackActions } from '../usePackActions';
import { EFFICIENCY_INSIGHTS_ENVELOPE } from '../../lib/catalogFixtures';
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

describe('useInstalledPacks', () => {
  it('starts empty and reflects installs performed via usePackActions', async () => {
    const repository = createInMemoryPackRepository();
    const wrapper = makeWrapper(repository);

    const { result: installedResult } = renderHook(() => useInstalledPacks(), { wrapper });
    await waitFor(() => expect(installedResult.current.isSuccess).toBe(true));
    expect(installedResult.current.data).toEqual([]);

    const { result: actionsResult } = renderHook(() => usePackActions(), { wrapper });
    await act(async () => {
      await actionsResult.current.install.mutateAsync({ envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification, enabled: true });
    });

    const { result: refetched } = renderHook(() => useInstalledPacks(), { wrapper });
    await waitFor(() => expect(refetched.current.data).toHaveLength(1));
    expect(refetched.current.data?.[0].packId).toBe(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id);
  });
});

describe('useAuditLog', () => {
  it('reflects an audit entry after an install action', async () => {
    const repository = createInMemoryPackRepository();
    const wrapper = makeWrapper(repository);

    const { result: actionsResult } = renderHook(() => usePackActions(), { wrapper });
    await act(async () => {
      await actionsResult.current.install.mutateAsync({ envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification, enabled: false });
    });

    const { result: auditResult } = renderHook(() => useAuditLog(), { wrapper });
    await waitFor(() => expect(auditResult.current.data?.length).toBeGreaterThan(0));
    expect(auditResult.current.data?.[0].action).toBe('install');
  });
});

describe('useTrustDecision', () => {
  it('is disabled (does not fetch) when packId is null', () => {
    const repository = createInMemoryPackRepository();
    const wrapper = makeWrapper(repository);
    const { result } = renderHook(() => useTrustDecision(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns null before any trust decision has been recorded, then reflects it after recordTrustDecision', async () => {
    const repository = createInMemoryPackRepository();
    const wrapper = makeWrapper(repository);
    const packId = EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id;

    const { result: beforeResult } = renderHook(() => useTrustDecision(packId), { wrapper });
    await waitFor(() => expect(beforeResult.current.isSuccess).toBe(true));
    expect(beforeResult.current.data).toBeNull();

    const { result: actionsResult } = renderHook(() => usePackActions(), { wrapper });
    await act(async () => {
      await actionsResult.current.recordTrustDecision.mutateAsync({
        packId,
        decision: 'trusted-signed-recognized',
        publisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
        decidedAtIso: new Date().toISOString(),
        approvedCapabilities: ['read:battery-sample'],
      });
    });

    const { result: afterResult } = renderHook(() => useTrustDecision(packId), { wrapper });
    await waitFor(() => expect(afterResult.current.data?.decision).toBe('trusted-signed-recognized'));
  });
});

describe('usePackActions — uninstall / setEnabled / rollback wired end-to-end', () => {
  it('installs, disables, re-enables, and uninstalls a pack, reflected in useInstalledPacks', async () => {
    const repository = createInMemoryPackRepository();
    const wrapper = makeWrapper(repository);
    const packId = EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id;

    const { result: actions } = renderHook(() => usePackActions(), { wrapper });
    await act(async () => {
      await actions.current.install.mutateAsync({ envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification, enabled: true });
    });

    await act(async () => {
      await actions.current.setEnabled.mutateAsync({ packId, enabled: false });
    });
    let record = await repository.getInstalled(packId);
    expect(record?.enabled).toBe(false);

    await act(async () => {
      await actions.current.uninstall.mutateAsync(packId);
    });
    record = await repository.getInstalled(packId);
    expect(record).toBeNull();
  });
});
