import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SHARE_CARD_SVG_REVOKE_DELAY_MS } from '../lib/shareCard';

interface QueryStub {
  data: readonly unknown[] | undefined;
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  query: undefined as unknown,
  drivesHook: vi.fn(),
  timezone: 'America/Los_Angeles',
  distance: 'km' as 'km' | 'mi',
  refetch: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, options?: unknown) => {
      const text = typeof fallback === 'string' ? fallback : _key;
      const values = options && typeof options === 'object'
        ? options as Record<string, unknown>
        : {};
      return text.replace(
        /\{\{\s*(\w+)\s*\}\}/g,
        (_match, name: string) =>
          values[name] != null ? String(values[name]) : '',
      );
    },
    i18n: { language: 'en-US', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: (vehicleId: string | undefined, options: unknown) => {
    h.drivesHook(vehicleId, options);
    return h.query;
  },
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId }),
}));

vi.mock('@/lib/timezone', () => ({
  useTimezone: () => h.timezone,
}));

vi.mock('@/hooks/useUnits', async () => {
  const units = await vi.importActual<typeof import('@/lib/unitConversion')>(
    '@/lib/unitConversion',
  );
  return {
    useUnits: () => {
      const unitPrefs: import('@/lib/unitConversion').UnitPref = {
        distance: h.distance,
        speed: h.distance === 'mi' ? 'mph' : 'km/h',
        temperature: '°C',
        pressure: 'bar',
        energy: 'kWh',
        duration: 'h',
        power: 'kW',
        locale: 'en-US',
        precision: 1,
      };
      return {
        unitPrefs,
        formatDistance: (
          value: number | null | undefined,
          options?: { precision?: number },
        ) => units.formatDistance(value, unitPrefs, options),
        formatDuration: (
          value: number | null | undefined,
          options?: { precision?: number },
        ) => units.formatDuration(value, unitPrefs, options),
        formatEnergy: (
          value: number | null | undefined,
          options?: { precision?: number },
        ) => units.formatEnergy(value, unitPrefs, options),
        formatSpeed: (
          value: number | null | undefined,
          options?: { precision?: number },
        ) => units.formatSpeed(value, unitPrefs, options),
        formatTemperature: (
          value: number | null | undefined,
          options?: { precision?: number },
        ) => units.formatTemperature(value, unitPrefs, options),
      };
    },
  };
});

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select">Vehicle picker</div>,
  RangePicker: () => <div data-testid="share-card-range">Range picker</div>,
}));

vi.mock('@/components/layout', () => ({
  PageContainer: ({
    title,
    actions,
    children,
  }: {
    title: string;
    actions?: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {actions}
      {children}
    </main>
  ),
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/charts', () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const SvgWrapper = ({ children }: { children?: ReactNode }) => <svg>{children}</svg>;
  return {
    Bar: () => null,
    BarChart: SvgWrapper,
    ChartContainer: ({
      title,
      subtitle,
      ariaLabel,
      data,
      children,
    }: {
      title: string;
      subtitle?: string;
      ariaLabel: string;
      data?: ReadonlyArray<Record<string, unknown>>;
      children: ReactNode | ((context: {
        annotations: [];
        hidden: false;
        hiddenSeries: { isHidden: () => false; toggle: () => void };
      }) => ReactNode);
    }) => (
      <div>
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
        <div data-testid="chart-export-data">{JSON.stringify(data ?? [])}</div>
        <div role="img" aria-label={ariaLabel}>
          {typeof children === 'function'
            ? children({
              annotations: [],
              hidden: false,
              hiddenSeries: {
                isHidden: () => false,
                toggle: () => undefined,
              },
            })
            : children}
        </div>
      </div>
    ),
    ChartLegend: () => null,
    ChartTooltip: () => null,
    ComposedChart: Wrapper,
    Line: () => null,
    ResponsiveContainer: Wrapper,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
    axisTick: {},
    chartGrid: null,
  };
});

import ShareCardPage from './ShareCardPage';

const SECTION_IDS = [
  'share-card-evidence-ledger',
  'share-card-source-scope',
  'share-card-coverage-disclosure',
  'share-card-style-controls',
  'share-card-preview-export',
  'share-card-line-inventory',
  'share-card-monthly-trend',
  'share-card-weekday-profile',
  'share-card-distance-distribution',
  'share-card-duration-distribution',
  'share-card-efficiency-evidence',
  'share-card-representative-directory',
  'share-card-accounting-identities',
  'share-card-methodology',
] as const;

function drive(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    startTs: '2026-07-01T15:00:00Z',
    distanceM: 10_000,
    durationS: 1_800,
    energyUsedWh: 2_000,
    regenEnergyWh: 250,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    outsideTempAvgC: 20,
    startAddress: 'Private home address',
    endAddress: 'Private work address',
    ...overrides,
  };
}

function query(
  data: readonly unknown[] | undefined,
  overrides: Partial<QueryStub> = {},
): QueryStub {
  return {
    data,
    isLoading: data === undefined,
    isPending: data === undefined,
    isSuccess: data !== undefined,
    isError: false,
    error: null,
    isFetching: data === undefined,
    fetchStatus: data === undefined ? 'fetching' : 'idle',
    isStale: false,
    dataUpdatedAt: Date.UTC(2026, 7, 8, 12),
    refetch: h.refetch,
    ...overrides,
  };
}

function renderPage(
  route = '/share-card?from=2015-01-01&to=2026-08-02',
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ShareCardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  h.vehicleId = 7;
  h.distance = 'km';
  h.query = query([drive()]);
  h.drivesHook.mockClear();
  h.refetch.mockReset();
  vi.restoreAllMocks();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:share-card'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
});

describe('ShareCardPage persistent composition', () => {
  it('mounts all 14 evidence section shells and both header controls', () => {
    renderPage();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId('vehicle-select')).toBeInTheDocument();
    expect(screen.getByTestId('share-card-range')).toBeInTheDocument();
  });

  it('converts URL calendar labels to vehicle-timezone RFC3339 query instants', () => {
    renderPage();
    expect(h.drivesHook).toHaveBeenLastCalledWith('7', {
      start: '2015-01-01T08:00:00.000Z',
      end: '2026-08-03T07:00:00.000Z',
      limit: 1_000,
    });
    expect(screen.getByText(/2015-01-01 through 2026-08-02/)).toBeInTheDocument();
  });

  it('keeps every section mounted when no vehicle is selected', () => {
    h.vehicleId = null;
    h.query = query(undefined, {
      isLoading: false,
      isPending: true,
      isFetching: false,
      fetchStatus: 'idle',
    });
    renderPage();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(h.drivesHook).toHaveBeenLastCalledWith(undefined, expect.any(Object));
    expect(screen.getAllByText(/Select a vehicle to load/).length).toBeGreaterThan(5);
  });
});

describe('ShareCardPage query states', () => {
  it('distinguishes initial loading from empty evidence', () => {
    h.query = query(undefined);
    renderPage();
    expect(screen.getAllByLabelText('Loading Share Card evidence').length).toBeGreaterThan(5);
    expect(screen.queryByText(/valid empty array/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('chart-export-data').every(
      (node) => node.textContent === '[]',
    )).toBe(true);
  });

  it('renders the initial paused state', () => {
    h.query = query(undefined, {
      isLoading: false,
      isPending: true,
      isFetching: false,
      fetchStatus: 'paused',
    });
    renderPage();
    expect(screen.getAllByText(/initial query is paused/).length).toBeGreaterThan(5);
  });

  it('renders an initial error with retry without hiding shells', () => {
    h.query = query(undefined, {
      isLoading: false,
      isPending: false,
      isSuccess: false,
      isError: true,
      error: new Error('offline'),
      isFetching: false,
      fetchStatus: 'idle',
    });
    renderPage();
    expect(screen.getAllByText('Selected-window drive evidence is unavailable.').length).toBeGreaterThan(5);
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry evidence query' })[0]!);
    expect(h.refetch).toHaveBeenCalled();
  });

  it('keeps cached evidence visible with a refresh error warning', () => {
    h.query = query([drive()], {
      isSuccess: false,
      isError: true,
      error: new Error('refresh failed'),
      isFetching: false,
    });
    renderPage();
    expect(screen.getAllByText(/Cached evidence remains visible, but the refresh failed/)).not.toHaveLength(0);
    expect(screen.getByAltText(/Share card preview/)).toBeInTheDocument();
  });

  it('keeps cached evidence visible with a paused refresh warning', () => {
    h.query = query([drive()], {
      isFetching: false,
      fetchStatus: 'paused',
    });
    renderPage();
    expect(screen.getAllByText(/Cached evidence remains visible while its refresh is paused/)).not.toHaveLength(0);
    expect(screen.getByAltText(/Share card preview/)).toBeInTheDocument();
  });

  it('shows a resolved valid-empty response without inventing zero measurements', () => {
    h.query = query([]);
    renderPage();
    expect(screen.getByText(/returned a valid empty array/)).toBeInTheDocument();
    expect(screen.queryByAltText(/Share card preview/)).not.toBeInTheDocument();
    expect(screen.getByText(/No returned drives support a card preview/)).toBeInTheDocument();
  });

  it('accounts for malformed rows and withholds the preview', () => {
    h.query = query([
      null,
      { id: 0, startTs: 'not-a-date', startAddress: 'Do not leak me' },
    ]);
    renderPage();
    expect(screen.getByText(/Rows were returned, but none passed/)).toBeInTheDocument();
    expect(screen.getByText(/2 returned · 0 eligible · 2 rejected/)).toBeInTheDocument();
    expect(screen.queryByAltText(/Share card preview/)).not.toBeInTheDocument();
  });
});

describe('ShareCardPage evidence and export behavior', () => {
  it('labels exactly 1,000 returned rows as a capped observed sample everywhere', () => {
    h.query = query(Array.from({ length: 1_000 }, (_, index) =>
      drive({ id: index + 1 })));
    renderPage();
    expect(screen.getByText(/Exactly 1,000 rows were returned/)).toBeInTheDocument();
    expect(screen.getAllByText(/Observed capped sample/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not lifetime coverage/).length).toBeGreaterThan(0);
    expect(screen.getByText(/truncated months are unknown, never zero/)).toBeInTheDocument();
    expect(screen.queryByText(/full lifetime/i)).not.toBeInTheDocument();
  });

  it('updates the accessible preview when a theme is selected', () => {
    renderPage();
    const preview = screen.getByAltText(/Share card preview/) as HTMLImageElement;
    const before = preview.src;
    fireEvent.click(screen.getByRole('button', { name: 'Use the aurora theme' }));
    expect(preview.src).not.toBe(before);
  });

  it('downloads XML-safe SVG and delays object URL cleanup', () => {
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Download safe SVG' }));
      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalledOnce();
      expect(document.querySelector('a[download^="teslasync-card-"]')).not.toBeInTheDocument();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(SHARE_CARD_SVG_REVOKE_DELAY_MS - 1);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:share-card');
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('converts canonical SI values to the selected imperial display units', () => {
    h.distance = 'mi';
    h.query = query([drive({
      distanceM: 1_609.344,
      maxSpeedMps: 26.8224,
    })]);
    renderPage();
    expect(screen.getAllByText('1 mi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60 mph').length).toBeGreaterThan(0);
  });

  it('never leaks exact route addresses into UI or preview payload', () => {
    const secret = '9876 Secret Residential Lane';
    h.query = query([drive({ startAddress: secret, endAddress: `${secret} East` })]);
    renderPage();
    expect(screen.queryByText(new RegExp(secret))).not.toBeInTheDocument();
    const preview = screen.getByAltText(/Share card preview/) as HTMLImageElement;
    expect(decodeURIComponent(preview.src)).not.toContain(secret);
    expect(screen.getByText('Present · withheld')).toBeInTheDocument();
  });

  it('renders selected-window monthly trend and weekday profile evidence', () => {
    h.query = query([
      drive({ id: 1, startTs: '2026-06-30T23:30:00Z' }),
      drive({ id: 2, startTs: '2026-07-01T15:00:00Z' }),
    ]);
    renderPage('/share-card?from=2026-06-01&to=2026-07-31');
    expect(screen.getByRole('img', {
      name: 'Monthly selected-window drive count, measured distance, and measured energy',
    })).toBeInTheDocument();
    expect(screen.getByRole('img', {
      name: 'Drive counts and measured distance by vehicle-local weekday',
    })).toBeInTheDocument();
    const serializedCharts = screen.getAllByTestId('chart-export-data')
      .map((node) => node.textContent)
      .join(' ');
    expect(serializedCharts).toContain('2026-06');
    expect(serializedCharts).toContain('2026-07');
    expect(serializedCharts).toContain('driveCount');
  });
});
