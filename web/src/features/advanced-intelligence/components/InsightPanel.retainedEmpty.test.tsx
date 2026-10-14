import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import { Button } from '@/components/ui';
import type { HazardPage } from '@/types/advancedIntelligence';
import { hazards } from '../pages/advancedIntelligenceClosure.fixtures';
import { InsightPanel } from './InsightPanel';

const EMPTY_MESSAGE = 'No coarse-cell hazard clusters meet the privacy and evidence thresholds.';
const FAILED_MESSAGE = 'The refresh failed; the most recently loaded evidence remains visible.';
const PAUSED_MESSAGE = 'Cached evidence remains visible while its refresh is paused.';
const emptyPage: HazardPage = { ...hazards, items: [], total: 0, offset: 0 };
const clients: QueryClient[] = [];

function createClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return client;
}

afterEach(() => {
  cleanup();
  clients.forEach(client => client.clear());
  clients.length = 0;
});

function panel(query: DataStateSource<unknown>, empty: boolean, onRetry?: () => void) {
  return <InsightPanel title="Hazard clusters" description="Source details" query={query}
    empty={empty} emptyMessage={EMPTY_MESSAGE} onRetry={onRetry}>
    <span>{hazards.items[0].hazard_type}</span>
    <Button onClick={() => undefined}>Inspect evidence</Button>
  </InsightPanel>;
}

function renderPanel(query: DataStateSource<unknown>, empty: boolean, onRetry?: () => void) {
  const client = createClient();
  function Providers({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
  }
  return render(panel(query, empty, onRetry), { wrapper: Providers });
}

const retainedCases = [
  { shape: 'HazardPage object', phase: 'refresh failure', data: emptyPage,
    error: new Error('Refresh failed'), fetchStatus: 'idle' as const, message: FAILED_MESSAGE },
  { shape: 'HazardPage object', phase: 'paused refresh', data: emptyPage,
    error: null, fetchStatus: 'paused' as const, message: PAUSED_MESSAGE },
  { shape: 'empty array', phase: 'refresh failure', data: [],
    error: new Error('Refresh failed'), fetchStatus: 'idle' as const, message: FAILED_MESSAGE },
  { shape: 'empty array', phase: 'paused refresh', data: [],
    error: null, fetchStatus: 'paused' as const, message: PAUSED_MESSAGE },
];

describe('InsightPanel retained authoritative emptiness', () => {
  it.each(retainedCases)('keeps the $shape empty explanation during $phase and retries both surfaces',
    ({ data, error, fetchStatus, message }) => {
      const refetch = vi.fn();
      const onRetry = error ? vi.fn() : undefined;
      const query = { data, isSuccess: true, dataUpdatedAt: Date.parse(hazards.generated_at), refetch };
      const view = renderPanel(query, true, onRetry);
      expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();

      // Keep the successful payload verbatim while the real trust hook derives stale/paused state.
      view.rerender(panel({ ...query, error, isError: error != null, fetchStatus }, true, onRetry));
      expect(screen.getByRole('heading', { name: 'Hazard clusters' })).toBeInTheDocument();
      expect(within(screen.getByRole('button', { name: 'Read full description for Hazard clusters' }))
        .getByText('Source details')).toBeInTheDocument();
      expect(screen.getByText(EMPTY_MESSAGE).closest('[role="status"]')).toBeInTheDocument();
      expect(screen.queryByText(hazards.items[0].hazard_type)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Inspect evidence' })).not.toBeInTheDocument();
      expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
      expect(screen.queryByText('Evidence availability has not resolved yet.')).not.toBeInTheDocument();
      expect(screen.queryByText('The initial evidence query is paused; no empty result is inferred.')).not.toBeInTheDocument();
      const warning = screen.getByTestId('stale-refresh-warning');
      expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
      expect(warning).toHaveTextContent(message);
      if (fetchStatus === 'paused') {
        expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
        expect(screen.queryByText(/refresh failed|you're offline/i)).not.toBeInTheDocument();
      } else {
        expect(warning).not.toHaveAttribute('data-refresh-blocked');
      }
      const refreshButtons = screen.getAllByRole('button', { name: 'Refresh' });
      expect(refreshButtons).toHaveLength(2);
      fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
      fireEvent.click(refreshButtons.find(button => !warning.contains(button))!);
      expect(onRetry ?? refetch).toHaveBeenCalledTimes(2);
      if (onRetry) expect(refetch).not.toHaveBeenCalled();
    });

  it.each([
    { shape: 'HazardPage object', data: hazards, phase: 'refresh failure',
      error: new Error('Refresh failed'), fetchStatus: 'idle' as const, message: FAILED_MESSAGE },
    { shape: 'HazardPage object', data: hazards, phase: 'paused refresh',
      error: null, fetchStatus: 'paused' as const, message: PAUSED_MESSAGE },
    { shape: 'populated array', data: hazards.items, phase: 'refresh failure',
      error: new Error('Refresh failed'), fetchStatus: 'idle' as const, message: FAILED_MESSAGE },
    { shape: 'populated array', data: hazards.items, phase: 'paused refresh',
      error: null, fetchStatus: 'paused' as const, message: PAUSED_MESSAGE },
  ])('preserves nonempty $shape content and actions during $phase',
    ({ data, error, fetchStatus, message }) => {
      const refetch = vi.fn();
      renderPanel({ data, error, fetchStatus, refetch }, false);
      expect(screen.getByText(hazards.items[0].hazard_type)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Inspect evidence' })).toBeInTheDocument();
      expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
      const warning = screen.getByTestId('stale-refresh-warning');
      expect(warning).toHaveTextContent(message);
      fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
      expect(refetch).toHaveBeenCalledOnce();
    });

  it.each([
    { shape: 'HazardPage object', data: emptyPage },
    { shape: 'empty array', data: [] },
  ])('preserves fresh successful emptiness for a $shape', ({ data }) => {
    const refetch = vi.fn();
    renderPanel({ data, isSuccess: true, refetch }, true);
    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(hazards.items[0].hazard_type)).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps initial fatal failure distinct from caller emptiness and retries the source', () => {
    const refetch = vi.fn();
    renderPanel({ error: new Error('Initial failure'), isError: true, refetch }, true);
    expect(screen.getByRole('heading', { name: 'Hazard clusters' })).toBeInTheDocument();
    expect(screen.getByText('Intelligence evidence could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText(hazards.items[0].hazard_type)).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it.each([
    { phase: 'loading flag', query: { isLoading: true } },
    { phase: 'fetching status', query: { fetchStatus: 'fetching' as const } },
  ])('preserves initial $phase without inferring an empty result', ({ query }) => {
    renderPanel(query, true);
    expect(screen.getByRole('heading', { name: 'Hazard clusters' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading Hazard clusters' })).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText(hazards.items[0].hazard_type)).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it.each([
    { phase: 'paused query', query: { fetchStatus: 'paused' as const },
      message: 'The initial evidence query is paused; no empty result is inferred.' },
    { phase: 'unresolved query', query: {}, message: 'Evidence availability has not resolved yet.' },
  ])('preserves an initial $phase despite caller emptiness', ({ query, message }) => {
    renderPanel(query, true);
    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText(hazards.items[0].hazard_type)).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('honors explicit empty content for the existing query-free retained source API', () => {
    const onRetry = vi.fn();
    render(<InsightPanel title="Hazard clusters" sourceState="retained" empty
      emptyMessage={EMPTY_MESSAGE} onRetry={onRetry}><span>{hazards.items[0].hazard_type}</span></InsightPanel>);
    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    expect(screen.queryByText(hazards.items[0].hazard_type)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('preserves nonempty content for the existing query-free retained source API', () => {
    render(<InsightPanel title="Hazard clusters" sourceState="retained">
      <span>{hazards.items[0].hazard_type}</span>
    </InsightPanel>);
    expect(screen.getByText(hazards.items[0].hazard_type)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
  });

  it('does not invent recovery for fresh successful empty data without a callback', () => {
    renderPanel({ data: emptyPage, isSuccess: true }, true);
    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('keeps refresh failure precedence when an empty retained envelope is also paused', () => {
    renderPanel({ data: emptyPage, error: new Error('Refresh failed'), fetchStatus: 'paused' }, true);
    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent(FAILED_MESSAGE);
    expect(screen.queryByText(PAUSED_MESSAGE)).not.toBeInTheDocument();
  });

  it('recovers a real query from successful empty through refresh failure using its actual retry', async () => {
    const queryKey = ['retained-empty-hazards'];
    const queryFn = vi.fn<() => Promise<HazardPage>>()
      .mockResolvedValueOnce(emptyPage)
      .mockRejectedValueOnce(new Error('Refresh failed'))
      .mockResolvedValueOnce(hazards);
    const client = createClient();
    function QueryPanel() {
      const query = useQuery({ queryKey, queryFn });
      // Match the production RoadHazardMeshPage caller, without mocking the target or trust wrapper.
      return panel(query, (query.data?.items ?? []).length === 0);
    }
    render(<QueryClientProvider client={client}><MemoryRouter><QueryPanel /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText(EMPTY_MESSAGE)).toBeInTheDocument();
    await act(async () => { await client.refetchQueries({ queryKey }); });
    const warning = await screen.findByTestId('stale-refresh-warning');
    expect(warning).toHaveTextContent(FAILED_MESSAGE);
    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(client.getQueryData(queryKey)).toBe(emptyPage);
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByText(hazards.items[0].hazard_type)).toBeInTheDocument());
    expect(queryFn).toHaveBeenCalledTimes(3);
    expect(client.getQueryData(queryKey)).toStrictEqual(hazards);
    expect(screen.getByRole('button', { name: 'Inspect evidence' })).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });
});
