import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import {
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

const FROZEN_NOW = Date.parse('2026-08-08T12:00:00.000Z');
const refetchPassport = vi.fn();
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  passportQuery: undefined as unknown,
  verifyQuery: undefined as unknown,
  passportHook: vi.fn(),
  verifyHook: vi.fn(),
  timeZone: 'America/Los_Angeles',
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
    useTimezone: () => h.timeZone,
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
  h.passportQuery = passportQuery();
  h.verifyQuery = verifyQuery();
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BatteryPassportPage', () => {
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
    const kpis = within(
      screen.getByTestId('battery-passport-kpis'),
    );
    const sohMetric = kpis
      .getByText('Certificate-reported SoH')
      .closest('[data-operational-metric]');
    expect(sohMetric).toHaveTextContent('—');
    expect(sohMetric).not.toHaveTextContent('0%');

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

  it('retains cached certificate evidence through a refresh error', () => {
    h.passportQuery = passportQuery({
      data: certificate(),
      isError: true,
      isSuccess: false,
      error: new Error('refresh failed'),
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Certificate refresh failed. Showing the most recently loaded certificate without changing its facts.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Export certificate' }),
    ).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
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
