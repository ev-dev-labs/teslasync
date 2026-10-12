import type { ReactElement, ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { AdvancedPage, FirmwareCanary } from '@/types/advancedIntelligence';
import { ToastProvider } from '@/components/feedback';
import { typography } from '@/lib/tokens';
import { firmware, observation } from './advancedIntelligenceClosure.fixtures';
import FirmwareCanaryPage from './FirmwareCanaryPage';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  query: {} as DataStateSource<AdvancedPage<FirmwareCanary>>,
  read: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useFirmwareCanary: (...args: unknown[]) => {
    state.read(...args);
    return state.query;
  },
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>
      <MemoryRouter><ToastProvider>{children}</ToastProvider></MemoryRouter>
    </QueryClientProvider>;
  }
  const view = render(<FirmwareCanaryPage />, { wrapper: Providers });
  return {
    ...view,
    rerender: (element: ReactElement = <FirmwareCanaryPage />) => view.rerender(element),
  };
}

function decision(version = '2026.20') {
  const article = screen.getByRole('heading', { name: version }).closest('article');
  if (!article) throw new Error('Missing firmware decision article');
  return article;
}

function populate(items: FirmwareCanary[] = [firmware], total = items.length) {
  state.query.data = { items, total, limit: 10, offset: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.vehicleId = 7;
  state.query = {
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    isFetching: false,
    fetchStatus: 'idle',
    refetch: state.retry,
  };
  window.localStorage.clear();
});

describe('FirmwareCanaryPage restrained decision presentation', () => {
  it('uses the shared neutral card without changing article identity or regression values', () => {
    populate();
    renderPage();
    const article = decision();
    const card = article.querySelector('[data-print-card]');
    expect(card).toHaveClass(
      'rounded-panel', 'border-[var(--panel-border)]', 'bg-[var(--panel-bg)]',
      'forced-colors:border-[CanvasText]', 'forced-colors:bg-[Canvas]',
    );
    expect(article).toHaveClass('min-w-0', 'break-words');
    expect(article).not.toHaveClass('border-white/[0.08]', 'bg-white/[0.025]');
    expect(within(article).getByText('0.00%')).toBeInTheDocument();
    expect(within(article).getAllByText('—')).toHaveLength(2);
    expect(within(article).getByText('insufficient')).toBeInTheDocument();
    ['Target regression', 'Peer regression', 'Matched excess', 'Decision generated']
      .forEach(label => expect(within(article).getByText(label)).toBeInTheDocument());
    const rationale = within(article).getByText('Decision rationale').parentElement;
    expect(rationale).toHaveClass('border-[var(--border-default)]', 'bg-[var(--surface-2)]');
    expect(rationale).not.toHaveClass('border-white/[0.06]');
    expect(within(article).getByText(/do not contain enough supported observations/)).toBeInTheDocument();
    const icon = article.querySelector('.lucide-git-compare-arrows');
    expect(icon).toHaveClass(...typography.color.secondary.split(' '), 'shrink-0');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('preserves every returned version, status and supported rationale in source order', () => {
    populate([
      { ...firmware, decision: 'rollout', vehicle_regression_pct: -1, peer_regression_pct: 0, matched_excess_pct: -1 },
      { ...firmware, version: '2026.21', decision: 'hold' },
      { ...firmware, version: '2026.22', decision: 'investigate' },
      { ...firmware, version: null },
    ]);
    renderPage();
    expect(screen.getAllByRole('article').map(article =>
      within(article).getByRole('heading', { level: 3 }).textContent))
      .toEqual(['2026.20', '2026.21', '2026.22', 'Version unsupported']);
    expect(within(decision()).getAllByText('-1.00%')).toHaveLength(2);
    expect(within(decision()).getByText('0.00%')).toBeInTheDocument();
    expect(within(decision()).getByText('rollout')).toBeInTheDocument();
    expect(within(decision('2026.21')).getByText('hold')).toBeInTheDocument();
    expect(within(decision('2026.22')).getByText('investigate')).toBeInTheDocument();
    expect(within(decision()).getByText(/relative to the matched peer change and window quality/)).toBeInTheDocument();
  });

  it('retains evidence metadata and unsupported deployment limits without exposing command actions', () => {
    populate([{ ...firmware, evidence: [
      observation, { ...observation, source: 'second-source', sample_count: null },
    ] }]);
    renderPage();
    const quality = screen.getByRole('region', { name: 'Data quality' });
    expect(within(quality).getByText('limited')).toBeInTheDocument();
    expect(within(quality).getByText('0')).toBeInTheDocument();
    expect(within(quality).getByText('—')).toBeInTheDocument();
    expect(within(quality).getByText(/2026/)).toBeInTheDocument();
    expect(within(quality).getByText(/No meter coverage; do not infer a measured loss/)).toBeInTheDocument();
    const sources = screen.getByRole('region', { name: 'Evidence sources' });
    const first = within(sources).getByText(observation.source);
    const second = within(sources).getByText('second-source');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(sources).getByText(/0 samples/)).toBeInTheDocument();
    const limitations = screen.getByRole('region', { name: 'Limitations' });
    expect(within(limitations).getByText(/Matched peers are incomplete/)).toBeInTheDocument();
    expect(within(limitations).getByText('Explicitly unsupported')).toBeInTheDocument();
    expect(within(limitations).getByText(/Proof that firmware caused a measured change/)).toBeInTheDocument();
    expect(within(limitations).getByText(/Firmware deployment or rollback commands/)).toBeInTheDocument();
    expect(screen.getByText(/does not install, hold, or roll back firmware/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /install|hold|rollback|roll back/i })).not.toBeInTheDocument();
  });

  it('keeps caller-owned page size and exact offsets through retained refresh failure', () => {
    populate([firmware], 20);
    const view = renderPage();
    expect(state.read).toHaveBeenLastCalledWith(7, 10, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 10, 10);
    state.query.error = new Error('refresh failed');
    view.rerender();
    expect(within(decision()).getByText('0.00%')).toBeInTheDocument();
    expect(screen.getByText(/refresh failed; the most recently loaded evidence remains visible/)).toBeInTheDocument();
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(state.retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 10, 0);
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent(observation.source);
  });

  it.each([
    { name: 'unselected vehicle', selected: null, message: 'Select a vehicle to load intelligence.' },
    { name: 'resolved empty windows', selected: 7, message: 'No firmware canary windows are available.' },
  ])('keeps both section shells for $name', ({ selected, message }) => {
    state.vehicleId = selected;
    populate([]);
    renderPage();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Matched cohort decisions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Data quality' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent('Explicitly unsupported');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('retains the warning and evidence shell when the decision source initially fails', () => {
    state.query.error = new Error('source failed');
    state.query.isError = true;
    renderPage();
    expect(screen.getByText('Intelligence evidence could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText(/does not install, hold, or roll back firmware/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
