import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  BatteryPassport,
  BatteryPassportVerifyResponse,
} from '@/api/hooks/useBatteryPassport';
import { ToastProvider } from '@/components/feedback';
import { formatDateTime } from '@/lib/dateFormat';
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';

const FROZEN_NOW = Date.parse('2026-08-08T12:00:00.000Z');
const refetchPassport = vi.fn();
const refetchVerification = vi.fn();
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  passportQuery: undefined as unknown,
  verifyQuery: undefined as unknown,
  passportHook: vi.fn(),
  verifyHook: vi.fn(),
  timeZone: 'America/Los_Angeles',
  savedLocale: 'en-US',
  savedMode: 'vehicle',
  userTimeZone: 'Asia/Tokyo',
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  );
  return {
    ...actual,
    useTranslation: () => ({
      t: (
        key: string,
        fallback?: unknown,
        options?: unknown,
      ) => {
        const text = typeof fallback === 'string' ? fallback : key;
        const values =
          options && typeof options === 'object'
            ? options as Record<string, unknown>
            : {};
        return text.replace(
          /\{\{\s*(\w+)\s*\}\}/g,
          (_match, name: string) => (
            values[name] != null ? String(values[name]) : ''
          ),
        );
      },
      i18n: {
        language: 'en-US',
        changeLanguage: vi.fn(),
      },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

describe('BatteryPassportPage retained trust and raw export regressions', () => {
  it.each([
    ['A', 'success'],
    ['B', 'info'],
    ['C', 'info'],
    ['D', 'warning'],
    ['E', 'warning'],
    ['F', 'danger'],
    ['N/A', null],
    [' b ', 'info'],
  ])('uses semantic masthead roles without altering the reported grade %s', (grade, role) => {
    const facts = certificate({ health_grade: grade });
    h.passportQuery = passportQuery({ data: facts });

    renderPage();

    expectEverySection();
    const masthead = screen.getByTestId('battery-passport-masthead');
    const reportedGrade = within(masthead).getByText(
      (_text, element) => element?.tagName === 'SPAN'
        && element.getAttribute('aria-hidden') === 'true'
        && element.textContent === grade,
    );
    expect(reportedGrade).toHaveClass(
      role ? `text-[var(--semantic-${role})]` : 'text-[var(--text-muted)]',
    );
    expect(masthead.querySelector('[class*="gradient"], [class*="text-cyan-300"]')).toBeNull();
    expect(masthead.querySelector('svg.lucide-file-check2'))
      .toHaveClass('text-[var(--text-secondary)]');
    expect(masthead.querySelector('svg.lucide-award')?.parentElement)
      .toHaveClass('text-[var(--text-secondary)]');
    expect(within(masthead).getByText(facts.vin_masked)).toBeInTheDocument();
    expect(within(masthead).getByText(facts.provenance_hash)).toBeInTheDocument();
    expect(within(masthead).getByText('Current digest match')).toBeInTheDocument();
    expect(within(masthead).getByRole('button', { name: 'Export certificate' })).toBeEnabled();
    expect(facts.health_grade).toBe(grade);
  });

  it('keeps every section and certificate action while a retained query is paused', () => {
    h.passportQuery = {
      ...passportQuery(),
      fetchStatus: 'paused',
      dataUpdatedAt: FROZEN_NOW - 60_000,
    };

    renderPage();

    expectEverySection();
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
    expect(warning).toHaveTextContent('Battery Passport may be out of date');
    expect(warning).toHaveTextContent('Previously loaded data remains visible.');
    expect(warning).not.toHaveTextContent(/device is offline/i);
    expect(screen.getByRole('button', { name: 'Export certificate' })).toBeEnabled();
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(refetchPassport).toHaveBeenCalledTimes(1);
  });

  it('identifies a paused initial query without inventing an empty response or connectivity cause', () => {
    h.passportQuery = {
      ...passportQuery({ data: undefined, isSuccess: false }),
      fetchStatus: 'paused',
      isPending: true,
    };
    h.verifyQuery = verifyQuery({ data: undefined, isSuccess: false });

    renderPage();

    expectEverySection();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.queryByText(/device is offline/i)).not.toBeInTheDocument();
    expect(screen.queryByText('The endpoint returned no certificate for this vehicle.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export certificate' })).toBeDisabled();
    expect(within(screen.getByTestId('battery-passport-masthead')).queryByRole('button', { name: 'Retry' }))
      .not.toBeInTheDocument();
  });

  it('preserves a resolved empty certificate while its refresh is paused', () => {
    h.passportQuery = { ...passportQuery({ data: null }), fetchStatus: 'paused' };
    h.verifyQuery = verifyQuery({ data: undefined, isSuccess: false });

    renderPage();

    expectEverySection();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getAllByText('The endpoint returned no certificate for this vehicle.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Certificate availability has not resolved.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export certificate' })).toBeDisabled();
  });

  it('removes the paused warning after source recovery without dropping certificate evidence', () => {
    h.passportQuery = { ...passportQuery(), fetchStatus: 'paused' };
    const view = renderPage();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();

    h.passportQuery = { ...passportQuery(), fetchStatus: 'idle' };
    view.rerenderPage();

    expectEverySection();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export certificate' })).toBeEnabled();
    expect(refetchPassport).not.toHaveBeenCalled();
  });

  it('exports ordered anomalous facts and unknown wire fields without client mirrors or display reinterpretation', () => {
    const facts = {
      ...certificate(),
      vehicleId: 7,
      provenanceHash: 'a'.repeat(64),
      source_note: 'test-only raw evidence',
      sourceNote: 'test-only raw evidence',
      thermal_exposure: {
        cold_pct: 0,
        coldPct: 0,
        nominal_pct: 115,
        nominalPct: 115,
        hot_pct: -15,
        hotPct: -15,
      },
      degradation_trend: [
        { date: '2026-08-01', soh_pct: 91.2, sohPct: 91.2 },
        { date: 'invalid-date', soh_pct: 110, sohPct: 110, source_note: 'excluded', sourceNote: 'excluded' },
        null,
        'invalid-point',
        { date: '2026-08-01', soh_pct: 0, sohPct: 0 },
      ],
      recommendations: ['first rule', 'second rule'],
    };
    // Deliberately malformed wire facts exercise export separately from diagnostics.
    h.passportQuery = { ...passportQuery(), data: facts };
    const createObjectURL = vi.fn(() => 'blob:passport-test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    const blob = vi.spyOn(globalThis, 'Blob');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Export certificate' }));

      const payload = JSON.parse(String(blob.mock.calls[0]?.[0]?.[0])) as Record<string, unknown>;
      expect(payload).toMatchObject({
        vehicle_id: 7,
        vin_masked: '5YJ**********1234',
        source_note: 'test-only raw evidence',
        capacity_kwh: 68.4,
        original_capacity_kwh: 75,
        provenance_hash: 'a'.repeat(64),
        thermal_exposure: { cold_pct: 0, nominal_pct: 115, hot_pct: -15 },
        recommendations: ['first rule', 'second rule'],
      });
      expect(payload.degradation_trend).toEqual([
        { date: '2026-08-01', soh_pct: 91.2 },
        { date: 'invalid-date', soh_pct: 110, source_note: 'excluded' },
        null,
        'invalid-point',
        { date: '2026-08-01', soh_pct: 0 },
      ]);
      expect(payload).not.toHaveProperty('vehicleId');
      expect(payload).not.toHaveProperty('provenanceHash');
      expect(payload).not.toHaveProperty('sourceNote');
      expect(blob).toHaveBeenCalledWith([expect.any(String)], { type: 'application/json' });
      expect(click).toHaveBeenCalledTimes(1);
      expect(click.mock.instances[0]?.download).toBe('battery-passport-7-aaaaaaaaaaaa.json');
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:passport-test');
      expect(facts.degradation_trend).toHaveLength(5);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

vi.mock('@/api/hooks/useBatteryPassport', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/api/hooks/useBatteryPassport')
  >();
  return {
    ...actual,
    useBatteryPassport: (vehicleId: string | null) => {
      h.passportHook(vehicleId);
      return h.passportQuery;
    },
    useVerifyPassport: (
      vehicleId: string | null,
      hash: string | null,
    ) => {
      h.verifyHook(vehicleId, hash);
      return h.verifyQuery;
    },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: h.vehicleId == null
      ? null
      : {
          id: h.vehicleId,
          timezone: h.timeZone,
        },
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/lib/timezone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/timezone')>();
  return {
    ...actual,
    useTimezone: (mode: string) => mode === 'utc' ? 'UTC' : mode === 'user' ? h.userTimeZone : h.timeZone,
  };
});

vi.mock('@/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>();
  return {
    ...actual,
    useSettings: () => {
      const result = actual.useSettings();
      return {
        ...result,
        locale: h.savedLocale,
        settings: { ...result.settings, locale: h.savedLocale,
          tz_display_default: h.savedMode, timezone_user: h.userTimeZone },
      };
    },
  };
});

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
  // MetricBar animates its fill via `motion.div`, and the real `ToastProvider`
  // (rendered here, not mocked) needs both `motion` + `AnimatePresence` for
  // its toast stack transitions. Both now come from this barrel rather than
  // 'framer-motion' directly, so the mock must supply them too.
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const Component = (props.as as string) ?? 'div';
        const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>;
        return <Component {...(rest as Record<string, unknown>)}>{children as ReactNode}</Component>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/charts', () => ({
  ChartContainer: ({
    title,
    children,
    loading,
    empty,
  }: {
    title: string;
    children: ReactNode;
    loading?: boolean;
    empty?: boolean;
  }) => (
    <div data-testid="battery-passport-chart-shell">
      <h2>{title}</h2>
      {!loading && !empty ? children : null}
    </div>
  ),
  AreaChartWrapper: ({
    data,
  }: {
    data: Array<Record<string, unknown>>;
  }) => (
    <div data-testid="battery-passport-chart">
      {data.length}
    </div>
  ),
}));

import BatteryPassportPage from './BatteryPassportPage';

interface PassportQueryStub {
  data: BatteryPassport | null | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

interface VerifyQueryStub {
  fetchStatus: 'fetching' | 'paused' | 'idle';
  refetch: () => void;
  data: BatteryPassportVerifyResponse | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
}

function certificate(
  overrides: Partial<BatteryPassport> = {},
): BatteryPassport {
  return {
    vehicle_id: 7,
    vin_masked: '5YJ**********1234',
    issued_at: '2026-08-08T10:00:00Z',
    first_observed_at: '2024-01-02T03:04:05Z',
    soh_pct: 91.2,
    capacity_kwh: 68.4,
    original_capacity_kwh: 75,
    equivalent_full_cycles: 321.4,
    fast_charge_ratio: 0.125,
    avg_charge_limit_pct: 81.2,
    thermal_exposure: {
      cold_pct: 10,
      nominal_pct: 80,
      hot_pct: 10,
    },
    health_grade: 'B',
    degradation_trend: [
      { date: '2026-05-01', soh_pct: 92.1 },
      { date: '2026-08-01', soh_pct: 91.2 },
    ],
    recommendations: [],
    provenance_hash: 'a'.repeat(64),
    ...overrides,
  };
}

function passportQuery(
  overrides: Partial<PassportQueryStub> = {},
): PassportQueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data: certificate(),
    isLoading,
    isFetching: overrides.isFetching ?? isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    refetch: refetchPassport,
    ...overrides,
  };
}

function verifyQuery(
  overrides: Partial<VerifyQueryStub> = {},
): VerifyQueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    fetchStatus: overrides.isFetching || isLoading ? 'fetching' : 'idle',
    refetch: refetchVerification,
    data: {
      valid: true,
      expected_hash: 'a'.repeat(64),
      provided_hash: 'a'.repeat(64),
    },
    isLoading,
    isFetching: overrides.isFetching ?? isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    ...overrides,
  };
}

const sectionIds = [
  'battery-passport-masthead',
  'battery-passport-kpis',
  'battery-passport-trend-timeline',
  'battery-passport-trend-diagnostics',
  'battery-passport-trend-distribution',
  'battery-passport-capacity-context',
  'battery-passport-grade-audit',
  'battery-passport-usage-profile',
  'battery-passport-thermal-profile',
  'battery-passport-recommendations',
  'battery-passport-provenance-matrix',
  'battery-passport-verification-diagnostics',
  'battery-passport-field-directory',
  'battery-passport-methodology',
] as const;

function expectEverySection(): void {
  for (const testId of sectionIds) {
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  }
}

function tree(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/battery-passport']}>
          <BatteryPassportPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const view = render(tree(client));
  return {
    ...view,
    rerenderPage: () => view.rerender(tree(client)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.timeZone = 'America/Los_Angeles';
  h.savedLocale = 'en-US';
  h.savedMode = 'vehicle';
  h.userTimeZone = 'Asia/Tokyo';
  h.passportQuery = passportQuery();
  h.verifyQuery = verifyQuery();
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BatteryPassportPage', () => {
  it.each([
    ['de-DE', 'vehicle', 'America/Los_Angeles', '7'],
    ['ja-JP', 'user', 'Asia/Tokyo', '8'],
    ['fr-FR', 'utc', 'UTC', '8'],
  ])('uses saved %s locale and %s timezone for KPI timestamps', (locale, mode, tz, day) => {
    h.savedLocale = locale;
    h.savedMode = mode;
    const facts = certificate({ issued_at: '2026-08-08T00:30:00Z' });
    h.passportQuery = passportQuery({ data: facts });
    renderPage();
    const expected = formatDateTime(facts.issued_at, { locale, tz });
    expect(expected).toContain(day);
    const kpis = screen.getByTestId('battery-passport-kpis');
    fireEvent.click(within(kpis).getByRole('button', { name: 'Review details' }));
    const kpiDialog = screen.getByRole('dialog');
    const kpiHeader = kpiDialog.querySelector('[data-drawer-header]');
    if (!(kpiHeader instanceof HTMLElement)) throw new Error('Review drawer header is missing');
    expect(within(kpiHeader).getAllByText(expected)).toHaveLength(2);
    fireEvent.keyDown(kpiDialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(kpis).not.toHaveTextContent(facts.issued_at);
    expect(facts.issued_at).toBe('2026-08-08T00:30:00Z');
    expectEverySection();
  });

  it.each([['not-a-date', 2], ['', 1]] as const)('withholds an invalid or missing KPI timestamp: %s', (issued_at, dashes) => {
    h.passportQuery = passportQuery({ data: certificate({ issued_at }) });
    renderPage();
    const kpis = screen.getByTestId('battery-passport-kpis');
    fireEvent.click(within(kpis).getByRole('button', { name: 'Review details' }));
    const kpiDialog = screen.getByRole('dialog');
    const kpiHeader = kpiDialog.querySelector('[data-drawer-header]');
    if (!(kpiHeader instanceof HTMLElement)) throw new Error('Review drawer header is missing');
    expect(within(kpiHeader).getAllByText('—')).toHaveLength(dashes);
    fireEvent.keyDown(kpiDialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(kpis).not.toHaveTextContent('Invalid Date');
    expectEverySection();
  });

  it('keeps every provenance field reachable through mobile key/value details and restores the desktop matrix', () => {
    const observers = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal('ResizeObserver', class {
      private elements = new Set<Element>();
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        this.elements.add(element);
        observers.set(element, this.callback);
      }
      unobserve(element: Element) {
        this.elements.delete(element);
        observers.delete(element);
      }
      disconnect() {
        this.elements.forEach(element => observers.delete(element));
        this.elements.clear();
      }
    });
    const resize = (width: number) => act(() => {
      observers.forEach((callback, element) => callback(
        [{ target: element, contentRect: { width } } as ResizeObserverEntry],
        {} as ResizeObserver,
      ));
    });
    try {
      renderPage();
      const matrix = screen.getByTestId('battery-passport-provenance-matrix');
      resize(375);
      expect(matrix.querySelectorAll('[data-kv-row]')).toHaveLength(14);
      expect(within(matrix).queryByRole('table')).not.toBeInTheDocument();

      const fields = [
        'vehicle_id', 'first_observed_at day', 'soh_pct', 'capacity_kwh',
        'equivalent_full_cycles', 'fast_charge_ratio', 'issued_at day',
        'vin_masked', 'original_capacity_kwh', 'avg_charge_limit_pct',
        'thermal_exposure', 'health_grade', 'degradation_trend', 'recommendations',
      ];
      for (const [index, field] of fields.entries()) {
        const row = within(matrix).getByRole('button', { name: field, exact: true });
        row.focus();
        expect(row).toHaveFocus();
        fireEvent.keyDown(row, { key: index % 2 === 0 ? 'Enter' : ' ' });
        const dialog = screen.getByRole('dialog');
        for (const label of ['Certificate fact', 'Current value', 'Source and meaning', 'Bound by v1 hash']) {
          expect(within(dialog).getByText(label)).toBeInTheDocument();
        }
        expect(within(dialog).getAllByText(field).length).toBeGreaterThan(0);
        if (field === 'vehicle_id') {
          expect(dialog).toHaveTextContent('Vehicle identifier; exact integer is in the v1 canonical string.');
          expect(dialog).toHaveTextContent('Yes');
        }
        if (field === 'first_observed_at day') expect(dialog).toHaveTextContent('Yes, UTC day');
        if (field === 'recommendations') expect(dialog).toHaveTextContent('0 server outputs');
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      }

      resize(1440);
      expect(matrix.querySelector('[data-mobile-table]')).toBeNull();
      expect(within(matrix).getAllByRole('columnheader')).toHaveLength(4);
      expect(within(matrix).getByText('Vehicle identifier; exact integer is in the v1 canonical string.')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the scientific matrix columns fixed', () => {
    renderPage();
    const matrix = screen.getByTestId('battery-passport-provenance-matrix');
    expect(within(matrix).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(matrix).queryByRole('button', { name: /columns/i })).not.toBeInTheDocument();
    expect(within(matrix).queryAllByLabelText(/^Resize column/)).toHaveLength(0);
    expect(matrix.querySelector('[draggable="true"]')).toBeNull();
  });

  it('renders fourteen persistent sections and exactly two canonical hook calls', () => {
    renderPage();

    expectEverySection();
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    expect(h.passportHook).toHaveBeenCalledTimes(1);
    expect(h.passportHook).toHaveBeenLastCalledWith('7');
    expect(h.verifyHook).toHaveBeenCalledTimes(1);
    expect(h.verifyHook).toHaveBeenLastCalledWith(
      '7',
      'a'.repeat(64),
    );
    expect(
      screen.getByRole('button', { name: 'Export certificate' }),
    ).toBeEnabled();
  });

  it('keeps every section mounted and export disabled without a vehicle', () => {
    h.vehicleId = null;
    h.passportQuery = passportQuery({
      data: undefined,
      isSuccess: false,
    });
    h.verifyQuery = verifyQuery({
      data: undefined,
      isSuccess: false,
    });

    renderPage();

    expectEverySection();
    expect(h.passportHook).toHaveBeenLastCalledWith(null);
    expect(h.verifyHook).toHaveBeenLastCalledWith(null, null);
    expect(
      screen.getByRole('button', { name: 'Export certificate' }),
    ).toBeDisabled();
    expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
  });

  it('keeps every section mounted during initial loading', () => {
    h.passportQuery = passportQuery({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isSuccess: false,
    });
    h.verifyQuery = verifyQuery({
      data: undefined,
      isSuccess: false,
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getAllByRole('status', {
        name: 'Loading Battery Passport evidence',
      }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: 'Export certificate' }),
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('provides one retry surface for an initial passport error', () => {
    h.passportQuery = passportQuery({
      data: undefined,
      isError: true,
      isSuccess: false,
      error: new Error('passport failed'),
    });
    h.verifyQuery = verifyQuery({
      data: undefined,
      isSuccess: false,
    });

    renderPage();

    expectEverySection();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]!);
    expect(refetchPassport).toHaveBeenCalledTimes(1);
  });

  it('keeps every shell and disabled export for an empty null success', () => {
    h.passportQuery = passportQuery({
      data: null,
      isSuccess: true,
    });
    h.verifyQuery = verifyQuery({
      data: undefined,
      isSuccess: false,
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByRole('button', { name: 'Export certificate' }),
    ).toBeDisabled();
    expect(
      screen.getAllByText(
        'The endpoint returned no certificate for this vehicle.',
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('presents the backend unknown-SoH sentinel as unavailable', () => {
    h.passportQuery = passportQuery({
      data: certificate({
        soh_pct: 0,
        health_grade: 'N/A',
      }),
    });

    renderPage();

    expectEverySection();
    const kpis = screen.getByTestId('battery-passport-kpis');
    assertOperationalMetricUnavailable(kpis, 'Certificate-reported SoH');
    expect(kpis).not.toHaveTextContent('Certificate-reported SoH');

    const gradeAudit = within(
      screen.getByTestId('battery-passport-grade-audit'),
    );
    expect(
      gradeAudit.getByText(
        'The server marks SoH as unavailable (soh_pct = 0 and health_grade = N/A), so no score or grade is reconstructed.',
      ),
    ).toBeInTheDocument();
    expect(
      gradeAudit.queryByText(
        'Grade mismatch: the certificate-reported grade differs from the transparent reconstruction. The values are shown separately and are not reconciled.',
      ),
    ).not.toBeInTheDocument();
  });

  it.each([
    {
      name: 'loading',
      query: verifyQuery({
        data: undefined,
        isLoading: true,
        isFetching: true,
        isSuccess: false,
      }),
      label: 'Verification in progress',
    },
    {
      name: 'error',
      query: verifyQuery({
        data: undefined,
        isError: true,
        isSuccess: false,
        error: new Error('verify failed'),
      }),
      label: 'Verification unavailable',
    },
    {
      name: 'mismatch',
      query: verifyQuery({
        data: {
          valid: false,
          expected_hash: 'b'.repeat(64),
          provided_hash: 'a'.repeat(64),
        },
      }),
      label: 'Digest mismatch',
    },
    {
      name: 'valid',
      query: verifyQuery(),
      label: 'Current digest match',
    },
  ])(
    'renders non-blocking verification $name state',
    ({ query, label }) => {
      h.verifyQuery = query;

      renderPage();

      expectEverySection();
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument();
    },
  );

  it.each([
    {
      valid: true,
      expectedHash: 'a'.repeat(64),
      label: 'Refreshing verification — previous result matched',
      staleLabel: 'Current digest match',
    },
    {
      valid: false,
      expectedHash: 'b'.repeat(64),
      label:
        'Refreshing verification — previous result did not match',
      staleLabel: 'Digest mismatch',
    },
  ])(
    'marks cached verification valid=$valid as a previous result while refetching',
    ({
      valid,
      expectedHash,
      label,
      staleLabel,
    }) => {
      h.verifyQuery = verifyQuery({
        data: {
          valid,
          expected_hash: expectedHash,
          provided_hash: 'a'.repeat(64),
        },
        isLoading: false,
        isFetching: true,
      });

      renderPage();

      expectEverySection();
      expect(screen.getAllByText(label)).toHaveLength(2);
      expect(screen.queryByText(staleLabel)).not.toBeInTheDocument();
      expect(
        screen.getByText(
          'A verification refetch is in progress. The displayed hashes and result are from the previous response, not a current digest comparison.',
        ),
      ).toBeInTheDocument();
    },
  );

  it('batteryPassportPage verification retry is localized, nonblocking, and recovers retained refresh failure', () => {
    const facts = certificate();
    const retained = {
      valid: true,
      expected_hash: 'a'.repeat(64),
      provided_hash: 'a'.repeat(64),
    };
    h.passportQuery = passportQuery({ data: facts });
    h.verifyQuery = verifyQuery({
      data: retained,
      isError: true,
      isSuccess: false,
      error: new Error('verification refresh failed'),
    });
    const view = renderPage();
    const diagnostics = within(screen.getByTestId('battery-passport-verification-diagnostics'));

    expectEverySection();
    expect(diagnostics.getByText('Verification unavailable')).toBeInTheDocument();
    expect(diagnostics.getByText(/Any displayed hashes are from the previous response/)).toBeInTheDocument();
    expect(diagnostics.getAllByText(`${'a'.repeat(16)}…`)).toHaveLength(2);
    expect(screen.queryByText('Current digest match')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export certificate' })).toBeEnabled();
    fireEvent.click(diagnostics.getByRole('button', { name: 'Retry verification' }));
    expect(refetchVerification).toHaveBeenCalledTimes(1);
    expect(refetchPassport).not.toHaveBeenCalled();

    h.verifyQuery = verifyQuery({ data: retained, isFetching: true });
    view.rerenderPage();
    expectEverySection();
    expect(diagnostics.getByText('Refreshing verification — previous result matched')).toBeInTheDocument();
    expect(diagnostics.queryByRole('button', { name: 'Retry verification' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export certificate' })).toBeEnabled();

    h.verifyQuery = verifyQuery({ data: retained });
    view.rerenderPage();
    expectEverySection();
    expect(diagnostics.getByText('Current digest match')).toBeInTheDocument();
    expect(diagnostics.queryByText(/Any displayed hashes are from the previous response/)).not.toBeInTheDocument();
    expect(diagnostics.queryByRole('button', { name: 'Retry verification' })).not.toBeInTheDocument();
    expect(refetchVerification).toHaveBeenCalledTimes(1);
  });

  it('keeps paused verification without data distinct from active loading and successful certificate evidence', () => {
    h.verifyQuery = verifyQuery({
      data: undefined,
      isSuccess: false,
      fetchStatus: 'paused',
    });
    const view = renderPage();
    const diagnostics = within(screen.getByTestId('battery-passport-verification-diagnostics'));
    expectEverySection();
    expect(diagnostics.getByRole('status')).toHaveTextContent('Verification is paused.');
    expect(diagnostics.queryByText('Verification in progress')).not.toBeInTheDocument();
    expect(diagnostics.queryByText('Current digest match')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export certificate' })).toBeEnabled();

    h.verifyQuery = verifyQuery({ data: undefined, isFetching: true, isSuccess: false });
    view.rerenderPage();
    expect(diagnostics.getByText('Verification in progress')).toBeInTheDocument();
    expect(diagnostics.queryByText(/Verification is paused/)).not.toBeInTheDocument();
  });

  it('preserves successful zero and empty certificate facts without offering verification retry', () => {
    h.passportQuery = passportQuery({
      data: certificate({ equivalent_full_cycles: 0, fast_charge_ratio: 0, recommendations: [], degradation_trend: [] }),
    });
    renderPage();
    expectEverySection();
    expect(screen.getByRole('button', { name: 'Export certificate' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Retry verification' })).not.toBeInTheDocument();
    const efc = within(screen.getByTestId('battery-passport-kpis'))
      .getByText('EFC proxy').closest('[data-operational-metric]');
    expect(efc?.querySelector('[data-operational-value]')).toHaveTextContent('0.00');
    expect(efc).not.toHaveTextContent('—');
  });

  it('retries a retained refresh failure beside the warning and removes it after recovery', () => {
    const facts = certificate();
    h.passportQuery = passportQuery({
      data: facts,
      isError: true,
      isSuccess: false,
      error: new Error('refresh failed'),
    });

    const view = renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Certificate refresh failed. Showing the most recently loaded certificate without changing its facts.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Export certificate' }),
    ).toBeEnabled();
    const masthead = within(screen.getByTestId('battery-passport-masthead'));
    const warning = masthead.getByRole('alert');
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    expect(within(warning).getByRole('button', { name: 'Retry' })).toBe(retries[0]);
    expect(masthead.getByText(facts.vin_masked)).toBeInTheDocument();
    expect(masthead.getByText(facts.provenance_hash)).toBeInTheDocument();
    expect(screen.queryByTestId('battery-passport-initial-error')).not.toBeInTheDocument();
    fireEvent.click(retries[0]!);
    expect(refetchPassport).toHaveBeenCalledTimes(1);

    h.passportQuery = passportQuery({ data: facts, isFetching: true });
    view.rerenderPage();
    expectEverySection();
    expect(masthead.getByText(facts.vin_masked)).toBeInTheDocument();
    expect(masthead.queryByRole('alert')).not.toBeInTheDocument();
    expect(masthead.queryByRole('status', { name: 'Loading Battery Passport evidence' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export certificate' })).toBeEnabled();

    h.passportQuery = passportQuery({ data: facts });
    view.rerenderPage();
    expectEverySection();
    expect(masthead.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(masthead.getByText(facts.provenance_hash)).toBeInTheDocument();
    expect(refetchPassport).toHaveBeenCalledTimes(1);
  });

  it('surfaces a cached-null refresh error with one retry action', () => {
    h.passportQuery = passportQuery({
      data: null,
      isError: true,
      isSuccess: false,
      error: new Error('refresh failed after cached null'),
    });
    h.verifyQuery = verifyQuery({
      data: undefined,
      isSuccess: false,
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByTestId('battery-passport-empty-refresh-error'),
    ).toBeInTheDocument();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]!);
    expect(refetchPassport).toHaveBeenCalledTimes(1);
  });

  it('keeps future classification fixed when Date.now advances', () => {
    const withFuture = certificate({
      degradation_trend: [
        { date: '2026-08-01', soh_pct: 91 },
        { date: '2026-08-09', soh_pct: 90 },
      ],
    });
    h.passportQuery = passportQuery({ data: withFuture });
    const view = renderPage();
    const diagnostics = within(
      screen.getByTestId('battery-passport-trend-diagnostics'),
    );
    const before = diagnostics
      .getByText('Future UTC dates')
      .closest('div');

    expect(before).toHaveTextContent('1');

    vi.mocked(Date.now).mockReturnValue(
      FROZEN_NOW + 30 * 86_400_000,
    );
    h.passportQuery = passportQuery({
      data: structuredClone(withFuture),
    });
    view.rerenderPage();

    const after = within(
      screen.getByTestId('battery-passport-trend-diagnostics'),
    )
      .getByText('Future UTC dates')
      .closest('div');
    expect(after).toHaveTextContent('1');
  });
});
