import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SHARE_CARD_SVG_REVOKE_DELAY_MS, SHARE_CARD_THEMES } from '../lib/shareCard';

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

vi.mock('@/components/layout', async () => {
  const actual = await vi.importActual<typeof import('@/components/layout')>('@/components/layout');
  const charts = await vi.importMock<typeof import('@/components/charts')>('@/components/charts');
  return {
  ...actual,
  ChartCard: charts.ChartContainer,
  PageLayout: ({
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
  };
});

vi.mock('@/components/motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return {
    ...actual,
    FadeIn: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

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
  const tree = () => (
    <MemoryRouter initialEntries={[route]}>
      <ShareCardPage />
    </MemoryRouter>
  );
  const result = render(tree());
  return { ...result, rerenderPage: () => result.rerender(tree()) };
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
  it('renders both genuine summary bands through real briefs and preserves their drawer evidence', () => {
    renderPage();
    const ledger = screen.getByTestId('share-card-evidence-ledger');
    const efficiency = screen.getByTestId('share-card-efficiency-evidence');
    expect(ledger.querySelector('[data-operational-brief]')).toBeInTheDocument();
    expect(ledger.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(efficiency.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(ledger.querySelector('[data-operational-metric="distance"]')).toHaveAttribute('data-value-state', 'value');
    expect(efficiency.querySelector('[data-operational-metric="weighted"]')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(ledger).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('10.0 km')).toBeInTheDocument();
    expect(within(drawer).getByText('Unique ID and in-window timestamp')).toBeInTheDocument();
    expect(within(drawer).getByText(/at most 1,000 rows|at most 1000 rows/)).toBeInTheDocument();
    expect(screen.getByTestId('share-card-preview-export')).toBeInTheDocument();
    expect(screen.getByTestId('share-card-accounting-identities')).toBeInTheDocument();
  });

  it('retains all six deterministic slots and all field and calendar coverage evidence as table rows', () => {
    renderPage();

    const inventory = within(screen.getByTestId('share-card-line-inventory')).getByRole('table');
    expect(within(inventory).getAllByRole('rowheader')).toHaveLength(6);
    const fields = within(screen.getByTestId('share-card-efficiency-evidence')).getByRole('table');
    expect(within(fields).getAllByRole('rowheader')).toHaveLength(8);
    const calendar = within(screen.getByTestId('share-card-coverage-disclosure')).getByRole('table');
    expect(within(calendar).getAllByRole('rowheader')).toHaveLength(4);
    expect(screen.getByText(/A sub-cap response is not a guarantee/)).toBeInTheDocument();
  });

  it('mounts all 14 evidence section shells without duplicate header controls', () => {
    renderPage();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('share-card-range')).not.toBeInTheDocument();
  });

  it('converts URL calendar labels to vehicle-timezone RFC3339 query instants', () => {
    renderPage();
    expect(h.drivesHook).toHaveBeenLastCalledWith('7', {
      start: '2015-01-01T08:00:00.000Z',
      end: '2026-08-03T07:00:00.000Z',
      limit: 1_000,
    });
    expect(within(screen.getByTestId('share-card-source-scope')).getByText(/2015-01-01 through 2026-08-02/)).toBeInTheDocument();
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
  it('keeps retained source evidence, metric state and full details after a background failure', () => {
    h.query = query([drive()], { isError: true, error: new Error('refresh failed') });
    renderPage();
    const ledger = screen.getByTestId('share-card-evidence-ledger');
    expect(within(ledger).getByText('Cached')).toBeInTheDocument();
    expect(ledger.querySelector('[data-operational-metric="energy"]')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(ledger).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('2.0 kWh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download safe SVG' })).toBeEnabled();
  });

  it('does not infer measurements from an unavailable source and exposes loading on both briefs', () => {
    h.query = query(undefined);
    renderPage();
    for (const id of ['share-card-evidence-ledger', 'share-card-efficiency-evidence']) {
      const shell = screen.getByTestId(id);
      expect(shell.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
      expect(shell.querySelector('[data-operational-value]')).toBeNull();
      for (const metric of shell.querySelectorAll('[data-operational-metric]')) {
        expect(metric).toHaveAttribute('data-value-state', 'missing');
      }
    }
  });

  it('distinguishes initial loading from empty evidence', () => {
    h.query = query(undefined);
    renderPage();
    expect(screen.getAllByLabelText('Loading share card evidence').length).toBeGreaterThan(5);
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
    expect(screen.getAllByText('1.0 mi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60.0 mph').length).toBeGreaterThan(0);
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

describe('ShareCardPage composition recovery interactions', () => {
  function previewSvg(): string {
    const preview = screen.getByAltText(/Share card preview/) as HTMLImageElement;
    return decodeURIComponent(preview.getAttribute('src')?.split(',').slice(1).join(',') ?? '');
  }

  function inventoryValues(): string[] {
    const table = within(screen.getByTestId('share-card-line-inventory')).getByRole('table');
    return within(table).getAllByRole('row').map((row) =>
      within(row).getAllByRole('cell')[1].textContent?.trim() ?? '',
    );
  }

  it('retains a chosen theme through cold pending, failed retry and successful evidence recovery', () => {
    h.query = query(undefined);
    const view = renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: 'Theme' }), { target: { value: 'ember' } });
    expect(screen.getByRole('button', { name: 'Use the ember theme' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Download safe SVG' })).toBeDisabled();

    h.query = query(undefined, {
      isLoading: false, isPending: false, isSuccess: false, isError: true,
      error: new Error('unavailable'), isFetching: false, fetchStatus: 'idle',
    });
    view.rerenderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry evidence query' })[0]);
    expect(h.refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('ember');
    expect(screen.queryByAltText(/Share card preview/)).not.toBeInTheDocument();

    h.query = query(undefined);
    view.rerenderPage();
    expect(screen.getAllByRole('status', { name: 'Loading share card evidence' }).length).toBeGreaterThan(5);
    expect(screen.getByRole('button', { name: 'Download safe SVG' })).toBeDisabled();
    h.query = query([drive()]);
    view.rerenderPage();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('ember');
    expect(screen.getByRole('button', { name: 'Use the ember theme' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Download safe SVG' })).not.toBeDisabled();
    expect(previewSvg()).toContain(SHARE_CARD_THEMES.ember.bg);
    expect(screen.queryByText('Selected-window drive evidence is unavailable.')).not.toBeInTheDocument();
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(h.drivesHook).toHaveBeenLastCalledWith('7', {
      start: '2015-01-01T08:00:00.000Z', end: '2026-08-03T07:00:00.000Z', limit: 1000,
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('preserves exact SVG, all six values and controls through pending, paused and failed cached refreshes', () => {
    const rows = [drive(), drive({ id: 2, distanceM: 5000, energyUsedWh: 1000 })];
    const view = renderPage();
    h.query = query(rows);
    view.rerenderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Use the aurora theme' }));
    const svg = previewSvg();
    const values = inventoryValues();
    for (const flags of [
      { isFetching: true, fetchStatus: 'fetching' as const },
      { isFetching: false, fetchStatus: 'paused' as const },
      { isFetching: false, isError: true, isSuccess: false, error: new Error('refresh failed') },
    ]) {
      h.query = query(rows, flags);
      view.rerenderPage();
      expect(previewSvg()).toBe(svg);
      expect(inventoryValues()).toEqual(values);
      expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('aurora');
      expect(screen.getByRole('button', { name: 'Download safe SVG' })).not.toBeDisabled();
      for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Cached evidence remains visible, but the refresh failed.').length)
      .toBeGreaterThan(0);
    h.query = query(rows);
    view.rerenderPage();
    expect(previewSvg()).toBe(svg);
    expect(screen.queryByText('Cached evidence remains visible, but the refresh failed.')).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('exports the exact complete preview SVG with every line, selected theme, scope and redaction intact', async () => {
    const rows = [
      drive({ id: 1, regenEnergyWh: 0 }),
      drive({ id: 2, distanceM: 5000, energyUsedWh: 1000, regenEnergyWh: null, maxSpeedMps: null }),
      drive({ id: 3, distanceM: null, energyUsedWh: null, regenEnergyWh: null, maxSpeedMps: null }),
    ];
    const snapshot = structuredClone(rows);
    h.query = query(rows);
    let filename = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download;
    });
    renderPage('/share-card?from=2026-07-01&to=2026-07-31');
    fireEvent.change(screen.getByRole('combobox', { name: 'Theme' }), { target: { value: 'ember' } });
    const expectedSvg = previewSvg();
    const values = inventoryValues();
    expect(values).toHaveLength(6);
    expect(values[1]).toBe('3');
    const expectedDocument = new DOMParser().parseFromString(expectedSvg, 'image/svg+xml');
    expect(expectedDocument.querySelector('parsererror')).toBeNull();
    const text = expectedDocument.documentElement.textContent ?? '';
    for (const label of [
      'Distance', 'Eligible drives', 'Drive energy', 'Regen recovered',
      'Longest measured drive', 'Top measured speed',
    ]) expect(text).toContain(label);
    for (const value of values) expect(text).toContain(value);
    expect(text).toContain('2026-07-01');
    expect(text).toContain('2026-07-31');
    expect(text).toContain('Returned selected-window evidence');
    expect(text).toContain('completeness not guaranteed');
    expect(expectedSvg).toContain(SHARE_CARD_THEMES.ember.bg);
    expect(expectedSvg).not.toContain('Private home address');
    expect(expectedSvg).not.toContain('Private work address');

    fireEvent.click(screen.getByRole('button', { name: 'Download safe SVG' }));
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0];
    if (!(blob instanceof Blob)) throw new Error('SVG export did not create a Blob');
    expect(blob.type).toBe('image/svg+xml;charset=utf-8');
    const exportedSvg = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(exportedSvg).toBe(expectedSvg);
    expect(filename).toBe('teslasync-card-2026-07-01-2026-07-31.svg');
    expect(rows).toEqual(snapshot);
    expect(h.drivesHook).toHaveBeenLastCalledWith('7', {
      start: '2026-07-01T07:00:00.000Z', end: '2026-08-01T07:00:00.000Z', limit: 1000,
    });
  });

  it('keeps real-zero slots distinct from a missing measurement in the actual inventory and SVG disclosure', () => {
    h.query = query([drive({
      distanceM: 0, energyUsedWh: null, regenEnergyWh: 0, maxSpeedMps: 0,
    })]);
    renderPage();
    const table = within(screen.getByTestId('share-card-line-inventory')).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[2]).getByText('Missing')).toBeInTheDocument();
    expect(within(rows[2]).getByText('—')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Measured')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Measured')).toBeInTheDocument();
    expect(within(rows[5]).getByText('Measured')).toBeInTheDocument();
    const svg = previewSvg();
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.textContent)
      .toContain('Missing: Drive energy');
    expect(inventoryValues()[2]).toBe('—');
    expect(inventoryValues()[0]).not.toBe('—');
    expect(inventoryValues()[3]).not.toBe('—');
    expect(inventoryValues()[5]).not.toBe('—');
  });

  it('retains style settings but withholds stale card contents while workspace vehicle evidence changes', () => {
    const view = renderPage('/share-card?from=2026-07-01&to=2026-07-31');
    fireEvent.click(screen.getByRole('button', { name: 'Use the aurora theme' }));
    h.vehicleId = 9;
    h.query = query(undefined);
    view.rerenderPage();
    expect(h.drivesHook).toHaveBeenLastCalledWith('9', {
      start: '2026-07-01T07:00:00.000Z', end: '2026-08-01T07:00:00.000Z', limit: 1000,
    });
    expect(screen.queryByAltText(/Share card preview/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download safe SVG' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('aurora');

    h.query = query([drive({ id: 901, distanceM: 2000, energyUsedWh: 500 })]);
    view.rerenderPage();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('aurora');
    expect(previewSvg()).toContain(SHARE_CARD_THEMES.aurora.bg);
    expect(inventoryValues()[1]).toBe('1');
    expect(inventoryValues()[0]).toBe('2.0 km');
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('share-card-range')).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('updates all mounted composition values for display preferences without changing SI evidence, theme or query scope', () => {
    const rows = [drive({ distanceM: 1609.344, maxSpeedMps: 26.8224 })];
    const snapshot = structuredClone(rows);
    Object.freeze(rows[0]);
    h.query = query(rows);
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Use the ember theme' }));
    const metricSvg = previewSvg();
    expect(inventoryValues()[0]).toBe('1.6 km');
    expect(inventoryValues()[5]).toBe('96.6 km/h');

    h.distance = 'mi';
    view.rerenderPage();
    const imperialValues = inventoryValues();
    expect(imperialValues[0]).toBe('1.0 mi');
    expect(imperialValues[4]).toBe('1.0 mi');
    expect(imperialValues[5]).toBe('60.0 mph');
    const imperialSvg = previewSvg();
    expect(imperialSvg).not.toBe(metricSvg);
    const text = new DOMParser().parseFromString(imperialSvg, 'image/svg+xml').documentElement.textContent ?? '';
    for (const value of imperialValues) expect(text).toContain(value);
    expect(imperialSvg).toContain(SHARE_CARD_THEMES.ember.bg);
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('ember');
    expect(rows).toEqual(snapshot);
    expect(h.drivesHook).toHaveBeenLastCalledWith('7', {
      start: '2015-01-01T08:00:00.000Z', end: '2026-08-03T07:00:00.000Z', limit: 1000,
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
