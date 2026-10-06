/** AUTHORED NOT RUN: parent owns the serialized full validation window. */
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, vi, expect } from 'vitest';
import { ChartCard, LayoutCard } from '@/components/layout/layout-reference';
import { ErrorDisplay, ToastProvider } from '@/components/feedback';
import { deriveDataState } from '@/api/dataState';
import type { DataStateSource } from '@/api/dataState';
import { EfficiencySource } from './EfficiencySource';
import { EfficiencyChart } from './EfficiencyChart';
import { fakeQuery } from './fixtures';

vi.mock('@/api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn().mockResolvedValue([]) };
});
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> };
});

export function TestProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <MemoryRouter initialEntries={['/efficiency']}>
    <QueryClientProvider client={client}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
  </MemoryRouter>;
}

describe('real shared chart/error adapters (AUTHORED NOT RUN)', () => {
  it('retries unknown and resolved-empty measurements through their existing source owner', () => {
    const retry = vi.fn();
    const content = (data: readonly number[] | undefined) =>
      <LayoutCard title="First source">
        <EfficiencySource state={deriveDataState(fakeQuery(data, { refetch: retry }))}
          loading={false} malformed={false} available={Boolean(data?.length)} label="First source"
          emptyMessage="No first rows"><span>Measured evidence</span></EfficiencySource>
      </LayoutCard>;
    const view = render(content(undefined), { wrapper: TestProviders });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    view.rerender(content([]));
    expect(screen.getByText('No first rows')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(2);
    view.rerender(content([1]));
    expect(screen.getByText('Measured evidence')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('keeps MemoryRouter on the initial mount AND every rerender with real ErrorDisplay', () => {
    const content = (query: DataStateSource<readonly number[]>) =>
      <LayoutCard title="First source">
        <EfficiencySource state={deriveDataState(query)} loading={Boolean(query.isLoading)}
          malformed={false} available={Boolean(query.data?.length)} label="First source"
          emptyMessage="No first rows"><span>Retained evidence</span></EfficiencySource>
      </LayoutCard>;
    const { container, rerender } = render(content(fakeQuery(undefined, { error: new Error('first failure') })),
      { wrapper: TestProviders });
    expect(screen.getByText('Unable to load First source')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(1);
    rerender(content(fakeQuery([1], { error: new Error('refresh failed') })));
    expect(screen.getByText('Retained evidence')).toBeInTheDocument();
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    rerender(<LayoutCard title="First source"><ErrorDisplay compact error={new Error('direct failure')}
      message="Real routed error display" /></LayoutCard>);
    expect(screen.getByText('Real routed error display')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(1);
  });
  it('renders and rerenders the REAL ChartCard for its compatible bounded read-only use', () => {
    const view = (error?: Error) => <ChartCard title="Read-only shared chart" ariaLabel="Read-only figure"
      data={[{ x: 1 }]} dataColumns={[{ key: 'x', label: 'X' }]} error={error}>
      <div>Original chart child</div>
    </ChartCard>;
    const { container, rerender } = render(view(), { wrapper: TestProviders });
    expect(screen.getByText('Original chart child')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(1);
    const card = container.querySelector<HTMLElement>('[data-card]')!;
    const figure = within(card).getByRole('figure', { name: 'Read-only shared chart' });
    const expectOwnedTitles = () => {
      const header = card.querySelector<HTMLElement>('header')!;
      const title = within(header).getByRole('heading', { name: 'Read-only shared chart' });
      expect(title).toBeVisible();
      expect(card).toHaveAttribute('aria-labelledby', title.id);
      expect(card).toHaveAccessibleName('Read-only shared chart');
      // EmbeddedChart separately owns the figure's screen-reader heading.
      const figureTitle = within(figure).getByRole('heading', { name: 'Read-only shared chart' });
      expect(figure).toHaveAttribute('aria-labelledby', figureTitle.id);
      expect(figure).toHaveAccessibleName('Read-only shared chart');
    };
    expectOwnedTitles();
    rerender(view(new Error('chart failed')));
    expect(container.querySelector('[data-card]')).toBe(card);
    expect(within(card).getByRole('figure', { name: 'Read-only shared chart' })).toBe(figure);
    expectOwnedTitles();
    expect(figure).toHaveAttribute('data-chart-state', 'error');
    expect(screen.queryByText('Original chart child')).not.toBeInTheDocument();
  });
  it('retains a real production chart shell and child through refresh failure', () => {
    const view = (query: DataStateSource<number[]>) => <EfficiencyChart
      source={{ state: deriveDataState(query), loading: Boolean(query.isLoading), malformed: false }}
      title="Exportable chart" ariaLabel="Efficiency figure"
      data={[{ x: 1 }]} dataColumns={[{ key: 'x', label: 'X' }]} empty={false}>
      <div>Visible chart evidence</div>
    </EfficiencyChart>;
    const { container, rerender } = render(view(fakeQuery([1])), { wrapper: TestProviders });
    expect(screen.getByText('Visible chart evidence')).toBeInTheDocument();
    const figure = container.querySelector('figure');
    rerender(view(fakeQuery([1], { error: new Error('refresh') })));
    expect(container.querySelector('figure')).toBe(figure);
    expect(screen.getByText('Visible chart evidence')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    rerender(view(fakeQuery(undefined, { error: new Error('initial failure') })));
    expect(container.querySelector('figure')).toBe(figure);
    expect(screen.queryByText('Visible chart evidence')).not.toBeInTheDocument();
  });
  it('adopts ChartCard without dropping annotations, fullscreen, export, fallback rows or the render prop', () => {
    const source = { state: deriveDataState(fakeQuery([1])), loading: false, malformed: false };
    const { container } = render(<EfficiencyChart source={source}
      title="Capability chart" ariaLabel="Capability figure" fullscreen
      annotations={{ vehicleId: 7, scope: 'efficiency', chartId: 'efficiency-daily-trend' }}
      data={[{ date: 'Observed date', efficiency: 123 }]}
      dataColumns={[{ key: 'date', label: 'Date' }, { key: 'efficiency', label: 'Consumption' }]}
      exportData={[{ date: 'Observed date', efficiency: 123 }]}>
      {({ annotations }) => <div>Render-prop evidence: {annotations.length}</div>}
    </EfficiencyChart>, { wrapper: TestProviders });
    expect(container.querySelectorAll('[data-card]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-chart-toolbar]')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: 'Capability chart' })).toHaveLength(1);
    expect(screen.getByText('Render-prop evidence: 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add annotation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide annotations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export chart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument();
    expect(screen.getByText('Observed date')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
    expect(screen.getByRole('menuitem', { name: /CSV/ })).toBeInTheDocument();
  });
});
