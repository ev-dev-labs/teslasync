import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { PackDetailModal, UNSIGNED_TRUST_PHRASE } from '../PackDetailModal';
import { usePackVerification } from '../../hooks/usePackVerification';
import { PackRepositoryProvider } from '../../hooks/packRepositoryContext';
import { createInMemoryPackRepository } from '../../lib/packRepository';
import { COMMUNITY_DRAFT_ENVELOPE, EFFICIENCY_INSIGHTS_ENVELOPE } from '../../lib/catalogFixtures';
import type { CatalogEntryWithStatus } from '../../hooks/useCatalog';
import type { SignedPackEnvelope } from '../../lib/manifestTypes';

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const repository = createInMemoryPackRepository();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PackRepositoryProvider repository={repository}>{children}</PackRepositoryProvider>
      </QueryClientProvider>
    );
  }
  return { wrapper: Wrapper, repository };
}

function entry(envelope: SignedPackEnvelope): CatalogEntryWithStatus {
  return { envelope, installedVersion: null, isUpToDate: false, sourceNote: 'Bundled regression fixture' };
}

async function confirmUnsigned() {
  fireEvent.click(await screen.findByRole('button', { name: /Trust as local-development pack/i }));
  fireEvent.change(screen.getByLabelText(new RegExp(`Type "${UNSIGNED_TRUST_PHRASE}"`, 'i')), {
    target: { value: UNSIGNED_TRUST_PHRASE },
  });
}

describe('complete pack envelope identity', () => {
  it.each(['manifest', 'signature', 'key', 'digest', 'no-digest'] as const)(
    'does not reuse valid verification after changing %s',
    async (change) => {
      const original = structuredClone(EFFICIENCY_INSIGHTS_ENVELOPE);
      if (change === 'no-digest') delete original.contentDigestSha256Hex;
      const { result, rerender } = renderHook(({ envelope }) => usePackVerification(envelope), {
        wrapper: harness().wrapper,
        initialProps: { envelope: original },
      });
      await waitFor(() => expect(result.current.data?.status).toBe('signature-valid'));
      const changed = structuredClone(original);
      if (change === 'manifest' || change === 'no-digest') changed.manifest.description += ' altered';
      if (change === 'signature' && changed.signature) changed.signature.signatureBase64 = 'AAAA';
      if (change === 'key' && changed.signature) changed.signature.publicKeyBase64 = 'AAAA';
      if (change === 'digest') changed.contentDigestSha256Hex = '0'.repeat(64);
      rerender({ envelope: changed });
      expect(result.current.data?.status).not.toBe('signature-valid');
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.status).toBe(
        change === 'manifest' || change === 'digest' ? 'digest-mismatch' : 'signature-invalid',
      );
    },
  );

  it('resets typed approval when same-id/version unsigned contents change', async () => {
    const { wrapper, repository } = harness();
    const first = structuredClone(COMMUNITY_DRAFT_ENVELOPE);
    const close = vi.fn();
    const { rerender } = render(<PackDetailModal entry={entry(first)} open onClose={close} />, { wrapper });
    await confirmUnsigned();
    const changed = structuredClone(first);
    changed.manifest.description += ' replacement';
    rerender(<PackDetailModal entry={entry(changed)} open onClose={close} />);
    expect(screen.queryByRole('button', { name: /Trust & install/i })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Trust as local-development pack/i }));
    expect(screen.getByRole('button', { name: /Trust & install/i })).toBeDisabled();
    expect(await repository.listInstalled()).toHaveLength(0);
    expect(close).not.toHaveBeenCalled();
  });

  it('drops signed confirmation when a replacement retains the claimed digest', async () => {
    const { wrapper, repository } = harness();
    const first = structuredClone(EFFICIENCY_INSIGHTS_ENVELOPE);
    const { rerender } = render(<PackDetailModal entry={entry(first)} open onClose={vi.fn()} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: /^Install$/i }));
    expect(screen.getByText(/Install pack\?/i)).toBeInTheDocument();
    const changed = structuredClone(first);
    changed.manifest.capabilities = [];
    rerender(<PackDetailModal entry={entry(changed)} open onClose={vi.fn()} />);
    await screen.findByText(/This pack cannot be installed/i);
    expect(screen.queryByRole('button', { name: /^Install$/i })).not.toBeInTheDocument();
    expect(await repository.listInstalled()).toHaveLength(0);
  });

  it('does not commit after replacement while the trust write is pending', async () => {
    const { wrapper, repository } = harness();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const trustWrite = vi.spyOn(repository, 'putTrustDecision').mockImplementation(() => pending);
    const close = vi.fn();
    const first = structuredClone(COMMUNITY_DRAFT_ENVELOPE);
    const { rerender } = render(<PackDetailModal entry={entry(first)} open onClose={close} />, { wrapper });
    await confirmUnsigned();
    fireEvent.click(screen.getByRole('button', { name: /Trust & install/i }));
    await waitFor(() => expect(trustWrite).toHaveBeenCalledOnce());
    const changed = structuredClone(first);
    changed.manifest.description += ' replacement';
    rerender(<PackDetailModal entry={entry(changed)} open onClose={close} />);
    await act(async () => { release(); await pending; });
    expect(await repository.listInstalled()).toHaveLength(0);
    expect(close).not.toHaveBeenCalled();
  });

  it('does not close a replacement dialog when an already-started commit finishes', async () => {
    const { wrapper, repository } = harness();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const append = repository.appendAuditLog.bind(repository);
    const auditWrite = vi.spyOn(repository, 'appendAuditLog').mockImplementation(async (record) => {
      if (record.action === 'install') await pending;
      await append(record);
    });
    const close = vi.fn();
    const first = structuredClone(COMMUNITY_DRAFT_ENVELOPE);
    const { rerender } = render(<PackDetailModal entry={entry(first)} open onClose={close} />, { wrapper });
    await confirmUnsigned();
    fireEvent.click(screen.getByRole('button', { name: /Trust & install/i }));
    await waitFor(() => expect(auditWrite.mock.calls.some(([record]) => record.action === 'install')).toBe(true));
    const changed = structuredClone(first);
    changed.manifest.description += ' replacement';
    rerender(<PackDetailModal entry={entry(changed)} open onClose={close} />);
    await act(async () => { release(); await pending; });
    expect(close).not.toHaveBeenCalled();
    expect(await repository.listInstalled()).toHaveLength(1);
    expect((await repository.listInstalled())[0].envelope.manifest.description).toBe(first.manifest.description);
  });

  it('commits the reviewed snapshot even if the caller mutates its object without rendering', async () => {
    const { wrapper, repository } = harness();
    const first = structuredClone(COMMUNITY_DRAFT_ENVELOPE);
    const reviewedDescription = first.manifest.description;
    render(<PackDetailModal entry={entry(first)} open onClose={vi.fn()} />, { wrapper });
    await confirmUnsigned();
    first.manifest.description = 'unreviewed mutation';
    fireEvent.click(screen.getByRole('button', { name: /Trust & install/i }));
    await waitFor(async () => {
      const installed = await repository.listInstalled();
      expect(installed).toHaveLength(1);
      expect(installed[0].envelope.manifest.description).toBe(reviewedDescription);
    });
  });
});
