import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
// Real i18n init so interpolated confirm-dialog copy (typed-phrase label,
// capability list, etc.) renders as it would in the running app.
import '@/i18n';

import { renderWithProviders } from './testUtils';
import { CatalogPanel } from '../CatalogPanel';
import { UNSIGNED_TRUST_PHRASE } from '../PackDetailModal';
import { EFFICIENCY_INSIGHTS_ENVELOPE, COMMUNITY_DRAFT_ENVELOPE, TAMPERED_DEMO_ENVELOPE } from '../../lib/catalogFixtures';

describe('CatalogPanel + PackDetailModal', () => {
  it('renders all three curated catalog entries', () => {
    renderWithProviders(<CatalogPanel />);
    expect(screen.getByText(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.name)).toBeInTheDocument();
    expect(screen.getByText(COMMUNITY_DRAFT_ENVELOPE.manifest.name)).toBeInTheDocument();
    expect(screen.getByText(TAMPERED_DEMO_ENVELOPE.manifest.name)).toBeInTheDocument();
  });

  it('installs a validly signed pack after the (non-typed) confirm dialog', async () => {
    const { repository } = renderWithProviders(<CatalogPanel />);

    const openButtons = screen.getAllByRole('button', { name: /View & install/i });
    fireEvent.click(openButtons[0]);

    // Step 1: the modal's own "Install" action opens the (non-typed) confirm dialog.
    const installBtn = await screen.findByRole('button', { name: /^Install$/i });
    fireEvent.click(installBtn);

    // Step 2: the modal closes and only the ConfirmDialog's "Install" button remains.
    const confirmInstallBtn = await screen.findByRole('button', { name: /^Install$/i });
    fireEvent.click(confirmInstallBtn);

    await waitFor(async () => {
      const installed = await repository.listInstalled();
      expect(installed).toHaveLength(1);
      expect(installed[0].packId).toBe(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id);
      expect(installed[0].enabled).toBe(true);
    });

    const trust = await repository.getTrustDecision(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id);
    expect(trust?.decision).toBe('trusted-signed-recognized');
  });

  it('blocks install for the unsigned pack until the typed local-development trust phrase is entered', async () => {
    const { repository } = renderWithProviders(<CatalogPanel />);

    const openButtons = screen.getAllByRole('button', { name: /View & install/i });
    fireEvent.click(openButtons[1]); // community draft (unsigned)

    const trustBtn = await screen.findByRole('button', { name: /Trust as local-development pack/i });
    fireEvent.click(trustBtn);

    const confirmBtn = await screen.findByRole('button', { name: /Trust & install/i });
    expect(confirmBtn).toBeDisabled();

    const typedInput = screen.getByLabelText(new RegExp(`Type "${UNSIGNED_TRUST_PHRASE}"`, 'i'));
    fireEvent.change(typedInput, { target: { value: 'wrong phrase' } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(typedInput, { target: { value: UNSIGNED_TRUST_PHRASE } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(async () => {
      const installed = await repository.listInstalled();
      expect(installed).toHaveLength(1);
      expect(installed[0].packId).toBe(COMMUNITY_DRAFT_ENVELOPE.manifest.id);
    });
    const trust = await repository.getTrustDecision(COMMUNITY_DRAFT_ENVELOPE.manifest.id);
    expect(trust?.decision).toBe('trusted-dev-unsigned');
  });

  it('never offers an install path for the deliberately-tampered demo pack', async () => {
    renderWithProviders(<CatalogPanel />);

    const openButtons = screen.getAllByRole('button', { name: /View & install/i });
    fireEvent.click(openButtons[2]); // tampered demo

    await screen.findByText(/cannot be installed/i);
    expect(screen.queryByRole('button', { name: /^Install$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Trust as local-development pack/i })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Record as blocked/i })).toBeInTheDocument();
  });
});
