import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { completionCopy as c } from './completionCopy';
import SharedLibraryCompletionReference from './SharedLibraryCompletionReference';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DEV completion companion host', () => {
  it('renders all twelve contracts in eight identified sections and resets caller interactions', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <MemoryRouter initialEntries={['/dev/shared-library-completion']}>
              <SharedLibraryCompletionReference />
            </MemoryRouter>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    const container = document.body;
    const titles = [
      c.selectionTitle, c.evidenceTitle, c.copyTitle, c.widgetTitle,
      c.eventTitle, c.bulkTitle, c.sourceTitle, c.chartTitle,
    ];
    titles.forEach(title => expect(screen.getByRole('region', { name: title })).toBeInTheDocument());
    expect(container.querySelectorAll('section[aria-labelledby]')).toHaveLength(8);
    const contractIds = [
      'weekday-select', 'composition-rail', 'code-block', 'copy-button', 'kv-list',
      'pill-filter-bar', 'widget-gauge-hero', 'widget-ranked-list',
      'timeline-item-event-feed', 'bulk-actions-toolbar', 'source-content', 'chart-card',
    ];
    const expectUniqueContracts = () => {
      expect(container.querySelectorAll('[data-shared-contract]')).toHaveLength(12);
      contractIds.forEach(id => expect(container.querySelectorAll(`[data-shared-contract="${id}"]`)).toHaveLength(1));
    };
    expectUniqueContracts();
    expect(screen.getByText(c.notice)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: c.narrow }));
    expect(container.querySelector('[data-allocated-width]')).toHaveAttribute('data-allocated-width', 'narrow');
    fireEvent.click(screen.getByRole('button', { name: c.clearDays }));
    expect(screen.getByText(c.none)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('region', { name: c.sourceTitle })).getByRole('button', { name: 'Empty' }));
    expect(screen.getByText(c.prerequisite)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: c.reset }));
    expect(screen.queryByText(c.none)).not.toBeInTheDocument();
    expect(screen.queryByText(c.prerequisite)).not.toBeInTheDocument();
    expect(container.querySelector('[data-allocated-width]')).toHaveAttribute('data-allocated-width', 'available');
    expectUniqueContracts();
    queryClient.clear();
  });
});
