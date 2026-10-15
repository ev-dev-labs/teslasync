import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import IntelligencePackMarketplacePage from './IntelligencePackMarketplacePage';
import { CATALOG_ENTRIES } from '../lib/catalogFixtures';

let client: QueryClient;

function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <IntelligencePackMarketplacePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('IntelligencePackMarketplacePage tab relationships', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    client?.clear();
  });

  it('defaults to the complete bundled catalog with a linked keyboard-reachable panel', () => {
    renderPage();

    const tab = screen.getByRole('tab', { name: 'Catalog', selected: true });
    const panel = screen.getByRole('tabpanel', { name: 'Catalog' });
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(tab).toHaveAttribute('id', 'intelligence-packs-tab-catalog');
    expect(tab).toHaveAttribute('aria-controls', 'intelligence-packs-panel-catalog');
    expect(panel).toHaveAttribute('id', 'intelligence-packs-panel-catalog');
    expect(panel).toHaveAttribute('aria-labelledby', 'intelligence-packs-tab-catalog');
    expect(panel).toHaveAttribute('tabindex', '0');
    for (const entry of CATALOG_ENTRIES) {
      expect(within(panel).getByText(entry.envelope.manifest.name)).toBeInTheDocument();
    }
  });

  it('links all six original sections and mounts only the active section without installing packs', async () => {
    const user = userEvent.setup();
    renderPage();
    const sections = [
      { key: 'installed', name: 'Installed', content: /No packs are installed yet/i },
      { key: 'sandbox', name: 'Sandbox preview', content: /Runs entirely offline against bundled synthetic sample data/i },
      { key: 'audit', name: 'Audit log', content: /No actions have been recorded yet/i },
      { key: 'importExport', name: 'Import / export', content: 'Import a manifest' },
      { key: 'security', name: 'Security & methodology', content: 'Guarantees' },
      { key: 'catalog', name: 'Catalog', content: CATALOG_ENTRIES[0].envelope.manifest.name },
    ];

    for (const section of sections) {
      await user.click(screen.getByRole('tab', { name: section.name }));
      const tab = screen.getByRole('tab', { name: section.name, selected: true });
      const panel = screen.getByRole('tabpanel', { name: section.name });
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
      expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
      expect(tab).toHaveAttribute('id', `intelligence-packs-tab-${section.key}`);
      expect(tab).toHaveAttribute('aria-controls', `intelligence-packs-panel-${section.key}`);
      expect(panel).toHaveAttribute('id', `intelligence-packs-panel-${section.key}`);
      expect(panel).toHaveAttribute('aria-labelledby', `intelligence-packs-tab-${section.key}`);
      expect(await within(panel).findByText(section.content)).toBeInTheDocument();
    }
  });

  it('keeps arrow and Home End navigation associated with the newly selected panel', async () => {
    const user = userEvent.setup();
    renderPage();
    screen.getByRole('tab', { name: 'Catalog' }).focus();

    await user.keyboard('{ArrowRight}');
    const installed = screen.getByRole('tab', { name: 'Installed', selected: true });
    await waitFor(() => expect(installed).toHaveFocus());
    expect(installed).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel', { name: 'Installed' }))
      .toHaveAttribute('aria-labelledby', installed.id);

    await user.keyboard('{End}');
    const security = screen.getByRole('tab', { name: 'Security & methodology', selected: true });
    await waitFor(() => expect(security).toHaveFocus());
    expect(security).toHaveAttribute('id', 'intelligence-packs-tab-security');
    expect(security).toHaveAttribute('aria-controls', 'intelligence-packs-panel-security');
    expect(security).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel', { name: 'Security & methodology' }))
      .toHaveAttribute('id', 'intelligence-packs-panel-security');
    expect(screen.getByRole('tabpanel', { name: 'Security & methodology' }))
      .toHaveAttribute('aria-labelledby', security.id);

    await user.keyboard('{Home}');
    const catalog = screen.getByRole('tab', { name: 'Catalog', selected: true });
    await waitFor(() => expect(catalog).toHaveFocus());
    expect(catalog).toHaveAttribute('tabindex', '0');
    await user.tab();
    expect(screen.getByRole('tabpanel', { name: 'Catalog' })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Catalog' }))
      .toHaveAttribute('aria-labelledby', 'intelligence-packs-tab-catalog');
  });
});
