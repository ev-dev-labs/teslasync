/** AUTHORED NOT RUN: parent owns the serialized full validation window. */
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
    rerender(view(new Error('chart failed')));
    expect(screen.getByRole('heading', { name: 'Read-only shared chart' })).toBeInTheDocument();
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
});
