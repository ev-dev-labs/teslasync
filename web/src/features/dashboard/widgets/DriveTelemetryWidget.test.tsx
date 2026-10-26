import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  drives: vi.fn(),
  telemetry: vi.fn(),
  retryDrives: vi.fn(),
  retryTelemetry: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: 1 }] }),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: mocks.drives,
  useDriveTelemetry: mocks.telemetry,
}));
vi.mock('@/components/charts', async () => ({
  ...await vi.importActual<typeof import('@/components/charts')>('@/components/charts'),
  useThemeChartPalette: () => ({ series: ['#2563eb', '#0d9488'] }),
  ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
    <div data-testid="chart-container">{children}</div>,
  EmbeddedChart: ({ data, dataColumns }: {
    data: readonly Record<string, unknown>[];
    dataColumns: readonly { key: string; label: string }[];
  }) => <div>
    <pre data-testid="telemetry-chart-data">{JSON.stringify(data)}</pre>
    {dataColumns.map(column => <span key={column.key}>{column.label}</span>)}
  </div>,
}));

import React from 'react';
import DriveTelemetryWidget from './DriveTelemetryWidget';

function query<T>(data: T, refetch: () => void, error: Error | null = null) {
  return {
    data,
    refetch,
    error,
    isError: error != null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: 0,
  };
}

function mount(size = { cols: 2, rows: 2 }) {
  return render(
    <MemoryRouter>
      <DriveTelemetryWidget size={size} />
    </MemoryRouter>,
  );
}

const drive = {
  id: 17,
  startTs: '2026-10-05T10:00:00Z',
  startAddress: 'Home',
  endAddress: 'Campus',
  distanceM: 10_000,
  durationS: 600,
  energyUsedWh: 1_000,
};

const samples = [
  { timestamp: '2026-10-05T10:00:00Z', speed: 10, power: -1000, batteryLevel: 52, elevation: 100 },
  { timestamp: '2026-10-05T10:01:00Z', speed: null, power: null, batteryLevel: null, elevation: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.drives.mockReturnValue(query([drive], mocks.retryDrives));
  mocks.telemetry.mockReturnValue(query(samples, mocks.retryTelemetry));
});

describe('DriveTelemetryWidget redesign', () => {
  it('matches the two-series hierarchy and renders one real route label', () => {
    mount();

    expect(screen.getByText(/Last drive · Home → Campus/)).toBeInTheDocument();
    expect(screen.getByText(/Speed \(km\/h\)/)).toBeInTheDocument();
    expect(screen.getByText(/Power \(kW\)/)).toBeInTheDocument();
    expect(screen.queryByText('Distance')).not.toBeInTheDocument();
    expect(screen.queryByText('Duration')).not.toBeInTheDocument();
  });

  it('preserves signed speed/power samples and null gaps without fabrication', () => {
    mount();
    const data = screen.getByTestId('telemetry-chart-data');

    expect(data).toHaveTextContent('"speed":36');
    expect(data).toHaveTextContent('"power":-1');
    expect(data).toHaveTextContent('"speed":null,"power":null');
    expect(mocks.telemetry).toHaveBeenCalledWith('17');
  });

  it('keeps the route visible while telemetry retries independently', () => {
    mocks.telemetry.mockReturnValue(
      query(undefined, mocks.retryTelemetry, new Error('telemetry failed')),
    );
    mount();

    expect(screen.getByText(/Last drive · Home → Campus/)).toBeInTheDocument();
    expect(screen.getByText('Drive telemetry unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryTelemetry).toHaveBeenCalledTimes(1);
    expect(mocks.retryDrives).not.toHaveBeenCalled();
  });

  it('shows retained samples while a background refresh recovers', () => {
    mocks.telemetry.mockReturnValue(
      query(samples, mocks.retryTelemetry, new Error('refresh failed')),
    );
    mount();

    expect(screen.getByText(/Last drive · Home → Campus/)).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded drive telemetry remains visible/)).toBeInTheDocument();
    expect(screen.getByTestId('telemetry-chart-data')).toHaveTextContent('"power":-1');
  });

  it('renders compact without a chart and without repeated metric cards', () => {
    mount({ cols: 1, rows: 2 });

    expect(screen.getByRole('heading', { name: 'Drive telemetry', level: 3 })).toBeVisible();
    expect(screen.queryByTestId('telemetry-chart-data')).not.toBeInTheDocument();
    expect(screen.queryByText('Distance')).not.toBeInTheDocument();
    expect(screen.getByText('Speed')).toBeInTheDocument();
    expect(screen.getByText('Power')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('shows the latest measured speed and signed power in the compact body', () => {
    mocks.telemetry.mockReturnValue(query([samples[0]], mocks.retryTelemetry));
    mount({ cols: 1, rows: 2 });
    expect(screen.getByText('36')).toHaveTextContent('36km/h');
    expect(screen.getByText('-1.0')).toHaveTextContent('-1.0kW');
    expect(screen.queryByTestId('telemetry-chart-data')).not.toBeInTheDocument();
  });

  it('exposes compact telemetry recovery rather than rendering an empty body', () => {
    mocks.telemetry.mockReturnValue(query(undefined, mocks.retryTelemetry, new Error('telemetry failed')));
    mount({ cols: 1, rows: 2 });
    expect(screen.getByText('Drive telemetry unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryTelemetry).toHaveBeenCalledTimes(1);
    expect(mocks.retryDrives).not.toHaveBeenCalled();
  });

  it('announces compact telemetry loading without fabricating measured values', () => {
    mocks.telemetry.mockReturnValue({
      ...query(undefined, mocks.retryTelemetry), isLoading: true, isFetching: true,
    });
    mount({ cols: 1, rows: 2 });
    expect(screen.getByRole('status', { name: 'Loading Drive telemetry' }))
      .toHaveTextContent('Loading drive telemetry');
    expect(screen.queryByText('Speed')).not.toBeInTheDocument();
    expect(screen.queryByText('Power')).not.toBeInTheDocument();
    expect(screen.queryByTestId('telemetry-chart-data')).not.toBeInTheDocument();
  });

  it('renders honest empty and drives-error states', () => {
    mocks.drives.mockReturnValue(query([], mocks.retryDrives));
    const empty = mount();
    expect(screen.getByText('No recent drives')).toBeInTheDocument();
    empty.unmount();

    mocks.drives.mockReturnValue(
      query(undefined, mocks.retryDrives, new Error('drives down')),
    );
    mount();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
