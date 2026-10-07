import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

import { renderWithProviders } from './testUtils';
import { ImportExportPanel } from '../ImportExportPanel';
import { createInMemoryPackRepository, type PackRepository } from '../../lib/packRepository';
import { installPack } from '../../lib/packActions';
import { envelopeToPrettyJson } from '../../lib/manifestImportExport';
import { COMMUNITY_DRAFT_ENVELOPE } from '../../lib/catalogFixtures';
import type { VerificationResult } from '../../lib/verifyEnvelope';

const unsignedVerification: VerificationResult = {
  status: 'unsigned',
  recomputedDigestSha256Hex: 'b'.repeat(64),
  recomputedPublisherFingerprint: null,
  claimedFingerprintMismatch: false,
  recognizedPublisherName: null,
  summary: 'unsigned',
};

describe('ImportExportPanel', () => {
  it('shows an "Import rejected" banner for malformed JSON', async () => {
    renderWithProviders(<ImportExportPanel />);

    const textarea = screen.getByLabelText(/Or paste envelope JSON/i);
    fireEvent.change(textarea, { target: { value: '{ this is not valid json' } });
    fireEvent.click(screen.getByRole('button', { name: /Parse pasted JSON/i }));

    expect(await screen.findByText(/Import rejected/i)).toBeInTheDocument();
  });

  it('routes a validly-parsed unsigned envelope into PackDetailModal rather than installing directly', async () => {
    renderWithProviders(<ImportExportPanel />);

    const textarea = screen.getByLabelText(/Or paste envelope JSON/i);
    fireEvent.change(textarea, { target: { value: envelopeToPrettyJson(COMMUNITY_DRAFT_ENVELOPE) } });
    fireEvent.click(screen.getByRole('button', { name: /Parse pasted JSON/i }));

    expect(await screen.findByRole('dialog', { name: COMMUNITY_DRAFT_ENVELOPE.manifest.name })).toBeInTheDocument();
    // The import panel never installs directly — only the trust flow inside PackDetailModal does.
    expect(await screen.findByRole('button', { name: /Trust as local-development pack/i })).toBeInTheDocument();
  });

  it('lists installed packs with an Export action', async () => {
    const repository: PackRepository = createInMemoryPackRepository();
    await installPack(repository, { envelope: COMMUNITY_DRAFT_ENVELOPE, verification: unsignedVerification, enabled: false });

    renderWithProviders(<ImportExportPanel />, { repository });

    expect(await screen.findByText(new RegExp(COMMUNITY_DRAFT_ENVELOPE.manifest.name))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Export$/i })).toBeInTheDocument();
  });

  it('shows an empty-export message with nothing installed', () => {
    renderWithProviders(<ImportExportPanel />);
    expect(screen.getByText(/No installed packs to export yet/i)).toBeInTheDocument();
  });
});
