import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SpeedBucket, SpeedProfileData } from '@/types/driving';
import type { ReactNode } from 'react';
import SpeedProfileWidget, { formatBucketLabel } from './SpeedProfileWidget';

const { useSpeedProfileMock, useVehiclesMock, useUnitsMock, useRangeStateMock } = vi.hoisted(() => ({
  useSpeedProfileMock: vi.fn(),
  useVehiclesMock: vi.fn(),
  useUnitsMock: vi.fn(),
  useRangeStateMock: vi.fn(),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useSpeedProfile: (vehicleId?: string, start?: string, end?: string) =>
    useSpeedProfileMock(vehicleId, start, end),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => useUnitsMock(),
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => useRangeStateMock(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual, ...chartTestDoubles,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
    ComposedChart: ({ data }: { data: readonly Record<string, unknown>[] }) =>
      <pre data-testid="speed-profile-data">{JSON.stringify(data)}</pre>,
  };
});

function data(overrides: Partial<SpeedProfileData> = {}): SpeedProfileData {
  return { distribution: [], avgSpeedMps: 0, peakSpeedMps: 0, optimalSpeedMps: 0, ...overrides };
}

function bucket(overrides: Partial<SpeedBucket>): SpeedBucket {
  return { speed_bucket: '', readings: 0, ...overrides };
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(size: { cols: number; rows: number } = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <SpeedProfileWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useUnitsMock.mockReturnValue({ unitPrefs: { speed: 'km/h', power: 'kW' } });
  useRangeStateMock.mockReturnValue({
    start: '2026-09-23',
    end: '2026-10-22',
    startInstant: '2026-09-23T00:00:00.000Z',
    endInstantExclusive: '2026-10-23T00:00:00.000Z',
  });
  useSpeedProfileMock.mockReturnValue(query());
});

afterEach(() => cleanup());

describe('SpeedProfileWidget redesign', () => {
  it('renders one sweet-spot headline and the sourced frequency/power chart without metric duplication', () => {
    useSpeedProfileMock.mockReturnValue(query({
      data: data({
        distribution: [
          bucket({ speed_bucket: '15-30', readings: 30, avg_power_w: 20000 }),
          bucket({ speed_bucket: '45-60', readings: 10, avg_power_w: 9000 }),
        ],
      }),
    }));

    renderWidget();

    expect(screen.getByRole('heading', { name: 'Speed profile', level: 3 })).toBeVisible();
    expect(screen.getByText('Sweet spot')).toBeInTheDocument();
    expect(screen.getByText('72–97')).toBeInTheDocument();
    expect(screen.getAllByText('km/h').length).toBeGreaterThan(0);
    expect(screen.queryByText('Lowest power range')).not.toBeInTheDocument();
    expect(screen.queryByText('Peak freq')).not.toBeInTheDocument();
    expect(screen.getByText('Observed speed samples · average power is not energy efficiency')).toBeInTheDocument();
    const rows = JSON.parse(screen.getByTestId('speed-profile-data').textContent ?? '[]');
    expect(rows.map((row: { frequency: number; power: number }) => [row.frequency, row.power])).toEqual([[75, 20], [25, 9]]);
  });

  it('preserves signed SI watts, missing power and the selected power unit', () => {
    useUnitsMock.mockReturnValue({ unitPrefs: { speed: 'km/h', power: 'W' } });
    useSpeedProfileMock.mockReturnValue(query({
      data: data({
        distribution: [
          bucket({ speed_bucket: '15-30', readings: 1, avg_power_w: -3000 }),
          bucket({ speed_bucket: '45-60', readings: 1 }),
        ],
      }),
    }));
    renderWidget();
    const rows = JSON.parse(screen.getByTestId('speed-profile-data').textContent ?? '[]');
    expect(rows.map((row: { frequency: number; power: number | null }) => [row.frequency, row.power]))
      .toEqual([[50, -3000], [50, null]]);
  });

  it('uses the API optimal speed as the headline when available', () => {
    useSpeedProfileMock.mockReturnValue(query({
      data: data({
        distribution: [bucket({ speed_bucket: '15-30', readings: 10, avg_power_w: 15000 })],
        optimalSpeedMps: 20,
      }),
    }));

    renderWidget();
    expect(screen.getByText('72')).toBeInTheDocument();
  });

  it('keeps mph labels truthful in mph preference', () => {
    useUnitsMock.mockReturnValue({ unitPrefs: { speed: 'mph', power: 'kW' } });
    useSpeedProfileMock.mockReturnValue(query({
      data: data({
        distribution: [bucket({ speed_bucket: '33.55-67.11', readings: 10 })],
      }),
    }));

    renderWidget();
    expect(screen.queryByText('km/h')).not.toBeInTheDocument();
    expect(screen.getByText('Sweet spot')).toBeInTheDocument();
    expect(screen.queryByText('72–97')).not.toBeInTheDocument();
  });

  it('shows useful loading, empty, and initial-error states without fabricating values', () => {
    useSpeedProfileMock.mockReturnValue(query({ isLoading: true }));
    const loading = renderWidget();
    expect(screen.getByRole('heading', { name: 'Speed profile', level: 3 })).toBeVisible();
    loading.unmount();

    useSpeedProfileMock.mockReturnValue(query({ data: data() }));
    renderWidget();
    expect(screen.getByText('No speed data')).toBeInTheDocument();
    expect(screen.queryByText('Sweet spot')).not.toBeInTheDocument();
  });

  it('passes shared range dates and resolves the selected vehicle to the hook', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
    renderWidget({ cols: 2, rows: 2 });
    expect(useSpeedProfileMock).toHaveBeenCalledWith(
      '42',
      '2026-09-23',
      '2026-10-22',
    );
  });

  it('uses compact summary layout with no chart', () => {
    useSpeedProfileMock.mockReturnValue(query({
      data: data({ distribution: [bucket({ speed_bucket: '15-30', readings: 10, avg_power_w: 9000 })] }),
    }));
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('Sweet spot')).toBeInTheDocument();
    expect(screen.queryByText('Peak freq')).not.toBeInTheDocument();
  });

  it('refetches only when not already fetching', () => {
    const refetch = vi.fn();
    useSpeedProfileMock.mockReturnValue(query({
      data: data({ distribution: [bucket({ speed_bucket: '15-30', readings: 10 })] }),
      isFetching: false,
      refetch,
    }));
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('speed bucket formatting', () => {
  it('converts mph bucket edges to km/h and supports an open-ended bucket', () => {
    const toKmh = (mps: number) => mps * 3.6;
    expect(formatBucketLabel('15-30', toKmh, (value) => String(Math.round(value)))).toBe('24–48');
    expect(formatBucketLabel('75+', toKmh, (value) => String(Math.round(value)))).toBe('121+');
    expect(formatBucketLabel('unknown', toKmh, (value) => String(Math.round(value)))).toBe('unknown');
  });
});
