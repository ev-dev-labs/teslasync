import { cloneElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import { useBatteryDegradation } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { DegradationData } from '@/types/energy';
import { patchMatchMedia } from '@/test/setup';
import BatteryDegradationForecastWidget from './BatteryDegradationForecastWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS } from './designPacks/types';
import type { WidgetSize } from './types';

vi.mock('@/api/hooks/useEnergy', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useEnergy')>(),
  useBatteryDegradation: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useVehicles')>(),
  useVehicles: vi.fn(),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 640, height: 240 }),
}));

const mockDegradation = vi.mocked(useBatteryDegradation);
const mockVehicles = vi.mocked(useVehicles);
const refresh = vi.fn();
const FULL: WidgetSize = { cols: 2, rows: 4 };
const COMPACT: WidgetSize = { cols: 1, rows: 2 };
let media: ReturnType<typeof patchMatchMedia>;

function forecast(overrides: Partial<DegradationData> = {}): DegradationData {
  return {
    current_health: 94,
    current_capacity: 0,
    current_cycles: 0,
    current_range: 0,
    current_temp: 0,
    stress_level: 'Low',
    fast_charge_ratio: 0,
    snapshots: [],
    prediction: null,
    charging_habits: null,
    current_health_pct: 94,
    degradation_rate_pct_per_month: 0.1,
    projected_80pct_date: '2036-10-15',
    monthly_trend: [
      { month: '2026-07', avg_health: 95, avg_capacity: 0, avg_range: 0 },
      { month: '2026-08', avg_health: Number.NaN, avg_capacity: 0, avg_range: 0 },
      { month: '2026-09', avg_health: 94, avg_capacity: 0, avg_range: 0 },
    ],
    projections: [
      { date: '2026-10-15', health_pct: 93.8, confidence_low: 92, confidence_high: 95 },
      { date: '2026-11-15', health_pct: Number.NaN, confidence_low: 91, confidence_high: 95 },
      { date: '2026-12-15', health_pct: 93.6, confidence_low: 91, confidence_high: 95 },
    ],
    horizon_outlook: {
      points: [
        { years: 1, health_pct: 92.8, confidence_low: 91, confidence_high: 95 },
        { years: 3, health_pct: 90.4, confidence_low: 88, confidence_high: 93 },
        { years: 5, health_pct: 88, confidence_low: 84, confidence_high: 92 },
      ],
      data_months: 14,
      slope_per_year: -1.2,
      has_enough_data: true,
    },
    risk_factors: [{ name: 'AC charging', label: 'Charging mix', detail: 'Most sessions use AC', score: 2 }],
    recommendations: ['Keep daily charge below 80% when practical'],
    ...overrides,
  };
}

function result<T>(data: T | undefined, overrides: Partial<UseQueryResult<T, Error>> = {}): UseQueryResult<T, Error> {
  return {
    data,
    error: null,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    isSuccess: true,
    isStale: false,
    status: 'success',
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    refetch: refresh,
    ...overrides,
  } as UseQueryResult<T, Error>;
}

function tree(packId: unknown = 'classic', size: WidgetSize = FULL) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <BatteryDegradationForecastWidget vehicleId={7} size={size} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function appearance(container: HTMLElement, name: string) {
  await waitFor(() => {
    expect(container.querySelector(`[data-widget-family="line"][data-widget-appearance="${name}"]`)).toBeInTheDocument();
  });
}

function expectOriginalSamples() {
  const table = screen.getByRole('table', { name: 'Battery degradation — data table' });
  const rows = within(table).getAllByRole('row');
  expect(rows).toHaveLength(7);
  expect(rows.slice(1).map(row => within(row).getAllByRole('cell').map(cell => cell.textContent))).toEqual([
    ['2026-07', '95', '—'],
    ['2026-08', '—', '—'],
    ['2026-09', '94', '94'],
    ['Oct 2026', '—', '93.8'],
    ['Nov 2026', '—', '—'],
    ['Dec 2026', '—', '93.6'],
  ]);
}

beforeEach(() => {
  media = patchMatchMedia(query => query.includes('prefers-reduced-motion'));
  refresh.mockReset();
  mockVehicles.mockReturnValue(result<NonNullable<ReturnType<typeof useVehicles>['data']>>([]));
  mockDegradation.mockReturnValue(result(forecast()));
  // Give the real ResponsiveContainer a viewport; no chart or pack is mocked.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 240,
    width: 640, height: 240, toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  media.restore();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe.each(Object.entries(PACK_APPEARANCES))('battery forecast %s (%s)', (packId, name) => {
  it('keeps the forecast, measurements, complete trend, outlook, risks, advice and source actions', async () => {
    const { container } = render(tree(packId));
    await appearance(container, name);

    expect(screen.getByRole('heading', { name: 'Battery forecast', level: 3 })).toBeVisible();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    expect(screen.getByText('Oct 2036')).toBeInTheDocument();
    expect(screen.getByText('Projected 80% capacity')).toBeInTheDocument();
    const brief = screen.getByTestId('dashboard-battery-forecast-brief');
    expect(brief).toHaveTextContent('94%');
    expect(brief).toHaveTextContent('−0.10%/mo');
    expect(screen.getByText('1 / 3 / 5-year outlook')).toBeInTheDocument();
    expect(screen.getByText('1 yr')).toBeInTheDocument();
    expect(screen.getByText('3 yr')).toBeInTheDocument();
    expect(screen.getByText('5 yr')).toBeInTheDocument();
    expect(screen.getByText('91–95')).toBeInTheDocument();
    expect(screen.getByText('Risk factors')).toBeInTheDocument();
    expect(screen.getByText('Charging mix')).toBeInTheDocument();
    expect(screen.getByText('Most sessions use AC')).toBeInTheDocument();
    expect(screen.getByText('Recommendations')).toBeInTheDocument();
    expect(screen.getByText('Keep daily charge below 80% when practical')).toBeInTheDocument();
    expect(screen.getByText('Forecasts are uncertain and are not warranty or service advice.')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-family="line"] .lucide-trending-down')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expectOriginalSamples();
    await waitFor(() => {
      expect(container.querySelector('.recharts-line-curve[stroke-dasharray="5 4"]')).toHaveAttribute('stroke-width', '2');
    });

    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('[data-provenance="inferred"]')).toHaveTextContent('Estimated');
    expect(dialog.querySelector('[data-drawer-header]')).toHaveTextContent('does not establish continuous recording coverage');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(mockDegradation.mock.calls.every(([id]) => id === '7')).toBe(true);
    expect(screen.getAllByTestId('dashboard-battery-forecast-brief')).toHaveLength(1);
  });

  it('retains independently available advice when measurements, risk scores and outlook are unknown', async () => {
    mockDegradation.mockReturnValue(result(forecast({
      current_health: Number.NaN,
      current_health_pct: Number.NaN,
      degradation_rate_pct_per_month: Number.NaN,
      projected_80pct_date: null,
      monthly_trend: [],
      projections: [],
      horizon_outlook: null,
      risk_factors: [{ name: 'Thermal exposure', label: 'Thermal exposure', detail: 'Insufficient observations', score: Number.NaN }],
    })));
    const { container } = render(tree(packId));
    await appearance(container, name);

    expect(screen.getByText('Projected 80% capacity')).toBeInTheDocument();
    expect(screen.getByText('1 / 3 / 5-year outlook')).toBeInTheDocument();
    expect(screen.getByText('This widget has no qualifying data yet.')).toBeInTheDocument();
    expect(screen.getByText('Risk factors')).toBeInTheDocument();
    const risk = screen.getByText('Thermal exposure').closest('li');
    expect(risk).toHaveTextContent('—');
    expect(risk).not.toHaveTextContent('0');
    expect(screen.getByText('Keep daily charge below 80% when practical')).toBeInTheDocument();
    expect(screen.getByText('More data needed for trend')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('preserves the compact health branch and honest empty-state refresh', async () => {
    const view = render(tree(packId, COMPACT));
    await appearance(view.container, name);
    expect(screen.getByText('94%')).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();
    expect(screen.queryByText('Projected 80% capacity')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    mockDegradation.mockReturnValue(result<DegradationData>(undefined, { dataUpdatedAt: 0 }));
    view.rerender(tree(packId, COMPACT));
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('No degradation forecast data')).toBeInTheDocument();
    expect(screen.queryByText('Normal')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('widget-body')).getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalledOnce();

    view.rerender(tree(packId));
    expect(screen.getByText('Projected 80% capacity')).toBeInTheDocument();
    expect(screen.getByText('1 / 3 / 5-year outlook')).toBeInTheDocument();
    expect(screen.getByText('Risk factors')).toBeInTheDocument();
    expect(screen.getByText('Recommendations')).toBeInTheDocument();
    expect(screen.getByText('No degradation data')).toBeInTheDocument();
    expect(screen.getByText('No recommendations')).toBeInTheDocument();
  });
});

it('keeps Classic as default/recovery and returns to the same complete source after every pack selection', async () => {
  const view = render(tree());
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
  expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(screen.queryByText('Forecasts are uncertain and are not warranty or service advice.')).not.toBeInTheDocument();
  expectOriginalSamples();

  for (const [packId, name] of Object.entries(PACK_APPEARANCES)) {
    view.rerender(tree(packId));
    await appearance(view.container, name);
    expectOriginalSamples();
  }
  view.rerender(tree('unknown-pack'));
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
  expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(screen.getByText('Oct 2036')).toBeInTheDocument();
  expect(screen.getByText('Most sessions use AC')).toBeInTheDocument();
  expect(screen.getByText('Keep daily charge below 80% when practical')).toBeInTheDocument();
  expectOriginalSamples();
});

it.each(Object.entries(PACK_APPEARANCES))('retains the actual chart and all model outputs after a cached refresh failure in %s', async (packId, name) => {
  mockDegradation.mockReturnValue(result(forecast(), { isError: true, error: new Error('refresh failed'), isStale: true }));
  const { container } = render(tree(packId));
  await appearance(container, name);
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('Oct 2036')).toBeInTheDocument();
  expect(screen.getByText('Most sessions use AC')).toBeInTheDocument();
  expect(screen.getByText('Keep daily charge below 80% when practical')).toBeInTheDocument();
  expectOriginalSamples();
  fireEvent.click(within(screen.getByTestId('dashboard-battery-forecast-brief')).getByRole('button', { name: 'Review details' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Retained readings');
  expect(dialog.querySelector('[data-provenance="inferred"]')).toHaveAttribute('data-data-status', 'stale');
  fireEvent.keyDown(dialog, { key: 'Escape' });
});

it('preserves the real chart legend selection and accessible samples when changing appearance', async () => {
  const view = render(tree('v1'));
  await appearance(view.container, 'studio');
  const toggle = await screen.findByRole('button', { name: 'Forecast' });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(view.container.querySelector('.recharts-line-curve[stroke-dasharray="5 4"]')).not.toBeInTheDocument();
  expectOriginalSamples();

  for (const [packId, name] of Object.entries(PACK_APPEARANCES)) {
    view.rerender(tree(packId));
    await appearance(view.container, name);
    expect(screen.getByRole('button', { name: 'Forecast' })).toHaveAttribute('aria-pressed', 'true');
    expect(view.container.querySelector('.recharts-line-curve[stroke-dasharray="5 4"]')).not.toBeInTheDocument();
    expectOriginalSamples();
  }
  const retainedToggle = screen.getByRole('button', { name: 'Forecast' });
  expect(retainedToggle).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(retainedToggle);
  await waitFor(() => {
    expect(view.container.querySelector('.recharts-line-curve[stroke-dasharray="5 4"]')).toBeInTheDocument();
  });
  expectOriginalSamples();
});

it('preserves a measured zero in every pack and the original signed monthly rate', async () => {
  const view = render(tree('classic'));
  for (const [packId, name] of Object.entries(PACK_APPEARANCES)) {
    mockDegradation.mockReturnValue(result(forecast({ current_health_pct: 0, degradation_rate_pct_per_month: 0 })));
    view.rerender(tree(packId));
    await appearance(view.container, name);
    const brief = screen.getByTestId('dashboard-battery-forecast-brief');
    expect(brief).toHaveTextContent('0%');
    expect(brief).toHaveTextContent('0.00%/mo');
    mockDegradation.mockReturnValue(result(forecast({ current_health_pct: 0, degradation_rate_pct_per_month: -0.02 })));
    view.rerender(tree(packId));
    expect(screen.getByTestId('dashboard-battery-forecast-brief')).toHaveTextContent('-0.02%/mo');
  }
});

it.each(PACK_IDS)('keeps shell loading and fatal-error recovery instead of fabricating a forecast in %s', packId => {
  mockDegradation.mockReturnValue(result<DegradationData>(undefined, {
    isLoading: true, isFetching: true, isPending: true, dataUpdatedAt: 0,
  }));
  const view = render(tree(packId));
  expect(view.container.querySelector('[aria-busy="true"][data-data-state="initial"]')).toBeInTheDocument();
  expect(screen.queryByText('Projected 80% capacity')).not.toBeInTheDocument();
  expect(screen.queryByText('0%')).not.toBeInTheDocument();

  mockDegradation.mockReturnValue(result<DegradationData>(undefined, {
    isError: true, error: new Error('source unavailable'), dataUpdatedAt: 0,
  }));
  view.rerender(tree(packId));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('Projected 80% capacity')).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /retry/i }));
  expect(refresh).toHaveBeenCalledOnce();
});
