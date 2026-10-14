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

import { departureChartLabel } from '../components/departure-forecast/labels';

const FROZEN_NOW = Date.parse('2026-05-14T06:30:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as unknown,
  historyHook: vi.fn(),
  timezoneHook: vi.fn(),
  timeZone: 'UTC',
}));

const historyRefetch = vi.fn();

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
    vehicle: null,
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
      return h.timeZone;
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
  h.history = query({ data: weekdayCommute(12) });
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
});

describe('DepartureForecastPage', () => {
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

  it('preserves every modeled window while a retained history refresh is paused offline', () => {
    h.history = { ...query({ data: weekdayCommute(12) }), fetchStatus: 'paused' };
    renderPage();
    expectEverySection();
    const notice = screen.getByTestId('stale-refresh-warning');
    expect(notice).toHaveTextContent(
      'The latest values are temporarily unavailable. Previously loaded data remains visible.',
    );
    expect(notice).toHaveAttribute('data-refresh-blocked', 'true');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).not.toHaveTextContent(/offline|failed/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }));
    expect(historyRefetch).toHaveBeenCalledTimes(1);
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
    expect(
      screen.getAllByText('Waiting for returned drive history…'),
    ).toHaveLength(6);
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
    expect(
      screen.getAllByText(
        'Departure history is unavailable; use the status below to retry.',
      ),
    ).toHaveLength(6);
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

    renderPage();

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
    const kpis = within(screen.getByTestId('departure-kpis'));
    expect(kpis.getAllByText('—').length).toBeGreaterThanOrEqual(5);
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
    const kpis = within(screen.getByTestId('departure-kpis'));
    expect(kpis.getByText('Illustrative planning marker')).toBeInTheDocument();
    expect(kpis.getAllByText('—').length).toBeGreaterThan(0);
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
      screen.getAllByText(/America\/Los_Angeles/).length,
    ).toBeGreaterThan(0);
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
      'Weekly recorded departure events and active local driving days across the observed vehicle-timezone span',
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
