import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Drive, DriveTelemetryPoint } from '@/types/driving';
import LineTelemetryLayout from '../families/LineTelemetryLayout';
import type { LineAppearance } from '../families/Line.types';

const mocks = vi.hoisted(() => ({
  drives: vi.fn(), telemetry: vi.fn(), retryDrives: vi.fn(), retryTelemetry: vi.fn(),
  pack: vi.fn(() => 'classic'),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [{ id: 1 }] }) }));
vi.mock('@/api/hooks/useDriving', () => ({ useDrives: mocks.drives, useDriveTelemetry: mocks.telemetry }));
vi.mock('../PackBoundary', async importOriginal => ({
  ...await importOriginal<typeof import('../PackBoundary')>(), usePackPresentation: mocks.pack,
}));
vi.mock('@/components/charts', async () => ({
  ...await vi.importActual<typeof import('@/components/charts')>('@/components/charts'),
  useThemeChartPalette: () => ({ series: ['#2563eb', '#0d9488'] }),
  EmbeddedChart: ({ data, dataColumns, chartKey }: {
    data: readonly Record<string, unknown>[];
    dataColumns: readonly { key: string; label: string }[];
    chartKey: string;
  }) => <div data-testid="telemetry-chart" data-chart-key={chartKey}>
    <pre>{JSON.stringify(data)}</pre>
    {dataColumns.map(column => <span key={column.key}>{column.label}</span>)}
  </div>,
}));

import DriveTelemetryWidget from '../../DriveTelemetryWidget';

function query<T>(data: T, refetch: () => void, error: Error | null = null) {
  return { data, refetch, error, isError: error != null, isLoading: false,
    isFetching: false, isStale: false, dataUpdatedAt: 0 };
}

const drive = {
  id: 17, startTs: '2026-10-05T10:00:00Z', startAddress: 'Home', endAddress: 'Campus',
  durationS: 1800,
} satisfies Pick<Drive, 'id' | 'startTs' | 'startAddress' | 'endAddress' | 'durationS'>;
const samples = [
  { timestamp: drive.startTs, speed: 10, power: -1000 },
  { timestamp: '2026-10-05T10:01:00Z', speed: null, power: null },
  { timestamp: '2026-10-05T10:02:00Z', speed: 0, power: 0 },
] satisfies Pick<DriveTelemetryPoint, 'timestamp' | 'speed' | 'power'>[];
const appearances: readonly [string, LineAppearance][] = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pack.mockReturnValue('classic');
  mocks.drives.mockReturnValue(query([drive], mocks.retryDrives));
  mocks.telemetry.mockReturnValue(query(samples, mocks.retryTelemetry));
});

function mount(cols = 3) {
  return render(<MemoryRouter><DriveTelemetryWidget vehicleId={42} size={{ cols, rows: 2 }} /></MemoryRouter>);
}

async function mountPresentation(appearance: LineAppearance, cols = 3) {
  const view = mount(cols);
  await waitFor(() => expect(view.container.querySelector(`[data-line-appearance="${appearance}"]`)).not.toBeNull());
  return view;
}

describe.each(appearances)('drive telemetry %s', (packId, appearance) => {
  it('uses the real controller readings, duration and independent chart scales', async () => {
    mocks.pack.mockReturnValue(packId);
    const { container } = await mountPresentation(appearance);
    const chart = await screen.findByTestId('telemetry-chart');
    expect(container.querySelector(`[data-line-appearance="${appearance}"]`)).not.toBeNull();
    expect(screen.getByText(/Last drive · Home → Campus/)).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('0.50 h')).toBeInTheDocument();
    expect(chart).toHaveAttribute('data-chart-key', 'dashboard-drive-telemetry');
    expect(chart).toHaveTextContent('Speed (km/h)');
    expect(chart).toHaveTextContent('Power (kW)');
    expect(chart).toHaveTextContent('"speed":36,"power":-1');
    expect(chart).toHaveTextContent('"speed":null,"power":null');
    expect(chart).toHaveTextContent('"speed":0,"power":0');
    expect(mocks.drives).toHaveBeenCalledWith('42');
    expect(mocks.telemetry).toHaveBeenCalledWith('17');
  });

  it.each([
    { durationS: 0, expected: '0.00 h' },
    { durationS: null, expected: '—' },
    { durationS: -1, expected: '—' },
  ])('distinguishes duration $durationS from missing or invalid readings', async ({ durationS, expected }) => {
    mocks.pack.mockReturnValue(packId);
    mocks.drives.mockReturnValue(query([{ ...drive, durationS }], mocks.retryDrives));
    await mountPresentation(appearance);
    const label = await screen.findByText('Duration');
    const metric = label.closest('div');
    expect(metric).not.toBeNull();
    expect(within(metric as HTMLElement).getByRole('definition')).toHaveTextContent(expected);
    expect(screen.getByTestId('telemetry-chart')).toBeInTheDocument();
  });

  it('keeps route context and independent retry when the telemetry source fails', async () => {
    mocks.pack.mockReturnValue(packId);
    mocks.telemetry.mockReturnValue(query(undefined, mocks.retryTelemetry, new Error('source down')));
    await mountPresentation(appearance);
    expect(screen.getByText('Drive telemetry unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Last drive · Home → Campus/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryTelemetry).toHaveBeenCalledOnce();
    expect(mocks.retryDrives).not.toHaveBeenCalled();
    expect(screen.queryByTestId('telemetry-chart')).not.toBeInTheDocument();
  });
});

it('retains the same controller and samples across presentation changes', async () => {
  mocks.pack.mockReturnValue('v1');
  const mounted = await mountPresentation('studio');
  const chart = screen.getByTestId('telemetry-chart');
  mocks.drives.mockClear();
  mocks.telemetry.mockClear();
  mocks.pack.mockReturnValue('v7');
  mounted.rerender(<MemoryRouter><DriveTelemetryWidget vehicleId={42} size={{ cols: 3, rows: 2 }} /></MemoryRouter>);
  expect(screen.getByTestId('telemetry-chart')).toBe(chart);
  expect(mocks.drives).toHaveBeenCalledWith('42');
  expect(mocks.telemetry).toHaveBeenCalledWith('17');
  expect(mocks.retryDrives).not.toHaveBeenCalled();
  expect(mocks.retryTelemetry).not.toHaveBeenCalled();
});

it('keeps cached telemetry on refresh failure and exposes a missing duration as unknown', async () => {
  mocks.pack.mockReturnValue('v4');
  mocks.drives.mockReturnValue(query([{ ...drive, durationS: null }], mocks.retryDrives));
  mocks.telemetry.mockReturnValue(query(samples, mocks.retryTelemetry, new Error('refresh down')));
  await mountPresentation('owner');
  expect(screen.getByText(/Previously loaded drive telemetry remains visible/)).toBeInTheDocument();
  const duration = screen.getByText('Duration').closest('div');
  expect(duration).not.toBeNull();
  expect(within(duration as HTMLElement).getByText('—')).toBeInTheDocument();
});

it('preserves compact summaries without mounting the chart', async () => {
  mocks.pack.mockReturnValue('v3');
  await mountPresentation('precision', 1);
  expect(await screen.findByText('Duration')).toBeInTheDocument();
  expect(screen.getByText('Speed')).toBeInTheDocument();
  expect(screen.getByText('Power')).toBeInTheDocument();
  expect(screen.queryByTestId('telemetry-chart')).not.toBeInTheDocument();
});

it('does not present absent telemetry as a successful drive or healthy zero', async () => {
  mocks.pack.mockReturnValue('v6');
  mocks.telemetry.mockReturnValue(query([], mocks.retryTelemetry));
  await mountPresentation('expressive');
  expect(screen.getByText('No telemetry for this drive')).toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  expect(screen.queryByTestId('telemetry-chart')).not.toBeInTheDocument();
});

it('announces source loading without fabricating readings', async () => {
  mocks.pack.mockReturnValue('v5');
  mocks.telemetry.mockReturnValue({ ...query(undefined, mocks.retryTelemetry), isLoading: true, isFetching: true });
  await mountPresentation('iconic');
  expect(await screen.findByRole('status', { name: 'Loading Drive telemetry' })).toHaveTextContent('Loading drive telemetry');
  expect(screen.queryByText('Duration')).not.toBeInTheDocument();
});

it.each(appearances)('%s composes existing chart interactions without starting data acquisition', (_, appearance) => {
  render(<LineTelemetryLayout
    appearance={appearance}
    compact={false}
    context={<span>Route context</span>}
    headline={{ label: 'Speed', value: '0', unit: 'km/h' }}
    details={[{ label: 'Power', value: null, unit: 'kW' }]}
    chart={<div>Existing chart</div>}
    sourceBoundary={(content: ReactNode) => <div>{content}</div>}
  />);
  expect(screen.getByText('Route context')).toBeInTheDocument();
  expect(screen.getByText('Existing chart')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(mocks.drives).not.toHaveBeenCalled();
  expect(mocks.telemetry).not.toHaveBeenCalled();
});
