import type { ReactElement, ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { HazardPage } from '@/types/advancedIntelligence';
import { ToastProvider } from '@/components/feedback';
import { hazards } from './advancedIntelligenceClosure.fixtures';
import RoadHazardMeshPage from './RoadHazardMeshPage';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  query: {} as DataStateSource<HazardPage>,
  read: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useRoadHazards: (...args: unknown[]) => { state.read(...args); return state.query; },
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
  const element: ReactElement = <RoadHazardMeshPage />;
  return render(element, { wrapper: Providers });
}

function clusterArticle(name = 'rough-surface') {
  const article = screen.getByRole('heading', { name }).closest('article');
  if (!article) throw new Error('Missing hazard article');
  return article;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.vehicleId = 7;
  state.query = { data: hazards, error: null, isLoading: false, isFetching: false,
    fetchStatus: 'idle', refetch: state.retry };
});

describe('RoadHazardMeshPage restrained source preservation', () => {
  it('preserves all coarse-cell fields, real zero, evidence and privacy boundaries', () => {
    renderPage();
    const article = clusterArticle();
    const table = within(article).getByRole('table', { name: 'Road hazard mesh' });
    expect(within(table).getAllByRole('rowheader').map(cell => cell.textContent))
      .toEqual(['Coarse cell', 'Confidence', 'Observations', 'Last seen']);
    expect(within(article).getByText('high')).toBeInTheDocument();
    expect(within(table).getByText('coarse-cell-only')).toBeInTheDocument();
    expect(within(table).getByText('0.00%')).toBeInTheDocument();
    expect(within(table).getByText('0')).toBeInTheDocument();
    expect(within(table).getAllByRole('cell')[3]).not.toHaveTextContent('—');
    expect(screen.getByText(/Cells are identifiers, not map pins/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /map/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Data quality' })).toHaveTextContent('Limited evidence');
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent('recorded-session-ledger');
    expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent('No route reconstruction.');
    expect(screen.getByText(/Exact coordinates or route reconstruction/)).toBeInTheDocument();
    expect(screen.getByText(/Automatic rerouting or vehicle commands/)).toBeInTheDocument();
  });

  it('uses neutral shared surfaces and uniquely describes every matrix without changing its saved name', () => {
    state.query.data = { ...hazards, items: [
      hazards.items[0],
      { ...hazards.items[0], hazard_type: 'synthetic-long-hazard'.repeat(20),
        coarse_cell: 'synthetic-coarse-identifier'.repeat(20), severity: 'medium' },
    ] };
    renderPage();
    const tables = screen.getAllByRole('table', { name: 'Road hazard mesh' });
    expect(tables).toHaveLength(2);
    expect(tables[0]).toHaveAccessibleDescription('rough-surface coarse-cell-only');
    expect(tables[1]).toHaveAccessibleDescription(
      `${'synthetic-long-hazard'.repeat(20)} ${'synthetic-coarse-identifier'.repeat(20)}`);
    expect(tables[0].getAttribute('aria-describedby')).not.toBe(tables[1].getAttribute('aria-describedby'));
    expect(tables[0].closest('[data-table-variant]')).toHaveAttribute('data-table-variant', 'embedded');
    expect(clusterArticle().firstElementChild).toHaveClass('bg-[var(--surface-2)]', 'shadow-none');
    expect(clusterArticle().parentElement).toHaveClass('@2xl:grid-cols-2', '@5xl:grid-cols-3');
    expect(screen.getByText('synthetic-coarse-identifier'.repeat(20))).toHaveClass('break-all');
  });

  it('preserves first, previous, next, last and direct jump with exact eighteen-row offsets', () => {
    state.query.data = { ...hazards, total: 90 };
    renderPage();
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 18);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 72);
    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 0);
    fireEvent.change(screen.getByRole('textbox', { name: 'Go to page' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 36);
  });

  it('resets the workspace vehicle offset before its first new query and after returning', () => {
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    state.read.mockClear();
    state.vehicleId = 8;
    state.query.data = undefined;
    view.rerender(<RoadHazardMeshPage />);
    expect(state.read.mock.calls.every(call => call[0] === 8 && call[2] === 0)).toBe(true);
    expect(state.read).toHaveBeenCalledWith(8, 18, 0);
    state.vehicleId = 7;
    view.rerender(<RoadHazardMeshPage />);
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 0);
  });

  it('recovers the actual server offset when an authoritative total shrinks', () => {
    state.query.data = { ...hazards, total: 54 };
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 36);
    state.query.data = { ...hazards, items: [], total: 19, offset: 36 };
    view.rerender(<RoadHazardMeshPage />);
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 18);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    state.query.data = { ...hazards, items: [], total: 0, offset: 18 };
    view.rerender(<RoadHazardMeshPage />);
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 0);
    expect(screen.getByText('No coarse-cell hazard clusters meet the privacy and evidence thresholds.')).toBeInTheDocument();
  });

  it('keeps pagination reachable on an empty loaded page', () => {
    state.query.data = { ...hazards, items: [] };
    renderPage();
    expect(screen.getByText('No coarse-cell hazard clusters meet the privacy and evidence thresholds.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 18);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 0);
  });

  it.each([
    { name: 'refresh-failure', error: new Error('refresh failed'), fetchStatus: 'idle' as const,
      message: 'The refresh failed; the most recently loaded evidence remains visible.' },
    { name: 'paused-refresh', error: null, fetchStatus: 'paused' as const,
      message: 'Cached evidence remains visible while its refresh is paused.' },
  ])('retains hazard and evidence during $name with the real individual retry', ({ error, fetchStatus, message }) => {
    state.query = { ...state.query, error, fetchStatus };
    renderPage();
    expect(clusterArticle()).toHaveTextContent('coarse-cell-only');
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent('recorded-session-ledger');
    expect(screen.getByText(message)).toBeInTheDocument();
    const warning = screen.getByTestId('stale-refresh-warning');
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(state.retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
  });

  it('keeps all section shells while initial loading or an initial source failure is unresolved', () => {
    state.query = { isLoading: true, fetchStatus: 'fetching', refetch: state.retry };
    const view = renderPage();
    expect(screen.getByRole('heading', { name: 'Hazard clusters' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'rough-surface' })).not.toBeInTheDocument();
    state.query = { error: new Error('initial source failed'), refetch: state.retry };
    view.rerender(<RoadHazardMeshPage />);
    expect(screen.getByText('Intelligence evidence could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Data quality' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Limitations' })).toBeInTheDocument();
  });

  it('keeps the vehicle prerequisite and unsupported explanations without inventing zero readings', () => {
    state.vehicleId = null;
    state.query.data = undefined;
    renderPage();
    expect(state.read).toHaveBeenLastCalledWith(null, 18, 0);
    expect(screen.getByText('Select a vehicle to load intelligence.')).toBeInTheDocument();
    expect(screen.getByText('Explicitly unsupported')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Road hazard mesh' })).not.toBeInTheDocument();
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
  });
});
