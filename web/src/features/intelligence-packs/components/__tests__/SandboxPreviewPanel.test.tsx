import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

import { renderWithProviders } from './testUtils';
import { SandboxPreviewPanel } from '../SandboxPreviewPanel';
import { createInMemoryPackRepository, type PackRepository } from '../../lib/packRepository';
import { installPack } from '../../lib/packActions';
import { EFFICIENCY_INSIGHTS_ENVELOPE } from '../../lib/catalogFixtures';
import type { VerificationResult } from '../../lib/verifyEnvelope';

const signedVerification: VerificationResult = {
  status: 'signature-valid',
  recomputedDigestSha256Hex: 'a'.repeat(64),
  recomputedPublisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
  claimedFingerprintMismatch: false,
  recognizedPublisherName: 'TeslaSync Labs (Sample Publisher)',
  summary: 'ok',
};

describe('SandboxPreviewPanel', () => {
  it('defaults to the first catalog entry and renders its dashboard widgets', async () => {
    renderWithProviders(<SandboxPreviewPanel />);
    expect(await screen.findByText('Efficiency Starter Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/simulating full requested-capability grant/i)).toBeInTheDocument();
    expect(await screen.findByText(/sample rows/i)).toBeInTheDocument();
  });

  it('uses the installed capability grant (not the full request) once a pack is installed with partial trust', async () => {
    const repository: PackRepository = createInMemoryPackRepository();
    await installPack(repository, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification: signedVerification, enabled: true });
    // Only approve a subset of what the manifest requests.
    await repository.putTrustDecision({
      packId: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id,
      decision: 'trusted-signed-recognized',
      publisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
      decidedAtIso: new Date().toISOString(),
      approvedCapabilities: ['render:dashboard'],
    });

    renderWithProviders(<SandboxPreviewPanel />, { repository });

    const select = await screen.findByLabelText(/Pack to preview/i);
    fireEvent.change(select, { target: { value: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id } });

    await waitFor(() => {
      expect(screen.getByText(/Using installed capability grant/i)).toBeInTheDocument();
    });
    // Fields denied by the (partial) capability grant show up on at least one widget.
    expect(await screen.findAllByText(/capability denied/i)).not.toHaveLength(0);
  });
});
