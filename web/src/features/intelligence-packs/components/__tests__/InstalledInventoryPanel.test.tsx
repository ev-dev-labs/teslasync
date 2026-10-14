import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

  afterEach(() => vi.unstubAllGlobals());

  it('keeps verification, trust details and lifecycle actions keyboard-accessible on mobile', async () => {
    vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 375 } } as ResizeObserverEntry], this);
      }
      unobserve() {}
      disconnect() {}
    });
    await installPack(repository, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification: signedVerification, enabled: true });
    await repository.putTrustDecision({
      packId: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id,
      decision: 'trusted-signed-recognized',
      publisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
      decidedAtIso: new Date().toISOString(),
      approvedCapabilities: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.capabilities,
    });
    const upgraded = { ...EFFICIENCY_INSIGHTS_ENVELOPE, manifest: { ...EFFICIENCY_INSIGHTS_ENVELOPE.manifest, version: '2.0.0' } };
    await upgradePack(repository, { packId: upgraded.manifest.id, envelope: upgraded, verification: signedVerification });
    const user = userEvent.setup();
    const view = renderWithProviders(<InstalledInventoryPanel />, { repository });
    await screen.findByRole('button', { name: /Rollback/i });
    expect(view.container.querySelector('[data-mobile-table]')).not.toBeNull();
    expect(view.container.querySelector('table')).toBeNull();
    const toggle = screen.getByRole('switch');
    await waitFor(() => expect(toggle).toBeEnabled());
    toggle.focus();
    await user.keyboard(' ');
    await waitFor(async () => expect((await repository.getInstalled(upgraded.manifest.id))?.enabled).toBe(false));
    const expand = screen.getByRole('button', { name: 'Expand row' });
    expand.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/Trust decision: trusted-signed-recognized/)).toBeInTheDocument();
    expect(screen.getByText(/1 previous version/)).toBeInTheDocument();
    const quickView = screen.getByRole('button', { name: 'Quick view' });
    quickView.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: upgraded.manifest.name });
    expect(within(dialog).getByText('v2.0.0')).toBeInTheDocument();
    expect(within(dialog).getByText('Verification')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Uninstall/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(quickView).toHaveFocus());
    await user.click(screen.getByRole('button', { name: /Rollback/i }));
    await waitFor(async () => expect((await repository.getInstalled(upgraded.manifest.id))?.envelope.manifest.version).toBe('1.0.0'));
  });

  it('renders an empty state with no installed packs', async () => {
    renderWithProviders(<InstalledInventoryPanel />, { repository });
    expect(await screen.findByText(/No packs are installed yet/i)).toBeInTheDocument();
  });

  it('shows an installed pack disabled-toggle warning when no trust decision is recorded', async () => {
    await installPack(repository, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification: signedVerification, enabled: true });
    renderWithProviders(<InstalledInventoryPanel />, { repository });

    expect(await screen.findByText(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.name)).toBeInTheDocument();
    expect(await screen.findByText(/No trust decision on record/i)).toBeInTheDocument();
    const toggle = await screen.findByRole('switch');
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect((await repository.getInstalled(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id))?.enabled).toBe(true);
  });

  it('disables the switch while trust is loading and enables it when trusted data resolves', async () => {
    const packId = EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id;
    await installPack(repository, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification: signedVerification, enabled: true });
    await repository.putTrustDecision({
      packId,
      decision: 'trusted-signed-recognized',
      publisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
      decidedAtIso: new Date().toISOString(),
      approvedCapabilities: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.capabilities,
    });
    const decision = await repository.getTrustDecision(packId);
    let resolveTrust!: (value: typeof decision) => void;
    const pendingTrust = new Promise<typeof decision>((resolve) => { resolveTrust = resolve; });
    vi.spyOn(repository, 'getTrustDecision').mockReturnValueOnce(pendingTrust);
    renderWithProviders(<InstalledInventoryPanel />, { repository });

    const toggle = await screen.findByRole('switch');
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/No trust decision on record/i)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect((await repository.getInstalled(packId))?.enabled).toBe(true);

    resolveTrust(decision);
    await waitFor(() => {
      expect(toggle).toBeEnabled();
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
    expect(screen.queryByText(/No trust decision on record/i)).not.toBeInTheDocument();
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
    expect(toggle).toBeEnabled();
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
