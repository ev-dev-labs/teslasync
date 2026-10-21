import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { cloneElement, isValidElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/feedback';
import type { Drive } from '@/types/driving';
import { formatDayKey } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { forecastDepartures } from '../lib/departureForecast';

import {
  departureChartLabel,
  departureClock,
  departureDateTime,
  departureLocalHour,
} from '../components/departure-forecast/labels';

const FROZEN_NOW = Date.parse('2026-05-14T06:30:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as unknown,
  historyHook: vi.fn(),
  timezoneHook: vi.fn(),
  timeZone: 'UTC',
  locale: 'en-US',
  vehicleTimezone: null as string | null,
  userTimezone: 'Asia/Tokyo',
  displayMode: 'user',
  useSharedTimezone: false,
}));

const historyRefetch = vi.fn();

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    locale: h.locale,
    decimals: 2,
    settings: {
      locale: h.locale,
      tz_display_default: h.displayMode,
      timezone_user: h.userTimezone,
      unit_of_length: 'km',
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      decimal_precision: 2,
      currency_symbol: '$',
      chart_palette: 'cb_safe',
    },
  }),
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  );
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: unknown) => {
        const text = typeof fallback === 'string' ? fallback : key;
        const values =
          options && typeof options === 'object'
            ? (options as Record<string, unknown>)
            : {};
        return text.replace(
          /\{\{\s*(\w+)\s*\}\}/g,
          (_match, name: string) =>
            values[name] != null ? String(values[name]) : '',
        );
      },
      i18n: { language: 'en-US', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useDriving', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useDriving')>();
  return {
    ...actual,
    useDriveHistory: (vehicleId?: string, limit?: number) => {
      h.historyHook(vehicleId, limit);
      return h.history;
    },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: h.vehicleTimezone == null ? null : { id: h.vehicleId, timezone: h.vehicleTimezone },
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/lib/timezone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/timezone')>();
  return {
    ...actual,
    useTimezone: (mode: string) => {
      h.timezoneHook(mode);
      return h.useSharedTimezone
        ? actual.resolveTimezone(mode as 'vehicle' | 'user' | 'utc', h.vehicleTimezone, h.userTimezone)
        : h.timeZone;
    },
  };
});

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement<{ width?: number; height?: number }>(children)
        ? cloneElement(children, { width: 800, height: 360 })
        : children,
  };
});

import DepartureForecastPage from './DepartureForecastPage';

let nextId = 1;

function driveAt(startTs: string, overrides: Partial<Drive> = {}): Drive {
  return {
    id: nextId++,
    vehicleId: 7,
    startTs,
    endTs: null,
    durationS: 1_800,
    distanceM: 20_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 3_000,
    regenEnergyWh: 400,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 5_000,
    outsideTempAvgC: 15,
    insideTempAvgC: 20,
    score: null,
    endedStatus: 'completed',
    createdAt: startTs,
    updatedAt: startTs,
    ...overrides,
  };
}

function weekdayCommute(weeks: number): Drive[] {
  const drives: Drive[] = [];
  for (let daysAgo = 1; daysAgo <= weeks * 7; daysAgo += 1) {
    const date = new Date(FROZEN_NOW - daysAgo * 86_400_000);
    const weekday = date.getUTCDay();
    if (weekday < 1 || weekday > 5) continue;
    drives.push(
      driveAt(
        new Date(
          Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
            8,
            5,
          ),
        ).toISOString(),
      ),
    );
  }
  return drives;
}

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  isFetching: boolean;
  isPending: boolean;
}

function query(overrides: Partial<QueryStub> = {}): QueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data: undefined,
    isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    refetch: historyRefetch,
    fetchStatus: isLoading ? 'fetching' : 'idle',
    isFetching: isLoading,
    isPending: isLoading,
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="forecast-location">{location.search}</output>;
}

function tree(client: QueryClient, initialEntry: string) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <DepartureForecastPage />
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderPage(initialEntry = '/driving/departure-forecast') {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const view = render(tree(client, initialEntry));
  return {
    ...view,
    rerenderPage: () => view.rerender(tree(client, initialEntry)),
  };
}

const sectionIds = [
  'departure-kpis',
  'departure-next-24',
  'departure-ranked-windows',
  'departure-weekday-routines',
  'departure-heatmap',
  'departure-hour-distribution',
  'departure-weekly-trend',
  'departure-evidence-quality',
  'departure-methodology',
] as const;

function expectEverySection(): void {
  for (const testId of sectionIds) {
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 1;
  h.vehicleId = 7;
  h.timeZone = 'UTC';
  h.locale = 'en-US';
  h.vehicleTimezone = null;
  h.userTimezone = 'Asia/Tokyo';
  h.displayMode = 'user';
  h.useSharedTimezone = false;
  h.history = query({ data: weekdayCommute(12) });
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
});

describe('DepartureForecastPage', () => {
  it('qualifies elapsed calendar opportunity without changing counts, rates, or ranked dates', () => {
    h.locale = 'de-DE';
    h.useSharedTimezone = true;
    h.vehicleTimezone = 'America/Los_Angeles';
    const drives = weekdayCommute(12);
    const original = structuredClone(drives);
    h.history = query({ data: drives });
    const forecast = forecastDepartures(drives, FROZEN_NOW, h.vehicleTimezone);
    renderPage();

    const ranked = within(screen.getByTestId('departure-ranked-windows'));
    const rows = ranked.getAllByRole('listitem');
    expect(rows).toHaveLength(forecast.rankedWindows.length);
    forecast.rankedWindows.forEach((slot, index) => {
      expect(rows[index]).toHaveTextContent(
        departureDateTime(slot.startMs, h.locale, h.vehicleTimezone!),
      );
      expect(rows[index]).toHaveTextContent(
        `${slot.historicalDepartures} recorded departures / ${slot.cellOccurrences} model-assumed calendar opportunities`,
      );
      expect(rows[index]).toHaveTextContent(
        `${fmtNumber(slot.p * 100, undefined, h.locale)}% modeled`,
      );
    });
    expect(ranked.getByText(/not verified telemetry coverage/)).toBeInTheDocument();

    const quality = within(screen.getByTestId('departure-evidence-quality'));
    expect(quality.getByText('Elapsed calendar opportunity and recorded recurrence')).toBeInTheDocument();
    for (const [label, value] of [
      ['Elapsed returned-history span (days)', forecast.observedSpanDays],
      ['Elapsed returned-history span (weeks)', forecast.observedWeeks],
      ['Mean model-assumed opportunities per occupied cell', forecast.evidenceStrength.meanOccupiedCellOccurrences],
    ] as const) {
      expect(quality.getByText(label).closest('div')).toHaveTextContent(
        fmtNumber(value, undefined, h.locale),
      );
    }
    expect(quality.getByText(/not measured recording coverage/)).toBeInTheDocument();
    const method = screen.getByTestId('departure-methodology');
    expect(within(method).getByRole('heading', {
      name: 'Model-assumed calendar opportunity',
    }).closest('article')).toHaveTextContent(
      'Zero-event weeks mean no included returned starts; they do not prove inactivity.',
    );
    expect(method).toHaveTextContent('(recorded departures + α) / (model-assumed calendar opportunities + β)');
    expect(method).toHaveTextContent('1 − exp(−rate)');
    expect(method).toHaveTextContent('No telemetry uptime, completeness, or monitoring coverage metadata is available');
    expect(drives).toEqual(original);
    expectEverySection();
  });

  it('preserves local Monday buckets and real returned-event zeroes across gaps and invalid dates', () => {
    h.locale = 'de-DE';
    h.useSharedTimezone = true;
    h.vehicleTimezone = 'America/Los_Angeles';
    const anchor = Date.parse('2026-01-20T01:00:00Z');
    vi.mocked(Date.now).mockReturnValue(anchor);
    const missing = driveAt('2026-01-05T00:00:00Z');
    Reflect.deleteProperty(missing, 'startTs');
    const drives = [
      missing, driveAt('invalid'), driveAt(''),
      driveAt('2026-01-05T07:59:00Z'),
      driveAt('2026-01-05T08:00:00Z'),
      driveAt('2026-01-19T08:00:00Z'),
    ];
    const original = structuredClone(drives);
    h.history = query({ data: drives });
    renderPage();

    const weekly = within(screen.getByTestId('departure-weekly-trend'));
    const tableRows = within(weekly.getByRole('table')).getAllByRole('row').slice(1);
    expect(tableRows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual(
      [
        ['2025-12-29', '1', '1'],
        ['2026-01-05', '1', '1'],
        ['2026-01-12', '0', '0'],
        ['2026-01-19', '1', '1'],
      ].map(([key, departures, activeDays]) => [
        formatDayKey(key, { locale: h.locale, style: 'short' }), departures, activeDays,
      ]),
    );
    expect(weekly.getByText(/gaps do not establish recording coverage/)).toHaveTextContent(
      '3 returned departures across 3 active days and 3 active weeks',
    );
    expect(weekly.getByText(/elapsed calendar opportunity is model-assumed/)).toBeInTheDocument();
    const quality = within(screen.getByTestId('departure-evidence-quality'));
    for (const label of ['Included departures', 'Invalid start times', 'Excluded rows']) {
      expect(quality.getByText(label).closest('div')?.querySelector('dd')).toHaveTextContent('3');
    }
    expect(drives).toEqual(original);
    expectEverySection();
  });

  it('uses restrained presenter roles without implying forecast success or losing support', () => {
    renderPage();

    for (const id of [
      'departure-ranked-windows',
      'departure-weekday-routines',
      'departure-evidence-quality',
    ]) {
      expect(screen.getByTestId(id).querySelector('svg')).toHaveClass(
        'text-[var(--text-secondary)]',
      );
    }
    const ranked = within(screen.getByTestId('departure-ranked-windows'));
    for (const badge of ranked.getAllByText(/% modeled$/)) {
      expect(badge).toHaveClass('bg-[var(--surface-2)]');
      expect(badge).not.toHaveClass('bg-[var(--semantic-success-bg)]');
    }
    const weekdays = within(screen.getByTestId('departure-weekday-routines'));
    expect(weekdays.getAllByText('Supported')).toHaveLength(5);
    expect(weekdays.getAllByText('Unsupported')).toHaveLength(2);
    for (const badge of weekdays.getAllByText(/^(Supported|Unsupported)$/)) {
      expect(badge).toHaveClass('bg-[var(--surface-2)]');
    }
    for (const id of ['departure-methodology', 'departure-evidence-quality']) {
      const notice = within(screen.getByTestId(id)).getByText(
        id === 'departure-methodology'
          ? 'Planning aid only: no automation is created, and no departure is promised.'
          : /The support index gates elapsed exposure/,
      ).closest('.rounded-panel');
      expect(notice).toHaveClass('bg-[var(--surface-2)]', 'border-[var(--border-subtle)]');
    }
    expectEverySection();
  });

  it('preserves four ordered heatmap intensities, departure counts, and unsupported cells', () => {
    h.history = query({
      data: [1, 4, 8, 16].flatMap((count, index) =>
        Array.from({ length: count }, () =>
          driveAt(`2026-01-15T${String(8 + index).padStart(2, '0')}:05:00.000Z`),
        ),
      ),
    });
    renderPage();

    const grid = screen.getByTestId('departure-heatmap-grid');
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[title]'));
    expect(cells).toHaveLength(168);
    const supported = cells.filter((cell) => !cell.classList.contains('border-dashed'));
    expect(supported.map((cell) => cell.textContent)).toEqual(['1', '4', '8', '16']);
    expect(supported.map((cell) => cell.className.match(/text-secondary\)_(\d+)%/)?.[1]))
      .toEqual(['2', '4', '6', '8']);
    for (const cell of supported) {
      expect(cell).toHaveClass('border-[var(--border-default)]');
      expect(cell.title).toContain(`${cell.textContent} departures across`);
    }
    const unsupported = cells.filter((cell) => cell.classList.contains('border-dashed'));
    expect(unsupported).toHaveLength(164);
    for (const cell of unsupported) {
      expect(cell).toHaveTextContent('·');
      expect(cell).toHaveClass('bg-[var(--surface-1)]');
      expect(cell.title).toContain('no recorded departures');
    }
  });

  it.each([null, 'UTC'])('discloses the shared saved-user fallback for vehicle metadata %s without overriding UTC semantics', (metadata) => {
    h.useSharedTimezone = true;
    h.vehicleTimezone = metadata;
    h.locale = 'de-DE';
    h.userTimezone = 'Asia/Kolkata';
    h.displayMode = 'utc';
    renderPage();

    const method = screen.getByTestId('departure-methodology');
    expect(method).toHaveTextContent('The model follows your selected time zone.');
    expect(method).not.toHaveTextContent('Asia/Kolkata');
    expect(method).toHaveTextContent('shared vehicle-mode fallback (saved user timezone)');
    expect(method).toHaveTextContent('vehicle timezone metadata is missing, invalid, or UTC');
    expect(method.querySelector('time')).toHaveTextContent(
      departureDateTime(FROZEN_NOW, 'de-DE', 'Asia/Kolkata'),
    );
    const kpis = screen.getByTestId('departure-kpis');
    assertOperationalBriefDisclosure(kpis, 'The model follows your selected time zone.', { contains: true });
    assertOperationalBriefDisclosure(kpis, 'shared vehicle-mode fallback (saved user timezone)', { contains: true });
    assertOperationalBriefDisclosure(kpis, 'vehicle timezone metadata is missing, invalid, or UTC', { contains: true });
    fireEvent.click(within(kpis).getByRole('button', { name: 'Review details' }));
    const kpisDrawer = screen.getByRole('dialog');
    expect(kpisDrawer.querySelector('time')).toHaveTextContent(
      departureDateTime(FROZEN_NOW, 'de-DE', 'Asia/Kolkata'),
    );
    fireEvent.keyDown(kpisDrawer, { key: 'Escape' });
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
    expect(h.vehicleTimezone).toBe(metadata);
    expect(h.displayMode).toBe('utc');
    expectEverySection();
  });

  it('discloses vehicle metadata independently of the saved user timezone', () => {
    h.useSharedTimezone = true;
    h.vehicleTimezone = 'America/Los_Angeles';
    h.locale = 'fr-FR';
    renderPage();
    const method = screen.getByTestId('departure-methodology');
    expect(method).toHaveTextContent('The model follows your selected time zone.');
    expect(method).toHaveTextContent('Source: selected vehicle timezone metadata.');
    expect(method).not.toHaveTextContent('America/Los_Angeles');
    expect(method).not.toHaveTextContent('shared vehicle-mode fallback');
    const kpis = screen.getByTestId('departure-kpis');
    assertOperationalBriefDisclosure(kpis, 'The model follows your selected time zone.', { contains: true });
    assertOperationalBriefDisclosure(kpis, 'Source: selected vehicle timezone metadata.', { contains: true });
    assertOperationalBriefDisclosure(kpis, 'shared vehicle-mode fallback', { contains: true, absent: true });
  });

  it('identifies the browser fallback when no user timezone is saved', () => {
    h.useSharedTimezone = true;
    h.userTimezone = '';
    renderPage();
    const method = screen.getByTestId('departure-methodology');
    expect(method).toHaveTextContent('shared vehicle-mode fallback (browser timezone, or UTC if unavailable)');
    expect(method).toHaveTextContent('The model follows your selected time zone.');
    const kpis = screen.getByTestId('departure-kpis');
    assertOperationalBriefDisclosure(kpis, 'shared vehicle-mode fallback (browser timezone, or UTC if unavailable)', { contains: true });
    assertOperationalBriefDisclosure(kpis, 'The model follows your selected time zone.', { contains: true });
    expect(h.userTimezone).toBe('');
  });

  it.each(['Not/AZone', ''])('falls back through the shared chain for invalid resolved zone "%s" without repairing settings', (zone) => {
    h.useSharedTimezone = zone !== '';
    h.vehicleTimezone = zone;
    h.timeZone = zone;
    renderPage();
    // Invalid vehicle metadata falls back to the saved user zone; a blank
    // legacy zone falls back to model-local UTC.
    const expectedZone = zone === '' ? 'UTC' : 'Asia/Tokyo';
    const method = screen.getByTestId('departure-methodology');
    expect(method).toHaveTextContent('The model follows your selected time zone.');
    expect(method).toHaveTextContent('shared vehicle-mode fallback (saved user timezone)');
    expect(method).toHaveTextContent('vehicle timezone metadata is missing, invalid, or UTC');
    if (zone === '') {
      expect(method).toHaveTextContent('this model uses UTC without changing shared settings');
    } else {
      expect(method).not.toHaveTextContent('this model uses UTC without changing shared settings');
    }
    expect(method).not.toHaveTextContent('Not/AZone');
    expect(method.querySelector('time')).toHaveTextContent(
      departureDateTime(FROZEN_NOW, h.locale, expectedZone),
    );
    const kpis = screen.getByTestId('departure-kpis');
    assertOperationalBriefDisclosure(kpis, 'The model follows your selected time zone.', { contains: true });
    assertOperationalBriefDisclosure(kpis, 'shared vehicle-mode fallback (saved user timezone)', { contains: true });
    fireEvent.click(within(kpis).getByRole('button', { name: 'Review details' }));
    const kpisDrawer = screen.getByRole('dialog');
    expect(kpisDrawer.querySelector('time')).toHaveTextContent(
      departureDateTime(FROZEN_NOW, h.locale, expectedZone),
    );
    fireEvent.keyDown(kpisDrawer, { key: 'Escape' });
    expect(h.vehicleTimezone).toBe(zone);
    expect(h.userTimezone).toBe('Asia/Tokyo');
    expectEverySection();
  });

  it('discloses invalid saved-user fallback without rewriting the saved timezone', () => {
    h.useSharedTimezone = true;
    h.userTimezone = 'Not/AZone';
    renderPage();
    const method = screen.getByTestId('departure-methodology');
    expect(method).toHaveTextContent('The model follows your selected time zone.');
    expect(method).toHaveTextContent('shared vehicle-mode fallback (browser timezone, or UTC if unavailable)');
    expect(method).not.toHaveTextContent('saved user timezone');
    expect(method).not.toHaveTextContent('Not/AZone');
    const kpis = screen.getByTestId('departure-kpis');
    assertOperationalBriefDisclosure(kpis, 'The model follows your selected time zone.', { contains: true });
    assertOperationalBriefDisclosure(kpis, 'shared vehicle-mode fallback (browser timezone, or UTC if unavailable)', { contains: true });
    expect(h.userTimezone).toBe('Not/AZone');
  });

  it('excludes missing and invalid drive starts while preserving valid local business days', () => {
    h.useSharedTimezone = true;
    h.vehicleTimezone = 'America/Los_Angeles';
    h.locale = 'de-DE';
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-01-06T01:00:00Z'));
    const missing = driveAt('2026-01-05T00:00:00Z');
    Reflect.deleteProperty(missing, 'startTs');
    const drives = [missing, driveAt('invalid'), driveAt(''), driveAt('2026-01-06T00:30:00Z')];
    const original = structuredClone(drives);
    h.history = query({ data: drives });
    renderPage();
    const weekdays = within(screen.getByTestId('departure-weekday-routines'));
    expect(within(weekdays.getByText('Monday').closest('li')!).getByText('Supported')).toBeInTheDocument();
    expect(within(weekdays.getByText('Tuesday').closest('li')!).getByText('Unsupported')).toBeInTheDocument();
    expect(drives).toEqual(original);
    expectEverySection();
  });

  it('preserves repeated DST hour boundaries in the metadata zone with a non-default locale', () => {
    h.useSharedTimezone = true;
    h.vehicleTimezone = 'America/Los_Angeles';
    h.locale = 'de-DE';
    const anchor = Date.parse('2026-11-01T07:30:00Z');
    vi.mocked(Date.now).mockReturnValue(anchor);
    h.history = query({ data: [driveAt('2026-10-25T08:05:00Z')] });
    renderPage();
    const table = within(screen.getByTestId('departure-next-24')).getByRole('table');
    for (const iso of ['2026-11-01T08:00:00Z', '2026-11-01T09:00:00Z']) {
      expect(within(table).getByText(departureChartLabel(Date.parse(iso), 'de-DE', h.vehicleTimezone))).toBeInTheDocument();
    }
    expect(screen.getByTestId('departure-methodology')).toHaveTextContent('The model follows your selected time zone.');
  });

  it('uses the saved date locale while retaining vehicle-model timezone and raw instants', () => {
    h.locale = 'de-DE';
    h.timeZone = 'America/Los_Angeles';
    const drives = weekdayCommute(12);
    const original = structuredClone(drives);
    h.history = query({ data: drives });
    const view = renderPage();
    const slot = Date.parse('2026-05-14T07:00:00.000Z');
    const expected = departureChartLabel(slot, 'de-DE', h.timeZone);
    const table = within(screen.getByTestId('departure-next-24')).getByRole('table');
    expect(within(table).getByText(expected)).toBeInTheDocument();
    expect(within(table).queryByText(departureChartLabel(slot, 'en-US', h.timeZone))).not.toBeInTheDocument();
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
    expect(drives).toEqual(original);
    expectEverySection();

    h.locale = 'fr-FR';
    view.rerenderPage();
    expect(within(table).getByText(departureChartLabel(slot, 'fr-FR', h.timeZone))).toBeInTheDocument();
    expect(drives).toEqual(original);
  });

  it.each(['de-DE', 'en-US'])('formats model day boundaries and abstract hours with %s', (locale) => {
    const zone = 'America/Los_Angeles';
    for (const iso of ['2026-05-14T06:59:00.000Z', '2026-05-14T07:00:00.000Z']) {
      const date = new Date(iso);
      expect(departureDateTime(date.getTime(), locale, zone)).toBe(
        date.toLocaleString(locale, {
          timeZone: zone, year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        }),
      );
      expect(departureClock(date.getTime(), locale, zone)).toBe(
        new Intl.DateTimeFormat(locale, {
          timeZone: zone, hour: '2-digit', minute: '2-digit',
        }).format(date),
      );
      expect(departureChartLabel(date.getTime(), locale, zone)).toBe(
        new Intl.DateTimeFormat(locale, {
          timeZone: zone, month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset',
        }).format(date),
      );
    }
    for (const hour of [0, 23]) {
      expect(departureLocalHour(hour, locale)).toBe(
        new Intl.DateTimeFormat(locale, {
          timeZone: 'UTC', hour: '2-digit', minute: '2-digit',
        }).format(new Date(Date.UTC(2020, 0, 1, hour))),
      );
    }
  });

  it.each([null, undefined, NaN, Infinity, -Infinity, 8.64e15 + 1])(
    'keeps missing or invalid instant %s unknown rather than showing epoch dates',
    (ms) => {
      expect(departureClock(ms, 'de-DE', 'America/Los_Angeles')).toBe('—');
      expect(departureDateTime(ms, 'de-DE', 'America/Los_Angeles')).toBe('—');
      expect(departureChartLabel(ms, 'de-DE', 'America/Los_Angeles')).toBe('—');
    },
  );

  it('preserves a valid epoch instant and rejects invalid abstract hours', () => {
    expect(departureDateTime(0, 'de-DE', 'UTC')).not.toBe('—');
    for (const hour of [NaN, Infinity, -1, 24, 1.5]) {
      expect(departureLocalHour(hour, 'de-DE')).toBe('—');
    }
  });

  it.each([
    'hidden_departure-forecast-next-24=likelihood',
    'hidden_departure-forecast-24h=likelihood',
    'hidden_departure-forecast-next-24=likelihood&hidden_departure-forecast-24h=cumulative',
  ])('uses one frame and preserves saved series visibility from %s', (search) => {
    renderPage(`/driving/departure-forecast?${search}&keep=1`);

    const section = screen.getByTestId('departure-next-24');
    const panel = within(section);
    expect(section.querySelectorAll('figure[data-chart-key]')).toHaveLength(1);
    expect(section.querySelector('figure')).toHaveAttribute(
      'data-chart-key',
      'departure-forecast-next-24',
    );
    expect(section.querySelectorAll('[data-chart-toolbar]')).toHaveLength(1);
    const table = panel.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Local slot',
      'Modeled likelihood (%)',
      'Cumulative estimate (%)',
      'Historical departures',
      'Cell occurrences',
      'Cell support',
    ]);
    expect(within(table).getAllByRole('row')).toHaveLength(25);
    const hourly = panel.getByRole('button', { name: 'Hourly modeled likelihood' });
    const cumulative = panel.getByRole('button', { name: 'Cumulative modeled likelihood' });
    expect(hourly).toHaveAttribute('aria-pressed', 'true');
    expect(cumulative).toHaveAttribute('aria-pressed', String(search.includes('cumulative')));
    expect(section.querySelector('.recharts-bar-rectangle')).not.toBeInTheDocument();

    fireEvent.click(hourly);
    expect(hourly).toHaveAttribute('aria-pressed', 'false');
    expect(section.querySelector('.recharts-bar-rectangle')).toBeInTheDocument();
    const updated = new URLSearchParams(screen.getByTestId('forecast-location').textContent ?? '');
    const remaining = search.includes('cumulative') ? 'cumulative' : null;
    expect(updated.get('hidden_departure-forecast-next-24')).toBe(remaining);
    expect(updated.get('hidden_departure-forecast-24h')).toBe(remaining);
    expect(updated.get('keep')).toBe('1');
    expect(within(table).getAllByRole('row')).toHaveLength(25);
  });

  it('preserves every modeled window while a retained history refresh is paused and recovers', () => {
    h.history = { ...query({ data: weekdayCommute(12) }), fetchStatus: 'paused' };
    const view = renderPage();
    expectEverySection();
    const notice = screen.getByTestId('stale-refresh-warning');
    expect(notice).toHaveTextContent(
      'The latest values are temporarily unavailable. Previously loaded data remains visible.',
    );
    expect(notice).toHaveAttribute('data-refresh-blocked', 'true');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).not.toHaveTextContent(/offline|failed/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(screen.getByTestId('departure-kpis'), 'Refresh paused');
    expect(screen.queryByTestId('departure-loading-status')).not.toBeInTheDocument();
    fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }));
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    h.history = query({ data: weekdayCommute(12) });
    view.rerenderPage();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(screen.getByTestId('departure-kpis'), 'Returned evidence');
    expectEverySection();
  });

  it('distinguishes paused initial history from loading or empty and recovers through an active load', () => {
    h.history = query({ isSuccess: false, isPending: true, fetchStatus: 'paused' });
    const view = renderPage();

    expectEverySection();
    const notice = screen.getByTestId('departure-paused-status');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveTextContent('Departure Forecast loading is paused. No data has been loaded yet.');
    expect(notice).not.toHaveTextContent(/offline|failed/i);
    expect(screen.queryByTestId('departure-loading-status')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const kpis = within(screen.getByTestId('departure-kpis'));
    assertOperationalBriefDisclosure(screen.getByTestId('departure-kpis'), 'Source paused');
    expect(kpis.queryByText('0')).not.toBeInTheDocument();
    expect(kpis.queryByText('Support index needs qualifying departures')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('departure-next-24')).queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    expect(historyRefetch).toHaveBeenCalledTimes(1);

    h.history = query({ isLoading: true });
    view.rerenderPage();
    expect(screen.queryByTestId('departure-paused-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('departure-loading-status')).toBeInTheDocument();

    h.history = query({ data: [] });
    view.rerenderPage();
    expectEverySection();
    expect(screen.queryByTestId('departure-loading-status')).not.toBeInTheDocument();
    expect(kpis.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('No drives were returned, so no peak, horizon likelihood, or planning marker is inferred.')).toBeInTheDocument();
  });

  it('renders the ready state with all persistent evidence sections', () => {
    renderPage();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Departure Forecast',
      }),
    ).toBeInTheDocument();
    expectEverySection();
    for (const title of [
      'Forecast evidence',
      'Modeled likelihood — next 24 local hours',
      'Strongest upcoming supported windows',
      'Weekday peaks and routine support',
      'Learned weekday-hour profile',
      'Historical local-hour and daypart distribution',
      'Recent weekly departure trend and active-day cadence',
      'Evidence quality and coverage',
      'Methodology and limitations',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(h.historyHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
  });

  it('freezes the analysis clock across query changes', () => {
    const view = renderPage();

    expect(
      screen.getAllByText(/in 1 h 30 min/).length,
    ).toBeGreaterThan(0);
    vi.mocked(Date.now).mockReturnValue(
      FROZEN_NOW + 3 * 86_400_000,
    );
    h.history = query({
      data: [...weekdayCommute(12), driveAt('2026-05-13T18:00:00.000Z')],
    });
    view.rerenderPage();

    expect(
      screen.getAllByText(/in 1 h 30 min/).length,
    ).toBeGreaterThan(0);
  });

  it('discloses the mount-time anchor through delayed loading, refresh, scope changes, and remount', () => {
    h.history = query({ isLoading: true });
    const view = renderPage();
    const assertAnchor = (anchor: number) => {
      const method = screen.getByTestId('departure-methodology');
      const time = method.querySelector('time');
      expect(time).toHaveAttribute('datetime', new Date(anchor).toISOString());
      expect(time).toHaveTextContent(departureDateTime(anchor, h.locale, h.timeZone));
      expect(method).not.toHaveTextContent(h.timeZone);
      const kpis = screen.getByTestId('departure-kpis');
      fireEvent.click(within(kpis).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog');
      const drawerTime = drawer.querySelector('time');
      expect(drawerTime).toHaveAttribute('datetime', new Date(anchor).toISOString());
      expect(drawerTime).toHaveTextContent(departureDateTime(anchor, h.locale, h.timeZone));
      expect(drawer).not.toHaveTextContent(h.timeZone);
      fireEvent.keyDown(drawer, { key: 'Escape' });
    };
    assertAnchor(FROZEN_NOW);
    assertOperationalBriefDisclosure(
      screen.getByTestId('departure-kpis'),
      'relative to this fixed anchor, not a live countdown',
      { contains: true },
    );
    expect(screen.getByTestId('departure-methodology')).toHaveTextContent(
      'not the current clock or the history fetch time',
    );

    const later = FROZEN_NOW + 3 * 86_400_000;
    vi.mocked(Date.now).mockReturnValue(later);
    h.history = query({ data: weekdayCommute(12) });
    view.rerenderPage();
    assertAnchor(FROZEN_NOW);
    expect(screen.getAllByText(/in 1 h 30 min/).length).toBeGreaterThan(0);
    const tableBeforeRefresh = within(screen.getByTestId('departure-next-24')).getByRole('table').textContent;

    // A prior Thursday at an otherwise empty hour inside the next-24h window, so the
    // refreshed history must visibly change the modeled table.
    h.history = query({
      data: [...weekdayCommute(12), driveAt('2026-05-07T10:05:00.000Z')],
    });
    view.rerenderPage();
    assertAnchor(FROZEN_NOW);
    expect(within(screen.getByTestId('departure-next-24')).getByRole('table').textContent).not.toBe(tableBeforeRefresh);
    expect(screen.getAllByText(/in 1 h 30 min/).length).toBeGreaterThan(0);

    h.vehicleId = 8;
    h.timeZone = 'America/Los_Angeles';
    h.locale = 'de-DE';
    view.rerenderPage();
    assertAnchor(FROZEN_NOW);
    expect(h.historyHook).toHaveBeenLastCalledWith('8', 1_000);
    expectEverySection();

    view.unmount();
    renderPage();
    assertAnchor(later);
    expectEverySection();
  });

  it('keeps all shells visible with one live status while loading', () => {
    h.history = query({ isLoading: true });

    renderPage();

    expectEverySection();
    expect(
      screen.getAllByLabelText('Loading departure history').length,
    ).toBeGreaterThan(1);
    expect(
      screen.getAllByRole('status', {
        name: 'Loading departure history',
      }),
    ).toHaveLength(1);
    fireEvent.click(within(screen.getByTestId('departure-kpis')).getByRole('button', { name: 'Review details' }));
    const loadingDrawer = screen.getByRole('dialog');
    expect(within(loadingDrawer).getAllByText('Waiting for returned drive history…')).toHaveLength(6);
    fireEvent.keyDown(loadingDrawer, { key: 'Escape' });
    expect(
      screen.queryByText('No supported slot crosses the model threshold'),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows one actionable initial error without hiding section shells', () => {
    h.history = query({
      isError: true,
      error: new Error('history unavailable'),
    });

    renderPage();

    expectEverySection();
    expect(screen.getAllByText("Can't reach server")).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    const errorKpis = screen.getByTestId('departure-kpis');
    expect(within(errorKpis).queryByText('Departure history is unavailable; use the status below to retry.')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(errorKpis, 'Source unavailable');
    for (const label of ['Next supported departure window', 'Peak modeled likelihood', '24h modeled likelihood',
      'Illustrative planning marker', 'Evidence strength', 'Already included departures']) {
      assertOperationalMetricUnavailable(errorKpis, label);
    }
    expect(
      screen.queryByText('Support index needs qualifying departures'),
    ).toBeNull();
    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(historyRefetch).toHaveBeenCalledTimes(1);
  });

  it('preserves cached evidence and shows one refresh-error retry', () => {
    const cached = weekdayCommute(12);
    h.history = query({
      data: cached,
      isError: true,
      error: new Error('refresh unavailable'),
    });

    const view = renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Departure history could not refresh. Showing the most recently loaded evidence.',
      ),
    ).toBeInTheDocument();
    const quality = within(screen.getByTestId('departure-evidence-quality'));
    expect(quality.getAllByText(String(cached.length)).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    h.history = query({
      data: cached,
      isError: true,
      error: new Error('refresh unavailable'),
      fetchStatus: 'fetching',
      isFetching: true,
    });
    view.rerenderPage();
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
    expect(quality.getAllByText(String(cached.length)).length).toBeGreaterThan(0);
    h.history = query({ data: cached });
    view.rerenderPage();
    expect(screen.queryByTestId('departure-refresh-error')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(screen.getByTestId('departure-kpis'), 'Returned evidence');
    expectEverySection();
  });

  it('shows only the refresh failure recovery when retained history is also paused', () => {
    h.history = query({
      data: weekdayCommute(12),
      isError: true,
      error: new Error('refresh unavailable'),
      fetchStatus: 'paused',
    });
    renderPage();
    expectEverySection();
    expect(screen.getByTestId('departure-refresh-error')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    assertOperationalBriefDisclosure(screen.getByTestId('departure-kpis'), 'Retained source');
  });

  it('shows no prior-only peak, horizon, or marker for empty history', () => {
    h.history = query({ data: [] });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'No drives were returned, so no peak, horizon likelihood, or planning marker is inferred.',
      ),
    ).toBeInTheDocument();
    const kpisSection = screen.getByTestId('departure-kpis');
    const kpis = within(kpisSection);
    expect(kpis.queryByText('—')).not.toBeInTheDocument();
    for (const label of ['Next supported departure window', 'Peak modeled likelihood', '24h modeled likelihood',
      'Illustrative planning marker', 'Evidence strength']) {
      assertOperationalMetricUnavailable(kpisSection, label);
    }
    expect(kpis.getByText('0')).toBeInTheDocument();
    expect(
      screen.queryByText(/% modeled likelihood/),
    ).not.toBeInTheDocument();
  });

  it('marks one departure as thin and withholds the planning marker', () => {
    h.history = query({
      data: [driveAt('2026-05-07T08:05:00.000Z')],
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Thin evidence: estimates remain descriptive, and the illustrative planning marker is unavailable.',
      ),
    ).toBeInTheDocument();
    assertOperationalMetricUnavailable(screen.getByTestId('departure-kpis'), 'Illustrative planning marker');
  });

  it('warns when exactly 1,000 returned rows reach the history cap', () => {
    h.history = query({
      data: Array.from({ length: 1_000 }, (_, index) =>
        driveAt(
          new Date(FROZEN_NOW - (index % 100) * 60_000).toISOString(),
        ),
      ),
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Exactly 1,000 rows were returned. History may be capped, so every finding is limited to the returned 120-day evidence.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The 1,000-row return cap was reached. Included and excluded counts are complete for returned rows, not guaranteed lifetime history.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps unsupported weekdays explicit', () => {
    h.history = query({
      data: [
        driveAt('2026-05-11T08:05:00.000Z'),
        driveAt('2026-05-04T08:05:00.000Z'),
      ],
    });

    renderPage();

    const panel = within(screen.getByTestId('departure-weekday-routines'));
    const monday = panel.getByText('Monday').closest('li');
    const tuesday = panel.getByText('Tuesday').closest('li');
    expect(monday).not.toBeNull();
    expect(tuesday).not.toBeNull();
    expect(within(monday!).getByText('Supported')).toBeInTheDocument();
    expect(within(tuesday!).getByText('Unsupported')).toBeInTheDocument();
    expect(panel.getAllByText('Unsupported')).toHaveLength(6);
  });

  it('buckets a UTC Tuesday start into Monday in vehicle timezone', () => {
    vi.mocked(Date.now).mockReturnValue(
      Date.parse('2026-01-06T01:00:00.000Z'),
    );
    h.timeZone = 'America/Los_Angeles';
    h.history = query({
      data: [driveAt('2026-01-06T00:30:00.000Z')],
    });

    renderPage();

    const panel = within(screen.getByTestId('departure-weekday-routines'));
    expect(
      within(panel.getByText('Monday').closest('li')!).getByText(
        'Supported',
      ),
    ).toBeInTheDocument();
    expect(
      within(panel.getByText('Tuesday').closest('li')!).getByText(
        'Unsupported',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryAllByText(/America\/Los_Angeles/).length,
    ).toBe(0);
  });

  it('distinguishes repeated fall-back hour labels by UTC offset', () => {
    const first = departureChartLabel(
      Date.parse('2026-11-01T08:00:00.000Z'),
      'en-US',
      'America/Los_Angeles',
    );
    const repeated = departureChartLabel(
      Date.parse('2026-11-01T09:00:00.000Z'),
      'en-US',
      'America/Los_Angeles',
    );

    expect(first).toContain('GMT-7');
    expect(repeated).toContain('GMT-8');
    expect(first).not.toBe(repeated);
  });

  it('provides chart summaries and accessible data-backed labels', () => {
    renderPage();

    for (const label of [
      'Hourly and cumulative modeled departure likelihood across the next 24 vehicle-timezone hour boundaries',
      'Weekly returned departure events and active local driving days across the elapsed model-timezone span',
    ]) {
      expect(screen.getByRole('group', { name: label })).toBeInTheDocument();
    }
    for (const label of [
      'Seven-day by 24-hour heatmap of supported recorded departures and modeled likelihood',
      'Bar chart of recorded departures by local hour with four daypart summaries',
    ]) {
      expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
    }
    expect(
      screen.getAllByText('Modeled likelihood (%)').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText('Recorded departures').length,
    ).toBeGreaterThan(0);
  });
});
