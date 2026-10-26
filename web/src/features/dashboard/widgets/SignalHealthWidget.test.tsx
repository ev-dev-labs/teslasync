import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

let MOCK_VEHICLES: { data: { id: number }[] | undefined };
let MOCK_STATS: StatsQuery;
let MOCK_GAPS: { data: GapMap | undefined; isError?: boolean; error?: unknown; isFetching?: boolean; isStale?: boolean; refetch?: () => void; dataUpdatedAt?: number };
let MOCK_SIGNALS: { data: string[] | undefined; isError?: boolean; error?: unknown; isFetching?: boolean; isStale?: boolean; refetch?: () => void; dataUpdatedAt?: number };
const mockIds = { stats: [] as number[], gaps: [] as number[], signals: [] as number[] };

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => MOCK_VEHICLES,
}));

vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalStats: (id: number) => (mockIds.stats.push(id), MOCK_STATS),
  useSignalGaps: (id: number) => (mockIds.gaps.push(id), MOCK_GAPS),
  useSignals: (id: number) => (mockIds.signals.push(id), MOCK_SIGNALS),
}));

import SignalHealthWidget from './SignalHealthWidget';
import type { WidgetSize } from './types';

interface StatsQuery {
  error?: unknown;
  data: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}
type GapEntry = { value?: unknown; timestamp?: string | null };
type GapMap = Record<string, GapEntry>;

const NOW = Date.parse('2026-07-05T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const STANDARD: WidgetSize = { cols: 2, rows: 2 };
const WIDE: WidgetSize = { cols: 3, rows: 2 };

function makeStats(overrides: Partial<StatsQuery> = {}): StatsQuery {
  return {
    data: { count: 1 }, isLoading: false, isFetching: false, isStale: false,
    isError: false, dataUpdatedAt: NOW, refetch: vi.fn(), ...overrides,
  };
}

function renderWidget(size: WidgetSize, vehicleId = 42) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SignalHealthWidget vehicleId={vehicleId} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  MOCK_VEHICLES = { data: [{ id: 7 }] };
  MOCK_STATS = makeStats();
  MOCK_GAPS = { data: {} };
  MOCK_SIGNALS = { data: [] };
  mockIds.stats.length = 0;
  mockIds.gaps.length = 0;
  mockIds.signals.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SignalHealthWidget redesign', () => {
  it('shows one headline active/observed value, coverage, and status without timezone labels', () => {
    MOCK_SIGNALS = { data: ['A', 'B', 'C'] };
    MOCK_GAPS = { data: {
      A: { timestamp: ago(30_000) },
      B: { timestamp: ago(20_000) },
      C: { timestamp: ago(10 * MIN) },
    } };
    const { container } = renderWidget(STANDARD);

    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('Degraded')).toBeInTheDocument();
    const meter = screen.getByRole('progressbar', { name: 'Reporting coverage' });
    expect(meter).toHaveAttribute('aria-valuenow', '67');
    expect(container.textContent ?? '').not.toMatch(/\bUTC\b|\bGMT\b|time zone/i);
  });

  it('uses real gap rows for the wide view and excludes active signals', () => {
    MOCK_SIGNALS = { data: ['A', 'B', 'C'] };
    MOCK_GAPS = { data: {
      VehicleSpeed: { timestamp: ago(20_000) },
      TpmsPressureRl: { timestamp: ago(40 * MIN) },
      MissingTimestamp: { value: 1 },
    } };
    renderWidget(WIDE);

    expect(screen.queryByText('VehicleSpeed')).toBeNull();
    expect(screen.getByText('TpmsPressureRl')).toBeInTheDocument();
    expect(screen.getByText('MissingTimestamp')).toBeInTheDocument();
    expect(screen.getByText(/Stale ·/)).toBeInTheDocument();
    expect(screen.getByText('Gap')).toBeInTheDocument();
  });

  it('counts unparseable timestamps as gaps and never fabricates freshness or NaN', () => {
    MOCK_SIGNALS = { data: ['A', 'B', 'C'] };
    MOCK_GAPS = { data: {
      Good: { timestamp: ago(30_000) },
      Bad: { timestamp: 'not-a-real-date' },
      Missing: { value: 1 },
    } };
    const { container } = renderWidget(STANDARD);

    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain('NaN');
  });

  it('renders compact coverage with no duplicate large totals', () => {
    MOCK_GAPS = { data: {
      A: { timestamp: ago(30_000) },
      B: { timestamp: ago(10 * MIN) },
    } };
    MOCK_SIGNALS = { data: ['A', 'B'] };
    renderWidget(COMPACT);

    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Signals reporting')).toBeInTheDocument();
    expect(screen.queryByText('Total signals')).toBeNull();
  });

  it('retains data on refresh failure and wires every source refresh', () => {
    const stats = vi.fn(), gaps = vi.fn(), signals = vi.fn();
    MOCK_STATS = makeStats({ refetch: stats });
    MOCK_GAPS = { data: { A: { timestamp: ago(10_000) } }, isError: true, error: new Error('refresh'), refetch: gaps };
    MOCK_SIGNALS = { data: ['A'], refetch: signals };
    const { container } = renderWidget(STANDARD);

    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="stale"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(stats).toHaveBeenCalledTimes(1);
    expect(gaps).toHaveBeenCalledTimes(1);
    expect(signals).toHaveBeenCalledTimes(1);
  });

  it('uses the empty-state action only when no source data exists', () => {
    MOCK_STATS = makeStats({ data: undefined, dataUpdatedAt: 0 });
    MOCK_GAPS = { data: undefined, refetch: vi.fn() };
    MOCK_SIGNALS = { data: undefined, refetch: vi.fn() };
    renderWidget(STANDARD);

    expect(screen.getByText('No signal health data')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Refresh' }));
    expect(MOCK_STATS.refetch).toHaveBeenCalledTimes(1);
    expect(MOCK_GAPS.refetch).toHaveBeenCalledTimes(1);
    expect(MOCK_SIGNALS.refetch).toHaveBeenCalledTimes(1);
  });

  it('resolves the vehicle scope and does not invent a vehicle result from the fleet head', () => {
    MOCK_VEHICLES = { data: [{ id: 7 }] };
    renderWidget(STANDARD, 42);
    expect(mockIds.stats).toContain(42);
    expect(mockIds.gaps).toContain(42);
    expect(mockIds.signals).toContain(42);
    expect(mockIds.stats).not.toContain(7);
  });
});
