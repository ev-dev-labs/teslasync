import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { request } from '@/api/client';
import { drivingKeys, useDrives, useDrivingStats, useDriveHistory, useDriveCalendarHistory, useDriveScore, useSpeedProfile } from './useDriving';
import { chargingKeys, useChargingHistory } from './useCharging';
import { useClimateHistory, useMediaHistory, vehicleSystemsKeys } from './useVehicleSystems';
import { useBatteryHealthAnalytics, useEnergyStats, useVampireDrainHistory, useVampireDrainStats } from './useEnergy';
import { useDriveScorePage } from '@/features/driving/hooks/useDriveScorePage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback: string) => fallback ?? key }),
}));
vi.mock('@/components/ui', () => ({
  useSortToggle: () => ({
    sortKey: 'date', sortDir: 'desc', onSort: vi.fn(),
    sortFn: <T,>(rows: T[]) => rows,
  }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 42 }) }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    start: '2024-03-10',
    end: '2024-03-11',
    startInstant: '2024-03-10T15:42:19.125Z',
    endInstantExclusive: '2024-03-11T15:42:19.125Z',
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km' },
    formatDistance: String, formatSpeed: String, formatPower: String,
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtInt: String, fmtNumber: String }),
}));
vi.mock('@/api/client', () => ({ request: vi.fn() }));
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const mockedRequest = vi.mocked(request);
const clients: QueryClient[] = [];

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children),
  };
}

beforeEach(() => { mockedRequest.mockReset(); });
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});

describe('vampire-drain history extraction', () => {
  it('preserves the page keys, raw envelope, request scope and cancellation', async () => {
    const stats = { vehicle_id: 42, event_count: 1 };
    const envelope = { vehicle_id: 42, events: [{ started_at: '2026-01-01T00:00:00Z' }] };
    mockedRequest.mockImplementation(async (path) => path.startsWith('/vampire-drain/stats') ? stats : envelope);
    const context = wrapper();
    const { result } = renderHook(() => ({
      stats: useVampireDrainStats('42', 0),
      events: useVampireDrainHistory('42'),
    }), { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.stats.isSuccess && result.current.events.isSuccess).toBe(true));
    expect(result.current.stats.data).toBe(stats);
    expect(result.current.events.data).toBe(envelope);
    expect(context.client.getQueryData(['vampire-drain-stats', '42'])).toBe(stats);
    expect(context.client.getQueryData(['vampire-drain-events', '42'])).toBe(envelope);
    expect(mockedRequest.mock.calls.map(([path]) => path)).toEqual([
      '/vampire-drain/stats?vehicle_id=42',
      '/vampire-drain?vehicle_id=42&limit=200',
    ]);
    for (const [, options] of mockedRequest.mock.calls) {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('stays disabled without a vehicle and aborts both old requests on a vehicle change', async () => {
    mockedRequest.mockImplementation(() => new Promise(() => {}));
    const context = wrapper();
    const { rerender, unmount } = renderHook((vehicleId: string) => ({
      stats: useVampireDrainStats(vehicleId, 0),
      events: useVampireDrainHistory(vehicleId),
    }), { wrapper: context.wrapper, initialProps: '' });
    expect(mockedRequest).not.toHaveBeenCalled();
    rerender('42');
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
    const oldSignals = mockedRequest.mock.calls.map(([, options]) => options?.signal);
    rerender('43');
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(4));
    expect(oldSignals.every((signal) => signal?.aborted)).toBe(true);
    expect(mockedRequest.mock.calls.slice(2).map(([path]) => path)).toEqual([
      '/vampire-drain/stats?vehicle_id=43',
      '/vampire-drain?vehicle_id=43&limit=200',
    ]);
    unmount();
    expect(mockedRequest.mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true);
  });
});

describe('driving exact-range integration', () => {
  const start = '2024-03-10T15:42:19.125Z';
  const end = '2024-03-11T15:42:19.125Z';

  it('scopes both preconditioning sources and caches by each exact bound while retaining the drive cap', async () => {
    mockedRequest.mockResolvedValue([]);
    const context = wrapper();
    const { result, rerender } = renderHook(
      (window: { start: string; end: string }) => ({
        climate: useClimateHistory('42', window),
        drives: useDriveHistory('42', 2000, window),
      }),
      { wrapper: context.wrapper, initialProps: { start, end } },
    );
    const ranges = [
      { start, end },
      { start: '2024-03-09T00:00:00-08:00', end },
      { start: '2024-03-09T00:00:00-08:00', end: '2024-03-11T00:00:00-07:00' },
    ];
    for (const [index, window] of ranges.entries()) {
      if (index > 0) rerender(window);
      await waitFor(() => expect(result.current.climate.isSuccess && result.current.drives.isSuccess).toBe(true));
      expect(context.client.getQueryData(vehicleSystemsKeys.climateHistory('42', window.start, window.end))).toEqual([]);
      expect(context.client.getQueryData(drivingKeys.history('42', 1000, window))).toEqual([]);
    }
    expect(mockedRequest).toHaveBeenCalledTimes(6);
    mockedRequest.mock.calls.forEach(([path, options], index) => {
      const url = new URL(path, 'http://fixture.test');
      const window = ranges[Math.floor(index / 2)];
      expect(url.pathname).toBe(index % 2 === 0 ? '/climate' : '/drives');
      expect(url.searchParams.get('vehicle_id')).toBe('42');
      expect(url.searchParams.get('start')).toBe(window.start);
      expect(url.searchParams.get('end')).toBe(window.end);
      expect(url.searchParams.get('limit')).toBe(index % 2 === 0 ? null : '1000');
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  it('disables both preconditioning sources without a vehicle and aborts superseded range requests', async () => {
    mockedRequest.mockImplementation(() => new Promise(() => {}));
    const context = wrapper();
    const { rerender, unmount } = renderHook(
      (props: { vehicleId: string; start: string; end: string }) => ({
        climate: useClimateHistory(props.vehicleId, props),
        drives: useDriveHistory(props.vehicleId || undefined, 1000, props),
      }),
      { wrapper: context.wrapper, initialProps: { vehicleId: '', start, end } },
    );
    expect(mockedRequest).not.toHaveBeenCalled();
    rerender({ vehicleId: '42', start, end });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
    const firstSignals = mockedRequest.mock.calls.map(([, options]) => options?.signal);
    rerender({ vehicleId: '42', start, end: '2024-03-12T15:42:19.125Z' });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(4));
    expect(firstSignals.every((signal) => signal?.aborted)).toBe(true);
    unmount();
    expect(mockedRequest.mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true);
  });

  it('scopes battery health requests and cache by both precise bounds without converting raw data', async () => {
    const data = { vehicle_id: 42, current_soh: 91.125, history: [{ capacity_wh: 72500 }] };
    mockedRequest.mockResolvedValue(data);
    const context = wrapper();
    const { result, rerender } = renderHook(
      (range: { start: string; end: string }) => useBatteryHealthAnalytics('42', range),
      { wrapper: context.wrapper, initialProps: { start, end } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const ranges = [
      { start, end },
      { start: '2024-03-09T00:00:00-08:00', end },
      { start: '2024-03-09T00:00:00-08:00', end: '2024-03-11T00:00:00-07:00' },
    ];
    for (const range of ranges.slice(1)) {
      rerender(range);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    }
    expect(mockedRequest).toHaveBeenCalledTimes(3);
    mockedRequest.mock.calls.forEach(([path, options], i) => {
      const url = new URL(path, 'http://fixture.test');
      expect(url.pathname).toBe('/analytics/battery-health');
      expect([...url.searchParams.entries()]).toEqual([
        ['vehicle_id', '42'], ['start', ranges[i].start], ['end', ranges[i].end],
      ]);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(context.client.getQueryData([
        'battery-health-analytics', '42', ranges[i].start, ranges[i].end,
      ])).toBe(data);
    });
  });

  it('disables scoped battery health without a vehicle and cancels superseded range requests', async () => {
    mockedRequest.mockImplementation(() => new Promise(() => {}));
    const context = wrapper();
    const { rerender, unmount } = renderHook(
      (props: { vehicleId: string | null; start: string; end: string }) =>
        useBatteryHealthAnalytics(props.vehicleId, { start: props.start, end: props.end }),
      { wrapper: context.wrapper, initialProps: { vehicleId: null as string | null, start, end } },
    );
    expect(mockedRequest).not.toHaveBeenCalled();
    rerender({ vehicleId: '42', start, end });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    const firstSignal = mockedRequest.mock.calls[0][1]?.signal;
    rerender({ vehicleId: '42', start, end: '2024-03-12T15:42:19.125Z' });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);
    unmount();
    expect(mockedRequest.mock.calls[1][1]?.signal?.aborted).toBe(true);
  });

  it('isolates media history by both exact bounds and preserves non-UTC custom instants', async () => {
    mockedRequest.mockResolvedValue([]);
    const context = wrapper();
    const { result, rerender } = renderHook(
      (range: { start: string; end: string }) => useMediaHistory('42', range),
      { wrapper: context.wrapper, initialProps: { start, end } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const customStart = '2024-03-09T00:00:00-08:00';
    rerender({ start: customStart, end });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
    const customEnd = '2024-03-11T00:00:00-07:00';
    rerender({ start: customStart, end: customEnd });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const ranges = [
      { start, end }, { start: customStart, end }, { start: customStart, end: customEnd },
    ];
    mockedRequest.mock.calls.forEach(([path, options], index) => {
      const url = new URL(path, 'http://fixture.test');
      expect(url.pathname).toBe('/media');
      expect([...url.searchParams.entries()]).toEqual([
        ['vehicle_id', '42'], ['start', ranges[index].start], ['end', ranges[index].end],
      ]);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(context.client.getQueryData(vehicleSystemsKeys.mediaHistory(
        '42', ranges[index].start, ranges[index].end,
      ))).toEqual([]);
    });
  });

  it.each([
    ['invalid', end], [start, 'invalid'], ['2024-02-30', end], [end, start],
  ])('rejects invalid drive-evidence bounds %s / %s without requesting unscoped history', async (lower, upper) => {
    const context = wrapper();
    const { result } = renderHook(() => useDriveCalendarHistory('42', lower, upper), {
      wrapper: context.wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Drive calendar requires a valid start and end date range');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('preserves both exact drive-evidence options and an authoritative empty response', async () => {
    mockedRequest.mockResolvedValue([]);
    const context = wrapper();
    const { result } = renderHook(() => useDriveCalendarHistory('42', start, end), {
      wrapper: context.wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [path, options] = mockedRequest.mock.calls[0];
    const url = new URL(path, 'http://fixture.test');
    expect(url.pathname).toBe('/drives');
    expect([...url.searchParams.entries()]).toEqual([
      ['vehicle_id', '42'], ['start', start], ['end', end], ['limit', '1000'], ['offset', '0'],
    ]);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(result.current.data).toEqual([]);
    expect(context.client.getQueryData(drivingKeys.calendar('42', start, end))).toEqual([]);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it('preserves profile exact exclusive bounds, raw payload, cache isolation and cancellation', async () => {
    const data = { distribution: [], avg_speed_mps: 12.5 };
    mockedRequest.mockResolvedValue(data);
    const context = wrapper();
    const { result, rerender } = renderHook(
      (window: { start: string; end: string }) => useSpeedProfile('42', window.start, window.end),
      { wrapper: context.wrapper, initialProps: { start, end } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(data);
    const nextEnd = '2024-03-12T07:00:00.000Z';
    rerender({ start, end: nextEnd });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
    mockedRequest.mock.calls.forEach(([path, options], index) => {
      const url = new URL(path, 'http://fixture.test');
      expect(url.pathname).toBe('/analytics/speed-profile');
      expect([...url.searchParams.entries()]).toEqual([
        ['vehicle_id', '42'], ['start', start], ['end', index === 0 ? end : nextEnd],
      ]);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    });
    expect(context.client.getQueryData(['speed-profile', '42', start, end])).toBe(data);
  });

  it.each([
    ['invalid', end], [start, 'invalid'], ['2024-02-30', end], ['2024', end],
    [start, undefined], [undefined, end], [end, start],
  ])('rejects invalid or one-sided profile bounds %s / %s instead of fetching full history', async (lower, upper) => {
    const context = wrapper();
    const { result } = renderHook(() => useSpeedProfile('42', lower, upper), { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Speed profile requires a valid start and end date range');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('retains full-history profile queries when both dates are missing and disables missing vehicles', async () => {
    mockedRequest.mockResolvedValue({ distribution: [] });
    const context = wrapper();
    const { result, rerender } = renderHook((vehicleId?: string) => useSpeedProfile(vehicleId), {
      wrapper: context.wrapper, initialProps: undefined as string | undefined,
    });
    expect(mockedRequest).not.toHaveBeenCalled();
    rerender('42');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe('/analytics/speed-profile?vehicle_id=42');
  });

  it.each([
    { start: '2026-10-13T20:15:39.843Z', end: '2026-10-14T20:15:39.843Z' },
    { start: '2024-03-09T08:00:00.000Z', end: '2024-03-11T07:00:00.000Z' },
  ])('preserves Explorer exact bounds $start to $end and the observed-row cap', async (window) => {
    const rows = [{ id: 1 }, { id: 2 }];
    mockedRequest.mockResolvedValue(rows);
    const context = wrapper();
    const { result } = renderHook(() => useDriveHistory('42', 1000, window), {
      wrapper: context.wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [path, options] = mockedRequest.mock.calls[0];
    const url = new URL(path, 'http://fixture.test');
    expect(url.pathname).toBe('/drives');
    expect([...url.searchParams.entries()]).toEqual([
      ['vehicle_id', '42'], ['limit', '1000'], ['start', window.start], ['end', window.end],
    ]);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(drivingKeys.history('42', 1000, window)).toEqual([
      'drives', '42', 'history', 1000, window.start, window.end,
    ]);
    expect(context.client.getQueryData(drivingKeys.history('42', 1000, window))).toEqual(rows);
  });

  it('scopes analytical drive and charging requests and caches by each header instant', async () => {
    let id = 1;
    mockedRequest.mockImplementation(async () => [{ id: id++ }]);
    const context = wrapper();
    const { result, rerender } = renderHook(
      (window: { start: string; end: string }) => ({
        drives: useDriveHistory('42', 1000, window),
        charging: useChargingHistory('42', 1000, window),
      }),
      { wrapper: context.wrapper, initialProps: { start, end } },
    );
    await waitFor(() => expect(result.current.drives.isSuccess && result.current.charging.isSuccess).toBe(true));
    const originalDrives = result.current.drives.data;
    const originalCharging = result.current.charging.data;
    const laterStart = '2024-03-10T20:00:00.000Z';
    rerender({ start: laterStart, end });
    await waitFor(() => expect(result.current.drives.data?.[0].id).toBe(3));
    await waitFor(() => expect(result.current.charging.data?.[0].id).toBe(4));
    const earlierEnd = '2024-03-11T10:00:00.000Z';
    rerender({ start: laterStart, end: earlierEnd });
    await waitFor(() => expect(result.current.drives.data?.[0].id).toBe(5));
    await waitFor(() => expect(result.current.charging.data?.[0].id).toBe(6));
    expect(context.client.getQueryData(drivingKeys.history('42', 1000, { start, end }))).toEqual(originalDrives);
    expect(context.client.getQueryData(chargingKeys.history('42', 1000, { start, end }))).toEqual(originalCharging);
    expect(mockedRequest).toHaveBeenCalledTimes(6);
    mockedRequest.mock.calls.forEach(([path, options], index) => {
      const params = new URL(path, 'http://fixture.test').searchParams;
      expect(params.get('vehicle_id')).toBe('42');
      expect(params.get('limit')).toBe('1000');
      expect(params.get('start')).toBe(index < 2 ? start : laterStart);
      expect(params.get('end')).toBe(index < 4 ? end : earlierEnd);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  it('scores page history using canonical half-open instants and qualifies server score independently', async () => {
    const drive = { distanceM: 10000, energyUsedWh: 1500, avgPowerW: 3000, maxSpeedMps: 20 };
    const rows = [
      { ...drive, id: 1, startTs: '2024-03-10T15:42:19.124Z' },
      { ...drive, id: 2, startTs: start },
      { ...drive, id: 3, startTs: '2024-03-11T15:42:19.124Z' },
      { ...drive, id: 4, startTs: end },
    ];
    const score = { overall: 87, grade: 'A', efficiency: 35, smoothness: 25, speedDiscipline: 27 };
    mockedRequest.mockImplementation(async (path) =>
      path.startsWith('/drives/score') ? score : rows,
    );
    const context = wrapper();
    const { result } = renderHook(useDriveScorePage, { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.drivesQuery.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.scoreQuery.isSuccess).toBe(true));
    expect(result.current.filteredDrives.map((row) => row.id)).toEqual([2, 3]);
    expect(result.current.scoredDrives).toHaveLength(2);
    expect(result.current.hasDrives).toBe(true);
    expect(result.current.overallReading).toBe(87);
    expect(result.current.apiScore).toBe(score);
    expect(result.current.apiScoreCoverage).toEqual({ scope: 'all-completed-drives' });
    expect(result.current.driveHistoryCoverage).toEqual({ scope: 'selected-range', start, end });
    const path = mockedRequest.mock.calls.find(([url]) => url.startsWith('/drives?'))![0];
    const params = new URL(path, 'http://fixture.test').searchParams;
    expect(params.get('start')).toBe(start);
    expect(params.get('end')).toBe(end);
  });

  it('loads complete exact-range score history beyond one page while retaining the independent server score', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, id) => ({ id, startTs: start }));
    const lastPage = [{ id: 1000, startTs: start }];
    const score = { overall: 87, grade: 'A', totalDrives: 2500 };
    mockedRequest.mockImplementation(async (path) => {
      const url = new URL(path, 'http://fixture.test');
      if (url.pathname === '/drives/score') return score;
      return url.searchParams.get('offset') === '0' ? firstPage : lastPage;
    });
    const context = wrapper();
    const { result } = renderHook(() => ({
      history: useDriveCalendarHistory('42', start, end),
      score: useDriveScore('42'),
    }), { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.history.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.score.isSuccess).toBe(true));
    expect(result.current.history.data).toEqual([...firstPage, ...lastPage]);
    expect(result.current.score.data).toBe(score);
    const historyCalls = mockedRequest.mock.calls.filter(([path]) => path.startsWith('/drives?'));
    expect(historyCalls).toHaveLength(2);
    historyCalls.forEach(([path, options], page) => {
      const params = new URL(path, 'http://fixture.test').searchParams;
      expect(params.get('vehicle_id')).toBe('42');
      expect(params.get('start')).toBe(start);
      expect(params.get('end')).toBe(end);
      expect(params.get('limit')).toBe('1000');
      expect(params.get('offset')).toBe(String(page * 1000));
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    });
    expect(mockedRequest.mock.calls.find(([path]) => path.startsWith('/drives/score'))?.[0])
      .toBe('/drives/score?vehicle_id=42');
  });

  it('isolates complete history by both bounds without rescoping the all-completed-drive score', async () => {
    let id = 1;
    mockedRequest.mockImplementation(async (path) =>
      path.startsWith('/drives/score') ? { overall: 87 } : [{ id: id++ }],
    );
    const context = wrapper();
    const { result, rerender } = renderHook(
      (window: { start: string; end: string }) => ({
        history: useDriveCalendarHistory('42', window.start, window.end),
        score: useDriveScore('42'),
      }),
      { wrapper: context.wrapper, initialProps: { start, end } },
    );
    await waitFor(() => expect(result.current.history.data).toEqual([{ id: 1 }]));
    const laterStart = '2024-03-10T20:00:00.000Z';
    rerender({ start: laterStart, end });
    await waitFor(() => expect(result.current.history.data).toEqual([{ id: 2 }]));
    const earlierEnd = '2024-03-11T10:00:00.000Z';
    rerender({ start: laterStart, end: earlierEnd });
    await waitFor(() => expect(result.current.history.data).toEqual([{ id: 3 }]));
    expect(context.client.getQueryData(drivingKeys.calendar('42', start, end))).toEqual([{ id: 1 }]);
    expect(mockedRequest.mock.calls.filter(([path]) => path.startsWith('/drives/score'))).toHaveLength(1);
    const params = new URL(mockedRequest.mock.calls.at(-1)![0], 'http://fixture.test').searchParams;
    expect(params.get('start')).toBe(laterStart);
    expect(params.get('end')).toBe(earlierEnd);
  });

  it('sends both exact bounds and vehicle to the list and whole-range stats without a cap change', async () => {
    const stats = { totalDrives: 125, totalDistanceKm: 8765, regenEnergyWh: null };
    mockedRequest.mockResolvedValueOnce([]).mockResolvedValueOnce(stats);
    const context = wrapper();
    const { result } = renderHook(() => ({
      drives: useDrives('42', { start, end }),
      stats: useDrivingStats('42', { start, end }),
    }), { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.stats.isSuccess).toBe(true));
    expect(result.current.drives.data).toEqual([]);
    expect(result.current.stats.data).toBe(stats);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    for (const [path, options] of mockedRequest.mock.calls) {
      const url = new URL(path, 'http://fixture.test');
      expect(['/drives', '/drives/stats']).toContain(url.pathname);
      expect([...url.searchParams.keys()]).toEqual(['vehicle_id', 'start', 'end']);
      expect(url.searchParams.get('vehicle_id')).toBe('42');
      expect(url.searchParams.get('start')).toBe(start);
      expect(url.searchParams.get('end')).toBe(end);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(context.client.getQueryState(drivingKeys.stats('42', { start, end }))?.data).toBe(stats);
  });

  describe.each([
    {
      name: 'drive',
      useHistory: () => useDriveHistory('42'),
      key: drivingKeys.history('42'),
      populated: [{ id: 7, startSocPct: null }, null, { id: 8, startSocPct: 80 }],
      empty: [],
      invalid: [null, {}, { rows: [] }, 'unavailable'],
    },
    {
      name: 'charging',
      useHistory: () => useChargingHistory('42'),
      key: ['charging-sessions', 'history', '42', 1000],
      populated: [{ id: 7, startSocPct: null }, null, { id: 8, startSocPct: 20 }],
      empty: [],
      invalid: [null, {}, { rows: [] }, 'unavailable'],
    },
    {
      name: 'energy',
      useHistory: () => useEnergyStats('42'),
      key: ['energy-stats', '42', 'days:30'],
      populated: { total_wh: 12000, daily_breakdown: [{ date: '2026-01-01', energy_wh: 12000 }, null] },
      empty: { total_wh: 0, daily_breakdown: [] },
      invalid: [null, [], {}, { daily_breakdown: null }, { daily_breakdown: {} }],
    },
  ])('$name analytical history shape', ({ useHistory, key, populated, empty, invalid }) => {
    it.each(invalid.map((payload, index) => ({ payload, index })))(
      'retains populated cache and reports a failed refresh for malformed shape $index',
      async ({ payload }) => {
        mockedRequest.mockResolvedValueOnce(populated).mockResolvedValueOnce(payload);
        const context = wrapper();
        const { result } = renderHook(useHistory, { wrapper: context.wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(populated);
        await result.current.refetch();
        await waitFor(() => expect(result.current.isRefetchError).toBe(true));
        expect(result.current.error?.message).toContain('Invalid');
        expect(result.current.data).toEqual(populated);
        expect(context.client.getQueryData(key)).toEqual(populated);
      },
    );

    it('accepts a legitimate empty history and preserves every returned row before qualification', async () => {
      mockedRequest.mockResolvedValueOnce(populated).mockResolvedValueOnce(empty);
      const context = wrapper();
      const { result } = renderHook(useHistory, { wrapper: context.wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(populated);
      await result.current.refetch();
      await waitFor(() => expect(result.current.data).toEqual(empty));
      expect(result.current.isSuccess).toBe(true);
      expect(context.client.getQueryData(key)).toEqual(empty);
    });

    it('reports an initial shape failure without inventing empty data', async () => {
      mockedRequest.mockResolvedValueOnce(null);
      const context = wrapper();
      const { result } = renderHook(useHistory, { wrapper: context.wrapper });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.data).toBeUndefined();
      expect(context.client.getQueryData(key)).toBeUndefined();
    });
  });

  it('refetches and isolates stats cache entries when either bound changes', async () => {
    mockedRequest.mockResolvedValueOnce({ totalDrives: 125 })
      .mockResolvedValueOnce({ totalDrives: 50 }).mockResolvedValueOnce({ totalDrives: 7 });
    const context = wrapper();
    const { result, rerender } = renderHook(
      (window: { start: string; end: string }) => useDrivingStats('42', window),
      { wrapper: context.wrapper, initialProps: { start, end } },
    );
    await waitFor(() => expect(result.current.data?.totalDrives).toBe(125));
    const laterStart = '2024-03-10T20:00:00.000Z';
    rerender({ start: laterStart, end });
    await waitFor(() => expect(result.current.data?.totalDrives).toBe(50));
    const earlierEnd = '2024-03-11T10:00:00.000Z';
    rerender({ start: laterStart, end: earlierEnd });
    await waitFor(() => expect(result.current.data?.totalDrives).toBe(7));
    expect(mockedRequest).toHaveBeenCalledTimes(3);
    expect(context.client.getQueryData(drivingKeys.stats('42', { start, end }))).toEqual({ totalDrives: 125 });
    expect(new URL(mockedRequest.mock.calls[2][0], 'http://fixture.test').searchParams.get('end')).toBe(earlierEnd);
  });

  it('preserves unbounded keys URLs retry policy and missing-vehicle enablement', async () => {
    expect(drivingKeys.stats('42')).toEqual(['driving-stats', '42']);
    expect(drivingKeys.stats('42', {})).toEqual(['driving-stats', '42']);
    const boom = new Error('stats unavailable');
    mockedRequest.mockRejectedValueOnce(boom);
    const context = wrapper();
    const { result } = renderHook(() => useDrivingStats('42'), { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(boom);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest.mock.calls[0][0]).toBe('/drives/stats?vehicle_id=42');
    mockedRequest.mockReset();
    const disabled = renderHook(() => useDrivingStats(undefined, { start, end }), { wrapper: context.wrapper });
    expect(disabled.result.current.fetchStatus).toBe('idle');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'lower only', window: { start }, expected: ['driving-stats', '42', start, null] },
    { name: 'upper only', window: { end }, expected: ['driving-stats', '42', null, end] },
  ])('supports an optional $name bound without inventing its other side', async ({ window, expected }) => {
    expect(drivingKeys.stats('42', window)).toEqual(expected);
    mockedRequest.mockResolvedValueOnce({ totalDrives: 0 });
    const context = wrapper();
    const { result } = renderHook(() => useDrivingStats('42', window), { wrapper: context.wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const params = new URL(mockedRequest.mock.calls[0][0], 'http://fixture.test').searchParams;
    expect(params.has('start')).toBe('start' in window);
    expect(params.has('end')).toBe('end' in window);
  });
});
