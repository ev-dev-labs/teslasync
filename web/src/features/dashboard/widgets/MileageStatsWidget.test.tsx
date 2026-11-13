import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { MileageStats } from '@/types/analytics';
import MileageStatsWidget from './MileageStatsWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

interface MileageQuery extends DataStateSource<Partial<MileageStats> | null> {
  refetch: () => void;
}

const { useMileageStatsMock, useVehiclesMock, useUnitsMock } = vi.hoisted(() => ({
  useMileageStatsMock: vi.fn<(vehicleId: string) => MileageQuery>(),
  useVehiclesMock: vi.fn<() => { data: { id: number }[] }>(),
  useUnitsMock: vi.fn<() => { unitPrefs: { distance: 'km' | 'mi' } }>(),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({
  useMileageStats: (vehicleId: string) => useMileageStatsMock(vehicleId),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => useUnitsMock(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        opts?.[name] == null ? '' : String(opts[name]),
      );
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function makeStats(overrides: Partial<MileageStats> = {}): MileageStats {
  return {
    vehicle_id: 1,
    lifetime_km: 0,
    last_7d_km: 0,
    last_30d_km: 0,
    last_365d_km: 0,
    drive_count_lifetime: 0,
    drive_count_30d: 0,
    first_drive_at: null,
    last_drive_at: null,
    ...overrides,
  };
}

function makeQuery(overrides: Partial<MileageQuery> = {}): MileageQuery {
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

function renderWidget(packId: PackId, cols = 2, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <MileageStatsWidget size={{ cols, rows: 2 }} vehicleId={vehicleId} />
      </PackBoundary>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  useUnitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
  useMileageStatsMock.mockReturnValue(makeQuery());
});

afterEach(cleanup);

describe.each(PACK_IDS)('MileageStatsWidget (%s)', packId => {
  async function renderContent(cols = 2, vehicleId?: number) {
    const result = renderWidget(packId, cols, vehicleId);
    expect(result.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    if (packId === 'classic') {
      expect(result.container.querySelector('[data-status-appearance]')).not.toBeInTheDocument();
    } else {
      await waitFor(() => {
        expect(result.container.querySelector('[data-status-appearance]'))
          .toHaveAttribute('data-status-appearance', PACK_APPEARANCES[packId]);
      });
    }
    return result;
  }

  it('matches the After hierarchy with three average values and one milestone meter', async () => {
    useMileageStatsMock.mockReturnValue(makeQuery({
      data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }),
    }));

    const { container } = await renderContent();

    expect(screen.getByRole('heading', { name: 'Mileage stats' })).toBeInTheDocument();
    expect(screen.getByText('Daily avg')).toBeInTheDocument();
    expect(screen.getByText('Weekly avg')).toBeInTheDocument();
    expect(screen.getByText('Monthly avg')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument();
    expect(screen.getByTestId('mileage-milestone')).toBeInTheDocument();
    expect(screen.getByText('45,000 km')).toBeInTheDocument();
    expect(screen.getByText('Next milestone 50,000 km · ~6 mo')).toBeInTheDocument();
    const milestoneTrack = screen.getByRole('progressbar', { name: 'Next milestone' });
    expect(milestoneTrack).toHaveAttribute('aria-valuenow', '50');
    expect(milestoneTrack).toHaveAttribute('data-app-metric', 'bar');
    expect(milestoneTrack).toHaveAttribute('data-metric-track');
    expect(milestoneTrack).toHaveClass('h-2', 'rounded-shape-sm');
    expect(milestoneTrack.querySelector('[data-metric-fill]')).toBe(milestoneTrack.firstElementChild);
    expect(milestoneTrack.firstElementChild).toHaveStyle({ width: '50%' });
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
  });

  it('converts the shared SI payload to the selected distance unit without fabricating values', async () => {
    useUnitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    useMileageStatsMock.mockReturnValue(makeQuery({
      data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }),
    }));

    await renderContent();

    expect(screen.getAllByText('mi')).toHaveLength(3);
    expect(screen.queryByText(/km$/)).not.toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.getByText('130')).toBeInTheDocument();
    expect(screen.getByText('559')).toBeInTheDocument();
    expect(screen.getByText('27,962 mi')).toBeInTheDocument();
    expect(screen.getByText(/30,000 mi/)).toBeInTheDocument();

    cleanup();
    await renderContent(1);
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.getByText('mi/day')).toBeInTheDocument();
  });

  it.each([
    { state: 'unknown', data: {} },
    { state: 'non-finite', data: { lifetime_km: Number.NaN, last_30d_km: Number.POSITIVE_INFINITY } },
  ])('keeps $state readings unknown instead of treating missing values as zero', async ({ data }) => {
    useMileageStatsMock.mockReturnValue(makeQuery({ data }));

    await renderContent();

    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('10,000')).not.toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.queryByTestId('mileage-milestone')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(document.querySelector('[data-metric-track]')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();

    cleanup();
    await renderContent(1);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('km/day')).not.toBeInTheDocument();
  });

  it('preserves measured zeros and does not invent an arrival estimate', async () => {
    useMileageStatsMock.mockReturnValue(makeQuery({ data: makeStats() }));

    await renderContent();

    expect(screen.getAllByText('0')).toHaveLength(3);
    expect(screen.getByText('0 km')).toBeInTheDocument();
    expect(screen.getByText('Next milestone 10,000 km')).toBeInTheDocument();
    const milestoneTrack = screen.getByRole('progressbar', { name: 'Next milestone' });
    expect(milestoneTrack).toHaveAttribute('aria-valuenow', '0');
    expect(milestoneTrack).toHaveAttribute('data-metric-track');
    expect(milestoneTrack.querySelector('[data-metric-fill]')).toHaveStyle({ width: '0%' });
    expect(screen.queryByText(/~\d+ mo/)).not.toBeInTheDocument();

    cleanup();
    await renderContent(1);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('km/day')).toBeInTheDocument();
  });

  it('keeps a known lifetime milestone when averages are missing', async () => {
    useMileageStatsMock.mockReturnValue(makeQuery({ data: { lifetime_km: 45000 } }));

    await renderContent();

    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByText('45,000 km')).toBeInTheDocument();
    expect(screen.getByText('Next milestone 50,000 km')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByText(/~\d+ mo/)).not.toBeInTheDocument();
  });

  it('keeps known averages without inventing a missing lifetime milestone', async () => {
    useMileageStatsMock.mockReturnValue(makeQuery({ data: { last_30d_km: 900 } }));

    await renderContent();

    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument();
    expect(screen.queryByTestId('mileage-milestone')).not.toBeInTheDocument();
  });

  it('advances to the following milestone when the current total equals a milestone', async () => {
    useMileageStatsMock.mockReturnValue(makeQuery({
      data: makeStats({ lifetime_km: 50000, last_30d_km: 900 }),
    }));

    await renderContent();

    expect(screen.getByText('50,000 km')).toBeInTheDocument();
    expect(screen.getByText('Next milestone 60,000 km · ~11 mo')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('uses compact one-column headline and shows an honest empty state', async () => {
    useMileageStatsMock.mockReturnValue(makeQuery({
      data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }),
    }));
    const compact = await renderContent(1);
    expect(compact.container.textContent).toContain('km/day');

    cleanup();
    useMileageStatsMock.mockReturnValue(makeQuery());
    renderWidget(packId, 1);
    expect(screen.getByText('No mileage data')).toBeInTheDocument();
  });

  it('retains cached data and exposes refresh freshness without replacing content on an error', async () => {
    const refetch = vi.fn();
    useMileageStatsMock.mockReturnValue(makeQuery({
      data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }),
      isError: true,
      error: new Error('transient'),
      refetch,
    }));

    const { container } = await renderContent();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument();
    expect(screen.getByTestId('mileage-milestone')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale');
    expect(container.querySelector('[class*="--semantic-danger"].rounded-full')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { state: 'refreshing', isFetching: true, fetchStatus: 'fetching', trust: 'ok', busy: 'true' },
    { state: 'paused', isFetching: false, fetchStatus: 'paused', trust: 'stale', busy: 'false' },
  ] as const)('retains readings while refresh is $state', async ({ isFetching, fetchStatus, trust, busy }) => {
    useMileageStatsMock.mockReturnValue(makeQuery({
      data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }),
      isFetching,
      fetchStatus,
    }));

    const { container } = await renderContent();

    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument();
    expect(screen.getByTestId('mileage-milestone')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', trust);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', busy);
  });

  it('uses the explicit vehicle id and disables the query without a resolved vehicle', () => {
    renderWidget(packId, 2, 7);
    expect(useMileageStatsMock).toHaveBeenCalledWith('7');

    cleanup();
    renderWidget(packId);
    expect(useMileageStatsMock).toHaveBeenLastCalledWith('42');

    cleanup();
    useVehiclesMock.mockReturnValue({ data: [] });
    renderWidget(packId, 2);
    expect(useMileageStatsMock).toHaveBeenCalledWith('');
  });

  it('renders loading, initial error, and empty states', () => {
    useMileageStatsMock.mockReturnValue(makeQuery({ isLoading: true }));
    const loading = renderWidget(packId);
    expect(loading.container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
    expect(loading.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');

    cleanup();
    const refetch = vi.fn();
    useMileageStatsMock.mockReturnValue(makeQuery({ isError: true, error: new Error('boom'), refetch }));
    const failed = renderWidget(packId);
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(failed.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initialFailure');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);

    cleanup();
    useMileageStatsMock.mockReturnValue(makeQuery({ data: null }));
    renderWidget(packId);
    expect(screen.getByText('No mileage data')).toBeInTheDocument();
  });
});
