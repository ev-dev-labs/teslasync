import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { AdvancedPage, ComponentSurvival } from '@/types/advancedIntelligence';
import { survival } from './advancedIntelligenceClosure.fixtures';
import ComponentSurvivalPage from './ComponentSurvivalPage';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  query: {} as DataStateSource<AdvancedPage<ComponentSurvival>>,
  read: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useComponentSurvival: (...args: unknown[]) => {
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
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>;
  }
  const view = render(<ComponentSurvivalPage />, { wrapper: Providers });
  return { ...view, update: () => view.rerender(<ComponentSurvivalPage />) };
}

function populate(items = [survival], total = items.length) {
  state.query.data = { items: structuredClone(items), total, limit: 12, offset: 0 };
}

function componentArticle(name: string) {
  const heading = screen.getAllByRole('heading', { name }).find(element => element.closest('article'));
  const article = heading?.closest('article');
  if (!article) throw new Error(`Missing component article ${name}`);
  return article;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.vehicleId = 7;
  state.query = { fetchStatus: 'idle', refetch: state.retry };
  window.localStorage.clear();
});

describe('Component survival page scoped adoption', () => {
  it('preserves SI horizons, unknown estimates, ordered zero and unsupported risks and signed modeled sensitivity', () => {
    populate();
    const original = structuredClone(state.query.data);
    renderPage();
    const article = componentArticle('front-bearing');
    ['Survival probability', 'P10 horizon', 'P50 horizon', 'P90 horizon', 'Competing risks', 'Intervention sensitivity']
      .forEach(label => expect(within(article).getByText(label)).toBeInTheDocument());
    expect(article.querySelectorAll('[data-stat]')).toHaveLength(4);
    expect(article.querySelectorAll('[data-state="missing"]')).toHaveLength(2);
    expect(within(article).getByText('0.00 h')).toBeInTheDocument();
    expect(within(article).getByText('2.00 h')).toBeInTheDocument();
    const risk = within(article).getByRole('progressbar', { name: 'observed-wear · 0 evidence' });
    expect(risk).toHaveAttribute('aria-valuenow', '0');
    expect(risk).toHaveAttribute('aria-valuemax', '100');
    expect(risk.querySelector('[style*="linear-gradient"]')).toBeNull();
    expect(within(article).getByText('unmeasured-corrosion · 0 evidence')).toBeInTheDocument();
    expect(within(article).getByText('Unsupported')).toBeInTheDocument();
    expect(within(article).getByText(/modeled service only: -10.00% · adjusted P50 —/)).toBeInTheDocument();
    expect(state.query.data).toEqual(original);
  });

  it('exposes each component basis, censored observations, quality reasons and limitations without merging evidence', () => {
    const second: ComponentSurvival = {
      ...survival, component: 'rear-bearing-with-a-long-source-identity',
      generated_at: '2026-08-04T00:00:00Z',
      data_quality: { ...survival.data_quality, sample_count: 3, reasons: ['Rear component coverage is limited.'] },
      evidence: [{ source: 'rear-ledger', observed_at: null, sample_count: 0, summary: 'Censored observation, not a confirmed failure.' }],
      limitations: ['Rear component outcome is not established.'],
    };
    populate([survival, second]);
    renderPage();
    const firstEvidence = screen.getByRole('region', { name: 'front-bearing' });
    const secondEvidence = screen.getByRole('region', { name: second.component });
    expect(within(firstEvidence).getByText('recorded-session-ledger')).toBeInTheDocument();
    expect(within(firstEvidence).queryByText('rear-ledger')).not.toBeInTheDocument();
    expect(within(secondEvidence).getByText('rear-ledger')).toBeInTheDocument();
    expect(within(secondEvidence).getByText('Censored observation, not a confirmed failure.')).toBeInTheDocument();
    expect(within(secondEvidence).getByText(/0 samples/)).toBeInTheDocument();
    expect(within(secondEvidence).getByText(/Rear component coverage is limited/)).toBeInTheDocument();
    expect(within(secondEvidence).getByText(/Rear component outcome is not established/)).toBeInTheDocument();
    expect(within(secondEvidence).getByText(/Result generated:/)).toBeInTheDocument();
    expect(within(secondEvidence).queryByText('recorded-session-ledger')).not.toBeInTheDocument();
    expect(firstEvidence.compareDocumentPosition(secondEvidence) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(componentArticle(second.component)).toHaveClass('min-w-0', 'break-words');
  });

  it.each([
    { name: 'loading', source: { isLoading: true, fetchStatus: 'fetching' as const } },
    { name: 'paused', source: { fetchStatus: 'paused' as const } },
    { name: 'unresolved', source: { fetchStatus: 'idle' as const } },
    { name: 'fatal', source: { error: new Error('source failed') } },
  ])('keeps source shells and non-capabilities without claiming returned evidence during $name', ({ source }) => {
    Object.assign(state.query, source);
    renderPage();
    expect(screen.getByRole('heading', { name: 'Component survival cards' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    expect(screen.getByText('A guaranteed failure date')).toBeInTheDocument();
    expect(screen.getByText('Automatic diagnosis or repair authorization')).toBeInTheDocument();
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    expect(screen.queryByText('No additional limitations were returned.')).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('retains component-specific evidence through refresh failure and paused refresh with source-owned retry', () => {
    populate();
    const view = renderPage();
    state.query.error = new Error('refresh failed');
    view.update();
    expect(screen.getAllByText('recorded-session-ledger')).toHaveLength(1);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    fireEvent.click(within(screen.getAllByTestId('stale-refresh-warning')[0]).getByRole('button', { name: 'Refresh' }));
    expect(state.retry).toHaveBeenCalledOnce();
    state.query.error = null;
    state.query.fetchStatus = 'paused';
    view.update();
    expect(screen.getAllByText('Cached evidence remains visible while its refresh is paused.')).toHaveLength(2);
    expect(componentArticle('front-bearing')).toBeInTheDocument();
    expect(screen.getByText('recorded-session-ledger')).toBeInTheDocument();
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
  });

  it('preserves server pagination and resets offsets immediately when workspace vehicle changes and returns', () => {
    populate([survival], 24);
    const view = renderPage();
    expect(state.read).toHaveBeenLastCalledWith(7, 12, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 12, 12);
    state.vehicleId = 8;
    view.update();
    expect(state.read).toHaveBeenLastCalledWith(8, 12, 0);
    state.vehicleId = 7;
    view.update();
    expect(state.read).toHaveBeenLastCalledWith(7, 12, 0);
    expect(screen.queryByLabelText('Select vehicle')).not.toBeInTheDocument();
  });

  it('keeps first-page recovery reachable after a resolved empty out-of-range page', () => {
    populate([survival], 24);
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    populate([], 0);
    view.update();
    expect(screen.getAllByText('No component survival estimates are available.')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 12, 0);
  });

  it('keeps no-vehicle guidance and non-capabilities without fabricating empty returned evidence', () => {
    state.vehicleId = null;
    renderPage();
    expect(state.read).toHaveBeenLastCalledWith(null, 12, 0);
    expect(screen.getAllByText('Select a vehicle to load intelligence.')).toHaveLength(2);
    expect(screen.getByText('A guaranteed failure date')).toBeInTheDocument();
    expect(screen.queryByText('Quality metadata is unsupported.')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
