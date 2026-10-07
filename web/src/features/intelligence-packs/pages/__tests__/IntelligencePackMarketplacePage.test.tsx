import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';

import IntelligencePackMarketplacePage from '../IntelligencePackMarketplacePage';
import { EFFICIENCY_INSIGHTS_ENVELOPE } from '../../lib/catalogFixtures';

// jsdom lacks matchMedia; framer-motion's <FadeIn> reads it at module load
// (see e.g. ChargingHeatmapPage.test.tsx for the established precedent).
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IntelligencePackMarketplacePage />
    </QueryClientProvider>,
  );
}

describe('IntelligencePackMarketplacePage', () => {
  beforeEach(() => {
    // The page's default PackRepositoryProvider persists to localStorage in
    // this jsdom environment (no indexedDB global) — isolate every test.
    window.localStorage.clear();
  });

  it('defaults to the Catalog tab', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'Catalog', selected: true })).toBeInTheDocument();
    expect(screen.getByText(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.name)).toBeInTheDocument();
  });

  it('switches panels as tabs change, sharing one repository across the whole page', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }));
    expect(await screen.findByText(/No packs are installed yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Sandbox Preview' }));
    expect(await screen.findByLabelText(/Pack to preview/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Audit Log' }));
    expect(await screen.findByText(/No actions have been recorded yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Import / Export' }));
    expect(await screen.findByText('Import a manifest')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Security & Methodology' }));
    expect(await screen.findByText('Guarantees')).toBeInTheDocument();

    // Install the signed sample pack from the Catalog tab, then confirm the
    // Installed tab (a completely different panel instance) sees it — proof
    // the single PackRepositoryProvider mounted at the page root is actually
    // shared, not re-created per tab.
    fireEvent.click(screen.getByRole('tab', { name: 'Catalog' }));
    const openButtons = await screen.findAllByRole('button', { name: /View & install/i });
    fireEvent.click(openButtons[0]);
    const installBtn = await screen.findByRole('button', { name: /^Install$/i });
    fireEvent.click(installBtn);
    const confirmInstallBtn = await screen.findByRole('button', { name: /^Install$/i });
    fireEvent.click(confirmInstallBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }));
    expect(await screen.findByText(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.name)).toBeInTheDocument();
  });
});
