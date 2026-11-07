import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { WatchAvailability, WatchComplication, WatchSummary } from '@/api/hooks/useWatch';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { hasGaugeColor } from '@/test/gaugeTestUtils';
import { COLOR } from '@/lib/colors';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackAppearance, type PackId } from './designPacks/types';
import WatchSummaryWidget from './WatchSummaryWidget';

interface WatchQuery<T> {
  data: T | undefined;
  availability: WatchAvailability;
  availabilityError: Error | null;
  error: Error | null;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  fetchStatus: 'idle' | 'fetching';
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn<() => void>>;
  recheckAvailability: ReturnType<typeof vi.fn<() => void>>;
}

const { summaryMock, complicationMock, unitsMock } = vi.hoisted(() => ({
  summaryMock: vi.fn<(vehicleId?: number) => WatchQuery<WatchSummary>>(),
  complicationMock: vi.fn<(vehicleId?: number) => WatchQuery<WatchComplication>>(),
  unitsMock: vi.fn<() => { unitPrefs: { distance: 'mi' | 'km'; temperature: '°C' | '°F' } }>(),
}));

vi.mock('@/api/hooks/useWatch', () => ({
  useWatchSummary: summaryMock,
  useWatchComplication: complicationMock,
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: unitsMock }));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDate: () => 'Nov 6, 2026',
    formatDateTime: () => 'Nov 6, 2026, 12:00 PM',
    formatTime: () => '12:00 PM',
    formatRelative: () => '2h ago',
  }),
}));
vi.mock('@/hooks/useTimeFormatPreference', () => ({
  useTimeFormatPreference: () => 'relative',
}));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      const vars = typeof fallback === 'object' ? fallback : options;
      return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => String(vars?.[name] ?? match));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const SUMMARY: WatchSummary = {
  vehicle_name: 'Model Y',
  state: 'asleep',
  battery_level: 72,
  range_m: 300000,
  is_charging: false,
  charge_rate: 0,
  time_to_full: 0,
  is_locked: true,
  sentry_mode: false,
  inside_temp_c: -10,
  outside_temp_c: -12,
  is_climate_on: false,
  last_updated: '2026-11-06T12:00:00Z',
};
const COMPLICATION: WatchComplication = {
  battery: '99%', range: '999 mi', state: 'online', charging: true,
};

function query<T>(data: T | undefined, overrides: Partial<WatchQuery<T>> = {}): WatchQuery<T> {
  return {
    data, availability: 'configured', availabilityError: null, error: null,
    isLoading: false, isPending: false, isFetching: false, isStale: false,
    isError: false, fetchStatus: 'idle', dataUpdatedAt: data ? Date.now() : 0,
    refetch: vi.fn<() => void>(), recheckAvailability: vi.fn<() => void>(),
    ...overrides,
  };
}

function tree(packId: unknown = 'classic', cols = 2) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <WatchSummaryWidget vehicleId={7} size={{ cols, rows: 2 }} />
      </PackBoundary>
    </MemoryRouter>
  );
}

const packs = Object.entries(PACK_APPEARANCES) as [Exclude<PackId, 'classic'>, PackAppearance][];

beforeEach(() => {
  summaryMock.mockReset();
  complicationMock.mockReset();
  unitsMock.mockReset();
  summaryMock.mockReturnValue(query(SUMMARY));
  complicationMock.mockReturnValue(query(COMPLICATION));
  unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi', temperature: '°C' } });
});
afterEach(cleanup);

describe.each(packs)('Watch summary %s (%s)', (packId, appearance) => {
  async function expectPack(container: HTMLElement) {
    await waitFor(() => expect(container.querySelector(
      `[data-widget-family="empty"][data-widget-appearance="${appearance}"]`,
    )).toBeInTheDocument());
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    expect(container.querySelector('[data-instrument-family="empty"] .lucide-watch')).toBeInTheDocument();
  }

  it('retains the real full summary, independent complication, SI readings, detail drawer and both refresh actions', async () => {
    const summary = query(SUMMARY);
    const complication = query(COMPLICATION);
    summaryMock.mockReturnValue(summary);
    complicationMock.mockReturnValue(complication);
    const { container } = render(tree(packId));
    await expectPack(container);

    expect(screen.getByRole('heading', { name: 'Watch summary' })).toBeVisible();
    expect(screen.getByText('72.00')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('Asleep')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getAllByText('Charging')).toHaveLength(2);
    expect(screen.getByText('Last seen')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();

    const brief = screen.getByTestId('dashboard-watch-measurements-brief');
    expect(within(brief).getByText('186.41 mi')).toBeInTheDocument();
    expect(within(brief).getByText('-10.00°C')).toBeInTheDocument();
    expect(screen.queryByText('999 mi')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(brief, 'Source available');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Requested vehicle 7');
    expect(dialog).toHaveTextContent('complication freshness does not establish measurement freshness');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    expect(summary.refetch).toHaveBeenCalledOnce();
    expect(complication.refetch).toHaveBeenCalledOnce();
    expect(summaryMock).toHaveBeenLastCalledWith(7);
    expect(complicationMock).toHaveBeenLastCalledWith(7);
  });

  it('preserves the compact battery gauge scale and color, converted range and combined charging/lock line', async () => {
    const { container } = render(tree(packId, 1));
    await expectPack(container);
    const gauge = screen.getByRole('meter', { name: 'Battery' });
    expect(gauge).toHaveAttribute('aria-valuenow', '72');
    expect(gauge).toHaveAttribute('aria-valuemin', '0');
    expect(gauge).toHaveAttribute('aria-valuemax', '100');
    expect(hasGaugeColor(container, COLOR.GOOD)).toBe(true);
    expect(screen.getByText('186.41 mi')).toBeInTheDocument();
    expect(screen.getByText('Charging · Locked')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-watch-measurements-brief')).not.toBeInTheDocument();
  });

  it.each([1, 2])('keeps the %s-column unconfigured view useful without fabricated readings or capability success', async cols => {
    const unavailable = { availability: 'not-configured', isPending: true } as const;
    const summary = query<WatchSummary>(undefined, unavailable);
    const complication = query<WatchComplication>(undefined, unavailable);
    summaryMock.mockReturnValue(summary);
    complicationMock.mockReturnValue(complication);
    const { container } = render(tree(packId, cols));
    await expectPack(container);

    for (const copy of ['Watch access', 'Not connected', 'Setup needed', 'Connect',
      'Configure a wearable API key', 'Then', 'Review the latest available readings']) {
      expect(screen.getByText(copy)).toBeInTheDocument();
    }
    expect(screen.getByText('Watch access is not configured')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage API keys' })).toHaveAttribute('href', '/api-keys');
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="unavailable"]')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.queryByText('Online')).not.toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
    expect(screen.queryByText('No watch data')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Refresh data/ })).not.toBeInTheDocument();
    if (cols === 2) {
      const brief = screen.getByTestId('dashboard-watch-measurements-brief');
      assertOperationalMetricUnavailable(brief, 'Range');
      assertOperationalMetricUnavailable(brief, 'Cabin');
      expect(screen.getByText('Lock')).toBeInTheDocument();
      expect(screen.getByText('Unknown')).toBeInTheDocument();
      expect(screen.getByText('Last seen')).toBeInTheDocument();
    }
    expect(summary.refetch).not.toHaveBeenCalled();
    expect(complication.refetch).not.toHaveBeenCalled();
  });

  it('retains measurements and their timestamp when access is removed, then restores refresh without claiming configuration proves freshness', async () => {
    const summary = query(SUMMARY, { availability: 'not-configured' });
    const complication = query(COMPLICATION, { availability: 'not-configured' });
    summaryMock.mockReturnValue(summary);
    complicationMock.mockReturnValue(complication);
    const view = render(tree(packId));
    await expectPack(view.container);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText(/Retained readings are not refreshed until access is configured/)).toBeInTheDocument();
    expect(screen.getByText('72.00')).toBeInTheDocument();
    expect(screen.getByText('186.41 mi')).toBeInTheDocument();
    expect(screen.getByText('-10.00°C')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Refresh data/ })).not.toBeInTheDocument();

    summaryMock.mockReturnValue({ ...summary, availability: 'configured', isError: true, error: new Error('Rejected key') });
    complicationMock.mockReturnValue({ ...complication, availability: 'configured' });
    view.rerender(tree(packId));
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(screen.getByText('72.00')).toBeInTheDocument();
    assertOperationalBriefDisclosure(screen.getByTestId('dashboard-watch-measurements-brief'), 'Retained readings');
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    expect(summary.refetch).toHaveBeenCalledOnce();
    expect(complication.refetch).toHaveBeenCalledOnce();
  });

  it('keeps failed prerequisite evidence distinct from setup and retries local availability rather than blocked reads', async () => {
    const failed = {
      availability: 'prerequisite-error',
      availabilityError: new Error('Session storage unavailable'),
      isPending: true,
    } as const;
    const summary = query<WatchSummary>(undefined, failed);
    const complication = query<WatchComplication>(undefined, failed);
    summaryMock.mockReturnValue(summary);
    complicationMock.mockReturnValue(complication);
    const { container } = render(tree(packId));
    await expectPack(container);
    expect(screen.getByRole('alert')).toHaveTextContent('Watch access could not be checked');
    expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage API keys' })).not.toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-watch-measurements-brief')).toBeInTheDocument();
    expect(screen.getByText('Lock')).toBeInTheDocument();
    expect(screen.getByText('Last seen')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
    expect(summary.recheckAvailability).toHaveBeenCalledOnce();
    expect(complication.recheckAvailability).toHaveBeenCalledOnce();
    expect(summary.refetch).not.toHaveBeenCalled();
    expect(complication.refetch).not.toHaveBeenCalled();
  });

  it('does not use a successful complication to invent missing summary measurements and keeps the configured empty state actionable', async () => {
    summaryMock.mockReturnValue(query<WatchSummary>(undefined));
    const { container } = render(tree(packId));
    await expectPack(container);
    expect(screen.getByText('No watch data')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    const brief = screen.getByTestId('dashboard-watch-measurements-brief');
    assertOperationalMetricUnavailable(brief, 'Range');
    assertOperationalMetricUnavailable(brief, 'Cabin');
    expect(screen.getAllByText('Charging')).toHaveLength(2);
    expect(screen.queryByText('999 mi')).not.toBeInTheDocument();
    expect(screen.queryByText('99%')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.queryByText('Setup needed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Refresh data/ })).toBeEnabled();
  });
});

it.each([1, 2])('retains the %s-column Classic body by default and recovers it after changing packs', async cols => {
  const view = render(tree(undefined, cols));
  expect(view.container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByText('72.00')).toBeInTheDocument();
  expect(screen.getByText('186.41 mi')).toBeInTheDocument();
  view.rerender(tree('v4', cols));
  await waitFor(() => expect(view.container.querySelector('[data-widget-appearance="owner"]')).toBeInTheDocument());
  view.rerender(tree('unrecognized-pack', cols));
  expect(view.container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByText('72.00')).toBeInTheDocument();
  expect(screen.getByText('186.41 mi')).toBeInTheDocument();
  if (cols === 1) expect(screen.getByText('Charging · Locked')).toBeInTheDocument();
  else {
    expect(screen.getByTestId('dashboard-watch-measurements-brief')).toBeInTheDocument();
    expect(screen.getByText('Asleep')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  }
});

it('keeps both source refreshes guarded while a read is in flight and converts only display units', async () => {
  const summary = query({ ...SUMMARY, range_m: 0, inside_temp_c: 0 }, { isFetching: true });
  const complication = query(COMPLICATION);
  summaryMock.mockReturnValue(summary);
  complicationMock.mockReturnValue(complication);
  unitsMock.mockReturnValue({ unitPrefs: { distance: 'km', temperature: '°F' } });
  const { container } = render(tree('v7'));
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="pixel"]')).toBeInTheDocument());
  expect(screen.getByText('0.00 km')).toBeInTheDocument();
  expect(screen.getByText('32.00°F')).toBeInTheDocument();
  const refresh = screen.getByRole('button', { name: /^Refresh data/ });
  expect(refresh).toBeDisabled();
  fireEvent.click(refresh);
  expect(summary.refetch).not.toHaveBeenCalled();
  expect(complication.refetch).not.toHaveBeenCalled();
  expect(summary.data?.range_m).toBe(0);
  expect(summary.data?.inside_temp_c).toBe(0);
});
