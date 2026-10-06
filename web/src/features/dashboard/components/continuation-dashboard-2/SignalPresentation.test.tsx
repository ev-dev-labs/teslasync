import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import SignalHealthWidget from '../../widgets/SignalHealthWidget';
import LiveSignalSparklinesWidget from '../../widgets/LiveSignalSparklinesWidget';
import { queryResult, renderWidget } from './testSupport';

const hooks = vi.hoisted(() => ({
  vehicles: vi.fn(), stats: vi.fn(), gaps: vi.fn(), signals: vi.fn(), history: vi.fn(), sparkline: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => hooks.vehicles() }));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalStats: (...args: unknown[]) => hooks.stats(...args),
  useSignalGaps: (...args: unknown[]) => hooks.gaps(...args),
  useSignals: (...args: unknown[]) => hooks.signals(...args),
  useSignalHistory: (...args: unknown[]) => hooks.history(...args),
}));
vi.mock('@/components/charts', async (original) => {
  const actual = await original<typeof import('@/components/charts')>();
  return {
    ...actual,
    Sparkline: (props: { data: number[]; ariaLabel?: string }) => {
      hooks.sparkline(props);
      return <div role="img" aria-label={props.ariaLabel} />;
    },
  };
});

const names = Array.from({ length: 16 }, (_, index) => `Signal${String(index).padStart(2, '0')}WithCompleteLongDiagnosticName`);

beforeEach(() => {
  vi.clearAllMocks();
  hooks.vehicles.mockReturnValue(queryResult([{ id: 7 }]));
  hooks.stats.mockReturnValue(queryResult({}));
  hooks.signals.mockReturnValue(queryResult(names));
  hooks.gaps.mockReturnValue(queryResult(Object.fromEntries(names.map(name => [name, { timestamp: null, value: 0 }]))));
  hooks.history.mockReturnValue(queryResult({ data: [{ valueNum: 0 }, { valueNum: 10 }, { valueNum: 20 }, { valueNum: 30 }] }));
});

describe('signal preservation in narrow-safe definitions and rows', () => {
  it('keeps the wide gap list limit, missing-clock-first order and complete diagnostic names', () => {
    const { container } = renderWidget(<SignalHealthWidget size={{ cols: 3, rows: 4 }} />);
    expect(container.querySelectorAll('dt')).toHaveLength(15);
    expect(screen.getByText(names[0])).toBeVisible();
    expect(screen.getByText(names[14])).toBeVisible();
    expect(screen.queryByText(names[15])).not.toBeInTheDocument();
    for (const label of container.querySelectorAll('dt')) expect(label).not.toHaveClass('truncate');
  });

  it('keeps independent live readings and source-specific catalog recovery rather than claiming zero signals', () => {
    const catalogRetry = vi.fn();
    const liveRetry = vi.fn();
    hooks.signals.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Catalog offline'), refetch: catalogRetry }));
    hooks.gaps.mockReturnValue(queryResult({ BatteryLevel: { value: 0, timestamp: new Date().toISOString() } }, { refetch: liveRetry }));
    renderWidget(<SignalHealthWidget size={{ cols: 3, rows: 4 }} />);
    expect(screen.getByText('Signal catalog')).toBeVisible();
    expect(screen.getByText('Total signals').parentElement?.parentElement).toHaveTextContent('—');
    expect(screen.getByText('Active')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(catalogRetry).toHaveBeenCalledOnce();
    expect(liveRetry).not.toHaveBeenCalled();
  });

  it('keeps historical sparklines visible when live readings fail and retries only the live source', () => {
    const liveRetry = vi.fn();
    const catalogRetry = vi.fn();
    hooks.signals.mockReturnValue(queryResult(['BatteryLevel'], { refetch: catalogRetry }));
    hooks.gaps.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Live offline'), refetch: liveRetry }));
    renderWidget(<LiveSignalSparklinesWidget size={{ cols: 2, rows: 4 }} config={{ signals: ['BatteryLevel'] }} />);
    expect(screen.getByText('Battery Level')).toBeVisible();
    expect(screen.getByText('Live signals')).toBeVisible();
    expect(hooks.sparkline).toHaveBeenCalledWith(expect.objectContaining({ data: [0, 10, 20, 30] }));
    expect(hooks.history).toHaveBeenCalledWith(7, 'BatteryLevel', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(liveRetry).toHaveBeenCalledOnce();
    expect(catalogRetry).not.toHaveBeenCalled();
  });
});
