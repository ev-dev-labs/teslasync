import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { InsightPanel } from './InsightPanel';
import type { DataStateSource } from '@/api/dataState';
import { Button } from '@/components/ui';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

function renderPanel(onRetry?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InsightPanel title="Evidence" empty onRetry={onRetry}>
          <span>Resolved evidence</span>
        </InsightPanel>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InsightPanel empty source recovery', () => {
  it('refreshes the supplied source without presenting unresolved evidence as ready', () => {
    const onRetry = vi.fn();
    renderPanel(onRetry);
    expect(screen.getByText('No supported data is available.')).toBeInTheDocument();
    expect(screen.queryByText('Resolved evidence')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  function renderQueryPanel(query: DataStateSource<unknown>, empty = false, onRetry?: () => void) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <div dir="rtl">
            <InsightPanel title="Evidence" description="Source details" query={query} empty={empty}
              emptyMessage="No matching evidence" onRetry={onRetry} error={new Error('Unrelated error')}>
              <span>Retained observation: 0</span>
              <Button onClick={() => undefined}>Inspect evidence</Button>
            </InsightPanel>
          </div>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  describe('InsightPanel source trust', () => {
    it('keeps retained observations and actions after refresh failure, even with an empty hint', () => {
      const refetch = vi.fn();
      const onRetry = vi.fn();
      renderQueryPanel({
        data: { value: 0 }, error: new Error('Refresh failed'), isError: true,
        dataUpdatedAt: Date.now(), refetch,
      }, true, onRetry);
      expect(screen.getByText('Retained observation: 0')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Inspect evidence' })).toBeInTheDocument();
      expect(screen.getByText('The refresh failed; the most recently loaded evidence remains visible.')).toBeInTheDocument();
      expect(screen.queryByText('No matching evidence')).not.toBeInTheDocument();
      expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(refetch).not.toHaveBeenCalled();
    });

    it('distinguishes a paused refresh without inventing a server failure or offline diagnosis', () => {
      const refetch = vi.fn();
      renderQueryPanel({ data: [0], fetchStatus: 'paused', dataUpdatedAt: Date.now(), refetch }, true);
      expect(screen.getByText('Retained observation: 0')).toBeInTheDocument();
      expect(screen.getByText('Cached evidence remains visible while its refresh is paused.')).toBeInTheDocument();
      expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
      expect(screen.queryByText(/refresh failed|you're offline/i)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('keeps an authoritative empty array and recovery after a failed refresh without invented children', () => {
      const refetch = vi.fn();
      const onRetry = vi.fn();
      renderQueryPanel({
        data: [], error: new Error('Refresh failed'), isError: true,
        dataUpdatedAt: Date.now(), refetch,
      }, true, onRetry);
      expect(screen.getByText('No matching evidence')).toBeInTheDocument();
      expect(screen.queryByText('Retained observation: 0')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Inspect evidence' })).not.toBeInTheDocument();
      const warning = screen.getByTestId('stale-refresh-warning');
      expect(warning).toHaveTextContent('The refresh failed; the most recently loaded evidence remains visible.');
      expect(warning).not.toHaveAttribute('data-refresh-blocked');
      expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
      expect(screen.queryByText('Evidence availability has not resolved yet.')).not.toBeInTheDocument();
      fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(refetch).not.toHaveBeenCalled();
      fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' }).find(button => !warning.contains(button))!);
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(refetch).not.toHaveBeenCalled();
    });

    it('keeps an authoritative empty array and recovery while paused without inventing failure or offline status', () => {
      const refetch = vi.fn();
      renderQueryPanel({ data: [], fetchStatus: 'paused', dataUpdatedAt: Date.now(), refetch }, true);
      expect(screen.getByText('No matching evidence')).toBeInTheDocument();
      expect(screen.queryByText('Retained observation: 0')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Inspect evidence' })).not.toBeInTheDocument();
      const warning = screen.getByTestId('stale-refresh-warning');
      expect(warning).toHaveTextContent('Cached evidence remains visible while its refresh is paused.');
      expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
      expect(screen.queryByText(/refresh failed|you're offline/i)).not.toBeInTheDocument();
      expect(screen.queryByText('The initial evidence query is paused; no empty result is inferred.')).not.toBeInTheDocument();
      fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
      expect(refetch).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' }).find(button => !warning.contains(button))!);
      expect(refetch).toHaveBeenCalledTimes(2);
    });

    it('gives refresh failure precedence over a simultaneous pause', () => {
      renderQueryPanel({ data: [0], error: new Error('Refresh failed'), fetchStatus: 'paused' });
      expect(screen.getByText('The refresh failed; the most recently loaded evidence remains visible.')).toBeInTheDocument();
      expect(screen.queryByText('Cached evidence remains visible while its refresh is paused.')).not.toBeInTheDocument();
      expect(screen.getByText('Retained observation: 0')).toBeInTheDocument();
    });

    it('shows successful observation freshness while refreshing without erasing actions', () => {
      renderQueryPanel({ data: 0, isFetching: true, dataUpdatedAt: Date.now() });
      expect(screen.getByText('updating…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Inspect evidence' })).toBeInTheDocument();
      expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
      expect(screen.getByText('Retained observation: 0').closest('[dir]')).toHaveAttribute('dir', 'rtl');
    });

    it('keeps an unknown successful timestamp unknown', () => {
      renderQueryPanel({ data: 0 });
      expect(screen.getByTitle(/Never updated/)).toBeInTheDocument();
      expect(screen.getByText('Retained observation: 0')).toBeInTheDocument();
      expect(screen.queryByText('just now')).not.toBeInTheDocument();
    });

    it('replaces only an initial fatal source and offers its supplied recovery', () => {
      const onRetry = vi.fn();
      renderQueryPanel({ error: new Error('Initial failure'), isError: true }, false, onRetry);
      expect(screen.queryByText('Retained observation: 0')).not.toBeInTheDocument();
      expect(screen.getByText('Intelligence evidence could not be loaded.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('does not infer empty results from an initial paused query', () => {
      renderQueryPanel({ fetchStatus: 'paused' });
      expect(screen.getByText('The initial evidence query is paused; no empty result is inferred.')).toBeInTheDocument();
      expect(screen.queryByText('No matching evidence')).not.toBeInTheDocument();
      expect(screen.queryByText('Retained observation: 0')).not.toBeInTheDocument();
    });

    it('preserves authoritatively empty successful sources and their recovery', () => {
      const refetch = vi.fn();
      renderQueryPanel({ data: [], isSuccess: true, dataUpdatedAt: Date.now(), refetch }, true);
      expect(screen.getByText('No matching evidence')).toBeInTheDocument();
      expect(screen.queryByText('Retained observation: 0')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps informational emptiness visible without inventing a recovery callback', () => {
    renderPanel();
    expect(screen.getByText('No supported data is available.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.queryByText('Resolved evidence')).not.toBeInTheDocument();
  });
});
