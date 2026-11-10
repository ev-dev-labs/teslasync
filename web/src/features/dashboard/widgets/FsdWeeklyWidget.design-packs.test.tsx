import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { FsdInsights } from '@/types/fsd';
import { formatDistance, type UnitPref } from '@/lib/unitConversion';
import { fsdInsights } from '@/features/driving/components/fsd-insights/__tests__/fixtures';
import { getWeekRange } from '@/features/analytics/components/weekly-digest/helpers';
import FsdWeeklyWidget from './FsdWeeklyWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS } from './designPacks/types';
import type { WidgetProps } from './types';

const { fsdRangeMock, vehiclesMock, unitsMock, distanceMock, refetch } = vi.hoisted(() => ({
  fsdRangeMock: vi.fn(),
  vehiclesMock: vi.fn(),
  unitsMock: vi.fn(),
  distanceMock: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({
  useFsdInsightsRange: (...args: unknown[]) => fsdRangeMock(...args),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => vehiclesMock() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ tz: 'UTC', formatTime: (value: unknown) => String(value) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const values = typeof fallback === 'object' ? fallback : options;
      const template = typeof fallback === 'string'
        ? fallback : typeof values?.defaultValue === 'string' ? values.defaultValue : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const packs = PACK_IDS.filter(pack => pack !== 'classic')
  .map(pack => [pack, PACK_APPEARANCES[pack]] as const);
const unitPrefs: UnitPref = {
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
  energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US',
};

function report(overrides: Partial<{
  distance: number | null; previous: number | null; share: number | null; change: number | null;
}> = {}): FsdInsights {
  const base = fsdInsights();
  const values = { distance: 16_000, previous: 12_000, share: 40, change: 3, ...overrides };
  return fsdInsights({
    totals: { ...base.totals, fsd_distance_m: values.distance, fsd_share_pct: values.share },
    drive_analytics: {
      ...base.drive_analytics,
      comparison: {
        ...base.drive_analytics.comparison,
        previous_fsd_distance_m: values.previous,
        fsd_share_change_pct_points: values.change,
      },
    },
  });
}

function query(overrides: Partial<DataStateSource<FsdInsights>> = {}) {
  return {
    data: report(), isLoading: false, isFetching: false, isStale: false, isError: false,
    error: null, dataUpdatedAt: Date.now(), refetch, ...overrides,
  };
}

function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-testid="location">{pathname}</span>;
}

function widget(packId: unknown, props: Partial<WidgetProps> = {}) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <FsdWeeklyWidget vehicleId={42} size={{ cols: 2, rows: 2 }} {...props} />
      </PackBoundary>
      <LocationProbe />
    </MemoryRouter>
  );
}

async function expectAppearance(container: HTMLElement, appearance: string) {
  await waitFor(() => {
    expect(container.querySelector(`[data-widget-family="empty"][data-widget-appearance="${appearance}"]`))
      .toBeInTheDocument();
  });
}

function expectRow(label: string, value: string) {
  const term = screen.getByText(label, { selector: 'dt' });
  expect(term.parentElement).toHaveTextContent(value);
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
  distanceMock.mockImplementation((meters: number, options?: Parameters<typeof formatDistance>[2]) =>
    formatDistance(meters, unitPrefs, options));
  unitsMock.mockReturnValue({ unitPrefs, formatDistance: distanceMock });
  fsdRangeMock.mockReturnValue(query());
});
afterEach(cleanup);

describe.each(packs)('FsdWeeklyWidget production design pack %s (%s)', (pack, appearance) => {
  it('preserves real weekly readings, both destinations and refresh', async () => {
    const view = render(widget(pack));
    await expectAppearance(view.container, appearance);

    expect(screen.getAllByRole('heading', { name: 'FSD this week', level: 3 })).toHaveLength(1);
    expect(screen.getAllByTestId('fsd-weekly-distance')).toHaveLength(1);
    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('16 km');
    expectRow('This week', '16 km');
    expectRow('Last week', '12 km');
    expectRow('Share', '40 %');
    expectRow('vs last week', '+3 pts');
    expect(screen.getByText('Unmeasured distance is not zero.')).toBeVisible();
    expect(screen.queryByText('UNMEASURED')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(view.container.querySelector(`[data-widget-appearance="${appearance}"] svg.lucide-gauge`))
      .toBeInTheDocument();
    expect(distanceMock).toHaveBeenCalledWith(16_000, { precision: 0 });
    expect(distanceMock).toHaveBeenCalledWith(12_000, { precision: 0 });
    const [start, end] = getWeekRange(0, 'UTC');
    expect(fsdRangeMock).toHaveBeenLastCalledWith(
      '42', start.toISOString(), new Date(end.getTime() + 1).toISOString(), 'UTC',
    );

    fireEvent.click(screen.getByRole('link', { name: 'FSD insights' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/fsd');
    fireEvent.click(screen.getByRole('link', { name: 'Weekly digest' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/weekly-digest');
    fireEvent.click(screen.getByRole('button', { name: /refresh data/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    fsdRangeMock.mockReturnValue(query({ isFetching: true }));
    view.rerender(widget(pack));
    const refresh = screen.getByRole('button', { name: /refresh data/i });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown measurements visibly unmeasured', async () => {
    fsdRangeMock.mockReturnValue(query({
      data: report({ distance: null, previous: null, share: null, change: null }),
    }));
    const view = render(widget(pack));
    await expectAppearance(view.container, appearance);
    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('—');
    expect(screen.getByText('UNMEASURED')).toBeVisible();
    expect(screen.getAllByText('Not available')).toHaveLength(4);
    expectRow('This week', 'Not available');
    expectRow('Last week', 'Not available');
    expectRow('Share', 'Not available');
    expectRow('vs last week', 'Not available');
    expect(screen.getByText('Unmeasured distance is not zero.')).toBeVisible();
    expect(screen.queryByText('0 km')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(distanceMock).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'FSD insights' })).toHaveAttribute('href', '/fsd');
  });

  it('preserves the compact headline branch', async () => {
    const view = render(widget(pack, { size: { cols: 1, rows: 1 } }));
    await expectAppearance(view.container, appearance);
    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('16 km');
    expect(screen.getByText('Reported supervised-driving distance')).toBeInTheDocument();
    expect(screen.queryByText('Share')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh data/i })).toBeEnabled();
  });

  it('distinguishes measured zero from unmeasured and preserves negative percentage-point changes', async () => {
    fsdRangeMock.mockReturnValue(query({ data: report({ distance: 0, previous: 0, share: 0, change: -3 }) }));
    const view = render(widget(pack));
    await expectAppearance(view.container, appearance);
    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('0 km');
    expectRow('This week', '0 km');
    expectRow('Last week', '0 km');
    expectRow('Share', '0 %');
    expectRow('vs last week', '-3 pts');
    expect(screen.queryByText('UNMEASURED')).not.toBeInTheDocument();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('does not present invalid distance or share as measurements (%s)', async (invalid) => {
    fsdRangeMock.mockReturnValue(query({
      data: report({ distance: invalid, previous: invalid, share: invalid, change: Number.NaN }),
    }));
    const view = render(widget(pack));
    await expectAppearance(view.container, appearance);
    expect(screen.getByText('UNMEASURED')).toBeVisible();
    expect(screen.getAllByText('Not available')).toHaveLength(4);
    expect(distanceMock).not.toHaveBeenCalled();
  });

  it('keeps independently measured distance when the share is outside its valid range', async () => {
    fsdRangeMock.mockReturnValue(query({ data: report({ share: 101, change: null }) }));
    const view = render(widget(pack));
    await expectAppearance(view.container, appearance);
    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('16 km');
    expectRow('Share', 'Not available');
    expectRow('Last week', '12 km');
    expect(screen.queryByText('UNMEASURED')).not.toBeInTheDocument();
  });

  it('keeps every full-size comparison row and both links visible for a resolved empty source', async () => {
    fsdRangeMock.mockReturnValue(query({ data: undefined, isSuccess: true, dataUpdatedAt: 0 }));
    const view = render(widget(pack));
    await expectAppearance(view.container, appearance);
    expect(screen.getByText('UNMEASURED')).toBeVisible();
    expect(screen.getAllByText('Not available')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'FSD insights' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Weekly digest' })).toBeVisible();
  });

  it('uses the selected display preference for both real SI distances', async () => {
    distanceMock.mockImplementation((meters: number, options?: Parameters<typeof formatDistance>[2]) =>
      formatDistance(meters, { ...unitPrefs, distance: 'mi' }, options));
    const view = render(widget(pack));
    await expectAppearance(view.container, appearance);
    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('10 mi');
    expectRow('This week', '10 mi');
    expectRow('Last week', '7 mi');
    expectRow('Share', '40 %');
  });

  it('preserves Classic default and unknown-pack recovery when switching the same controller', async () => {
    const view = render(widget(undefined));
    expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
    expect(screen.getByText('Reported FSD')).toBeInTheDocument();
    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('16 km');
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.queryByText('Unmeasured distance is not zero.')).not.toBeInTheDocument();
    view.rerender(widget(pack));
    await expectAppearance(view.container, appearance);
    view.rerender(widget('unknown-pack'));
    expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('fsd-weekly-distance')).toHaveLength(1);
    expect(screen.getByText('Reported FSD')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Weekly digest' })).toHaveAttribute('href', '/weekly-digest');
    expect(screen.queryByText('Last week', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it.each(['failed', 'paused'] as const)('retains the readings, navigation and trust warning when a refresh is %s', async (state) => {
    fsdRangeMock.mockReturnValue(query(state === 'failed'
      ? { isStale: true, isError: true, error: new Error('offline') }
      : { fetchStatus: 'paused' }));
    const view = render(widget(pack));
    await expectAppearance(view.container, appearance);
    expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
    expect(view.container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('16 km');
    expectRow('Last week', '12 km');
    expect(screen.getByRole('link', { name: 'FSD insights' })).toBeVisible();
  });

  it('keeps the source shell during initial loading and retries an initial failure', async () => {
    fsdRangeMock.mockReturnValue(query({ data: undefined, isLoading: true, isFetching: true }));
    const view = render(widget(pack));
    expect(screen.getByRole('heading', { name: 'FSD this week', level: 3 })).toBeVisible();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByTestId('fsd-weekly-distance')).not.toBeInTheDocument();
    fsdRangeMock.mockReturnValue(query({ data: undefined, isError: true, error: new Error('FSD request failed') }));
    view.rerender(widget(pack));
    expect(screen.getByRole('heading', { name: 'FSD this week', level: 3 })).toBeVisible();
    fireEvent.click(within(screen.getByTestId('widget-body')).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('fsd-weekly-distance')).not.toBeInTheDocument();
    fsdRangeMock.mockReturnValue(query());
    view.rerender(widget(pack));
    await expectAppearance(view.container, appearance);
    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('16 km');
  });

  it('retains the explicit no-vehicle state and existing first-vehicle fallback', async () => {
    const view = render(widget(pack, { vehicleId: 0 }));
    await expectAppearance(view.container, appearance);
    expect(screen.getByText('Select a vehicle')).toBeVisible();
    expect(screen.queryByTestId('fsd-weekly-distance')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(fsdRangeMock.mock.lastCall?.[0]).toBeUndefined();
    view.rerender(widget(pack, { vehicleId: undefined }));
    expect(fsdRangeMock.mock.lastCall?.[0]).toBe('7');
    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('16 km');
  });
});
