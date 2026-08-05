import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

import { renderWithProviders } from './testUtils';
import { InstalledInventoryPanel } from '../InstalledInventoryPanel';
import { createInMemoryPackRepository, type PackRepository } from '../../lib/packRepository';
import { installPack, upgradePack } from '../../lib/packActions';
import { EFFICIENCY_INSIGHTS_ENVELOPE, COMMUNITY_DRAFT_ENVELOPE } from '../../lib/catalogFixtures';
import type { VerificationResult } from '../../lib/verifyEnvelope';

const signedVerification: VerificationResult = {
  status: 'signature-valid',
  recomputedDigestSha256Hex: 'a'.repeat(64),
  recomputedPublisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
  claimedFingerprintMismatch: false,
  recognizedPublisherName: 'TeslaSync Labs (Sample Publisher)',
  summary: 'ok',
};

const unsignedVerification: VerificationResult = {
  status: 'unsigned',
  recomputedDigestSha256Hex: 'b'.repeat(64),
  recomputedPublisherFingerprint: null,
  claimedFingerprintMismatch: false,
  recognizedPublisherName: null,
  summary: 'unsigned',
};

describe('InstalledInventoryPanel', () => {
  let repository: PackRepository;

  beforeEach(() => {
    repository = createInMemoryPackRepository();
  });

  it('renders an empty state with no installed packs', () => {
    renderWithProviders(<InstalledInventoryPanel />, { repository });
    expect(screen.getByText(/No packs are installed yet/i)).toBeInTheDocument();
  });

  it('shows an installed pack disabled-toggle warning when no trust decision is recorded', async () => {
    await installPack(repository, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification: signedVerification, enabled: true });
    renderWithProviders(<InstalledInventoryPanel />, { repository });

    expect(await screen.findByText(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.name)).toBeInTheDocument();
    expect(await screen.findByText(/No trust decision on record/i)).toBeInTheDocument();
  });

  it('allows toggling enabled once a non-blocked trust decision exists', async () => {
    await installPack(repository, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification: signedVerification, enabled: true });
    await repository.putTrustDecision({
      packId: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id,
      decision: 'trusted-signed-recognized',
      publisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
      decidedAtIso: new Date().toISOString(),
      approvedCapabilities: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.capabilities,
    });
    renderWithProviders(<InstalledInventoryPanel />, { repository });

    const toggle = await screen.findByRole('switch');
    // The trust-decision query resolves asynchronously; wait for it before asserting the initial state.
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(toggle);

    await waitFor(async () => {
      const record = await repository.getInstalled(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id);
      expect(record?.enabled).toBe(false);
    });
  });

  it('shows a rollback action once a previous version exists, and rollback restores it', async () => {
    await installPack(repository, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification: signedVerification, enabled: true });
    const upgraded = { ...EFFICIENCY_INSIGHTS_ENVELOPE, manifest: { ...EFFICIENCY_INSIGHTS_ENVELOPE.manifest, version: '2.0.0' } };
    await upgradePack(repository, { packId: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id, envelope: upgraded, verification: signedVerification });

    renderWithProviders(<InstalledInventoryPanel />, { repository });
    expect(await screen.findByText('v2.0.0')).toBeInTheDocument();

    const rollbackBtn = await screen.findByRole('button', { name: /Rollback/i });
    fireEvent.click(rollbackBtn);

    await waitFor(async () => {
      const record = await repository.getInstalled(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id);
      expect(record?.envelope.manifest.version).toBe('1.0.0');
    });
  });

  it('uninstalls a pack after confirming the destructive dialog', async () => {
    await installPack(repository, { envelope: COMMUNITY_DRAFT_ENVELOPE, verification: unsignedVerification, enabled: false });
    renderWithProviders(<InstalledInventoryPanel />, { repository });

    const uninstallBtn = await screen.findByRole('button', { name: /Uninstall/i });
    fireEvent.click(uninstallBtn);

    const confirmBtn = await screen.findAllByRole('button', { name: /Uninstall/i });
    fireEvent.click(confirmBtn[confirmBtn.length - 1]);

    await waitFor(async () => {
      const installed = await repository.listInstalled();
      expect(installed).toHaveLength(0);
    });
  });
});
