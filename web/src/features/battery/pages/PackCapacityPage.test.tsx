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
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { ToastProvider } from '@/components/feedback';
import type { ChargingSession } from '@/types/charging';

const FROZEN_NOW = Date.parse('2026-08-08T12:00:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  sessions: undefined as unknown,
  chargingHook: vi.fn(),
  timezoneHook: vi.fn(),
  timeZone: 'America/Los_Angeles',
}));
const refetchCharging = vi.fn();

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

vi.mock('@/api/hooks/useCharging', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/api/hooks/useCharging')
  >();
  return {
    ...actual,
    useChargingHistory: (vehicleId?: string, limit?: number) => {
      h.chargingHook(vehicleId, limit);
      return h.sessions;
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

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
    formatEnergy: (
      value: number | null | undefined,
      options?: { precision?: number },
    ) =>
      value == null
        ? '—'
        : `${(value / 1_000).toFixed(options?.precision ?? 1)} kWh`,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import PackCapacityPage from './PackCapacityPage';

let nextId = 1;

function session(
  completedAt: string,
  capacityWh = 75_000,
  overrides: Partial<ChargingSession> = {},
): ChargingSession {
  const endMs = Date.parse(completedAt);
  const start = new Date(endMs - 2 * 3_600_000).toISOString();
  return {
    id: String(nextId++),
    vehicle_id: '7',
    charger_type: 'AC',
    start_soc_pct: 20,
    end_soc_pct: 60,
    total_energy_added_wh: capacityWh * 0.4,
    peak_power_w: 11_000,
    cost_decimal: null,
    started_at: start,
    ended_at: completedAt,
    start_ts: start,
    startedAt: start,
    duration_min: 120,
    ...overrides,
  };
}

function readyHistory(): ChargingSession[] {
  return Array.from({ length: 14 }, (_, index) => {
    const completed = new Date(
      Date.UTC(2025, 4 + index, 15, 20),
    ).toISOString();
    return session(completed, 76_000 - index * 120);
  });
}

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

function query(
  overrides: Partial<QueryStub> = {},
): QueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data: undefined,
    isLoading,
    isFetching: overrides.isFetching ?? isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    refetch: refetchCharging,
    ...overrides,
  };
}

function tree(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/pack-capacity']}>
          <PackCapacityPage />
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

const sectionIds = [
  'pack-capacity-kpis',
  'pack-capacity-estimate-timeline',
  'pack-capacity-month-trend',
  'pack-capacity-soc-window-profile',
  'pack-capacity-window-sensitivity',
  'pack-capacity-process-sensitivity',
  'pack-capacity-innovation-profile',
  'pack-capacity-influence-timeline',
  'pack-capacity-fit-diagnostics',
  'pack-capacity-directory',
  'pack-capacity-coverage',
  'pack-capacity-evidence-support',
  'pack-capacity-accounting',
  'pack-capacity-methodology',
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
  h.timeZone = 'America/Los_Angeles';
  h.sessions = query({ data: readyHistory() });
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
});

describe('PackCapacityPage', () => {
  it('renders all fourteen analytical shells from the capped canonical hook', () => {
    renderPage();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Pack Capacity',
      }),
    ).toBeInTheDocument();
    expectEverySection();
    expect(h.chargingHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
    expect(screen.getAllByText(/kWh/).length).toBeGreaterThan(0);
  });

  it('recomputes methodology from both model selectors', () => {
    renderPage();

    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Minimum SoC window',
      }),
      { target: { value: '40' } },
    );
    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Process uncertainty',
      }),
      { target: { value: '60' } },
    );

    const method = within(
      screen.getByTestId('pack-capacity-methodology'),
    );
    expect(method.getByText(/selected 40 percentage points/i))
      .toBeInTheDocument();
    expect(method.getByText(/60 Wh per square-root day/i))
      .toBeInTheDocument();
  });

  it('freezes recency across source updates', () => {
    const view = renderPage();
    const coverage = within(
      screen.getByTestId('pack-capacity-coverage'),
    );
    const recencyCard = coverage
      .getByText('Recency')
      .closest('div')?.parentElement;
    const before = recencyCard?.textContent;

    vi.mocked(Date.now).mockReturnValue(
      FROZEN_NOW + 30 * 86_400_000,
    );
    h.sessions = query({ data: [...readyHistory()] });
    view.rerenderPage();

    const afterCard = within(
      screen.getByTestId('pack-capacity-coverage'),
    )
      .getByText('Recency')
      .closest('div')?.parentElement;
    expect(afterCard?.textContent).toBe(before);
  });

  it('keeps every shell visible while charging history loads', () => {
    h.sessions = query({ isLoading: true });

    renderPage();

    expectEverySection();
    expect(
      screen.getByRole('status', {
        name: 'Loading Pack Capacity evidence',
      }),
    ).toBeInTheDocument();
  });

  it('keeps every shell visible without a selected vehicle', () => {
    h.vehicleId = null;
    h.sessions = query();

    renderPage();

    expectEverySection();
    expect(h.chargingHook).toHaveBeenLastCalledWith(undefined, 1_000);
    expect(
      screen.getByText(
        'Select a vehicle to analyze its returned charging history.',
      ),
    ).toBeInTheDocument();
  });

  it('shows one retry surface when charging history fails', () => {
    h.sessions = query({
      isError: true,
      error: new Error('charging failed'),
    });

    renderPage();

    expectEverySection();
    const retries = screen.getAllByRole('button', { name: /retry/i });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]!);
    expect(refetchCharging).toHaveBeenCalledTimes(1);
  });

  it('retains cached evidence through a refresh error', () => {
    h.sessions = query({
      data: readyHistory(),
      isError: true,
      isSuccess: false,
      error: new Error('refresh failed'),
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Charging history could not refresh. Showing the most recently loaded evidence.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1);
  });

  it('keeps all shells and exact accounting for empty success', () => {
    h.sessions = query({ data: [] });

    renderPage();

    expectEverySection();
    expect(
      within(screen.getByTestId('pack-capacity-kpis')).getByText(
        'No charging history was returned for this vehicle.',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('pack-capacity-accounting')).getByText(
        '0 returned = 0 included + 0 excluded. Missing completion times are never synthesized, and missing SoC or energy is never imputed.',
      ),
    ).toBeInTheDocument();
  });
});
