/**
 * ActivityTimelinePage contract tests.
 *
 * Covers:
 *   1. No-vehicle-in-fleet gate — renders `<NoVehicleSelected>` instead of
 *      the feed when the fleet is empty.
 *   2. Loading — the feed shell renders a skeleton, not the empty/error
 *      states.
 *   3. Loaded — grouped items render via the feed, and the query is called
 *      with the inherited vehicle id + range instants.
 *   4. Empty — the feed's empty state renders when `items` is `[]`.
 *   5. Error — the feed's error state renders and Retry re-issues the
 *      query.
 *   6. Kind filter — toggling a chip re-issues the query with `kind` set.
 *   7. Pagination — the Older/Newer controls appear only when there is a
 *      next/previous page and step `offset` by the page size.
 *   8. The compact service-history limitation renders regardless of load
 *      state without displacing the activity feed.
 *
 * Heavy visual dependencies (VehicleSelect/RangePicker, the feed's day
 * grouping) are exercised through minimal mocks so this file asserts
 * page-level wiring, not the already-covered ActivityFeed/KindFilterBar
 * internals.
 */

import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityItem } from '@/types/activity';
import { Button } from '@/components/ui';
import { deriveDataState } from '@/api/dataState';
import { useRangeState } from '@/hooks/useRangeState';
import { calendarRangeToInstants } from '@/lib/dateRange';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  vehicles: [{ id: 7 }] as Array<{ id: number }>,
  fleetResolved: true,
  fleetError: null as unknown,
  fleetFetching: false,
  fleetFetchStatus: 'idle' as 'fetching' | 'paused' | 'idle',
  retryFleet: vi.fn(),
  useActivityMock: vi.fn(),
  rangeMock: vi.fn(),
  useActualRange: false,
  refetch: vi.fn(),
  setRange: vi.fn(),
  asOf: null as string | null,
  downloadCsv: vi.fn(),
  downloadJson: vi.fn(),
  range: {
    start: '2026-01-01',
    end: '2026-01-31',
    startInstant: '2026-01-01T00:00:00.000Z',
    endInstantExclusive: '2026-02-01T00:00:00.000Z',
    timezone: 'UTC',
  },
}));

vi.mock('@/lib/csvExport', () => ({
  downloadRowsAsCSV: (...args: unknown[]) => h.downloadCsv(...args),
  downloadJSON: (...args: unknown[]) => h.downloadJson(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, options?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
            options?.[key] == null ? match : String(options[key]))
        : _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: { locale: 'en-US', decimal_precision: 2, currency_symbol: '$' }, settingsUnavailable: false }),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicles: h.vehicles,
    vehiclesState: deriveDataState({
      data: h.fleetResolved ? h.vehicles : undefined,
      error: h.fleetError,
      isFetching: h.fleetFetching,
      fetchStatus: h.fleetFetchStatus,
      refetch: h.retryFleet,
    }, { unavailable: h.fleetResolved && h.vehicles.length === 0 }),
  }),
}));

vi.mock('@/lib/timezone', () => ({
  useTimezone: () => 'America/Los_Angeles',
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km', speed: 'km/h', temperature: 'C', pressure: 'bar', energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US' },
    formatDuration: (value: number) => `${(value / 3600).toFixed(1)} h`,
    formatEnergy: (value: number) => `${(value / 1000).toFixed(1)} kWh`,
  }),
}));

vi.mock('@/hooks/useRangeState', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useRangeState')>();
  return {
    ...actual,
    useRangeState: (options?: Parameters<typeof actual.useRangeState>[0]) =>
      h.useActualRange ? actual.useRangeState(options) : h.rangeMock(options),
  };
});

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => ({
    mode: h.asOf ? 'as_of' : 'live',
    asOf: h.asOf,
    online: true,
    isReadOnly: h.asOf != null,
    canWrite: h.asOf == null,
    label: h.asOf ? 'As of' : 'Live',
    description: '',
    writeBlockReason: h.asOf ? 'Return to live mode.' : null,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
  RangePicker: () => <div data-testid="range-picker" />,
  ListExportMenu: ({ disabled, onExportCsv, onExportJson }: {
    disabled: boolean;
    onExportCsv: () => void;
    onExportJson: () => void;
  }) => (
    <div>
      <Button type="button" data-testid="activity-export-trigger" disabled={disabled}>Export</Button>
      <Button type="button" data-testid="activity-export-csv" disabled={disabled} onClick={onExportCsv}>CSV</Button>
      <Button type="button" data-testid="activity-export-json" disabled={disabled} onClick={onExportJson}>JSON</Button>
    </div>
  ),
}));

vi.mock('@/api/hooks/useActivity', () => ({
  useActivity: (params: unknown) => h.useActivityMock(params),
}));

vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => (
    <div data-testid="no-vehicle-selected">{pageTitle}</div>
  ),
}));

import ActivityTimelinePage from './ActivityTimelinePage';

function makeItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'drives:1',
    kind: 'drive',
    occurred_at: '2026-01-15T12:00:00Z',
    vehicle_id: 7,
    title: 'Drive',
    summary: '12 min',
    status: 'completed',
    source_table: 'drives',
    source_id: 1,
    path: '/drives/1',
    ...overrides,
  };
}

function mockQueryResult(overrides: Partial<ReturnType<typeof baseQueryResult>> = {}) {
  return { ...baseQueryResult(), ...overrides };
}

function baseQueryResult() {
  return {
    data: { items: [] as ActivityItem[], total: 0, limit: 50, offset: 0, generated_at: '' },
    isLoading: false,
    isPending: false,
    isFetching: false,
    fetchStatus: 'idle' as 'fetching' | 'paused' | 'idle',
    isError: false,
    error: null as unknown,
    refetch: h.refetch,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ActivityTimelinePage />
    </MemoryRouter>,
  );
}

// The overview region hosts two untagged briefs (range/page counts first,
// event-type mix second); scope disclosure assertions to each in order.
function overviewBriefs(): HTMLElement[] {
  const overview = screen.getByRole('region', { name: 'Activity overview' });
  const briefs = [...overview.querySelectorAll<HTMLElement>('[data-operational-brief]')];
  expect(briefs).toHaveLength(2);
  return briefs;
}

function SharedRangeProbe() {
  const range = useRangeState({ enableCompare: true });
  return (
    <>
      <output data-testid="shared-range-authority">{JSON.stringify({
        start: range.start,
        end: range.end,
        startInstant: range.startInstant,
        endInstantExclusive: range.endInstantExclusive,
        timezone: range.timezone,
      })}</output>
      <Button type="button" onClick={() => range.setRange({ start: '2026-11-01', end: '2026-11-01' }, 'custom')}>
        Apply shared custom window
      </Button>
    </>
  );
}

beforeEach(() => {
  h.vehicleId = 7;
  h.vehicles = [{ id: 7 }];
  h.fleetResolved = true;
  h.fleetError = null;
  h.fleetFetching = false;
  h.fleetFetchStatus = 'idle';
  h.retryFleet.mockReset();
  h.refetch.mockReset();
  h.setRange.mockReset();
  h.rangeMock.mockReset();
  h.rangeMock.mockImplementation(() => ({ ...h.range, setRange: h.setRange }));
  h.useActualRange = false;
  h.useActivityMock.mockReset();
  h.asOf = null;
  h.downloadCsv.mockReset();
  h.downloadJson.mockReset();
  h.range = {
    start: '2026-01-01',
    end: '2026-01-31',
    startInstant: '2026-01-01T00:00:00.000Z',
    endInstantExclusive: '2026-02-01T00:00:00.000Z',
    timezone: 'UTC',
  };
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  h.useActivityMock.mockReturnValue(mockQueryResult());
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('teslasync.date-range.v2');
  localStorage.removeItem('activity.timeline.range');
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

describe('ActivityTimelinePage preferences', () => {
  it('uses the shared effective calendar timezone for feed grouping, page-day counts and export bounds', () => {
    h.range = {
      start: '2026-03-08',
      end: '2026-03-08',
      ...calendarRangeToInstants({
        startDate: '2026-03-08',
        endDate: '2026-03-08',
        timezone: 'America/New_York',
      }),
      timezone: 'America/New_York',
    };
    const items = [
      makeItem({ occurred_at: '2026-03-08T05:30:00Z' }),
      makeItem({ id: 'drives:2', source_id: 2, occurred_at: '2026-03-08T08:30:00Z' }),
    ];
    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: { items, total: 2, limit: 50, offset: 0, generated_at: '' },
    }));
    renderPage();
    expect(h.rangeMock).toHaveBeenCalledWith({ persistKey: 'activity.timeline.range' });
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({
      start: '2026-03-08T05:00:00.000Z',
      end: '2026-03-09T04:00:00.000Z',
    }));
    // Both events are Sunday in the shared zone, but straddle Saturday/Sunday in the vehicle zone.
    expect(screen.getByRole('heading', { level: 3, name: /Mar 8, 2026/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: /Mar 7, 2026/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Activity overview' })).toHaveTextContent('Days on this page1');
    fireEvent.click(screen.getByTestId('activity-export-json'));
    expect(h.downloadJson).toHaveBeenCalledWith(
      'activity-2026-03-08T05-00-00.000Z-2026-03-09T04-00-00.000Z-page-1', items,
    );
    expect(screen.queryByTestId('range-picker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
  });

  it('re-buckets events in a changed shared timezone without replacing the exact rolling instants', () => {
    h.range.startInstant = '2026-01-15T12:34:00.000Z';
    h.range.endInstantExclusive = '2026-01-16T12:34:00.000Z';
    const items = [
      makeItem({ occurred_at: '2026-01-15T23:30:00Z' }),
      makeItem({ id: 'drives:2', source_id: 2, occurred_at: '2026-01-16T00:30:00Z' }),
    ];
    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: { items, total: 75, limit: 50, offset: 0, generated_at: '' },
    }));
    const view = renderPage();
    expect(screen.getByRole('heading', { level: 3, name: /Jan 15, 2026/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /Jan 16, 2026/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^older$/i }));
    h.range.timezone = 'America/Los_Angeles';
    view.rerender(<MemoryRouter><ActivityTimelinePage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 3, name: /Jan 15, 2026/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: /Jan 16, 2026/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Activity overview' })).toHaveTextContent('Days on this page1');
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({
      start: '2026-01-15T12:34:00.000Z',
      end: '2026-01-16T12:34:00.000Z',
      offset: 0,
    }));
    fireEvent.click(screen.getByTestId('activity-export-json'));
    expect(h.downloadJson).toHaveBeenCalledWith(
      'activity-2026-01-15T12-34-00.000Z-2026-01-16T12-34-00.000Z-page-1', items,
    );
  });

  it('reactively localizes page ordinals without changing numeric query scope or precision', () => {
    h.useActivityMock.mockImplementation(({ offset }: { offset: number }) =>
      mockQueryResult({
        data: { items: [makeItem(), makeItem({ id: 'drives:2', source_id: 2 })], total: 12345, limit: 50, offset, generated_at: '' },
      }),
    );
    renderPage();
    for (let page = 0; page < 20; page++) {
      fireEvent.click(screen.getByRole('button', { name: /^older$/i }));
    }
    expect(screen.getByText('Showing 1,001–1,002 of 12,345 events in the selected range')).toBeInTheDocument();

    act(() => {
      setGlobalLocale('de-DE');
      setGlobalPrecision(4);
    });
    expect(screen.getByText('Showing 1.001–1.002 of 12.345 events in the selected range')).toBeInTheDocument();
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({
      vehicle_id: 7,
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-02-01T00:00:00.000Z',
      offset: 1000,
      limit: 50,
    }));
    expect(h.refetch).not.toHaveBeenCalled();
  });

  it('localizes legitimate zero ordinals while keeping empty export disabled', () => {
    setGlobalLocale('ar-EG');
    renderPage();
    expect(screen.getByText('Showing ٠–٠ of ٠ events in the selected range')).toBeInTheDocument();
    expect(screen.getByTestId('activity-export-trigger')).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Filter by activity kind' })).toBeInTheDocument();
  });

  it.each([
    {
      label: 'shifted historical',
      asOf: '2025-12-15T12:00:00.000Z',
      start: '2025-11-14T12:00:00.000Z',
      end: '2025-12-15T12:00:00.000Z',
    },
    {
      label: 'capped historical',
      asOf: '2026-01-15T12:00:00.000Z',
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-15T12:00:00.000Z',
    },
  ])('identifies the $label export by the effective queried instants', ({ asOf, start, end }) => {
    h.asOf = asOf;
    const item = makeItem();
    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: { items: [item], total: 75, limit: 50, offset: 0, generated_at: '' },
    }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^older$/i }));
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({ start, end, offset: 50 }));
    const name = `activity-${start.replace(/:/g, '-')}-${end.replace(/:/g, '-')}-page-2`;
    fireEvent.click(screen.getByTestId('activity-export-csv'));
    fireEvent.click(screen.getByTestId('activity-export-json'));
    expect(h.downloadCsv).toHaveBeenCalledWith(name, [item], [
      ...['occurred_at', 'kind', 'vehicle_id', 'title', 'summary', 'severity', 'status', 'source_table', 'source_id', 'duration_s', 'energy_added_wh', 'path']
        .map(key => expect.objectContaining({ key })),
    ]);
    expect(h.downloadJson).toHaveBeenCalledWith(name, [item]);
    expect(name).not.toContain(':');
    expect(screen.getByText(/exports include only the loaded page/i)).toBeInTheDocument();
    expect(screen.getByText(/dated service records will join this timeline/i)).toBeInTheDocument();
  });

  it('keeps elapsed windows with identical calendar labels distinct in export names', () => {
    const item = makeItem();
    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: { items: [item], total: 1, limit: 50, offset: 0, generated_at: '' },
    }));
    h.range.startInstant = '2026-01-15T12:34:00.000Z';
    h.range.endInstantExclusive = '2026-01-16T12:34:00.000Z';
    const view = renderPage();
    fireEvent.click(screen.getByTestId('activity-export-json'));
    expect(h.downloadJson).toHaveBeenLastCalledWith(
      'activity-2026-01-15T12-34-00.000Z-2026-01-16T12-34-00.000Z-page-1', [item],
    );
    h.range.startInstant = '2026-01-15T12:35:00.000Z';
    h.range.endInstantExclusive = '2026-01-16T12:35:00.000Z';
    view.rerender(<MemoryRouter><ActivityTimelinePage /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('activity-export-json'));
    expect(h.downloadJson).toHaveBeenLastCalledWith(
      'activity-2026-01-15T12-35-00.000Z-2026-01-16T12-35-00.000Z-page-1', [item],
    );
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({
      start: h.range.startInstant, end: h.range.endInstantExclusive,
    }));
  });
});

describe('ActivityTimelinePage actual shared range authority', () => {
  it.each([
    {
      label: 'spring DST',
      timezone: 'America/New_York',
      start: '2026-03-08',
      end: '2026-03-08',
      startInstant: '2026-03-08T05:00:00.000Z',
      endInstantExclusive: '2026-03-09T04:00:00.000Z',
    },
    {
      label: 'fall DST',
      timezone: 'America/New_York',
      start: '2026-11-01',
      end: '2026-11-01',
      startInstant: '2026-11-01T04:00:00.000Z',
      endInstantExclusive: '2026-11-02T05:00:00.000Z',
    },
    {
      label: 'custom non-hour offset',
      timezone: 'Asia/Kathmandu',
      start: '2026-01-01',
      end: '2026-01-02',
      startInstant: '2025-12-31T18:15:00.000Z',
      endInstantExclusive: '2026-01-02T18:15:00.000Z',
    },
    {
      label: 'UTC fallback',
      timezone: '',
      start: '2026-01-01',
      end: '2026-01-01',
      startInstant: '2026-01-01T00:00:00.000Z',
      endInstantExclusive: '2026-01-02T00:00:00.000Z',
    },
  ])('uses the same $label half-open instants as the header range hook, not the vehicle timezone', scope => {
    h.useActualRange = true;
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...resolvedOptions.call(this), timeZone: scope.timezone };
    });
    const item = makeItem({ occurred_at: scope.startInstant });
    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: { items: [item], total: 1, limit: 50, offset: 0, generated_at: '' },
    }));
    render(
      <MemoryRouter initialEntries={[`/activity?from=${scope.start}&to=${scope.end}&time_scope=custom`]}>
        <SharedRangeProbe />
        <ActivityTimelinePage />
      </MemoryRouter>,
    );
    expect(JSON.parse(screen.getByTestId('shared-range-authority').textContent ?? '{}')).toEqual({
      start: scope.start,
      end: scope.end,
      startInstant: scope.startInstant,
      endInstantExclusive: scope.endInstantExclusive,
      timezone: scope.timezone || 'UTC',
    });
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({
      start: scope.startInstant,
      end: scope.endInstantExclusive,
      vehicle_id: 7,
    }));
    fireEvent.click(screen.getByTestId('activity-export-json'));
    expect(h.downloadJson).toHaveBeenCalledWith(
      `activity-${scope.startInstant.replace(/:/g, '-')}-${scope.endInstantExclusive.replace(/:/g, '-')}-page-1`, [item],
    );
    expect(screen.queryByTestId('range-picker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
  });

  it('inherits a committed shared custom range and resets paging while ignoring the old page-specific preference', () => {
    h.useActualRange = true;
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...resolvedOptions.call(this), timeZone: 'America/New_York' };
    });
    localStorage.setItem('activity.timeline.range', JSON.stringify({
      version: 2, start: '2024-01-01', end: '2024-12-31',
    }));
    localStorage.setItem('teslasync.date-range.v2', JSON.stringify({
      version: 2, start: '2026-03-08', end: '2026-03-08',
    }));
    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: { items: [makeItem()], total: 75, limit: 50, offset: 0, generated_at: '' },
    }));
    render(
      <MemoryRouter initialEntries={['/activity']}>
        <SharedRangeProbe />
        <ActivityTimelinePage />
      </MemoryRouter>,
    );
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({
      start: '2026-03-08T05:00:00.000Z',
      end: '2026-03-09T04:00:00.000Z',
    }));
    fireEvent.click(screen.getByRole('button', { name: /^older$/i }));
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply shared custom window' }));
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({
      start: '2026-11-01T04:00:00.000Z',
      end: '2026-11-02T05:00:00.000Z',
      offset: 0,
    }));
    expect(JSON.parse(screen.getByTestId('shared-range-authority').textContent ?? '{}')).toEqual(expect.objectContaining({
      start: '2026-11-01', end: '2026-11-01', timezone: 'America/New_York',
    }));
    expect(h.setRange).not.toHaveBeenCalled();
  });

  it.each([
    { preset: '24h', start: '2026-03-07T16:34:56.789Z' },
    { preset: 'live', start: '2026-03-08T16:29:56.789Z' },
  ])('preserves the exact elapsed $preset window across DST instead of reinterpreting it as calendar midnights', ({ preset, start }) => {
    h.useActualRange = true;
    const end = '2026-03-08T16:34:56.789Z';
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(end));
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...resolvedOptions.call(this), timeZone: 'America/New_York' };
    });
    const item = makeItem({ occurred_at: start });
    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: { items: [item], total: 1, limit: 50, offset: 0, generated_at: '' },
    }));
    render(
      <MemoryRouter initialEntries={[`/activity?time_scope=${preset}`]}>
        <SharedRangeProbe />
        <ActivityTimelinePage />
      </MemoryRouter>,
    );
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({ start, end }));
    expect(JSON.parse(screen.getByTestId('shared-range-authority').textContent ?? '{}')).toEqual(expect.objectContaining({
      startInstant: start, endInstantExclusive: end, timezone: 'America/New_York',
    }));
    fireEvent.click(screen.getByTestId('activity-export-json'));
    expect(h.downloadJson).toHaveBeenCalledWith(
      `activity-${start.replace(/:/g, '-')}-${end.replace(/:/g, '-')}-page-1`, [item],
    );
  });
});

describe('ActivityTimelinePage fleet prerequisites', () => {
  it.each(['fetching', 'paused'] as const)('keeps %s unresolved fleet on the loading shells instead of setup or measured zero', fetchStatus => {
    h.vehicles = [];
    h.fleetResolved = false;
    h.fleetFetchStatus = fetchStatus;
    h.useActivityMock.mockReturnValue(mockQueryResult({ data: undefined, isPending: true }));
    renderPage();
    expect(screen.queryByTestId('no-vehicle-selected')).not.toBeInTheDocument();
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    const fleetBriefs = overviewBriefs();
    assertOperationalBriefDisclosure(fleetBriefs[0], 'Loading source');
    assertOperationalBriefDisclosure(fleetBriefs[1], 'Loading source');
    expect(screen.queryByText(/no activity in this window/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/showing 0–0 of 0 events/i)).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filter by activity kind' })).toBeInTheDocument();
    expect(screen.getByText(/exports include only the loaded page/i)).toBeInTheDocument();
    expect(screen.getByText(/dated service records will join this timeline/i)).toBeInTheDocument();
    expect(screen.getByTestId('activity-export-trigger')).toBeDisabled();
  });

  it('retries the actual initial fleet failure and recovers without calling the disabled activity request', () => {
    h.vehicles = [];
    h.fleetResolved = false;
    h.fleetError = new Error('fleet unavailable');
    h.useActivityMock.mockReturnValue(mockQueryResult({ data: undefined, isPending: true }));
    const view = renderPage();
    expect(screen.queryByTestId('no-vehicle-selected')).not.toBeInTheDocument();
    assertOperationalMetricUnavailable(overviewBriefs()[0], 'Events in selected range');
    expect(screen.getByRole('group', { name: 'Filter by activity kind' })).toBeInTheDocument();
    expect(screen.getByTestId('activity-export-trigger')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.retryFleet).toHaveBeenCalledTimes(1);
    expect(h.refetch).not.toHaveBeenCalled();
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));

    h.fleetResolved = true;
    h.fleetError = null;
    h.vehicles = [{ id: 7 }];
    const item = makeItem();
    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: { items: [item], total: 1, limit: 50, offset: 0, generated_at: '' },
    }));
    view.rerender(<MemoryRouter><ActivityTimelinePage /></MemoryRouter>);
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, vehicle_id: 7 }));
    expect(screen.getByText('12 min')).toBeInTheDocument();
    expect(screen.getByTestId('activity-export-trigger')).toBeEnabled();
  });

  it.each(['failed', 'paused'] as const)('retains known fleet and activity scope during a %s fleet refresh and routes recovery to the prerequisite', status => {
    h.fleetError = status === 'failed' ? new Error('fleet refresh failed') : null;
    h.fleetFetchStatus = status === 'paused' ? 'paused' : 'idle';
    const item = makeItem({ duration_s: 120, energy_added_wh: 2500 });
    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: { items: [item], total: 75, limit: 50, offset: 0, generated_at: '' },
    }));
    const view = renderPage();
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, vehicle_id: 7 }));
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Vehicle registry may be out of date');
    expect(screen.getByRole('region', { name: 'Activity overview' })).toHaveTextContent('Events in selected range75');
    // TimelineItem links the title only (keeping metadata outside the link);
    // the measurements stay visible as the row subtitle.
    expect(screen.getByRole('link', { name: 'Drive' })).toHaveAttribute('href', '/drives/1');
    expect(screen.getByText('0.0 h · 2.5 kWh · 12 min')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^older$/i })).toBeEnabled();
    expect(screen.getByTestId('activity-export-trigger')).toBeEnabled();
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: /^refresh$/i }));
    expect(h.retryFleet).toHaveBeenCalledTimes(1);
    expect(h.refetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('activity-export-json'));
    expect(h.downloadJson).toHaveBeenCalledWith(
      'activity-2026-01-01T00-00-00.000Z-2026-02-01T00-00-00.000Z-page-1', [item],
    );

    h.fleetError = null;
    h.fleetFetchStatus = 'idle';
    view.rerender(<MemoryRouter><ActivityTimelinePage /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('0.0 h · 2.5 kWh · 12 min')).toBeInTheDocument();
  });

  it('does not turn a retained empty fleet refresh failure into authoritative setup guidance', () => {
    h.vehicles = [];
    h.fleetError = new Error('fleet refresh failed');
    h.useActivityMock.mockReturnValue(mockQueryResult({ data: undefined, isPending: true }));
    renderPage();
    expect(screen.queryByTestId('no-vehicle-selected')).not.toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filter by activity kind' })).toBeInTheDocument();
    expect(screen.getByTestId('activity-export-trigger')).toBeDisabled();
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });
});

describe('ActivityTimelinePage', () => {
  it('renders NoVehicleSelected instead of the feed when the fleet is empty', () => {
    h.vehicles = [];
    renderPage();
    expect(screen.getByTestId('no-vehicle-selected')).toBeInTheDocument();
    // useActivity is still called (React hooks can't be conditional) but
    // must be disabled so no wasted request fires while the fleet is empty.
    expect(h.useActivityMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('calls useActivity with the inherited vehicle id and range instants', () => {
    renderPage();
    expect(h.useActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicle_id: 7,
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-02-01T00:00:00.000Z',
        limit: 50,
        offset: 0,
      }),
    );
  });

  it('never queries activity after the historical anchor', () => {
    h.asOf = '2025-12-15T12:00:00.000Z';
    renderPage();
    expect(h.useActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        start: '2025-11-14T12:00:00.000Z',
        end: '2025-12-15T12:00:00.000Z',
      }),
    );
  });

  it('documents the verified service-history limitation without a blocking warning panel', () => {
    renderPage();
    expect(screen.getByText(/dated service records will join this timeline/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no items', () => {
    renderPage();
    expect(screen.getByText(/no activity in this window/i)).toBeInTheDocument();
  });

  it('renders the error state and Retry calls refetch', () => {
    h.useActivityMock.mockReturnValue(
      mockQueryResult({ isError: true, error: new Error('boom'), data: undefined }),
    );
    renderPage();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders feed items grouped by day when loaded', () => {
    h.useActivityMock.mockReturnValue(
      mockQueryResult({
        data: { items: [makeItem()], total: 1, limit: 50, offset: 0, generated_at: '' },
      }),
    );
    renderPage();
    expect(screen.getByText('12 min')).toBeInTheDocument();
  });

  it('toggles a kind filter and re-issues the query scoped to it', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^drive$/i }));
    expect(h.useActivityMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: ['drive'] }),
    );
  });

  it('hides pagination controls when there is only one page', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /older/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /newer/i })).not.toBeInTheDocument();
  });

  it('shows Older (not Newer) on the first page when more results exist, and steps offset forward', () => {
    h.useActivityMock.mockReturnValue(
      mockQueryResult({
        data: { items: [makeItem()], total: 100, limit: 50, offset: 0, generated_at: '' },
      }),
    );
    renderPage();
    expect(screen.queryByRole('button', { name: /newer/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /older/i }));
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 }));
  });

  it('does not claim to show an event when a page becomes empty after the range changes', () => {
    h.useActivityMock.mockImplementation(({ offset }: { offset: number }) =>
      mockQueryResult({
        data: {
          items: offset ? [] : [makeItem()],
          total: offset ? 20 : 75,
          limit: 50,
          offset,
          generated_at: '',
        },
      }),
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /older/i }));
    expect(screen.getByText('Showing 0–0 of 20 events in the selected range')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Activity overview' })).toHaveTextContent(
      'events 0–0 of 20',
    );
    expect(screen.getByRole('button', { name: /newer/i })).toBeInTheDocument();
  });

  it('shows range total but limits event-type and alert counts to the loaded page', () => {
    h.useActivityMock.mockReturnValue(
      mockQueryResult({
        data: { items: [makeItem(), makeItem({ id: 'notification_logs:2', kind: 'alert', severity: 'critical', source_id: 2 })], total: 75, limit: 50, offset: 0, generated_at: '' },
      }),
    );
    renderPage();
    const overview = screen.getByRole('region', { name: 'Activity overview' });
    expect(overview).toHaveTextContent('Events in selected range75');
    expect(overview).toHaveTextContent('Events on this page2');
    expect(overview).toHaveTextContent('Critical alerts on this page1');
    expect(overview).toHaveTextContent('Event types on this page');
  });

  it('exports only loaded records and preserves raw SI fields', () => {
    const item = makeItem({ duration_s: 120, energy_added_wh: 2500 });
    h.useActivityMock.mockReturnValue(
      mockQueryResult({ data: { items: [item], total: 100, limit: 50, offset: 0, generated_at: '' } }),
    );
    renderPage();
    fireEvent.click(screen.getByTestId('activity-export-csv'));
    expect(h.downloadCsv).toHaveBeenCalledWith(
      'activity-2026-01-01T00-00-00.000Z-2026-02-01T00-00-00.000Z-page-1',
      [item],
      expect.arrayContaining([expect.objectContaining({ key: 'energy_added_wh' })]),
    );
    expect(screen.getByText(/exports include only the loaded page/i)).toBeInTheDocument();
  });

  it('does not present unknown totals or an available export when the initial request fails', () => {
    h.useActivityMock.mockReturnValue(mockQueryResult({ isError: true, error: new Error('failed'), data: undefined }));
    renderPage();
    assertOperationalMetricUnavailable(overviewBriefs()[0], 'Events in selected range');
    expect(screen.getByTestId('activity-export-trigger')).toBeDisabled();
  });

  it('retains loaded totals, records and raw-SI exports when a background refresh fails', () => {
    const item = makeItem({ duration_s: 120, energy_added_wh: 2500 });
    h.useActivityMock.mockReturnValue(mockQueryResult({
      isError: true,
      error: new Error('refresh failed'),
      data: { items: [item], total: 75, limit: 50, offset: 0, generated_at: '' },
    }));
    renderPage();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Activity overview' })).toHaveTextContent('Events in selected range75');
    expect(screen.getByText('0.0 h · 2.5 kWh · 12 min')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Drive' })).toHaveAttribute('href', '/drives/1');
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Source: Driving history')).toBeInTheDocument();
    expect(screen.getByTestId('activity-export-trigger')).toBeEnabled();
    expect(screen.getByRole('button', { name: /older/i })).toBeEnabled();
    fireEvent.click(screen.getByTestId('activity-export-csv'));
    expect(h.downloadCsv).toHaveBeenCalledWith(
      'activity-2026-01-01T00-00-00.000Z-2026-02-01T00-00-00.000Z-page-1',
      [item],
      expect.arrayContaining([
        expect.objectContaining({ key: 'duration_s' }),
        expect.objectContaining({ key: 'energy_added_wh' }),
      ]),
    );
    fireEvent.click(screen.getByTestId('activity-export-json'));
    expect(h.downloadJson).toHaveBeenCalledWith(
      'activity-2026-01-01T00-00-00.000Z-2026-02-01T00-00-00.000Z-page-1',
      [item],
    );
  });

  it('keeps initial and paused first loads distinct from a successful empty timeline', () => {
    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: undefined,
      isLoading: true,
      isPending: true,
      fetchStatus: 'fetching',
    }));
    const view = renderPage();
    const loadingBriefs = overviewBriefs();
    assertOperationalBriefDisclosure(loadingBriefs[0], 'Loading source');
    assertOperationalBriefDisclosure(loadingBriefs[1], 'Loading source');
    expect(screen.queryByText(/no activity in this window/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/showing 0–0 of 0 events/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('activity-export-trigger')).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Filter by activity kind' })).toBeInTheDocument();

    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: undefined,
      isPending: true,
      fetchStatus: 'paused',
    }));
    view.rerender(<MemoryRouter><ActivityTimelinePage /></MemoryRouter>);
    const pausedBriefs = overviewBriefs();
    assertOperationalBriefDisclosure(pausedBriefs[0], 'Loading source');
    assertOperationalBriefDisclosure(pausedBriefs[1], 'Loading source');
    expect(screen.queryByText(/no activity in this window/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/showing 0–0 of 0 events/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('activity-export-trigger')).toBeDisabled();
    expect(screen.getByText(/dated service records will join this timeline/i)).toBeInTheDocument();
  });

  it('labels paused cached history as retained while preserving records exports and recovery', () => {
    const item = makeItem({ duration_s: 120, energy_added_wh: 2500 });
    h.useActivityMock.mockReturnValue(mockQueryResult({
      fetchStatus: 'paused',
      data: { items: [item], total: 75, limit: 50, offset: 0, generated_at: '' },
    }));
    const view = renderPage();
    const overview = screen.getByRole('region', { name: 'Activity overview' });
    const retainedBriefs = overviewBriefs();
    assertOperationalBriefDisclosure(retainedBriefs[0], 'Retained source');
    assertOperationalBriefDisclosure(retainedBriefs[1], 'Retained source');
    expect(within(overview).queryByText('Source available')).not.toBeInTheDocument();
    expect(overview).toHaveTextContent('Events in selected range75');
    expect(screen.getByRole('link', { name: 'Drive' }))
      .toHaveAttribute('href', '/drives/1');
    expect(screen.getByText('0.0 h · 2.5 kWh · 12 min')).toBeInTheDocument();
    expect(screen.getByTestId('activity-export-trigger')).toBeEnabled();
    expect(screen.getByRole('button', { name: /older/i })).toBeEnabled();
    fireEvent.click(screen.getByTestId('activity-export-json'));
    expect(h.downloadJson).toHaveBeenCalledWith(
      'activity-2026-01-01T00-00-00.000Z-2026-02-01T00-00-00.000Z-page-1', [item],
    );

    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: { items: [item], total: 75, limit: 50, offset: 0, generated_at: '' },
    }));
    view.rerender(<MemoryRouter><ActivityTimelinePage /></MemoryRouter>);
    const recoveredBriefs = overviewBriefs();
    assertOperationalBriefDisclosure(recoveredBriefs[0], 'Source available');
    assertOperationalBriefDisclosure(recoveredBriefs[1], 'Source available');
    expect(within(overview).queryByText('Retained source')).not.toBeInTheDocument();
  });

  it('keeps mobile pagination wrapping and both directions reachable with desktop density restored', () => {
    h.useActivityMock.mockReturnValue(mockQueryResult({
      data: { items: [makeItem()], total: 100, limit: 50, offset: 0, generated_at: '' },
    }));
    renderPage();
    const older = screen.getByRole('button', { name: /older/i });
    expect(older).toHaveClass('h-auto', 'min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0', 'whitespace-normal');
    expect(older.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(older.querySelector('svg')).toHaveClass('rtl:rotate-180');
    fireEvent.click(older);
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 }));
    const newer = screen.getByRole('button', { name: /newer/i });
    expect(newer).toHaveClass('h-auto', 'min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0', 'whitespace-normal');
    expect(newer.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(newer.querySelector('svg')).toHaveClass('rtl:rotate-180');
    fireEvent.click(newer);
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));
  });
});
