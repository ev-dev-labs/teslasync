import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { FleetTrendCard } from './FleetTrendCard';

// This focused presenter test uses real shared shells. Resize/ChartContainer
// behavior still belongs to the parent's serialized integration/browser suite.
// RTL retains the render wrapper on rerender, including loading -> empty.
function TestRouter({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/vehicle-comparison']}>{children}</MemoryRouter>;
}

describe('FleetTrendCard source preservation', () => {
  const base = {
    title: 'Monthly distance',
    ariaLabel: 'Monthly distance comparison',
    chartKey: 'fleet-compare-monthly-distance',
    emptyMessage: 'No monthly data available yet',
    onRetry: vi.fn(),
  };

  it('keeps the title and shell through loading and empty transitions', () => {
    const { rerender } = render(
      <FleetTrendCard {...base} hasData={false} loading error={null}>
        <div data-testid="retained-series" />
      </FleetTrendCard>,
      { wrapper: TestRouter },
    );
    expect(screen.getByText(base.title)).toBeInTheDocument();
    expect(screen.queryByText(base.emptyMessage)).not.toBeInTheDocument();
    rerender(
      <FleetTrendCard {...base} hasData={false} loading={false} error={null}>
        <div data-testid="retained-series" />
      </FleetTrendCard>,
    );
    expect(screen.getByText(base.emptyMessage)).toBeInTheDocument();
    expect(screen.getByText(base.title)).toBeInTheDocument();
  });

  it('keeps retained chart children when refreshing fails and preserves retry', () => {
    const retry = vi.fn();
    render(
      <FleetTrendCard {...base} onRetry={retry} hasData loading={false} error={new Error('Refresh failed')}>
        <div data-testid="retained-series" />
      </FleetTrendCard>,
      { wrapper: TestRouter },
    );
    expect(screen.getByTestId('retained-series')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('refreshes both existing comparison sources from the empty chart', () => {
    const retry = vi.fn();
    render(
      <FleetTrendCard {...base} onRetry={retry} hasData={false} loading={false} error={null}>
        <div data-testid="retained-series" />
      </FleetTrendCard>,
      { wrapper: TestRouter },
    );
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByText(base.emptyMessage)).toBeInTheDocument();
    expect(screen.queryByTestId('retained-series')).not.toBeInTheDocument();
  });

  it('keeps a usable chart while its independent peer is initially loading', () => {
    render(
      <>
        <FleetTrendCard {...base} hasData loading error={null}>
          <div data-testid="retained-series" />
        </FleetTrendCard>
        <FleetTrendCard
          {...base}
          title="Peer monthly distance"
          chartKey="fleet-compare-peer-distance"
          emptyMessage="No peer monthly data"
          hasData={false}
          loading
          error={null}
        >
          <div data-testid="peer-series" />
        </FleetTrendCard>
      </>,
      { wrapper: TestRouter },
    );
    expect(screen.getByTestId('retained-series')).toBeInTheDocument();
    expect(screen.queryByText(base.emptyMessage)).not.toBeInTheDocument();
    expect(screen.getByText('Peer monthly distance')).toBeInTheDocument();
    expect(screen.queryByTestId('peer-series')).not.toBeInTheDocument();
    expect(screen.queryByText('No peer monthly data')).not.toBeInTheDocument();
  });
});
