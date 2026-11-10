import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { DataStateSource } from '@/api/dataState';
import type { Drive } from '@/api/types';
import { formatHourName } from '@/lib/dateConvert';
import { fmtNumber } from '@/lib/numberFormat';
import { convertSpeedFromSI, type SpeedUnitPref } from '@/lib/unitConversion';
import { queryResult, renderWidget } from '../components/continuation-dashboard-2/testSupport';
import SpeedHeatmapWidget from './SpeedHeatmapWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

const { historyMock, vehiclesMock, unitsMock, timezoneMock, refetch } = vi.hoisted(() => ({
  historyMock: vi.fn(),
  vehiclesMock: vi.fn(),
  unitsMock: vi.fn(),
  timezoneMock: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDashboardDriveHistory: (vehicleId: number, options: { kind: string; range?: string }) =>
    historyMock(vehicleId, options),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => vehiclesMock() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));
vi.mock('@/lib/timezone', async (original) => {
  const actual = await original<typeof import('@/lib/timezone')>();
  return { ...actual, useTimezone: () => timezoneMock() };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

const packs = Object.entries(PACK_APPEARANCES);
const gridLabel = 'Average speed by day of week and hour of day';
const blankCells = 'Blank cells represent periods without samples, not zero speed.';
const compactSize: WidgetSize = { cols: 1, rows: 1 };
const fullSize: WidgetSize = { cols: 3, rows: 3 };

function drive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1, vehicle_id: 42, start_ts: '2026-10-05T08:10:00Z', end_ts: null,
    duration_s: 600, distance_m: 6000, start_address: null, end_address: null,
    start_lat: null, start_lon: null, end_lat: null, end_lon: null,
    start_soc_pct: 80, end_soc_pct: null, energy_used_wh: null, regen_energy_wh: null,
    avg_speed_mps: 10, max_speed_mps: null, avg_power_w: null,
    outside_temp_avg_c: null, inside_temp_avg_c: null, score: null, ended_status: null,
    created_at: '2026-10-05T08:10:00Z', updated_at: '2026-10-05T08:10:00Z',
    ...overrides,
  };
}

const drives = [
  drive(),
  drive({ id: 2, start_ts: '2026-10-05T08:50:00Z', avg_speed_mps: 30 }),
  drive({ id: 3, start_ts: '2026-10-05T09:00:00Z', avg_speed_mps: 0 }),
  drive({ id: 4, start_ts: '2026-10-11T23:20:00Z', avg_speed_mps: 15 }),
  drive({ id: 5, start_ts: '2026-10-06T06:00:00Z', avg_speed_mps: null, max_speed_mps: 50 }),
  drive({ id: 6, start_ts: 'invalid timestamp', avg_speed_mps: 99 }),
  drive({ id: 7, avg_speed_mps: Number.NaN }),
];

function query(overrides: Partial<DataStateSource<Drive[]>> = {}) {
  return queryResult(drives, { refetch, ...overrides });
}

function widget(packId: unknown, size = fullSize, vehicleId?: number) {
  return (
    <PackBoundary requestedPackId={packId}>
      <SpeedHeatmapWidget vehicleId={vehicleId} size={size} config={{ timeRange: '30d' }} />
    </PackBoundary>
  );
}

async function appearance(container: HTMLElement, name: string) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="heatmap"][data-widget-appearance="${name}"]`,
  )).toBeInTheDocument());
}

function displaySpeed(mps: number, unit: SpeedUnitPref = 'km/h') {
  return fmtNumber(convertSpeedFromSI(mps, unit));
}

function expectOriginalGrid(pixel = false, wide = true, unit: SpeedUnitPref = 'km/h') {
  const svg = screen.getByRole('img', { name: gridLabel });
  expect(svg).toHaveAttribute('viewBox', wide ? '0 0 272 100' : '0 0 256 100');
  const cells = svg.querySelectorAll('rect');
  expect(cells).toHaveLength(168);
  expect(svg.querySelectorAll('rect title')).toHaveLength(168);
  expect(cells[8].textContent).toContain(`${displaySpeed(20, unit)} ${unit} (2 drives)`);
  expect(cells[9].textContent).toContain(`${displaySpeed(0, unit)} ${unit} (1 drive)`);
  expect(cells[6 * 24 + 23].textContent).toContain(`${displaySpeed(15, unit)} ${unit} (1 drive)`);
  expect(cells[24 + 6].textContent).toContain('No data');
  expect(cells[24 + 6]).toHaveAttribute('fill', 'var(--surface-2)');
  expect(cells[9].getAttribute('fill')).not.toBe('var(--surface-2)');
  expect(cells[8]).toHaveAttribute('rx', pixel ? '0' : '1.5');
  expect(cells[8]).toHaveAttribute('fill', `color-mix(in srgb, ${pixel ? 'var(--text-primary)' : 'var(--accent)'} 100%, var(--surface-2))`);
  expect(svg.querySelectorAll('text')).toHaveLength(wide ? 12 : 11);
  expect(within(svg).getByText(wide ? 'Mon' : 'M')).toBeInTheDocument();
  expect(within(svg).getByText(formatHourName(18, { locale: 'en', showMinutes: true }))).toBeInTheDocument();
  if (wide) {
    expect(within(svg).getByText(formatHourName(23, { locale: 'en', showMinutes: true }))).toBeInTheDocument();
  }
  const table = screen.getByRole('table', { name: 'Speed heatmap — data table' });
  expect(within(table).getByRole('columnheader', { name: `Average speed (${unit})` })).toBeInTheDocument();
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(168);
  const rowValues = (index: number) => within(rows[index]).getAllByRole('cell').map(cell => cell.textContent);
  expect(rowValues(8)).toEqual(['Mon', '8:00', displaySpeed(20, unit), '2']);
  expect(rowValues(9)).toEqual(['Mon', '9:00', displaySpeed(0, unit), '1']);
  expect(rowValues(24 + 6)).toEqual(['Tue', '6:00', '—', '0']);
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  historyMock.mockReturnValue(query());
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
  unitsMock.mockReturnValue({ unitPrefs: { speed: 'km/h' } });
  timezoneMock.mockReturnValue('UTC');
});
afterEach(cleanup);

describe.each(packs)('Speed heatmap %s / %s', (packId, packAppearance) => {
  it('preserves every real sample, axis, tooltip, accessible table, scope and refresh action', async () => {
    const view = renderWidget(widget(packId, fullSize, 42));
    await appearance(view.container, packAppearance);
    expect(view.container.querySelector('[data-role="widget-header-title"]')).toHaveTextContent('Speed heatmap');
    expect(view.container.querySelectorAll('[data-role="widget-shell-header"]')).toHaveLength(1);
    expect(screen.getByText('By hour')).toBeInTheDocument();
    expect(screen.getByText('Average driving speed')).toBeInTheDocument();
    expect(screen.getByText('Rows')).toBeInTheDocument();
    expect(screen.getByText('Days')).toBeInTheDocument();
    expect(screen.getByText('Columns')).toBeInTheDocument();
    expect(screen.getByText('Time of day')).toBeInTheDocument();
    expect(screen.getByText('Dim = no sample')).toBeInTheDocument();
    expect(screen.getByText('Brighter = higher speed')).toBeInTheDocument();
    expect(screen.getByText(blankCells)).toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-appearance] svg.lucide')?.getAttribute('class')).toMatch(/grid/i);
    expectOriginalGrid(packId === 'v7');
    expect(view.container.querySelectorAll('[data-chart-key="dashboard-speed-heatmap"]')).toHaveLength(1);
    expect(historyMock).toHaveBeenCalledTimes(1);
    expect(historyMock).toHaveBeenLastCalledWith(42, { kind: 'heatmap', range: '30d' });

    fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    historyMock.mockReturnValue(query({ isFetching: true }));
    view.rerender(widget(packId, fullSize, 42));
    const refresh = screen.getByRole('button', { name: /refresh data/i });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the compact peak of cell averages without mounting a chart or invented scale', async () => {
    const view = renderWidget(widget(packId, compactSize));
    await appearance(view.container, packAppearance);
    expect(screen.getByText('Peak')).toBeInTheDocument();
    expect(screen.getByText(displaySpeed(20))).toBeInTheDocument();
    expect(screen.getByText('km/h')).toBeInTheDocument();
    expect(screen.getByText('Peak of sampled hourly averages')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(historyMock).toHaveBeenCalledTimes(1);
    expect(historyMock).toHaveBeenLastCalledWith(7, { kind: 'heatmap', range: '30d' });
  });

  it('keeps empty and invalid-only sources honest in full and compact layouts', async () => {
    historyMock.mockReturnValue(query({ data: [
      drive({ avg_speed_mps: null, max_speed_mps: 50 }),
      drive({ avg_speed_mps: Number.NaN }),
      drive({ avg_speed_mps: -1 }),
      drive({ start_ts: 'invalid timestamp' }),
    ] }));
    const view = renderWidget(widget(packId));
    await appearance(view.container, packAppearance);
    expect(screen.getByText('No drive data yet')).toBeInTheDocument();
    expect(screen.getByText(blankCells)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    historyMock.mockReturnValue(query({ data: [] }));
    view.rerender(widget(packId, compactSize));
    await appearance(view.container, packAppearance);
    expect(screen.getByText('Peak')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('km/h')).not.toBeInTheDocument();
    expect(screen.queryByText(/^0(?:\.00)?$/)).not.toBeInTheDocument();
  });

  it('distinguishes a zero-only sample from missing data in the grid and compact peak', async () => {
    historyMock.mockReturnValue(query({ data: [drive({ avg_speed_mps: 0 })] }));
    const view = renderWidget(widget(packId));
    await appearance(view.container, packAppearance);
    const cells = screen.getByRole('img', { name: gridLabel }).querySelectorAll('rect');
    expect(cells[8].textContent).toContain(`${displaySpeed(0)} km/h (1 drive)`);
    expect(cells[8].getAttribute('fill')).not.toBe('var(--surface-2)');
    expect(cells[9].textContent).toContain('No data');
    expect(cells[9]).toHaveAttribute('fill', 'var(--surface-2)');
    expect(screen.queryByText('No drive data yet')).not.toBeInTheDocument();

    view.rerender(widget(packId, compactSize));
    await appearance(view.container, packAppearance);
    expect(screen.getByText('Peak')).toBeInTheDocument();
    expect(screen.getByText(displaySpeed(0))).toBeInTheDocument();
    expect(screen.getByText('km/h')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

it.each(packs)('preserves Classic, narrow axes and unknown-pack recovery when switching to %s', async (packId, packAppearance) => {
  const narrowSize = { cols: 2, rows: 2 };
  const view = renderWidget(widget(undefined, narrowSize));
  expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(screen.queryByText('By hour')).not.toBeInTheDocument();
  expect(screen.queryByText(blankCells)).not.toBeInTheDocument();
  expectOriginalGrid(false, false);
  view.rerender(widget(packId, narrowSize));
  await appearance(view.container, packAppearance);
  expectOriginalGrid(packId === 'v7', false);
  view.rerender(widget('unrecognized-pack', narrowSize));
  expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expectOriginalGrid(false, false);
  view.rerender(widget('classic', compactSize));
  expect(screen.getByText(displaySpeed(20))).toBeInTheDocument();
  expect(screen.queryByText('Peak of sampled hourly averages')).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it.each(packs)('retains the sampled plot and measured zero after a failed refresh in %s', async (packId, packAppearance) => {
  const updatedAt = Date.now() - 60_000;
  historyMock.mockReturnValue(query({
    error: new Error('Refresh interrupted'), isError: true, isStale: true, dataUpdatedAt: updatedAt,
  }));
  const view = renderWidget(widget(packId));
  await appearance(view.container, packAppearance);
  expectOriginalGrid(packId === 'v7');
  expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
  expect(view.container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it.each(packs)('shows loading and fatal-error recovery without fabricated readings in %s', async (packId, packAppearance) => {
  historyMock.mockReturnValue(query({ data: undefined, isLoading: true, isPending: true, dataUpdatedAt: 0 }));
  const view = renderWidget(widget(packId));
  expect(view.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Speed heatmap' })).toBeVisible();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByText('No drive data yet')).not.toBeInTheDocument();
  historyMock.mockReturnValue(query({
    data: undefined, error: new Error('History unavailable'), isError: true, dataUpdatedAt: 0,
  }));
  view.rerender(widget(packId));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByText('No drive data yet')).not.toBeInTheDocument();
  historyMock.mockReturnValue(query());
  view.rerender(widget(packId));
  await appearance(view.container, packAppearance);
  expectOriginalGrid(packId === 'v7');
});

it.each(packs)('keeps SI conversion and vehicle-timezone placement at the display boundary in %s', async (packId, packAppearance) => {
  unitsMock.mockReturnValue({ unitPrefs: { speed: 'mph' } });
  timezoneMock.mockReturnValue('America/Los_Angeles');
  historyMock.mockReturnValue(query({ data: [
    drive({ start_ts: '2026-10-05T01:00:00Z', avg_speed_mps: 20 }),
  ] }));
  const view = renderWidget(widget(packId));
  await appearance(view.container, packAppearance);
  const cells = screen.getByRole('img', { name: gridLabel }).querySelectorAll('rect');
  expect(cells[6 * 24 + 18].textContent).toContain(`Sun 18:00 – ${displaySpeed(20, 'mph')} mph (1 drive)`);
  expect(cells[1].textContent).toContain('No data');
  const table = screen.getByRole('table', { name: 'Speed heatmap — data table' });
  expect(within(table).getByRole('columnheader', { name: 'Average speed (mph)' })).toBeInTheDocument();
});
