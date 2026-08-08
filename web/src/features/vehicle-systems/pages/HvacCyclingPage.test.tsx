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

import type { ClimateState } from '@/types/vehicle-systems';

const BASE = Date.parse('2026-08-08T12:00:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as unknown,
  historyHook: vi.fn(),
}));
const refetch = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, options?: unknown) => {
      const text = typeof fallback === 'string' ? fallback : _key;
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
}));

vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useClimateHistory: (vehicleId: string) => {
    h.historyHook(vehicleId);
    return h.history;
  },
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { duration: 'min' },
    formatDuration: (
      value: number | null | undefined,
      options?: { precision?: number },
    ) =>
      value == null || !Number.isFinite(value)
        ? '—'
        : `${(value / 60).toFixed(options?.precision ?? 1)} min`,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select">Vehicle picker</div>,
}));

vi.mock('@/components/charts', () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  ChartContainer: ({
    children,
    title,
    ariaLabel,
  }: {
    children: ReactNode;
    title: string;
    ariaLabel: string;
  }) => (
    <div>
      <h4>{title}</h4>
      <div role="img" aria-label={ariaLabel}>{children}</div>
    </div>
  ),
  ChartTooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import HvacCyclingPage from './HvacCyclingPage';

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
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
    isFetching: isLoading,
    isStale: false,
    dataUpdatedAt: BASE,
    refetch,
    ...overrides,
  };
}

function climate(
  minute: number,
  state: Partial<ClimateState>,
): ClimateState {
  return {
    timestamp: new Date(BASE + minute * 60_000).toISOString(),
    ...state,
  };
}

function completeEvidence(): ClimateState[] {
  return [
    climate(0, { hvacPower: false }),
    climate(5, { hvacPower: true }),
    climate(10, { hvacPower: true }),
    climate(15, { hvacPower: false }),
    climate(20, { hvacPower: false }),
    climate(25, { hvacPower: true }),
    climate(30, { hvacPower: true }),
    climate(35, { hvacPower: false }),
  ];
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/hvac-cycling']}>
      <HvacCyclingPage />
    </MemoryRouter>,
  );
}

const sectionIds = [
  'hvac-cycling-kpis',
  'hvac-cycling-source-availability',
  'hvac-cycling-coverage-cadence',
  'hvac-cycling-interval-disposition',
  'hvac-cycling-duty-composition',
  'hvac-cycling-hourly-duty',
  'hvac-cycling-transition-matrix',
  'hvac-cycling-run-distribution',
  'hvac-cycling-cycle-diagnostics',
  'hvac-cycling-thresholds',
  'hvac-cycling-run-directory',
  'hvac-cycling-accounting',
  'hvac-cycling-availability',
  'hvac-cycling-methodology',
] as const;

function expectEverySection(): void {
  for (const id of sectionIds) {
    expect(screen.getByTestId(id)).toBeInTheDocument();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.history = query({ data: completeEvidence() });
});

describe('HvacCyclingPage', () => {
  it('renders all fourteen persistent shells with complete evidence', () => {
    renderPage();

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'HVAC Cycling',
    })).toBeInTheDocument();
    expectEverySection();
    expect(h.historyHook).toHaveBeenLastCalledWith('7');
    expect(screen.getByText('2-run denominator')).toBeInTheDocument();
    expect(screen.getAllByText('Complete support').length).toBeGreaterThan(0);
  });

  it('keeps the header, vehicle control, and every shell without a vehicle', () => {
    h.vehicleId = null;
    h.history = query();
    renderPage();

    expectEverySection();
    expect(screen.getByTestId('vehicle-select')).toBeInTheDocument();
    expect(h.historyHook).toHaveBeenLastCalledWith('');
    expect(screen.getByText(
      'Select a vehicle to analyze its returned climate timeline.',
    )).toBeInTheDocument();
  });

  it('keeps every shell visible while loading', () => {
    h.history = query({ isLoading: true, isSuccess: false });
    renderPage();

    expectEverySection();
    expect(screen.getAllByRole('status', {
      name: 'Loading HVAC cycling evidence',
    })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows one retry for an initial error while retaining all shells', () => {
    h.history = query({
      isError: true,
      isSuccess: false,
      error: new Error('history unavailable'),
    });
    renderPage();

    expectEverySection();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]!);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('preserves cached evidence through a refresh error', () => {
    h.history = query({
      data: completeEvidence(),
      isError: true,
      isSuccess: false,
      error: new Error('refresh unavailable'),
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Climate history could not refresh. Showing the most recently loaded HVAC evidence.',
    )).toBeInTheDocument();
    expect(screen.getAllByText('Complete support').length).toBeGreaterThan(0);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]!);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps exact zero accounting for an empty success', () => {
    h.history = query({ data: [] });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'The climate endpoint returned no rows, so no cycling claim is made.',
    )).toBeInTheDocument();
    expect(
      within(screen.getByTestId('hvac-cycling-accounting'))
        .getAllByText('Balances'),
    ).toHaveLength(4);
  });

  it('discloses returned but uninterpretable rows', () => {
    h.history = query({
      data: [
        climate(0, {}),
        climate(5, { fanSpeed: Number.NaN }),
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Rows were returned, but every unique timestamp had an uninterpretable HVAC state.',
    )).toBeInTheDocument();
    expect(screen.getByText('Valid timestamp, unknown state')).toBeInTheDocument();
  });

  it('distinguishes known samples from absent observed intervals', () => {
    h.history = query({
      data: [climate(0, { hvacPower: false })],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Known states exist, but no adjacent interval passed the continuity and maximum-gap rules.',
    )).toBeInTheDocument();
    expect(screen.getByText('0-run denominator')).toBeInTheDocument();
  });

  it('withholds short-cycle rate for censored-only active evidence', () => {
    h.history = query({
      data: [
        climate(0, { hvacPower: true }),
        climate(5, { hvacPower: true }),
        climate(10, { hvacPower: false }),
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Active run fragments are present, but none has two observed transition boundaries; short-cycle rate is withheld.',
    )).toBeInTheDocument();
    expect(screen.getByText(
      'The denominator is zero: every active fragment is left-censored, right-censored, or both. No short-cycle rate is published.',
    )).toBeInTheDocument();
  });
});
