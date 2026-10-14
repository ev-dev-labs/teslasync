import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { summarizeComfortConsistency } from '../../lib/comfortConsistency';
import { ComfortConsistencyRowDisposition } from './ComfortConsistencyRowDisposition';
import type { ComfortConsistencyQueryState } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values?.[key] ?? '')),
  }),
}));

vi.mock('@/components/layout', () => ({
  LayoutCard: ({ title, children }: { title: string; children: ReactNode }) => (
    <div><h2>{title}</h2>{children}</div>
  ),
}));

vi.mock('@/components/ui', () => ({
  Badge: ({ variant, children }: { variant: string; children: ReactNode }) => (
    <span data-testid="accounting-badge" data-variant={variant}>{children}</span>
  ),
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

vi.mock('@/components/feedback', () => ({
  Skeleton: () => <div data-testid="loading-skeleton" />,
}));

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtInt: (value: number) => String(value) }),
}));

vi.mock('../operationalbrief-all/VehicleOperationalBrief', () => ({
  VehicleOperationalBrief: ({
    retained, metrics,
  }: {
    retained: boolean;
    metrics: readonly { label: string; rawValue: number }[];
  }) => (
    <div data-testid="row-metrics" data-retained={String(retained)}>
      {metrics.map(metric => <p key={metric.label}>{metric.label}: {metric.rawValue}</p>)}
    </div>
  ),
}));

const summary = summarizeComfortConsistency([]);
const description = 'Ordered, mutually exclusive outcomes explain why each endpoint row is analyzed or withheld.';
function state(overrides: Partial<ComfortConsistencyQueryState> = {}): ComfortConsistencyQueryState {
  return {
    vehicleSelected: true,
    isLoading: false,
    isResolved: false,
    error: null,
    refreshError: null,
    onRetry: vi.fn(),
    ...overrides,
  };
}

describe('ComfortConsistencyRowDisposition evidence gating', () => {
  it.each([
    ['unresolved', state(), 'Unknown'],
    ['no vehicle', state({ vehicleSelected: false, isResolved: true }), 'Unknown'],
    ['active loading', state({ isLoading: true }), 'Loading...'],
    ['loading with a resolved flag', state({ isLoading: true, isResolved: true }), 'Loading...'],
    ['paused without data', state({ isPaused: true }), 'Climate history loading is paused while the network is unavailable; no empty response is inferred.'],
    ['fatal failure', state({ isResolved: true, error: new Error('Unavailable') }), 'Unknown'],
    ['refresh failure without data', state({ refreshError: new Error('Unavailable') }), 'Unknown'],
  ])('preserves the shell without accounting claims during %s', (_name, queryState, fallback) => {
    render(<ComfortConsistencyRowDisposition summary={summary} state={queryState} />);
    expect(screen.getByTestId('comfort-consistency-row-disposition')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Returned-row disposition' })).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.getByText(fallback)).toBeInTheDocument();
    expect(screen.queryByTestId('accounting-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-metrics')).not.toBeInTheDocument();
  });

  it('allows a successful empty response to balance and displays actual zero counts', () => {
    render(<ComfortConsistencyRowDisposition summary={summary} state={state({ isResolved: true })} />);
    expect(screen.getByTestId('accounting-badge')).toHaveTextContent('Exact balance');
    expect(screen.getByTestId('accounting-badge')).toHaveAttribute('data-variant', 'success');
    expect(screen.getByText('Analyzed active sample: 0')).toBeInTheDocument();
    expect(screen.getByText(/0 returned = all nine outcomes/)).toBeInTheDocument();
  });

  it.each(['refresh failure', 'paused'] as const)('retains resolved accounting during %s and recovers', mode => {
    const view = render(<ComfortConsistencyRowDisposition summary={summary}
      state={state({ isResolved: true })} />);
    view.rerender(<ComfortConsistencyRowDisposition summary={summary} state={state({
      isResolved: true,
      ...(mode === 'paused' ? { isPaused: true } : { refreshError: new Error('Refresh failed') }),
    })} />);
    expect(screen.getByTestId('accounting-badge')).toHaveTextContent('Exact balance');
    expect(screen.getByTestId('row-metrics')).toHaveAttribute('data-retained', 'true');
    expect(screen.getByText('Analyzed active sample: 0')).toBeInTheDocument();
    view.rerender(<ComfortConsistencyRowDisposition summary={summary}
      state={state({ isResolved: true })} />);
    expect(screen.getByTestId('accounting-badge')).toHaveTextContent('Exact balance');
    expect(screen.getByTestId('row-metrics')).toHaveAttribute('data-retained', 'false');
  });

  it('reports a mismatch only when the evidence is usable', () => {
    const mismatched = { ...summary, identities: { ...summary.identities, rowsBalanced: false } };
    const view = render(<ComfortConsistencyRowDisposition summary={mismatched} state={state()} />);
    expect(screen.queryByText('Accounting mismatch')).not.toBeInTheDocument();
    view.rerender(<ComfortConsistencyRowDisposition summary={mismatched}
      state={state({ isResolved: true })} />);
    expect(screen.getByTestId('accounting-badge')).toHaveTextContent('Accounting mismatch');
    expect(screen.getByTestId('accounting-badge')).toHaveAttribute('data-variant', 'danger');
  });
});
