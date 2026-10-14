import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatisticsSource, statisticsSourcePhase } from './StatisticsSource';
import { deriveDataState } from '@/api/dataState';

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

  it('uses only the trust fatal error for replacement while zero data survives refresh failure and recovery', () => {
    const data = { lifetime_km: 0 };
    const failed = deriveDataState({ data, error: new Error('refresh') }, { provenance: 'historical' });
    const { rerender } = render(
      <StatisticsSource {...common} hasData={failed.hasData} loading={false} error={failed.fatalError} />,
    );
    expect(failed.refreshError).toBeInstanceOf(Error);
    expect(failed.data).toBe(data);
    expect(screen.getByText('Retained measurement: 0')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const recovered = deriveDataState({ data, error: null }, { provenance: 'historical' });
    rerender(<StatisticsSource {...common} hasData={recovered.hasData} loading={false} error={recovered.fatalError} />);
    expect(recovered.status).toBe('ok');
    expect(recovered.refreshError).toBeNull();
    expect(screen.getByText('Retained measurement: 0')).toBeInTheDocument();
  });

  it('keeps a zero measurement during failed refresh and retries only its source', () => {
    const retry = vi.fn();
    render(<StatisticsSource {...common} hasData loading error={new Error('refresh')} onRetry={retry} />);
    expect(screen.getByText('Retained measurement: 0')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Source skeleton')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry source' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('retains charging proxy context alongside populated measurements during a failed refresh', () => {
    render(
      <StatisticsSource {...common} hasData loading error={new Error('refresh')}>
        <span>100.00 kWh</span>
        <span>Charging-session energy added, not measured drive energy used; numerator of the efficiency proxy.</span>
        <span>160.00 Wh/km</span>
        <span>Charging-energy/distance proxy: charging-session energy added divided by completed-drive distance, not measured driving efficiency.</span>
      </StatisticsSource>,
    );
    expect(screen.getByText('100.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('160.00 Wh/km')).toBeInTheDocument();
    expect(screen.getByText(/numerator of the efficiency proxy/)).toBeInTheDocument();
    expect(screen.getByText(/not measured driving efficiency/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Source skeleton')).not.toBeInTheDocument();
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

  it('retains CO₂ estimate limitations with a populated mass during refresh failure and recovery', () => {
    const content = <>
      <span>50.00 kg</span>
      <span>Estimated CO₂ savings, not measured emissions.</span>
      <span>Fixed ICE baseline: completed-drive kilometres × 0.120 kg CO₂/km; grid emissions are not deducted.</span>
    </>;
    const { rerender } = render(
      <StatisticsSource {...common} hasData loading error={new Error('refresh')}>{content}</StatisticsSource>,
    );
    expect(screen.getByText('50.00 kg')).toBeInTheDocument();
    expect(screen.getByText('Estimated CO₂ savings, not measured emissions.')).toBeInTheDocument();
    expect(screen.getByText(/grid emissions are not deducted/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Source skeleton')).not.toBeInTheDocument();
    rerender(<StatisticsSource {...common} hasData loading={false}>{content}</StatisticsSource>);
    expect(screen.getByText('50.00 kg')).toBeInTheDocument();
    expect(screen.getByText(/grid emissions are not deducted/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

  it.each(['Unknown health', 'Measured health: 0%', 'Measured health: 92.34%', 'Measured degradation: -1.25%/yr'])(
    'preserves field-level evidence independently of source presence: %s',
    reading => {
      render(
        <StatisticsSource {...common} hasData loading={false} error={new Error('refresh')}>
          <span>{reading}</span>
          <span>Measured cycles: 0</span>
        </StatisticsSource>,
      );
      expect(screen.getByText(reading)).toBeInTheDocument();
      expect(screen.getByText('Measured cycles: 0')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.queryByText('No source records')).not.toBeInTheDocument();
    },
  );
});
