import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  drives: vi.fn(), telemetry: vi.fn(), retryDrives: vi.fn(), retryTelemetry: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [{ id: 1 }] }) }));
vi.mock('@/api/hooks/useDriving', () => ({ useDrives: mocks.drives, useDriveTelemetry: mocks.telemetry }));
vi.mock('@/components/charts', async () => ({
  ...await vi.importActual<typeof import('@/components/charts')>('@/components/charts'),
  useThemeChartPalette: () => ({ series: ['cyan', 'green', 'orange', 'gray'] }),
  useMeasuredAxisWidth: () => 36,
  EmbeddedChart: ({ data }: { data: readonly Record<string, unknown>[] }) => <pre data-testid="telemetry-chart-data">{JSON.stringify(data)}</pre>,
}));

import DriveTelemetryWidget from './DriveTelemetryWidget';

function query<T>(data: T, refetch: () => void, error: Error | null = null) {
  return { data, refetch, error, isError: error != null, isLoading: false, isFetching: false, isStale: false, dataUpdatedAt: 0 };
}
function mount() {
  return render(<MemoryRouter><DriveTelemetryWidget size={{ cols: 3, rows: 2 }} /></MemoryRouter>);
}
const address = 'Complete starting address with important final location details';
const samples = [
  { timestamp: '2026-10-05T10:00:00Z', speed: 10, power: -1000, batteryLevel: 52, elevation: 100 },
  { timestamp: '2026-10-05T10:01:00Z', speed: null, power: null, batteryLevel: null, elevation: null },
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.drives.mockReturnValue(query([
    { id: 17, startTs: '2026-10-05T10:00:00Z', startAddress: address, distanceM: 10000, durationS: 600, energyUsedWh: 1000 },
    { id: 9, startTs: '2026-10-04T10:00:00Z', distanceM: 5000, durationS: 300 },
  ], mocks.retryDrives));
  mocks.telemetry.mockReturnValue(query(samples, mocks.retryTelemetry));
});

describe('latest-drive telemetry source preservation', () => {
  it('keeps drive metadata visible while retrying only the failed telemetry source', () => {
    mocks.telemetry.mockReturnValue(query(undefined, mocks.retryTelemetry, new Error('telemetry failed')));
    mount();
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText(address)).toBeInTheDocument();
    expect(screen.getByText('Drive telemetry unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryTelemetry).toHaveBeenCalledTimes(1);
    expect(mocks.retryDrives).not.toHaveBeenCalled();
  });

  it('selects the latest drive and keeps all signed/null display series in the chart data', () => {
    mount();
    expect(mocks.telemetry).toHaveBeenCalledWith('17');
    const data = screen.getByTestId('telemetry-chart-data');
    expect(data).toHaveTextContent('"speed":36');
    expect(data).toHaveTextContent('"power":-1');
    expect(data).toHaveTextContent('"battery":52');
    expect(data).toHaveTextContent('"elevation":0.1');
    expect(data).toHaveTextContent('"speed":null,"power":null,"battery":null,"elevation":null');
  });

  it('keeps all retained samples when a background telemetry refresh fails', () => {
    mocks.telemetry.mockReturnValue(query(samples, mocks.retryTelemetry, new Error('refresh failed')));
    mount();
    expect(screen.getByText('Previously loaded drive telemetry remains visible while this source recovers.')).toBeInTheDocument();
    expect(screen.getByTestId('telemetry-chart-data')).toHaveTextContent('"power":-1');
    expect(screen.getByText(address)).toBeInTheDocument();
  });
});
