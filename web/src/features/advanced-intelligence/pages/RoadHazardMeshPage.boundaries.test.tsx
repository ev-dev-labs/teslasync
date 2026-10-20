import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advancedIntelligenceKeys } from '@/api/hooks/useAdvancedIntelligence';
import type { HazardPage } from '@/types/advancedIntelligence';
import { hazards } from './advancedIntelligenceClosure.fixtures';
import RoadHazardMeshPage from './RoadHazardMeshPage';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  request: vi.fn(),
}));
const clients: QueryClient[] = [];

vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => state.request(...args),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.vehicleId = 7;
  state.request.mockRejectedValue(new Error('Synthetic uncached hazard page failure'));
});
afterEach(() => {
  cleanup();
  clients.forEach(client => client.clear());
  clients.length = 0;
});

function renderPage(data: HazardPage | undefined = hazards) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 60_000 } },
  });
  clients.push(client);
  if (data) client.setQueryData(advancedIntelligenceKeys.roadHazards(7, 18, 0), data);
  function Providers({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/intelligence/road-hazards']}>{children}</MemoryRouter>
    </QueryClientProvider>;
  }
  return { ...render(<RoadHazardMeshPage />, { wrapper: Providers }), client };
}

function expectShells() {
  expect(screen.getByRole('heading', { name: 'Hazard clusters' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeVisible();
  for (const name of ['Data quality', 'Evidence sources', 'Limitations']) {
    expect(screen.getByRole('region', { name })).toBeVisible();
  }
  expect(screen.getByText(/Cells are identifiers, not map pins/)).toBeVisible();
  expect(screen.getByText('• Exact coordinates or route reconstruction')).toBeVisible();
  expect(screen.getByText('• Automatic rerouting or vehicle commands')).toBeVisible();
}

describe('RoadHazardMeshPage requested-page and severity boundaries', () => {
  it.each(['Previous page', 'First page', 'direct jump'] as const)(
    'recovers from a genuinely uncached page-two failure using %s without inventing an empty total',
    async action => {
      const { client } = renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      await screen.findByText('Intelligence evidence could not be loaded.');
      expect(client.getQueryData(advancedIntelligenceKeys.roadHazards(7, 18, 18))).toBeUndefined();
      expect(state.request).toHaveBeenCalledWith(
        '/advanced-intelligence/road-hazards?vehicle_id=7&limit=18&offset=18',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      const pagination = screen.getByRole('navigation', { name: 'Pagination' });
      expect(pagination).toHaveTextContent('Page 2 of Unknown');
      expect(within(pagination).getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
      expect(within(pagination).getByRole('button', { name: 'Previous page' })).toBeEnabled();
      expect(within(pagination).getByRole('button', { name: 'Next page' })).toBeDisabled();
      expect(within(pagination).queryByRole('button', { name: 'Last page' })).not.toBeInTheDocument();
      expect(pagination).not.toHaveTextContent('Showing 0–0 of 0');
      expectShells();
      expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
      expect(screen.queryByText('No coarse-cell hazard clusters meet the privacy and evidence thresholds.'))
        .not.toBeInTheDocument();
      if (action === 'direct jump') {
        fireEvent.change(within(pagination).getByRole('textbox', { name: 'Go to page' }), {
          target: { value: '1' },
        });
        fireEvent.click(within(pagination).getByRole('button', { name: 'Go' }));
      } else {
        fireEvent.click(within(pagination).getByRole('button', { name: action }));
      }
      await screen.findByRole('heading', { name: 'rough-surface' });
      expect(client.getQueryData(advancedIntelligenceKeys.roadHazards(7, 18, 0))).toBe(hazards);
      expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 1–18 of 36');
      expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent('recorded-session-ledger');
      expect(state.request).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps page two and backward recovery reachable while its uncached request is still loading', () => {
    state.request.mockImplementation(() => new Promise<HazardPage>(() => {}));
    const { client } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(client.getQueryState(advancedIntelligenceKeys.roadHazards(7, 18, 18))?.fetchStatus).toBe('fetching');
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Page 2 of Unknown');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expectShells();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByRole('table', { name: 'Road hazard mesh' })).toHaveTextContent('coarse-cell-only');
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 1–18 of 36');
  });

  it('retries the actual failed page-two key and replaces unknown with its returned exact total', async () => {
    const { client } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Intelligence evidence could not be loaded.');
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Page 2 of Unknown');
    const recovered: HazardPage = { ...hazards, offset: 18, items: [
      { ...hazards.items[0], hazard_type: 'synthetic-page-two', coarse_cell: 'synthetic-coarse-two' },
    ] };
    state.request.mockResolvedValue(recovered);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { name: 'synthetic-page-two' });
    expect(client.getQueryData(advancedIntelligenceKeys.roadHazards(7, 18, 18))).toEqual(recovered);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 19–36 of 36');
    expect(screen.getByRole('button', { name: 'Page 2 of 2' })).toHaveAttribute('aria-current', 'page');
    expect(state.request.mock.calls.map(call => call[0])).toEqual([
      '/advanced-intelligence/road-hazards?vehicle_id=7&limit=18&offset=18',
      '/advanced-intelligence/road-hazards?vehicle_id=7&limit=18&offset=18',
    ]);
    expectShells();
  });

  it('retains the exact total, real zeros, quality and evidence for a matching page-two refresh failure', async () => {
    const { client } = renderPage();
    const retained: HazardPage = { ...hazards, offset: 18 };
    client.setQueryData(advancedIntelligenceKeys.roadHazards(7, 18, 18), retained);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await client.refetchQueries({ queryKey: advancedIntelligenceKeys.roadHazards(7, 18, 18), exact: true });
    await screen.findByText('The refresh failed; the most recently loaded evidence remains visible.');
    expect(client.getQueryData(advancedIntelligenceKeys.roadHazards(7, 18, 18))).toBe(retained);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 19–36 of 36');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Last page' })).toBeDisabled();
    expect(screen.getByRole('table', { name: 'Road hazard mesh' })).toHaveTextContent('0.00%');
    expect(screen.getByRole('region', { name: 'Data quality' })).toHaveTextContent('Limited evidence');
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent('recorded-session-ledger');
    expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent('No route reconstruction.');
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
    expectShells();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 1–18 of 36');
  });

  it('does not carry another vehicle total or metadata and resets before each newly selected vehicle query', async () => {
    state.request.mockImplementation(() => new Promise<HazardPage>(() => {}));
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    state.vehicleId = 8;
    view.rerender(<RoadHazardMeshPage />);
    await waitFor(() => expect(state.request).toHaveBeenLastCalledWith(
      '/advanced-intelligence/road-hazards?vehicle_id=8&limit=18&offset=0',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    expect(screen.queryByText('recorded-session-ledger')).not.toBeInTheDocument();
    expect(screen.queryByText('coarse-cell-only')).not.toBeInTheDocument();
    expectShells();
    state.vehicleId = 7;
    view.rerender(<RoadHazardMeshPage />);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 1–18 of 36');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    const callsBeforeUnselect = state.request.mock.calls.length;
    state.vehicleId = null;
    view.rerender(<RoadHazardMeshPage />);
    expect(screen.getByText('Select a vehicle to load intelligence.')).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    expect(screen.queryByText('recorded-session-ledger')).not.toBeInTheDocument();
    expect(state.request).toHaveBeenCalledTimes(callsBeforeUnselect);
    expectShells();
  });

  it('keeps authoritative zero empty rather than presenting it as an unknown total', () => {
    renderPage({ ...hazards, items: [], total: 0, limitations: [] });
    expect(screen.getByText('No coarse-cell hazard clusters meet the privacy and evidence thresholds.')).toBeVisible();
    expect(screen.getByText('No supporting evidence was returned.')).toBeVisible();
    expect(screen.getByText('No additional limitations were returned.')).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    expect(state.request).not.toHaveBeenCalled();
    expectShells();
  });

  it.each([
    { severity: 'critical', variant: 'danger' },
    { severity: 'high', variant: 'danger' },
    { severity: 'medium', variant: 'warning' },
    { severity: 'warning', variant: 'warning' },
    { severity: 'low', variant: 'info' },
    { severity: 'info', variant: 'info' },
    { severity: 'unknown', variant: 'neutral', label: 'Unknown' },
    { severity: 'synthetic-new-severity', variant: 'neutral' },
    { severity: 'constructor', variant: 'neutral' },
    { severity: '', variant: 'neutral', label: 'Unknown' },
    { severity: '   ', variant: 'neutral', label: 'Unknown' },
  ])('uses $variant for source severity "$severity" without changing the record or recognized mappings',
    ({ severity, variant, label }) => {
      const data: HazardPage = { ...hazards, items: [{ ...hazards.items[0], severity }] };
      const { client } = renderPage(data);
      const article = screen.getByRole('heading', { name: 'rough-surface' }).closest('article');
      if (!article) throw new Error('Missing synthetic hazard article');
      const badge = within(article).getByText(label ?? severity);
      expect(badge).toHaveClass(variant === 'neutral'
        ? 'text-[var(--text-secondary)]' : `text-[var(--semantic-${variant})]`);
      if (variant === 'neutral') expect(badge).not.toHaveClass('text-[var(--semantic-info)]');
      expect(within(article).getByRole('table', { name: 'Road hazard mesh' }))
        .toHaveAccessibleDescription('rough-surface coarse-cell-only');
      expect(within(article).getByText('0.00%')).toBeVisible();
      expect(client.getQueryData<HazardPage>(advancedIntelligenceKeys.roadHazards(7, 18, 0))?.items[0].severity)
        .toBe(severity);
      expectShells();
      expect(state.request).not.toHaveBeenCalled();
    },
  );
});
