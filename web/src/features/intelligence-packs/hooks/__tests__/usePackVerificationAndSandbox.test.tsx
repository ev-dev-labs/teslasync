import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { usePackVerification } from '../usePackVerification';
import { useSandboxPreview } from '../useSandboxPreview';
import { EFFICIENCY_INSIGHTS_ENVELOPE, TAMPERED_DEMO_ENVELOPE, COMMUNITY_DRAFT_ENVELOPE } from '../../lib/catalogFixtures';
import type { PackCapabilityId } from '../../lib/manifestTypes';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('usePackVerification', () => {
  it('resolves signature-valid for the bundled signed fixture', async () => {
    const { result } = renderHook(() => usePackVerification(EFFICIENCY_INSIGHTS_ENVELOPE), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe('signature-valid');
  });

  it('resolves unsigned for the community draft', async () => {
    const { result } = renderHook(() => usePackVerification(COMMUNITY_DRAFT_ENVELOPE), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe('unsigned');
  });

  it('resolves signature-invalid for the tampered demo', async () => {
    const { result } = renderHook(() => usePackVerification(TAMPERED_DEMO_ENVELOPE), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe('signature-invalid');
  });

  it('does not fetch when the envelope is null/undefined', () => {
    const { result } = renderHook(() => usePackVerification(null), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useSandboxPreview', () => {
  it('returns null when manifest is null', () => {
    const { result } = renderHook(() => useSandboxPreview(null, new Set()));
    expect(result.current).toBeNull();
  });

  it('computes formula results for a granted-capability manifest', () => {
    const granted = new Set<PackCapabilityId>(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.capabilities);
    const { result } = renderHook(() => useSandboxPreview(EFFICIENCY_INSIGHTS_ENVELOPE.manifest, granted));
    expect(result.current?.formulas.length).toBe(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.formulas.length);
  });

  it('recomputes when the granted capability set changes', () => {
    const { result, rerender } = renderHook(
      ({ granted }: { granted: Set<PackCapabilityId> }) => useSandboxPreview(EFFICIENCY_INSIGHTS_ENVELOPE.manifest, granted),
      { initialProps: { granted: new Set<PackCapabilityId>() } },
    );
    const emptyRun = result.current;
    expect(emptyRun?.formulas.find((f) => f.formulaId === 'efficiency-gap')?.deniedFieldRefs.length).toBeGreaterThan(0);

    rerender({ granted: new Set<PackCapabilityId>(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.capabilities) });
    const fullRun = result.current;
    expect(fullRun?.formulas.find((f) => f.formulaId === 'efficiency-gap')?.deniedFieldRefs.length).toBe(0);
  });
});
