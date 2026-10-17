import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatisticsSource, statisticsSourcePhase } from './StatisticsSource';

vi.mock('@/components/feedback', () => ({
  QueryError: ({ onRetry }: { onRetry?: () => void }) => (
    <div role="alert">
      Refresh failed
      {onRetry && <button onClick={onRetry}>Retry source</button>}
    </div>
  ),
}));

describe('statistics source preservation', () => {
  it.each([
    [true, false, null, 'ready'],
    [true, true, null, 'ready'],
    [true, false, new Error('refresh'), 'retained'],
    [true, true, new Error('refresh'), 'retained'],
    [false, true, null, 'loading'],
    [false, false, new Error('initial'), 'error'],
    [false, false, null, 'empty'],
  ] as const)('hasData=%s loading=%s error=%s -> %s', (hasData, loading, error, expected) => {
    expect(statisticsSourcePhase(hasData, loading, error)).toBe(expected);
  });

  const common = {
    skeleton: <span>Source skeleton</span>,
    empty: <span>No source records</span>,
    children: <span>Retained measurement: 0</span>,
  };

  it('keeps a zero measurement during failed refresh and retries only its source', () => {
    const retry = vi.fn();
    render(<StatisticsSource {...common} hasData loading error={new Error('refresh')} onRetry={retry} />);
    expect(screen.getByText('Retained measurement: 0')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Source skeleton')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry source' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('preserves independent neighbors when an initial source fails', () => {
    render(
      <>
        <StatisticsSource {...common} hasData={false} loading={false} error={new Error('initial')} />
        <StatisticsSource {...common} hasData loading={false} />
      </>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Retained measurement: 0')).toBeInTheDocument();
  });

  it('transitions initial loading through empty to ready without mounting hidden content', () => {
    const { rerender } = render(<StatisticsSource {...common} hasData={false} loading />);
    expect(screen.getByText('Source skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Retained measurement: 0')).not.toBeInTheDocument();
    rerender(<StatisticsSource {...common} hasData={false} loading={false} />);
    expect(screen.getByText('No source records')).toBeInTheDocument();
    rerender(<StatisticsSource {...common} hasData loading={false} />);
    expect(screen.getByText('Retained measurement: 0')).toBeInTheDocument();
  });

  it('retains the loaded chart minimum-record empty state and its refresh error', () => {
    render(<StatisticsSource {...common} hasData loading={false} emptyWhen error={new Error('refresh')} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('No source records')).toBeInTheDocument();
    expect(screen.queryByText('Retained measurement: 0')).not.toBeInTheDocument();
  });
});
