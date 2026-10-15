import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/feedback';
import type { RegenEfficiencyData } from '@/types/driving';
import { buildRegenEfficiencyModel } from '../../lib/regenEfficiency';
import { RegenCoverageBrief } from '../operationalbrief-n-z/RegenCoverageBrief';
import { RegenMethodologyList } from './RegenMethodologyList';
import type { RegenSectionState } from './types';

const labels = [
  /totals cover the complete selected date window/,
  /Every aggregate ratio shown here is energy-weighted/,
  /A detailed drive is eligible/,
  /Calendar-month buckets count every valid dated returned row/,
  /comparisons are descriptive associations/,
  /Equivalent full-pack cycles use an estimated usable battery capacity/,
];
const ready: RegenSectionState = {
  isLoading: false, isResolved: true, error: null, onRetry: vi.fn(),
};
const zeroAggregate: RegenEfficiencyData = {
  vehicleId: 7, totalRegenWh: 0, totalDriveWh: 0, regenRatio: 0,
  freeCharges: 0, monthlyAvgRegen: 0, monthlySummary: [], drives: [],
  batteryCapacityWh: 75_000, capacitySource: 'vin_estimate',
};

function assertList(scope: HTMLElement) {
  // Source notices can render their own list; select the methodology grid.
  const list = within(scope).getAllByRole('list').find((candidate) => candidate.classList.contains('lg:grid-cols-2'))!;
  expect(list).toHaveClass('mt-5', 'grid', 'gap-3', 'lg:grid-cols-2');
  const items = within(list).getAllByRole('listitem');
  expect(items).toHaveLength(6);
  items.forEach((item, index) => {
    expect(item).toHaveTextContent(labels[index]!);
    expect(item).toHaveClass(
      'flex', 'items-start', 'gap-3', 'rounded-xl', 'p-3',
      'border-[var(--border-subtle)]', 'bg-[var(--surface-2)]',
    );
    const icon = item.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon?.parentElement).toHaveClass('text-[var(--text-muted)]');
    expect(item.className).not.toMatch(/white|neon|glow/);
  });
  expect(items[0]).toHaveTextContent('1,000 returned rows');
}

describe('RegenMethodologyList', () => {
  it('retains every label, decorative icon and responsive layout with semantic roles', () => {
    const { container, rerender } = render(<RegenMethodologyList historyLimit={1000} />);
    assertList(container);
    rerender(<RegenMethodologyList historyLimit={2000} />);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('2,000 returned rows');
  });

  it('keeps all six explanations through loading, pause, empty/zero, retained failure and recovery', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: PropsWithChildren) {
      return <QueryClientProvider client={client}>
        <ToastProvider><MemoryRouter>{children}</MemoryRouter></ToastProvider>
      </QueryClientProvider>;
    }
    const model = buildRegenEfficiencyModel([], 1000, 'UTC');
    function coverage(state: RegenSectionState, aggregate?: RegenEfficiencyData, retained = false) {
      return <RegenCoverageBrief
        aggregate={aggregate} model={model}
        aggregateState={state} detailState={state}
        scope="Selected date window" retained={retained}
      />;
    }
    const loading = { ...ready, isLoading: true, isResolved: false };
    const { rerender } = render(coverage(loading), { wrapper: Wrapper });
    assertList(screen.getByTestId('regen-methodology'));
    expect(screen.getByText('Detailed query loading')).toBeInTheDocument();

    // A paused first request is unresolved, not successful empty evidence.
    rerender(coverage({ ...ready, isResolved: false }));
    assertList(screen.getByTestId('regen-methodology'));
    expect(screen.getByText('Detailed availability not resolved')).toBeInTheDocument();

    rerender(coverage(ready, zeroAggregate));
    assertList(screen.getByTestId('regen-methodology'));
    expect(screen.getByText('No detailed rows returned')).toBeInTheDocument();
    expect(screen.getByText('Complete aggregate loaded')).toBeInTheDocument();

    rerender(coverage({ ...ready, error: new Error('Refresh failed') }, zeroAggregate, true));
    assertList(screen.getByTestId('regen-methodology'));
    expect(screen.getByText('Detailed query unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Pack basis:/)).toBeInTheDocument();

    rerender(coverage(ready, zeroAggregate));
    assertList(screen.getByTestId('regen-methodology'));
    expect(screen.queryByText('Detailed query unavailable')).not.toBeInTheDocument();
    expect(screen.getByText('No detailed rows returned')).toBeInTheDocument();
    client.clear();
  });
});
