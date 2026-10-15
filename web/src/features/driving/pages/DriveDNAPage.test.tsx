import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/feedback';
import type { Drive, DriveTelemetryPoint } from '@/types/driving';
import { resolveChartPalette } from '@/hooks/useChartPalette';
import { fmtNumber } from '@/lib/numberFormat';

const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as unknown,
  telemetry: undefined as unknown,
  historyHook: vi.fn(),
  telemetryHook: vi.fn(),
  locale: 'en-US',
  timeZone: 'America/Los_Angeles',
  timezoneHook: vi.fn(),
  chartPalette: 'cb_safe',
  measureCharts: false,
}));

const historyRefetch = vi.fn();
const telemetryRefetch = vi.fn();

vi.mock('@/hooks/useChartPalette', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useChartPalette')>();
  return {
    ...actual,
    useChartPalette: () => actual.resolveChartPalette(h.chartPalette),
  };
});

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
      width,
      height,
    }: {
      children: ReactElement<{ width: number; height: number }>;
      width: string | number;
      height: string | number;
    }) => h.measureCharts
      ? cloneElement(children, { width: 800, height: 320 })
      : <actual.ResponsiveContainer width={width} height={height}>{children}</actual.ResponsiveContainer>,
  };
});

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
      i18n: { language: 'en', changeLanguage: vi.fn() },
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
    useDriveTelemetry: (driveId: string) => {
      h.telemetryHook(driveId);
      return h.telemetry;
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
  return { ...actual, useTimezone: (mode: string) => {
    h.timezoneHook(mode);
    return h.timeZone;
  } };
});

vi.mock('@/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>();
  return {
    ...actual,
    useSettings: () => {
      const result = actual.useSettings();
      return {
        ...result,
        locale: h.locale,
        settings: { ...result.settings, locale: h.locale, tz_display_default: 'utc' },
      };
    },
  };
});

const unitPrefs = {
  distance: 'km',
  speed: 'km/h',
  temperature: '°C',
  pressure: 'bar',
  energy: 'kWh',
  duration: 'h',
  power: 'kW',
  locale: 'en-US',
  precision: 1,
} as const;

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs,
    formatDistance: (value: number | null | undefined) =>
      value == null ? '—' : `${value / 1_000} km`,
    formatSpeed: (value: number | null | undefined) =>
      value == null ? '—' : `${value * 3.6} km/h`,
    formatTemperature: (value: number | null | undefined) =>
      value == null ? '—' : `${value}°C`,
    formatPressure: (value: number | null | undefined) =>
      value == null ? '—' : `${value} bar`,
    formatEnergy: (value: number | null | undefined) =>
      value == null ? '—' : `${value / 1_000} kWh`,
    formatDuration: (value: number | null | undefined) =>
      value == null ? '—' : `${value / 3_600} h`,
    formatPower: (value: number | null | undefined) =>
      value == null ? '—' : `${value / 1_000} kW`,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import {
  DRIVE_DNA_SVG_REVOKE_DELAY_MS,
  buildDriveDnaSvg,
} from '../components/drive-dna';
import { buildDriveDnaModel } from '../lib/driveDNA';
import DriveDNAPage from './DriveDNAPage';

function drive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicleId: 7,
    startTs: '2026-02-01T18:00:00Z',
    endTs: '2026-02-01T18:30:00Z',
    durationS: 1_800,
    distanceM: 25_000,
    startAddress: 'Start',
    endAddress: 'End',
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 8_000,
    regenEnergyWh: 1_000,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 5_000,
    outsideTempAvgC: 12,
    insideTempAvgC: 21,
    score: null,
    endedStatus: 'completed',
    createdAt: '2026-02-01T18:00:00Z',
    updatedAt: '2026-02-01T18:30:00Z',
    ...overrides,
  };
}

function telemetryPoint(
  seconds: number,
  overrides: Partial<DriveTelemetryPoint> = {},
): DriveTelemetryPoint {
  const createdAt = new Date(
    Date.parse('2026-02-01T18:00:00Z') + seconds * 1_000,
  ).toISOString();
  return {
    timestamp: createdAt,
    createdAt,
    speed: 10 + seconds / 10,
    // Endpoint response semantics are kW; the model lifts this to W.
    // Telemetry power is watts (pack voltage × current).
    power: seconds % 20 === 0 ? -5_000 : 12_000,
    batteryLevel: null,
    outsideTemp: 10,
    insideTemp: 21,
    driverTemp: 21,
    passengerTemp: 21,
    elevation: 100 + seconds,
    idealRange: null,
    ratedRange: null,
    estRange: null,
    odometer: null,
    soc: 80 - seconds / 20,
    usableSoc: null,
    tirePressureFl: null,
    tirePressureFr: null,
    tirePressureRl: null,
    tirePressureRr: null,
    isClimateOn: false,
    fanStatus: null,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  isPending?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  dataUpdatedAt?: number;
}

function query(
  overrides: Partial<QueryStub> = {},
  refetch = historyRefetch,
): QueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data: undefined,
    isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    refetch,
    ...overrides,
  };
}

function testTree(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/driving/drive-dna']}>
          <DriveDNAPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(testTree(client));
  return {
    ...view,
    rerenderPage: () => view.rerender(testTree(client)),
  };
}

const sectionIds = [
  'drive-dna-kpis',
  'drive-dna-fingerprint',
  'drive-dna-genome',
  'drive-dna-encoding',
  'drive-dna-speed-power',
  'drive-dna-soc-elevation',
  'drive-dna-power-distribution',
  'drive-dna-speed-distribution',
  'drive-dna-coverage',
  'drive-dna-methodology',
] as const;

function expectEverySection(): void {
  for (const testId of sectionIds) {
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.locale = 'en-US';
  h.timeZone = 'America/Los_Angeles';
  h.chartPalette = 'cb_safe';
  h.measureCharts = false;
  h.history = query({
    data: [
      drive(),
      drive({
        id: 2,
        startTs: '2026-02-02T18:00:00Z',
        distanceM: 12_000,
      }),
    ],
  });
  h.telemetry = query(
    {
      data: [
        telemetryPoint(0),
        telemetryPoint(10),
        telemetryPoint(20),
        telemetryPoint(40),
      ],
    },
    telemetryRefetch,
  );
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:drive-dna'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
    configurable: true,
    value: vi.fn(),
  });
});

describe('DriveDNAPage', () => {
  it('omits header freshness and refresh when no vehicle is selected, even with cached query errors', () => {
    h.vehicleId = null;
    h.history = query({ data: [drive()], isError: true, error: new Error('inactive history') });
    h.telemetry = query({ isError: true, error: new Error('inactive telemetry') }, telemetryRefetch);
    renderPage();

    expect(screen.queryByRole('button', { name: /Refresh data/ })).not.toBeInTheDocument();
    expect(h.historyHook).toHaveBeenLastCalledWith(undefined, 1_000);
    expect(h.telemetryHook).toHaveBeenLastCalledWith('');
    expect(historyRefetch).not.toHaveBeenCalled();
    expect(telemetryRefetch).not.toHaveBeenCalled();
    expectEverySection();
  });

  it('refreshes only scoped history when there is no active drive, then includes populated telemetry', () => {
    h.history = query({ data: [], dataUpdatedAt: Date.now() });
    h.telemetry = query({ isError: true, error: new Error('inactive telemetry') }, telemetryRefetch);
    const view = renderPage();

    const refresh = screen.getByRole('button', { name: /Refresh data/ });
    expect(refresh).not.toHaveAccessibleName(/Error/i);
    fireEvent.click(refresh);
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    expect(telemetryRefetch).not.toHaveBeenCalled();
    expect(h.telemetryHook).toHaveBeenLastCalledWith('');
    expectEverySection();

    h.history = query({ data: [drive()], dataUpdatedAt: Date.now() });
    h.telemetry = query({
      data: [telemetryPoint(0), telemetryPoint(10)],
      isStale: true,
      dataUpdatedAt: Date.now() - 60_000,
    }, telemetryRefetch);
    view.rerenderPage();
    fireEvent.click(screen.getByRole('button', { name: /Refresh data.*Stale/i }));
    expect(telemetryRefetch).toHaveBeenCalledTimes(1);
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    expect(h.telemetryHook).toHaveBeenLastCalledWith('1');
    expect(screen.getByLabelText(/Drive DNA deterministic emission artwork/)).toBeInTheDocument();
    expectEverySection();
  });

  it('uses neutral theme roles for encoding chrome without changing populated evidence or availability', () => {
    const view = renderPage();
    const section = screen.getByTestId('drive-dna-encoding');
    const title = within(section).getByText('Encoding legend & evidence');
    expect(title.querySelector('svg')).toHaveClass(
      'h-4', 'w-4', 'text-[var(--text-secondary)]',
    );

    for (const name of ['Journey progress', 'Speed', 'Pack power', 'State of charge', 'Elevation']) {
      const card = within(section).getByText(name).parentElement!;
      expect(card).toHaveClass(
        'rounded-xl', 'border', 'border-[var(--border-subtle)]',
        'bg-[var(--surface-2)]', 'p-3',
      );
      expect(card.querySelector('svg')?.parentElement).toHaveClass(
        'text-[var(--text-secondary)]',
      );
      expect(within(card).getByText('Available')).toHaveClass(
        'text-[var(--semantic-success)]',
      );
    }
    expect(within(section).getByText('4 valid timestamp rows')).toBeInTheDocument();
    expect(within(section).getByText('36 km/h to 50.4 km/h')).toBeInTheDocument();
    expect(within(section).getByText('-5 kW to 12 kW')).toBeInTheDocument();
    expect(within(section).getByText(`${fmtNumber(78)}% to ${fmtNumber(80)}%`)).toBeInTheDocument();
    expect(within(section).getByText(`${fmtNumber(100)} m to ${fmtNumber(140)} m`)).toBeInTheDocument();
    expect(section.querySelector('[class*="text-cyan-"], [class*="border-white/"], [class*="bg-white/"]'))
      .not.toBeInTheDocument();

    h.telemetry = query({
      data: [
        telemetryPoint(0, { speed: null, elevation: null }),
        telemetryPoint(10, { elevation: null }),
      ],
    }, telemetryRefetch);
    view.rerenderPage();
    const speed = within(section).getByText('Speed').parentElement!;
    const elevation = within(section).getByText('Elevation').parentElement!;
    expect(within(speed).getByText('Partial')).toHaveClass(
      'text-[var(--semantic-warning)]',
    );
    expect(within(elevation).getByText('Unavailable')).toHaveClass(
      'text-[var(--text-secondary)]',
    );
    expect(within(elevation).getByText('No available range')).toBeInTheDocument();
    expectEverySection();
  });

  it('reactively recolors speed, power, zero reference, and legend without changing the trace or DNA art', async () => {
    h.measureCharts = true;
    const view = renderPage();
    const section = screen.getByTestId('drive-dna-speed-power');
    const art = screen.getByTestId('drive-dna-genome').querySelector('svg')?.outerHTML;
    const fingerprint = screen.getByTestId('drive-dna-fingerprint').innerHTML;
    const traceGeometry = () =>
      Array.from(section.querySelectorAll('.recharts-line-curve')).map(
        (curve) => curve.getAttribute('d'),
      );
    const expectPalette = async (preference: string) => {
      const palette = resolveChartPalette(preference);
      await waitFor(() => {
        const curves = section.querySelectorAll('.recharts-line-curve');
        expect(curves).toHaveLength(2);
        expect(curves[0]).toHaveAttribute('stroke', palette[0]);
        expect(curves[1]).toHaveAttribute('stroke', palette[3]);
        expect(section.querySelector('.recharts-reference-line-line'))
          .toHaveAttribute('stroke', palette[4]);
      });
      const legend = within(section).getByRole('list');
      expect(within(legend).getByRole('button', { name: /Speed/ })).toBeInTheDocument();
      expect(within(legend).getByRole('button', { name: /power/i })).toBeInTheDocument();
      // Recharts 3 renders the legend icon itself as the path.
      const swatches = legend.querySelectorAll('path.recharts-legend-icon, .recharts-legend-icon path');
      expect(swatches).toHaveLength(2);
      expect(swatches[0]).toHaveAttribute('stroke', palette[0]);
      expect(swatches[1]).toHaveAttribute('stroke', palette[3]);
    };

    await expectPalette('cb_safe');
    const geometry = traceGeometry();
    expect(geometry.every(Boolean)).toBe(true);
    h.chartPalette = 'neon';
    view.rerenderPage();
    await expectPalette('neon');
    expect(traceGeometry()).toEqual(geometry);
    expect(screen.getByTestId('drive-dna-genome').querySelector('svg')?.outerHTML).toBe(art);
    expect(screen.getByTestId('drive-dna-fingerprint').innerHTML).toBe(fingerprint);
    expectEverySection();
  });

  it('gives genome export a wrapping mobile target while retaining desktop density, focus, and export behavior', () => {
    const view = renderPage();
    const button = within(screen.getByTestId('drive-dna-genome')).getByRole(
      'button', { name: 'Download safe SVG' },
    );

    expect(button).toHaveClass(
      'min-h-11', 'md:min-h-10', 'w-full', 'h-auto', 'whitespace-normal',
      'focus-visible:outline', 'focus-visible:outline-2',
    );
    expect(button).not.toHaveClass('h-10');
    expect(within(button).getByText('Download safe SVG')).toHaveClass(
      'min-w-0', 'break-words',
    );
    expect(button.querySelector('svg')?.parentElement).toHaveClass('shrink-0');
    expect(button).toBeEnabled();
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(button).toHaveFocus();

    h.telemetry = query({ data: [] }, telemetryRefetch);
    view.rerenderPage();
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expectEverySection();
  });

  it.each([
    ['de-DE', 'Europe/Berlin'],
    ['en-GB', 'America/Los_Angeles'],
  ])('formats brief dates with saved locale %s and vehicle zone %s without changing raw dates', (locale, timeZone) => {
    h.locale = locale;
    h.timeZone = timeZone;
    const selectedDrive = drive({
      startTs: '2026-02-02T00:15:00Z',
      endTs: '2026-02-02T00:45:00Z',
    });
    h.history = query({ data: [selectedDrive] });
    const view = renderPage();
    const formatted = (value: string) => new Date(value).toLocaleString(h.locale, {
      timeZone: h.timeZone,
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const expectScope = () => {
      expect(within(screen.getByTestId('drive-dna-kpis')).getByText(
        `Drive 1 · ${formatted(selectedDrive.startTs)}–${formatted(selectedDrive.endTs!)}; sampled coverage may be incomplete`,
      )).toBeInTheDocument();
      expectEverySection();
    };
    expectScope();
    // The brief scope above is formatted in the vehicle zone; shared shell badges may
    // still follow the user's default display zone ('utc' in this fixture).
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');

    h.locale = 'fr-FR';
    h.timeZone = 'Asia/Tokyo';
    view.rerenderPage();
    expectScope();
    expect(selectedDrive.startTs).toBe('2026-02-02T00:15:00Z');
    expect(selectedDrive.endTs).toBe('2026-02-02T00:45:00Z');
  });

  it('keeps an ongoing end null while formatting the brief start date', () => {
    h.locale = 'de-DE';
    h.timeZone = 'Europe/Berlin';
    const selectedDrive = drive({ endTs: null, endedStatus: 'ongoing' });
    h.history = query({ data: [selectedDrive] });
    renderPage();

    const start = new Date(selectedDrive.startTs).toLocaleString(h.locale, {
      timeZone: h.timeZone,
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    expect(within(screen.getByTestId('drive-dna-kpis')).getByText(
      `Drive 1 · ${start}–ongoing; sampled coverage may be incomplete`,
    )).toBeInTheDocument();
    expect(selectedDrive.endTs).toBeNull();
    expectEverySection();
  });

  it('associates a visible drive label and history hint with the native selector', () => {
    renderPage();

    const picker = screen.getByRole('combobox', { name: 'Choose a drive' });
    const label = screen.getByText('Choose a drive', { selector: 'label' });
    expect(label).toHaveAttribute('for', picker.id);
    expect(screen.getByLabelText('Choose a drive')).toBe(picker);
    expect(picker).toHaveAccessibleDescription(
      'Selection history is capped at 1,000 recent drives.',
    );
    picker.focus();
    expect(picker).toHaveFocus();
    expect(picker).toHaveValue('1');
    expectEverySection();
  });

  it('keeps the selected fingerprint during a paused list refresh without retrying telemetry', () => {
    h.history = { ...query({ data: [drive()] }), fetchStatus: 'paused' };
    renderPage();
    expectEverySection();
    const notice = screen.getByTestId('stale-refresh-warning');
    expect(notice).toHaveTextContent(
      'The latest values are temporarily unavailable. Previously loaded data remains visible.',
    );
    expect(notice).toHaveAttribute('data-refresh-blocked', 'true');
    expect(notice).not.toHaveTextContent('offline');
    fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }));
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    expect(telemetryRefetch).not.toHaveBeenCalled();
    expect(h.telemetryHook).toHaveBeenLastCalledWith('1');
  });

  it.each(['history', 'telemetry'] as const)(
    'keeps initial paused %s unknown, retries it independently, and recovers',
    (source) => {
      const paused = query({
        isSuccess: false,
        isPending: true,
        isFetching: false,
        fetchStatus: 'paused',
      }, source === 'history' ? historyRefetch : telemetryRefetch);
      if (source === 'history') {
        h.history = paused;
      } else {
        h.telemetry = paused;
      }
      const view = renderPage();

      expectEverySection();
      const notice = screen.getByRole('status');
      expect(notice).toHaveAttribute('data-refresh-blocked');
      expect(notice).toHaveTextContent(
        'The initial evidence query is paused; no empty result is inferred.',
      );
      expect(notice).not.toHaveTextContent(/offline|can't reach server/i);
      expect(screen.queryByTestId('drive-dna-list-loading')).not.toBeInTheDocument();
      expect(screen.queryByTestId('drive-dna-telemetry-loading')).not.toBeInTheDocument();
      expect(screen.queryByText('No drives were returned for this vehicle.')).not.toBeInTheDocument();
      expect(screen.queryByText('This drive returned no telemetry emissions.')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      if (source === 'history') {
        expect(h.telemetryHook).toHaveBeenLastCalledWith('');
        expect(screen.getByRole('combobox', { name: 'Choose a drive' })).toHaveTextContent('Refresh paused');
      } else {
        expect(screen.getByText('25 km')).toBeInTheDocument();
      }
      fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
      expect(source === 'history' ? historyRefetch : telemetryRefetch).toHaveBeenCalledTimes(1);
      expect(source === 'history' ? telemetryRefetch : historyRefetch).not.toHaveBeenCalled();

      if (source === 'history') {
        h.history = query({ data: [drive()] });
      } else {
        h.telemetry = query({ data: [telemetryPoint(0), telemetryPoint(10)] }, telemetryRefetch);
      }
      view.rerenderPage();
      expectEverySection();
      expect(screen.queryByText(
        'The initial evidence query is paused; no empty result is inferred.',
      )).not.toBeInTheDocument();
      expect(screen.getByLabelText(/Drive DNA deterministic emission artwork/)).toBeInTheDocument();
      expect(h.telemetryHook).toHaveBeenLastCalledWith('1');
    },
  );

  it('ignores blocked queries whose vehicle or drive prerequisite is absent', () => {
    h.vehicleId = null;
    h.history = query({ isSuccess: false, fetchStatus: 'paused' });
    h.telemetry = query({ isSuccess: false, fetchStatus: 'paused' }, telemetryRefetch);
    renderPage();
    expectEverySection();
    expect(screen.queryByText(
      'The initial evidence query is paused; no empty result is inferred.',
    )).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drive-dna-list-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drive-dna-telemetry-loading')).not.toBeInTheDocument();
    expect(h.telemetryHook).toHaveBeenLastCalledWith('');
  });

  it('retains both sources through refresh failures and recovers each independently', () => {
    const history = [drive()];
    const telemetry = [telemetryPoint(0), telemetryPoint(10)];
    h.history = query({ data: history, isError: true, error: new Error('history refresh failed') });
    h.telemetry = query({ data: telemetry, isError: true, error: new Error('telemetry refresh failed') }, telemetryRefetch);
    const view = renderPage();
    expectEverySection();
    expect(screen.getByLabelText(/Drive DNA deterministic emission artwork/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('drive-dna-list-refresh-error')).getByRole('button', { name: 'Retry' }));
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    expect(telemetryRefetch).not.toHaveBeenCalled();

    h.history = query({ data: history });
    view.rerenderPage();
    expectEverySection();
    expect(screen.queryByTestId('drive-dna-list-refresh-error')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('drive-dna-telemetry-refresh-error')).getByRole('button', { name: 'Retry' }));
    expect(telemetryRefetch).toHaveBeenCalledTimes(1);
    h.telemetry = query({ data: telemetry }, telemetryRefetch);
    view.rerenderPage();
    expectEverySection();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Drive DNA deterministic emission artwork/)).toBeInTheDocument();
  });

  it('renders the ready state with all ten persistent evidence sections', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Drive DNA' }),
    ).toBeInTheDocument();
    expectEverySection();
    for (const title of [
      'Selected-drive evidence',
      'Emission fingerprint',
      'Genome identity',
      'Encoding legend & evidence',
      'Speed & power emission profile',
      'SoC & elevation context',
      'Power states by telemetry-emission count',
      'Speed bands by telemetry-emission count',
      'Signal coverage & cadence',
      'Coverage & methodology',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(h.historyHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.telemetryHook).toHaveBeenLastCalledWith('1');
  });

  it('renders methodology cards once while preserving all scope and guardrail evidence', () => {
    renderPage();

    const methodology = within(screen.getByTestId('drive-dna-methodology'));
    for (const title of [
      'Coverage & methodology',
      'Selection & telemetry scope',
      'Interpretation guardrails',
    ]) {
      expect(methodology.getAllByRole('heading', { name: title })).toHaveLength(1);
    }
    const lists = methodology.getAllByRole('list');
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    }
    for (const evidence of [
      'The 1,000-drive cap qualifies only which drives can appear in the selector.',
      'The selected drive’s telemetry endpoint returns that drive’s full available emission feed and is not truncated by the selector cap.',
      'Elevation and other optional channels may be unavailable; missing values remain unavailable, never measured zero.',
      'Charts use at most 600 deterministic points while retaining the first and last; evidence metrics use all valid rows.',
      'Rows are chronological change-feed emissions with values forward-folded by StateReader, not uniform-time samples.',
      'Response power is already canonical watts (pack voltage × current) and is used without rescaling.',
      'Power states, speed bands, and regen shares are emission-count evidence, never duration or time shares.',
      'Traits are deterministic artistic heuristics—not a score, diagnosis, stable personality assessment, efficiency verdict, or causal claim.',
      'Selector history resolved',
      'Drive telemetry resolved',
      'The selector requests up to 1,000 recent drives; 2 were returned for the current vehicle.',
    ]) {
      expect(methodology.getAllByText(evidence)).toHaveLength(1);
    }
    expectEverySection();
  });

  it('keeps every shell visible and suppresses telemetry while the list loads', () => {
    h.history = query({ isLoading: true });

    renderPage();

    expectEverySection();
    expect(h.telemetryHook).toHaveBeenLastCalledWith('');
    expect(
      screen
        .getByTestId('drive-dna-fingerprint')
        .querySelectorAll('[class*="--skeleton-bg"]').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByLabelText('Loading drive history').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('status', { name: 'Loading drive history' }),
    ).toHaveLength(1);
  });

  it('keeps every shell visible on a list error and never requests stale telemetry', () => {
    h.history = query({
      isError: true,
      error: new Error('history unavailable'),
    });

    renderPage();

    expectEverySection();
    expect(h.telemetryHook).toHaveBeenLastCalledWith('');
    expect(screen.getAllByText("Can't reach server")).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1);
    expect(screen.getByText('Selector history unavailable')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByTestId('drive-dna-list-error')).getByRole(
        'button',
        { name: 'Retry' },
      ),
    );
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    expect(telemetryRefetch).not.toHaveBeenCalled();
  });

  it('keeps cached drive-list evidence visible after a refetch failure', () => {
    h.history = query({
      data: [drive()],
      isError: true,
      error: new Error('history refresh unavailable'),
    });

    renderPage();

    expectEverySection();
    expect(h.telemetryHook).toHaveBeenLastCalledWith('1');
    expect(screen.getByText('25 km')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Drive DNA deterministic emission artwork/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Drive history could not refresh. Showing the most recently loaded drives.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1);

    fireEvent.click(
      within(screen.getByTestId('drive-dna-list-refresh-error')).getByRole(
        'button',
        { name: 'Retry' },
      ),
    );
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    expect(telemetryRefetch).not.toHaveBeenCalled();
  });

  it('renders explicit list-empty states without a telemetry request', () => {
    h.history = query({ data: [] });

    renderPage();

    expectEverySection();
    expect(h.telemetryHook).toHaveBeenLastCalledWith('');
    expect(
      screen.getAllByText('No drives were returned for this vehicle.').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('combobox', { name: 'Choose a drive' })).toBeDisabled();
  });

  it('retains selected-drive metadata while telemetry loads', () => {
    h.telemetry = query(
      { isLoading: true },
      telemetryRefetch,
    );

    renderPage();

    expectEverySection();
    expect(screen.getByText('25 km')).toBeInTheDocument();
    expect(screen.getByText('0.5 h')).toBeInTheDocument();
    expect(
      screen.getAllByLabelText('Loading selected-drive telemetry').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('status', {
        name: 'Loading selected-drive telemetry',
      }),
    ).toHaveLength(1);
  });

  it('isolates a telemetry error without blanking selected-drive metadata', () => {
    h.telemetry = query(
      { isError: true, error: new Error('telemetry unavailable') },
      telemetryRefetch,
    );

    renderPage();

    expectEverySection();
    expect(screen.getByText('25 km')).toBeInTheDocument();
    expect(screen.getByText('0.5 h')).toBeInTheDocument();
    expect(screen.getAllByText("Can't reach server")).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1);
    const error = screen.getByTestId('drive-dna-telemetry-error');
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));
    expect(telemetryRefetch).toHaveBeenCalledTimes(1);
    expect(historyRefetch).not.toHaveBeenCalled();
  });

  it('keeps cached telemetry fingerprint evidence visible after a refetch failure', () => {
    h.telemetry = query(
      {
        data: [
          telemetryPoint(0),
          telemetryPoint(10),
          telemetryPoint(20),
        ],
        isError: true,
        error: new Error('telemetry refresh unavailable'),
      },
      telemetryRefetch,
    );

    renderPage();

    expectEverySection();
    expect(screen.getByText('25 km')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Drive DNA deterministic emission artwork/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Drive telemetry could not refresh. Showing the most recently loaded fingerprint and evidence.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1);

    fireEvent.click(
      within(
        screen.getByTestId('drive-dna-telemetry-refresh-error'),
      ).getByRole('button', { name: 'Retry' }),
    );
    expect(telemetryRefetch).toHaveBeenCalledTimes(1);
    expect(historyRefetch).not.toHaveBeenCalled();
  });

  it('keeps all shells explicit for no telemetry and for one telemetry row', () => {
    h.telemetry = query({ data: [] }, telemetryRefetch);
    const view = renderPage();

    expectEverySection();
    expect(
      screen.getAllByText('This drive returned no telemetry emissions.').length,
    ).toBeGreaterThan(0);
    const coverage = within(screen.getByTestId('drive-dna-coverage'));
    expect(
      coverage.getByText(
        'No telemetry rows were returned for cadence or channel coverage.',
      ),
    ).toBeInTheDocument();
    expect(
      coverage.getAllByText(/^0\s*\/\s*0$/, {
        selector:
          '[data-operational-brief] [role="list"] [data-operational-metric] [data-operational-value]',
      }),
    ).toHaveLength(6);
    expect(
      coverage.getAllByText('No valid-row denominator'),
    ).toHaveLength(5);
    expect(
      coverage.queryByText(
        'One chronological emission is available; at least two are needed for this profile.',
      ),
    ).not.toBeInTheDocument();

    h.telemetry = query(
      { data: [telemetryPoint(0, { speed: 0, power: 0, soc: 0 })] },
      telemetryRefetch,
    );
    view.rerenderPage();

    expectEverySection();
    expect(
      screen.getByLabelText(/Drive DNA deterministic emission artwork/),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        'One chronological emission is available; at least two are needed for this profile.',
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('shows honest partial states when speed, power, and elevation are missing', () => {
    h.telemetry = query(
      {
        data: [0, 10, 20].map((seconds) =>
          telemetryPoint(seconds, {
            speed: null,
            power: null,
            elevation: null,
            soc: 80 - seconds / 10,
          }),
        ),
      },
      telemetryRefetch,
    );

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Unavailable speed or power channels use neutral geometry and color; they are not encoded as measured zero.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Speed and power channels are unavailable for these emissions.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Elevation is unavailable for this drive; available SoC context remains visible.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No emissions contain available power, so no power state is inferred.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No emissions contain available speed, so no speed band is inferred.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No artistic trait was assigned; unavailable speed or power never creates a substitute trait.',
      ),
    ).toBeInTheDocument();
  });

  it('warns when the 1,000-drive selector history cap is reached', () => {
    h.history = query({
      data: Array.from({ length: 1_000 }, (_, index) =>
        drive({ id: index + 1 }),
      ),
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Newest 1,000 drives shown; older drives may be outside this selector.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The selector returned the newest 1,000 drives and reached its cap; older drives may not be selectable.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The selector reached its 1,000-drive history cap; it does not truncate the selected drive’s full available telemetry emission feed or establish complete drive observations.',
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ['loading', { isLoading: true }],
    ['failed', { isError: true, error: new Error('telemetry unavailable') }],
    ['empty', { data: [] }],
    ['sparse', { data: [telemetryPoint(0)] }],
  ] satisfies [string, Partial<QueryStub>][])(
    'qualifies selector-cap independence when telemetry is %s',
    (_status, telemetry) => {
      h.history = query({
        data: Array.from({ length: 1_000 }, (_, index) =>
          drive({ id: index + 1 }),
        ),
      });
      h.telemetry = query(telemetry, telemetryRefetch);

      renderPage();

      expectEverySection();
      expect(
        within(screen.getByTestId('drive-dna-kpis')).getByText(
          'The selector reached its 1,000-drive history cap; it does not truncate the selected drive’s full available telemetry emission feed or establish complete drive observations.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/telemetry remains complete for that drive/),
      ).not.toBeInTheDocument();
      expect(
        within(screen.getByTestId('drive-dna-methodology')).getByText(
          'The selected drive’s telemetry endpoint returns that drive’s full available emission feed and is not truncated by the selector cap.',
        ),
      ).toBeInTheDocument();
      expect(h.historyHook).toHaveBeenLastCalledWith('7', 1_000);
      expect(h.telemetryHook).toHaveBeenLastCalledWith('1');
    },
  );

  it('requests telemetry for the drive selected with the shared Select', async () => {
    renderPage();
    const picker = screen.getByRole('combobox', { name: 'Choose a drive' });

    fireEvent.change(picker, { target: { value: '2' } });

    await waitFor(() => {
      expect(h.telemetryHook).toHaveBeenLastCalledWith('2');
    });
    expect(picker).toHaveValue('2');
  });

  it('derives a valid fallback when a selection leaves the list and disables stale requests during vehicle loading', async () => {
    const view = renderPage();
    const picker = screen.getByRole('combobox', { name: 'Choose a drive' });
    fireEvent.change(picker, { target: { value: '2' } });
    await waitFor(() => expect(h.telemetryHook).toHaveBeenLastCalledWith('2'));

    h.history = query({
      data: [drive({ id: 3, vehicleId: 7 })],
    });
    view.rerenderPage();
    await waitFor(() => expect(h.telemetryHook).toHaveBeenLastCalledWith('3'));
    expect(screen.getByRole('combobox', { name: 'Choose a drive' })).toHaveValue('3');

    h.vehicleId = 8;
    h.history = query({ isLoading: true });
    view.rerenderPage();
    await waitFor(() => expect(h.telemetryHook).toHaveBeenLastCalledWith(''));

    h.history = query({
      data: [drive({ id: 4, vehicleId: 8 })],
    });
    view.rerenderPage();
    await waitFor(() => expect(h.telemetryHook).toHaveBeenLastCalledWith('4'));
    expect(h.historyHook).toHaveBeenLastCalledWith('8', 1_000);
  });

  it('escapes XML export text and performs a local safe SVG download', () => {
    const model = buildDriveDnaModel([
      telemetryPoint(0),
      telemetryPoint(10),
    ]);
    const unsafe = `<Drive & "quoted">'`;
    const svg = buildDriveDnaSvg(model.genome, unsafe);
    expect(svg).toContain('&lt;Drive &amp; &quot;quoted&quot;&gt;&apos;');
    expect(svg).not.toContain(unsafe);

    let downloaded = '';
    const click = vi.mocked(HTMLAnchorElement.prototype.click);
    click.mockImplementation(function captureDownload() {
      downloaded = this.download;
    });
    renderPage();
    vi.useFakeTimers();
    try {
      fireEvent.click(
        screen.getByRole('button', { name: 'Download safe SVG' }),
      );

      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalledTimes(1);
      expect(downloaded).toMatch(/^drive-dna-[0-9A-Z]{7}\.svg$/);
      expect(
        document.querySelector('a[download^="drive-dna-"]'),
      ).not.toBeInTheDocument();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();

      vi.advanceTimersByTime(DRIVE_DNA_SVG_REVOKE_DELAY_MS - 1);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:drive-dna');
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});
