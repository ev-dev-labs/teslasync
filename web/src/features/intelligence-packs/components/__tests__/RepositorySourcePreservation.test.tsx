import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

import { AuditLogPanel } from '../AuditLogPanel';
import { CatalogPanel } from '../CatalogPanel';
import { ImportExportPanel } from '../ImportExportPanel';
import { InstalledInventoryPanel } from '../InstalledInventoryPanel';
import { PackRepositorySource } from '../PackRepositorySource';
import { buildAuditEntry } from '../../lib/auditLog';
import { EFFICIENCY_INSIGHTS_ENVELOPE } from '../../lib/catalogFixtures';
import { createInMemoryPackRepository, type InstalledPackRecord } from '../../lib/packRepository';
import { intelPackQueryKeys } from '../../hooks/queryKeys';
import { renderWithProviders as renderPack } from './testUtils';

function renderWithProviders(ui: ReactElement, options?: Parameters<typeof renderPack>[1]) {
  return renderPack(<MemoryRouter>{ui}</MemoryRouter>, options);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function installedRecord(): InstalledPackRecord {
  return {
    packId: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id,
    envelope: EFFICIENCY_INSIGHTS_ENVELOPE,
    verification: {
      status: 'signature-valid',
      recomputedDigestSha256Hex: 'a'.repeat(64),
      recomputedPublisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
      claimedFingerprintMismatch: false,
      recognizedPublisherName: 'Snapshot publisher',
      summary: 'Recorded verification snapshot',
    },
    enabled: false,
    installedAtIso: '2026-10-01T10:00:00Z',
    updatedAtIso: '2026-10-02T10:00:00Z',
    previousVersions: [],
  };
}

function Sources() {
  return (
    <>
      <section aria-label="Installed source"><InstalledInventoryPanel /></section>
      <section aria-label="Audit source"><AuditLogPanel /></section>
      <section aria-label="Import and export"><ImportExportPanel /></section>
    </>
  );
}

describe('Intelligence-pack local source preservation', () => {
  it('does not infer an empty inventory or audit log before their independent reads resolve', async () => {
    const repository = createInMemoryPackRepository();
    const installed = deferred<InstalledPackRecord[]>();
    const audit = deferred<Awaited<ReturnType<typeof repository.listAuditLog>>>();
    vi.spyOn(repository, 'listInstalled').mockReturnValue(installed.promise);
    vi.spyOn(repository, 'listAuditLog').mockReturnValue(audit.promise);
    renderWithProviders(<Sources />, { repository });

    expect(within(screen.getByRole('region', { name: 'Installed source' }))
      .getByRole('status', { name: 'Loading Installed' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Audit source' }))
      .getByRole('status', { name: 'Loading Audit log' })).toBeInTheDocument();
    expect(screen.queryByText(/No packs are installed yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No actions have been recorded yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No installed packs to export yet/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Or paste envelope JSON')).toBeEnabled();

    await act(async () => { installed.resolve([]); });
    expect(await screen.findByText(/No packs are installed yet/i)).toBeInTheDocument();
    expect(await screen.findByText(/No installed packs to export yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/No actions have been recorded yet/i)).not.toBeInTheDocument();

    await act(async () => { audit.resolve([]); });
    expect(await screen.findByText(/No actions have been recorded yet/i)).toBeInTheDocument();
  });

  it('keeps a complete audit row and an unsubmitted import draft when the inventory first load fails', async () => {
    const repository = createInMemoryPackRepository();
    const read = vi.spyOn(repository, 'listInstalled').mockRejectedValue(new Error('Inventory read failed'));
    const entry = buildAuditEntry({
      packId: 'source-pack',
      packName: 'Independent audit pack',
      action: 'install',
      detail: 'Complete audit detail: requested capabilities and installed version retained.',
    });
    vi.spyOn(repository, 'listAuditLog').mockResolvedValue([entry]);
    renderWithProviders(<Sources />, { repository });

    const draft = screen.getByLabelText('Or paste envelope JSON');
    fireEvent.change(draft, { target: { value: '{"unsubmitted":"retained draft"}' } });
    const installed = within(screen.getByRole('region', { name: 'Installed source' }));
    expect(await installed.findByText('Could not read Installed from local storage.')).toBeInTheDocument();
    const audit = within(screen.getByRole('region', { name: 'Audit source' }));
    expect(await audit.findByText(entry.packName)).toBeInTheDocument();
    expect(audit.getByText(entry.detail)).toBeInTheDocument();
    expect(audit.getByText(entry.action)).toBeInTheDocument();
    expect(draft).toHaveValue('{"unsubmitted":"retained draft"}');
    expect(screen.getByRole('button', { name: 'Parse pasted JSON' })).toBeEnabled();
    expect(screen.queryByText(/No packs are installed yet/i)).not.toBeInTheDocument();
    read.mockResolvedValue([installedRecord()]);
    fireEvent.click(installed.getByRole('button', { name: 'Retry' }));
    expect(await installed.findByText(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.name)).toBeInTheDocument();
    expect(installed.queryByText('Could not read Installed from local storage.')).not.toBeInTheDocument();
    expect(audit.getByText(entry.detail)).toBeInTheDocument();
    expect(draft).toHaveValue('{"unsubmitted":"retained draft"}');
  });

  it('retains installed version, verification, actions and export choices while only the audit source fails', async () => {
    const repository = createInMemoryPackRepository();
    const record = installedRecord();
    vi.spyOn(repository, 'listInstalled').mockResolvedValue([record]);
    vi.spyOn(repository, 'listAuditLog').mockRejectedValue(new Error('Audit read failed'));
    renderWithProviders(<Sources />, { repository });

    const installed = within(screen.getByRole('region', { name: 'Installed source' }));
    expect(await installed.findByText(record.envelope.manifest.name)).toBeInTheDocument();
    expect(installed.getByText('v1.0.0')).toBeInTheDocument();
    expect(installed.getByText(/recognized publisher/i)).toBeInTheDocument();
    expect(installed.getByRole('button', { name: 'Uninstall' })).toBeEnabled();
    const exports = within(screen.getByRole('region', { name: 'Import and export' }));
    expect(await exports.findByRole('button', { name: 'Export' })).toBeEnabled();
    expect(exports.getByText(`${record.envelope.manifest.name} · v1.0.0`)).toBeInTheDocument();
    expect(await screen.findByText('Could not read Audit log from local storage.')).toBeInTheDocument();
    expect(screen.queryByText(/No actions have been recorded yet/i)).not.toBeInTheDocument();
  });

  it('keeps retained rows and draft through inventory refresh failure and clears only its notice after retry', async () => {
    const repository = createInMemoryPackRepository();
    const record = installedRecord();
    const installedRead = vi.spyOn(repository, 'listInstalled').mockResolvedValue([record]);
    vi.spyOn(repository, 'listAuditLog').mockResolvedValue([]);
    const { client } = renderWithProviders(<Sources />, { repository });
    const inventory = within(screen.getByRole('region', { name: 'Installed source' }));
    await inventory.findByText(record.envelope.manifest.name);
    const draft = screen.getByLabelText('Or paste envelope JSON');
    fireEvent.change(draft, { target: { value: 'local draft before refresh' } });
    installedRead.mockRejectedValue(new Error('Refresh failed'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: intelPackQueryKeys.installed });
    });

    expect(await inventory.findByText(/Previously loaded data remains visible/i)).toBeInTheDocument();
    expect(inventory.getByText(record.envelope.manifest.name)).toBeInTheDocument();
    expect(inventory.getByText('v1.0.0')).toBeInTheDocument();
    expect(inventory.getByRole('button', { name: 'Uninstall' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    expect(draft).toHaveValue('local draft before refresh');
    expect(screen.getByText(/No actions have been recorded yet/i)).toBeInTheDocument();

    installedRead.mockResolvedValue([record]);
    fireEvent.click(inventory.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(inventory.queryByText(/Previously loaded data remains visible/i)).not.toBeInTheDocument();
    });
    expect(draft).toHaveValue('local draft before refresh');
    expect(inventory.getByText(record.envelope.manifest.name)).toBeInTheDocument();
  });

  it('keeps an authoritative empty audit result with a nonblocking refresh warning, not a first-load error', async () => {
    const repository = createInMemoryPackRepository();
    const read = vi.spyOn(repository, 'listAuditLog').mockResolvedValue([]);
    const { client } = renderWithProviders(<AuditLogPanel />, { repository });
    await screen.findByText(/No actions have been recorded yet/i);
    read.mockRejectedValue(new Error('Refresh failure after empty result'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: intelPackQueryKeys.audit() });
    });
    expect(await screen.findByText(/Previously loaded data remains visible/i)).toBeInTheDocument();
    expect(screen.getByText(/No actions have been recorded yet/i)).toBeInTheDocument();
    expect(screen.queryByText('Could not read Audit log from local storage.')).not.toBeInTheDocument();
  });

  it('keeps the bundled catalog readable independently of a failed install-status source', async () => {
    const repository = createInMemoryPackRepository();
    const read = vi.spyOn(repository, 'listInstalled').mockRejectedValue(new Error('Install-status lookup failed'));
    renderWithProviders(<CatalogPanel />, { repository });
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(screen.getByText(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.name)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'View & install' })).toHaveLength(3);
    expect(screen.getByText(/locally-bundled catalog/i)).toBeInTheDocument();
  });

  it.each(['paused', 'idle'] as const)('does not label an unresolved %s source as empty', (fetchStatus) => {
    renderWithProviders(
      <PackRepositorySource query={{ data: undefined, fetchStatus }} label="Audit log">
        <AuditLogPanel />
      </PackRepositorySource>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(fetchStatus === 'paused'
      ? 'The local Audit log read is paused; no empty result is inferred.'
      : 'Audit log availability has not resolved yet.');
    expect(screen.queryByText(/No actions have been recorded yet/i)).not.toBeInTheDocument();
  });
});
