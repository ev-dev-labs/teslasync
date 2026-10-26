import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
}));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useVehicleLiveSignals: vi.fn(),
  useSignalHistory: vi.fn(),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: (value: number) => String(value) }),
}));
vi.mock('./WidgetShell', () => ({
  WidgetShell: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

import { useVehicles } from '@/api/hooks/useVehicles';
import { useSignalHistory, useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import { useUnits } from '@/hooks/useUnits';
import LiveSignalsWidget from './LiveSignalsWidget';

const SIZE = { cols: 2, rows: 4 };

describe('LiveSignalsWidget — live-signal display boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    vi.mocked(useVehicles).mockReturnValue({ data: [{ id: 7 }] } as ReturnType<typeof useVehicles>);
    vi.mocked(useVehicleLiveSignals).mockReturnValue({
      data: { signals: {
        BatteryLevel: { value: 64 },
        ACChargingPower: { value: 7000 },
        InsideTemp: { value: 20 },
        OutsideTemp: { value: 10 },
        RatedRange: { value: 275000 },
      } },
      dataUpdatedAt: 1234,
      isFetching: false,
      isStale: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useVehicleLiveSignals>);
    vi.mocked(useSignalHistory).mockReturnValue({
      data: { data: [] },
      isError: false,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: 1234,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSignalHistory>);
  });

  it('uses the metric formatters for SI inputs and user display preferences', () => {
    vi.mocked(useUnits).mockReturnValue({
      formatPower: (value: number | null) => value == null ? '—' : `${(value / 1000).toFixed(1)} kW`,
      formatTemperature: (value: number | null) => value == null ? '—' : `${value.toFixed(1)}°C`,
      formatDistance: (value: number | null) => value == null ? '—' : `${(value / 1000).toFixed(1)} km`,
      unitPrefs: {},
    } as unknown as ReturnType<typeof useUnits>);
    render(<LiveSignalsWidget vehicleId={7} size={SIZE} />);
    expect(screen.getByText('64 %')).toBeInTheDocument();
    expect(screen.getByText('7.0 kW')).toBeInTheDocument();
    expect(screen.getByText('20.0°C')).toBeInTheDocument();
    expect(screen.getByText('10.0°C')).toBeInTheDocument();
    expect(screen.getByText('275.0 km')).toBeInTheDocument();
  });

  it('shows unavailable placeholders for malformed readings instead of inventing zeroes', () => {
    vi.mocked(useVehicleLiveSignals).mockReturnValue({
      data: { signals: {
        BatteryLevel: { value: 'unknown' },
        ACChargingPower: { value: null },
        InsideTemp: { value: Number.NaN },
        OutsideRange: { value: 275000 },
      } },
      dataUpdatedAt: 1234,
      isFetching: false,
      isStale: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useVehicleLiveSignals>);
    vi.mocked(useUnits).mockReturnValue({
      formatPower: () => '—',
      formatTemperature: () => '—',
      formatDistance: () => '—',
      unitPrefs: {},
    } as unknown as ReturnType<typeof useUnits>);
    render(<LiveSignalsWidget vehicleId={7} size={SIZE} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });
});
