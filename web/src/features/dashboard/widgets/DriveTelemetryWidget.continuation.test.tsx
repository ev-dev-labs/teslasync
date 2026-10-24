import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ drives: vi.fn(), telemetry: vi.fn(), retryDrives: vi.fn(), retryTelemetry: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [{ id: 1 }] }) }));
vi.mock('@/api/hooks/useDriving', () => ({ useDrives: mocks.drives, useDriveTelemetry: mocks.telemetry }));
vi.mock('@/components/charts', async () => ({
  ...await vi.importActual<typeof import('@/components/charts')>('@/components/charts'),
  useThemeChartPalette: () => ({ series: ['cyan', 'green'] }),
  EmbeddedChart: ({ data }: { data: readonly Record<string, unknown>[] }) => <pre data-testid="telemetry-chart-data">{JSON.stringify(data)}</pre>,
}));

import DriveTelemetryWidget from './DriveTelemetryWidget';

function query<T>(data: T, refetch: () => void, error: Error | null = null) {
  return { data, refetch, error, isError: error != null, isLoading: false, isFetching: false, isStale: false, dataUpdatedAt: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.drives.mockReturnValue(query([{
    id: 17, startTs: '2026-10-05T10:00:00Z', startAddress: 'Home', endAddress: 'Campus',
  }], mocks.retryDrives));
  mocks.telemetry.mockReturnValue(query([
    { timestamp: '2026-10-05T10:00:00Z', speed: 10, power: -1000 },
    { timestamp: '2026-10-05T10:01:00Z', speed: null, power: null },
  ], mocks.retryTelemetry));
});

function mount() {
  return render(<MemoryRouter><DriveTelemetryWidget size={{ cols: 3, rows: 2 }} /></MemoryRouter>);
}

describe('latest-drive telemetry source preservation', () => {
  it('keeps the route while telemetry retries independently', () => {
    mocks.telemetry.mockReturnValue(query(undefined, mocks.retryTelemetry, new Error('telemetry failed')));
    mount();
    expect(screen.getByText(/Last drive · Home → Campus/)).toBeInTheDocument();
    expect(screen.getByText('Drive telemetry unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryTelemetry).toHaveBeenCalledTimes(1);
    expect(mocks.retryDrives).not.toHaveBeenCalled();
  });

  it('preserves signed and null two-series chart data', () => {
    mount();
    expect(mocks.telemetry).toHaveBeenCalledWith('17');
    const data = screen.getByTestId('telemetry-chart-data');
    expect(data).toHaveTextContent('"speed":36');
    expect(data).toHaveTextContent('"power":-1');
    expect(data).toHaveTextContent('"speed":null,"power":null');
  });

  it('keeps retained samples while refresh recovers', () => {
    mocks.telemetry.mockReturnValue(query([
      { timestamp: '2026-10-05T10:00:00Z', speed: 10, power: -1000 },
    ], mocks.retryTelemetry, new Error('refresh failed')));
    mount();
    expect(screen.getByText(/Previously loaded drive telemetry remains visible/)).toBeInTheDocument();
    expect(screen.getByTestId('telemetry-chart-data')).toHaveTextContent('"power":-1');
  });
});
