import type { ReactNode } from 'react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { HazardPage } from '@/types/advancedIntelligence';
import { hazards } from './advancedIntelligenceClosure.fixtures';
import RoadHazardMeshPage from './RoadHazardMeshPage';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  query: {} as DataStateSource<HazardPage>,
  read: vi.fn(), retry: vi.fn(),
  realQuery: false, request: vi.fn(),
}));
const clients: QueryClient[] = [];

vi.mock('@/api/client', () => ({ request: state.request }));
vi.mock('@/api/hooks/useAdvancedIntelligence', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useAdvancedIntelligence')>(
    '@/api/hooks/useAdvancedIntelligence',
  );
  return {
    useRoadHazards: (vehicleId: number | null, limit?: number, offset?: number) => {
      state.read(vehicleId, limit, offset);
      return state.realQuery ? actual.useRoadHazards(vehicleId, limit, offset) : state.query;
    },
  };
});
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.realQuery = false;
  onlineManager.setOnline(true);
  state.vehicleId = 7;
  state.query = { data: hazards, isSuccess: true, fetchStatus: 'idle',
    dataUpdatedAt: Date.parse(hazards.generated_at), refetch: state.retry };
});
afterEach(() => {
  cleanup();
  clients.forEach(client => client.clear());
  clients.length = 0;
  onlineManager.setOnline(true);
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  function Providers({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
  }
  return render(<RoadHazardMeshPage />, { wrapper: Providers });
}

function expectShells() {
  expect(screen.getByRole('heading', { name: 'Hazard clusters' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeVisible();
  for (const name of ['Data quality', 'Evidence sources', 'Limitations']) {
    expect(screen.getByRole('region', { name })).toBeVisible();
  }
  expect(screen.getByText('Coarse cells protect location privacy')).toBeVisible();
  expect(screen.getByText(/Cells are identifiers, not map pins/)).toBeVisible();
  expect(screen.getByText('• Exact coordinates or route reconstruction')).toBeVisible();
  expect(screen.getByText('• Automatic rerouting or vehicle commands')).toBeVisible();
}

function expectNoResultClaims() {
  expect(screen.queryByText('Quality metadata is unsupported.')).not.toBeInTheDocument();
  expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
  expect(screen.queryByText('No additional limitations were returned.')).not.toBeInTheDocument();
  expect(screen.queryByText('recorded-session-ledger')).not.toBeInTheDocument();
}

describe('RoadHazardMeshPage evidence source trust', () => {
  it('uses the real scoped hook across offline initial load retry retained failure and recovery', async () => {
    state.realQuery = true;
    onlineManager.setOnline(false);
    let fail = true;
    state.request.mockImplementation(async () => {
      if (fail) throw new Error('Synthetic hazard request failure');
      return hazards;
    });
    const view = renderPage();
    expectShells();
    expectNoResultClaims();
    expect(screen.getAllByText('The initial evidence query is paused; no empty result is inferred.')).toHaveLength(1);
    expect(state.request).not.toHaveBeenCalled();
    const client = clients[0];
    const key = ['advanced-intelligence', 'road-hazards', 7, 18, 0];
    await act(async () => { onlineManager.setOnline(true); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible());
    expectNoResultClaims();
    expect(client.getQueryData(key)).toBeUndefined();
    expect(screen.getAllByText('Intelligence evidence could not be loaded.')).toHaveLength(1);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Evidence sources' }))
      .toHaveTextContent('recorded-session-ledger'));
    expect(client.getQueryData(key)).toBe(hazards);
    const successfulAt = client.getQueryState(key)?.dataUpdatedAt;
    expect(successfulAt).toBeGreaterThan(0);
    expect(state.request).toHaveBeenLastCalledWith(
      '/advanced-intelligence/road-hazards?vehicle_id=7&limit=18&offset=0',
      { signal: expect.any(AbortSignal) },
    );
    fail = true;
    await act(async () => { await client.refetchQueries({ queryKey: key }); });
    await waitFor(() => expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1));
    expectShells();
    expect(screen.getByRole('table', { name: 'Road hazard mesh' })).toHaveTextContent('coarse-cell-only');
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent('recorded-session-ledger');
    expect(client.getQueryData(key)).toBe(hazards);
    expect(client.getQueryState(key)?.dataUpdatedAt).toBe(successfulAt);
    fail = false;
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
    expect(state.request).toHaveBeenCalledTimes(4);
    expect(client.getQueryData(key)).toBe(hazards);
    expect(hazards.items[0].confidence_pct).toBe(0);
    expect(hazards.items[0].last_seen).toBe('2026-08-02T00:00:00Z');
    onlineManager.setOnline(false);
    state.vehicleId = 8;
    view.rerender(<RoadHazardMeshPage />);
    expectShells();
    expectNoResultClaims();
    expect(client.getQueryState(['advanced-intelligence', 'road-hazards', 8, 18, 0])?.fetchStatus).toBe('paused');
    expect(client.getQueryData(key)).toBe(hazards);
    expect(state.request).toHaveBeenCalledTimes(4);
  });

  it.each([
    { phase: 'initial fetching', query: { isLoading: true, fetchStatus: 'fetching' as const }, message: null },
    { phase: 'initial paused', query: { isPending: true, fetchStatus: 'paused' as const },
      message: 'The initial evidence query is paused; no empty result is inferred.' },
    { phase: 'initial fatal', query: { error: new Error('Synthetic hazard failure'), isError: true },
      message: 'Intelligence evidence could not be loaded.' },
    { phase: 'unresolved idle', query: { isPending: true, fetchStatus: 'idle' as const },
      message: 'Evidence availability has not resolved yet.' },
  ])('threads authentic $phase into evidence without duplicating the upper source notice', ({ query, message }) => {
    state.query = { ...query, refetch: state.retry };
    renderPage();
    expectShells();
    expectNoResultClaims();
    if (message) expect(screen.getAllByText(message)).toHaveLength(1);
    if (query.fetchStatus === 'fetching') {
      expect(screen.getByRole('status', { name: 'Loading Evidence sources' })).toBeVisible();
    }
    expect(screen.queryByRole('table', { name: 'Road hazard mesh' })).not.toBeInTheDocument();
  });

  it('keeps a disabled unselected query unresolved with independent coarse-cell disclosures', () => {
    state.vehicleId = null;
    state.query = { isPending: true, fetchStatus: 'idle', refetch: state.retry };
    renderPage();
    expectShells();
    expectNoResultClaims();
    expect(screen.getAllByText('Select a vehicle to load intelligence.')).toHaveLength(1);
    expect(state.read).toHaveBeenCalledWith(null, 18, 0);
  });

  it('recovers through the sole fatal retry then displays authoritative empty and populated evidence', () => {
    state.query = { error: new Error('Synthetic hazard failure'), refetch: state.retry };
    const view = renderPage();
    expectNoResultClaims();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
    state.query = { data: { ...hazards, items: [], total: 0, limitations: [] }, isSuccess: true };
    view.rerender(<RoadHazardMeshPage />);
    expectShells();
    expect(screen.getByText('No coarse-cell hazard clusters meet the privacy and evidence thresholds.')).toBeVisible();
    expect(screen.getByText('No supporting evidence was returned.')).toBeVisible();
    expect(screen.getByText('No additional limitations were returned.')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Data quality' })).getByText('0')).toBeVisible();
    state.query = { data: hazards, isSuccess: true };
    view.rerender(<RoadHazardMeshPage />);
    expect(screen.getByRole('table', { name: 'Road hazard mesh' })).toHaveTextContent('coarse-cell-only');
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent('recorded-session-ledger');
    expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent('No route reconstruction.');
  });

  it.each([
    { phase: 'refresh failure', query: { error: new Error('Synthetic retained failure'), isError: true },
      message: 'The refresh failed; the most recently loaded evidence remains visible.' },
    { phase: 'paused refresh', query: { fetchStatus: 'paused' as const },
      message: 'Cached evidence remains visible while its refresh is paused.' },
  ])('retains matching coarse-cell records and evidence with one source notice during $phase', ({ query, message }) => {
    const successfulAt = state.query.dataUpdatedAt;
    state.query = { ...state.query, ...query };
    const view = renderPage();
    expectShells();
    expect(screen.getByRole('table', { name: 'Road hazard mesh' })).toHaveTextContent('coarse-cell-only');
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent('recorded-session-ledger');
    expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent('No route reconstruction.');
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(screen.getAllByText(message)).toHaveLength(1);
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(state.retry).toHaveBeenCalledOnce();
    expect(state.query.data).toBe(hazards);
    expect(state.query.dataUpdatedAt).toBe(successfulAt);
    state.query = { data: hazards, isSuccess: true, fetchStatus: 'idle', refetch: state.retry };
    view.rerender(<RoadHazardMeshPage />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent('recorded-session-ledger');
  });

  it.each([
    { phase: 'refresh error', query: { error: new Error('Synthetic empty refresh failure') } },
    { phase: 'paused refresh', query: { fetchStatus: 'paused' as const } },
  ])('retains all empty hazard and evidence explanations through $phase', ({ query }) => {
    state.query = { ...state.query, data: { ...hazards, items: [], total: 0, limitations: [] }, ...query };
    renderPage();
    expectShells();
    expect(screen.getByText('No coarse-cell hazard clusters meet the privacy and evidence thresholds.')).toBeVisible();
    expect(screen.getByText('No supporting evidence was returned.')).toBeVisible();
    expect(screen.getByText('No additional limitations were returned.')).toBeVisible();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
  });

  it('retains active refresh evidence and drops prior vehicle metadata as soon as scope changes', () => {
    state.query = { ...state.query, isFetching: true, fetchStatus: 'fetching' };
    const view = renderPage();
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent('recorded-session-ledger');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 18, 18);
    state.vehicleId = 8;
    state.query = { isPending: true, fetchStatus: 'paused', refetch: state.retry };
    view.rerender(<RoadHazardMeshPage />);
    expectShells();
    expectNoResultClaims();
    expect(state.read).toHaveBeenLastCalledWith(8, 18, 0);
    expect(hazards.items[0].confidence_pct).toBe(0);
    expect(hazards.items[0].last_seen).toBe('2026-08-02T00:00:00Z');
  });
});
