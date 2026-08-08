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
  it('renders fourteen persistent sections and exactly two canonical hook calls', () => {
    renderPage();

    expectEverySection();
    expect(screen.getByTestId('vehicle-select')).toBeInTheDocument();
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
      .closest('div');
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
