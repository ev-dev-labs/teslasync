import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { WidgetProps } from './types';

const mocks = vi.hoisted(() => ({ drives: vi.fn(), telemetry: vi.fn(), retryDrives: vi.fn(), retryTelemetry: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [{ id: 1 }] }) }));
vi.mock('@/api/hooks/useDriving', () => ({ useDrives: mocks.drives, useDriveTelemetry: mocks.telemetry }));
vi.mock('@/components/charts', async () => ({
  ...await vi.importActual<typeof import('@/components/charts')>('@/components/charts'),
  useThemeChartPalette: () => ({ series: ['cyan', 'green'] }),
  EmbeddedChart: ({ data, dataColumns }: {
    data: readonly Record<string, unknown>[];
    dataColumns: readonly { key: string; label: string }[];
  }) => <div>
    <pre data-testid="telemetry-chart-data">{JSON.stringify(data)}</pre>
    {dataColumns.map(column => <span key={column.key}>{column.label}</span>)}
  </div>,
}));

import DriveTelemetryWidget from './DriveTelemetryWidget';

function query<T>(data: T, refetch: () => void, error: Error | null = null) {
  return { data, refetch, error, isError: error != null, isLoading: false, isFetching: false, isStale: false, dataUpdatedAt: 0 };
}

const drive = {
  id: 17, startTs: '2026-10-05T10:00:00Z', startAddress: 'Home', endAddress: 'Campus',
  durationS: 600,
};
const samples = [
  { timestamp: '2026-10-05T10:00:00Z', speed: 10, power: -1000 },
  { timestamp: '2026-10-05T10:01:00Z', speed: null, power: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.drives.mockReturnValue(query([drive], mocks.retryDrives));
  mocks.telemetry.mockReturnValue(query(samples, mocks.retryTelemetry));
});

function mount(packId: PackId, size: WidgetProps['size'] = { cols: 3, rows: 2 }) {
  const widget = () => <MemoryRouter>
    <PackBoundary requestedPackId={packId}>
      <DriveTelemetryWidget vehicleId={5} size={size} />
    </PackBoundary>
  </MemoryRouter>;
  const view = render(widget());
  return { ...view, update: () => view.rerender(widget()) };
}

async function expectPresentation(packId: PackId, container: HTMLElement) {
  if (packId === 'classic') return;
  await waitFor(() => {
    expect(container.querySelector('[data-line-appearance]'))
      .toHaveAttribute('data-line-appearance', PACK_APPEARANCES[packId]);
  });
}

describe.each(PACK_IDS)('latest-drive telemetry source preservation (%s)', packId => {
  it('keeps the route while telemetry retries independently', async () => {
    mocks.telemetry.mockReturnValue(query(undefined, mocks.retryTelemetry, new Error('telemetry failed')));
    const view = mount(packId);
    await expectPresentation(packId, view.container);
    expect(screen.getByText(/Last drive · Home → Campus/)).toBeInTheDocument();
    expect(screen.getByText('Drive telemetry unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryTelemetry).toHaveBeenCalledTimes(1);
    expect(mocks.retryDrives).not.toHaveBeenCalled();
  });

  it('preserves the latest-drive controller, SI conversion, signed power, zero and invalid gaps', async () => {
    mocks.drives.mockReturnValue(query([
      drive,
      { ...drive, id: 99, startTs: '2026-10-04T10:00:00Z', startAddress: 'Older' },
    ], mocks.retryDrives));
    mocks.telemetry.mockReturnValue(query([
      ...samples,
      { timestamp: '2026-10-05T10:02:00Z', speed: 0, power: 0 },
      { timestamp: 'invalid', speed: Number.NaN, power: Number.POSITIVE_INFINITY },
    ], mocks.retryTelemetry));
    const view = mount(packId);
    await expectPresentation(packId, view.container);
    expect(mocks.drives).toHaveBeenLastCalledWith('5');
    expect(mocks.telemetry).toHaveBeenCalledWith('17');
    const data = screen.getByTestId('telemetry-chart-data');
    expect(data).toHaveTextContent('"speed":36');
    expect(data).toHaveTextContent('"power":-1');
    expect(data).toHaveTextContent('"speed":null,"power":null');
    expect(data).toHaveTextContent('"speed":0,"power":0');
    expect(data).toHaveTextContent('"time":"—","speed":null,"power":null');
    expect(screen.getByText('Speed (km/h)')).toBeInTheDocument();
    expect(screen.getByText('Power (kW)')).toBeInTheDocument();
    expect(screen.getByText(/Last drive · Home → Campus/)).toBeInTheDocument();
    if (packId !== 'classic') {
      expect(screen.getByText('Duration').nextElementSibling).toHaveTextContent('0.17 h');
    }
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(mocks.retryDrives).toHaveBeenCalledTimes(1);
    expect(mocks.retryTelemetry).toHaveBeenCalledTimes(1);
  });

  it('keeps retained samples while refresh recovers', async () => {
    mocks.telemetry.mockReturnValue(query([
      { timestamp: '2026-10-05T10:00:00Z', speed: 10, power: -1000 },
    ], mocks.retryTelemetry, new Error('refresh failed')));
    const view = mount(packId);
    await expectPresentation(packId, view.container);
    expect(screen.getByText(/Previously loaded drive telemetry remains visible/)).toBeInTheDocument();
    expect(screen.getByTestId('telemetry-chart-data')).toHaveTextContent('"power":-1');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryTelemetry).toHaveBeenCalledTimes(1);
    expect(mocks.retryDrives).not.toHaveBeenCalled();
  });

  it('retains the route through independent telemetry loading, empty and ready states', async () => {
    mocks.telemetry.mockReturnValue({
      ...query(undefined, mocks.retryTelemetry), isLoading: true, isFetching: true,
    });
    const view = mount(packId);
    await expectPresentation(packId, view.container);
    expect(screen.getByRole('status', { name: 'Loading Drive telemetry' }))
      .toHaveTextContent('Loading drive telemetry');
    expect(screen.queryByTestId('telemetry-chart-data')).not.toBeInTheDocument();

    mocks.telemetry.mockReturnValue(query([], mocks.retryTelemetry));
    view.update();
    expect(screen.getByText('No telemetry for this drive')).toBeInTheDocument();
    expect(screen.queryByTestId('telemetry-chart-data')).not.toBeInTheDocument();

    mocks.telemetry.mockReturnValue(query(samples, mocks.retryTelemetry));
    view.update();
    expect(screen.getByTestId('telemetry-chart-data')).toHaveTextContent('"power":-1');
    expect(screen.getByText(/Last drive · Home → Campus/)).toBeInTheDocument();
  });

  it('distinguishes measured compact zero, signed power, unknown and invalid values', async () => {
    mocks.telemetry.mockReturnValue(query([samples[1]], mocks.retryTelemetry));
    const view = mount(packId, { cols: 1, rows: 2 });
    await expectPresentation(packId, view.container);
    expect(screen.getByText('Speed').nextElementSibling).toHaveTextContent(/^—$/);
    expect(screen.getByText('Power').nextElementSibling).toHaveTextContent(/^—$/);

    mocks.telemetry.mockReturnValue(query([
      { timestamp: samples[0].timestamp, speed: 0, power: 0 },
    ], mocks.retryTelemetry));
    view.update();
    expect(screen.getByText('Speed').nextElementSibling).toHaveTextContent(/^0km\/h$/);
    expect(screen.getByText('Power').nextElementSibling).toHaveTextContent(/^0\.0kW$/);

    mocks.telemetry.mockReturnValue(query([samples[0]], mocks.retryTelemetry));
    view.update();
    expect(screen.getByText('Speed').nextElementSibling).toHaveTextContent(/^36km\/h$/);
    expect(screen.getByText('Power').nextElementSibling).toHaveTextContent(/^-1\.0kW$/);

    mocks.telemetry.mockReturnValue(query([
      { timestamp: 'invalid', speed: Number.NaN, power: Number.NEGATIVE_INFINITY },
    ], mocks.retryTelemetry));
    view.update();
    expect(screen.getByText('Speed').nextElementSibling).toHaveTextContent(/^—$/);
    expect(screen.getByText('Power').nextElementSibling).toHaveTextContent(/^—$/);
    expect(screen.queryByTestId('telemetry-chart-data')).not.toBeInTheDocument();
  });

  it('keeps drives loading and fatal recovery distinct from authoritative empty history', () => {
    mocks.drives.mockReturnValue({
      ...query(undefined, mocks.retryDrives), isLoading: true, isFetching: true,
    });
    const view = mount(packId);
    expect(screen.getByTestId('widget-body').parentElement).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No recent drives')).not.toBeInTheDocument();

    mocks.drives.mockReturnValue(query(undefined, mocks.retryDrives, new Error('drives down')));
    view.update();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No recent drives')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryDrives).toHaveBeenCalledTimes(1);
    expect(mocks.retryTelemetry).toHaveBeenCalledTimes(1);

    mocks.drives.mockReturnValue(query([], mocks.retryDrives));
    view.update();
    expect(screen.getByText('No recent drives')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('telemetry-chart-data')).not.toBeInTheDocument();
    expect(mocks.telemetry).toHaveBeenLastCalledWith('');
  });
});
