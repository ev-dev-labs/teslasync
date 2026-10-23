import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, _opts?: unknown) => fallback ?? _key,
  }),
}));

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useVehicleLiveSignals: vi.fn(),
  useSignalHistory: vi.fn(),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number, precision = 0) => Number(value).toFixed(precision),
  }),
}));
vi.mock('./WidgetShell', () => ({
  WidgetShell: ({ title, children, updatedAt, onRefresh }: {
    title?: string;
    children?: ReactNode;
    updatedAt?: number;
    onRefresh?: () => void;
  }) => (
    <section>
      <h3>{title}</h3>
      <button aria-label="Refresh data" onClick={onRefresh}>refresh</button>
      <span data-testid="updated-at">{updatedAt ?? 0}</span>
      {children}
    </section>
  ),
}));

import { useVehicles } from '@/api/hooks/useVehicles';
import { useSignalHistory, useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import { useUnits } from '@/hooks/useUnits';
import LiveSignalsWidget from './LiveSignalsWidget';

const history = (values: number[]) => ({
  data: { data: values.map((value) => ({ value })) },
  isError: false,
  isFetching: false,
  isStale: false,
  dataUpdatedAt: 100,
  refetch: vi.fn(),
});

describe('LiveSignalsWidget — After card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useVehicles).mockReturnValue({
      data: [{ id: 7 }],
    } as ReturnType<typeof useVehicles>);
    vi.mocked(useVehicleLiveSignals).mockReturnValue({
      data: {
        signals: {
          BatteryLevel: { value: 64 },
          ACChargingPower: { value: 7000 },
          InsideTemp: { value: 22.2 },
          OutsideTemp: { value: 23 },
          RatedRange: { value: 275_000 },
        },
      },
      dataUpdatedAt: 1234,
      isFetching: false,
      isStale: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useVehicleLiveSignals>);
    vi.mocked(useSignalHistory).mockImplementation((_vehicleId, signal) =>
      history(signal === 'BatteryLevel' ? [63, 64] : [1, 2]) as ReturnType<typeof useSignalHistory>,
    );
    vi.mocked(useUnits).mockReturnValue({
      formatPower: (value: number | null) => value == null ? '—' : `${(value / 1000).toFixed(1)} kW`,
      formatTemperature: (value: number | null) => value == null ? '—' : `${value.toFixed(1)}°C`,
      formatDistance: (value: number | null) => value == null ? '—' : `${(value / 1609.344).toFixed(1)} mi`,
      unitPrefs: {},
    } as unknown as ReturnType<typeof useUnits>);
  });

  it('renders five source-backed rows and the existing freshness indicator contract', () => {
    render(<LiveSignalsWidget vehicleId={7} size={{ cols: 2, rows: 4 }} />);

    expect(screen.getByText('BatteryLevel')).toBeInTheDocument();
    expect(screen.getByText('ACChargingPower')).toBeInTheDocument();
    expect(screen.getByText('InsideTemp')).toBeInTheDocument();
    expect(screen.getByText('OutsideTemp')).toBeInTheDocument();
    expect(screen.getByText('RatedRange')).toBeInTheDocument();
    expect(screen.getByText('64 %')).toBeInTheDocument();
    expect(screen.getByText('7.0 kW')).toBeInTheDocument();
    expect(screen.getByText('22.2°C')).toBeInTheDocument();
    expect(screen.getByText('23.0°C')).toBeInTheDocument();
    expect(screen.getByText('170.9 mi')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /trend/i }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('updated-at')).toHaveTextContent('1234');
  });

  it('does not invent missing values', () => {
    vi.mocked(useVehicleLiveSignals).mockReturnValue({
      data: { signals: { BatteryLevel: { value: 0 } } },
      dataUpdatedAt: 1234,
      isFetching: false,
      isStale: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useVehicleLiveSignals>);
    render(<LiveSignalsWidget vehicleId={7} size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByText('0 %')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('shows an empty state and refreshes every source action', () => {
    vi.mocked(useVehicleLiveSignals).mockReturnValue({
      data: { signals: {} },
      dataUpdatedAt: 0,
      isFetching: false,
      isStale: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useVehicleLiveSignals>);
    render(<LiveSignalsWidget vehicleId={7} size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByText('No live signal data')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
    expect(vi.mocked(useVehicleLiveSignals).mock.results[0].value.refetch).toHaveBeenCalled();
  });
});
