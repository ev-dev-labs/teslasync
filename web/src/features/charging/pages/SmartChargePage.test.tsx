/**
 * SmartChargePage — behaviour + hardening coverage.
 *
 * The module exports the page (default) plus two pure utilities:
 *   - `planStatusVariant(status)` — maps a plan lifecycle status onto a shared
 *     Badge variant. Every branch (incl. the neutral fallback) is asserted.
 *   - `defaultDepartBy()` — the datetime-local seed. A `<input
 *     type="datetime-local">` value is LOCAL wall-clock, so this must emit
 *     local calendar fields. This suite pins the regression that the seed is
 *     `07:30` local (the previous `toISOString().slice(0,16)` leaked UTC and
 *     shifted the default by the user's timezone offset). We force a non-UTC
 *     zone below so a UTC-leaking implementation would fail the assertion.
 *
 * The page itself is driven through every meaningful branch by mocking its four
 * data hooks (`useOptimizeCharge` / `useApplySchedule` / `useChargePlans` /
 * `useRatePlans`), the global vehicle selection, and the display-boundary
 * formatters. The shared UI (PageContainer, MetricCard, Select/Input/Slider,
 * DataTable, EmptyState, Skeleton, QueryError, RateTimeline, VehicleSelect) is
 * REAL so the render-boundary wiring is genuinely exercised. Network is never
 * touched; the AI suggestion card (gated + streaming) is inert here.
 *
 * Facets covered: pre-optimize placeholders + labelled cost region; per-panel
 * empty states; rate-plan fallback vs backend options; no-vehicle disable +
 * prompt; the snake_case optimize payload assembled from live form state;
 * pending skeletons/spinner; optimizer error surfacing; a populated result
 * (KPIs, timeline legend, schedule facts, alternatives, window copy); apply
 * success badge + apply failure copy; and plan-history loading / retryable
 * error / populated rows / empty message.
 */

// Force a non-UTC zone BEFORE the component mounts so `defaultDepartBy` (which
// reads native local Date fields) is exercised off-UTC. A UTC-leaking seed
// would render `11:30`/`12:30` here instead of the intended `07:30`.
process.env.TZ = 'America/New_York';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { ChargePlan, OptimizeChargeResponse, RatePlanInfo } from '@/types/charging';

// ── i18n stub: resolve the string fallback (or options-bag defaultValue) and
//    interpolate {{var}} placeholders so assertions read on human copy. ──────
vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') {
      return interpolate(second, third as Record<string, unknown> | undefined);
    }
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── framer-motion: strip animation props, keep motion.* + AnimatePresence. ──
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              ['animate', 'initial', 'exit', 'transition', 'whileHover', 'whileTap', 'whileInView', 'viewport', 'variants'].includes(
                k,
              )
            )
              continue;
            safe[k] = v;
          }
          return <div {...(safe as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// The AI schedule card is gated by ai_mode and reaches a streaming endpoint; it
// has its own suite. Inert here, but echo the vehicle prop so we can prove the
// page threads the current selection into it.
vi.mock('@/components/ai/AISmartChargeScheduleSuggestion', () => ({
  AISmartChargeScheduleSuggestion: (props: { vehicleId?: number }) => (
    <div data-testid="ai-suggestion" data-vehicle-id={String(props.vehicleId ?? '')} />
  ),
}));

// ── Display-boundary formatters: deterministic + timezone-independent. ──
vi.mock('@/hooks/useDateFormat', () => {
  const ymd = (v: unknown) => (v == null ? '—' : new Date(v as string).toISOString().slice(0, 10));
  const hm = (v: unknown) => (v == null ? '—' : new Date(v as string).toISOString().slice(11, 16));
  return {
    useDateFormat: () => ({
      opts: { locale: 'en-US', tz: 'UTC' },
      tz: 'UTC',
      locale: 'en-US',
      formatDate: ymd,
      formatDateTime: ymd,
      formatTime: hm,
      formatDateShort: ymd,
      formatDateWithDay: ymd,
      formatRelative: ymd,
      formatRelativeTime: hm,
      formatRelativeDays: ymd,
    }),
  };
});
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    costPerKwh: 0.12,
    currencySymbol: '$',
    formatEnergyCost: (kwh: number) => `$${(kwh * 0.12).toFixed(2)}`,
    formatCurrency: (amount: number, decimals = 2) => `$${Number(amount ?? 0).toFixed(decimals)}`,
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
  }),
}));

// ── Data + environment hooks, driven per test. ──
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/api/hooks/useCharging', () => ({
  useOptimizeCharge: vi.fn(),
  useApplySchedule: vi.fn(),
  useChargePlans: vi.fn(),
  useRatePlans: vi.fn(),
}));

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useOptimizeCharge, useApplySchedule, useChargePlans, useRatePlans } from '@/api/hooks/useCharging';
import SmartChargePage, { planStatusVariant, defaultDepartBy } from './SmartChargePage';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockOptimize = useOptimizeCharge as unknown as ReturnType<typeof vi.fn>;
const mockApply = useApplySchedule as unknown as ReturnType<typeof vi.fn>;
const mockPlans = useChargePlans as unknown as ReturnType<typeof vi.fn>;
const mockRatePlans = useRatePlans as unknown as ReturnType<typeof vi.fn>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    status: 'success',
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
    refetch: vi.fn(),
    ...over,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function optimizeState(over: Record<string, unknown> = {}): any {
  return { mutate: vi.fn(), isPending: false, isError: false, error: null, ...over };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyState(over: Record<string, unknown> = {}): any {
  return { mutate: vi.fn(), isPending: false, isError: false, error: null, ...over };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function selected(vehicleId: number | null): any {
  return {
    vehicleId,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Model 3', vin: 'VIN7' }],
    setVehicleId: vi.fn(),
  };
}

const RESULT: OptimizeChargeResponse = {
  plan_id: 555,
  current_soc: 35,
  target_soc: 80,
  kwh_needed: 42,
  estimated_duration_hours: 3.5,
  schedule: {
    start_time: '2026-01-16T02:00:00Z',
    end_time: '2026-01-16T05:00:00Z',
    rate_cents_kwh: 24,
    estimated_cost: 3.25,
    rate_tier: 'OFF_PEAK',
  },
  comparison: { charge_now_cost: 8.5, optimized_cost: 3.25, savings: 5.25, savings_percent: 61.8 },
  alternative_windows: [
    { start_time: '2026-01-16T01:00:00Z', end_time: '2026-01-16T04:00:00Z', rate_cents_kwh: 26, estimated_cost: 4.1, rate_tier: 'SUPER_OFF_PEAK' },
    { start_time: '2026-01-16T22:00:00Z', end_time: '2026-01-17T02:00:00Z', rate_cents_kwh: 28, estimated_cost: 4.8, rate_tier: 'MID_PEAK' },
  ],
  hourly_rates: [
    { hour: 0, rate_cents: 20, tier: 'OFF_PEAK' },
    { hour: 6, rate_cents: 45, tier: 'ON_PEAK' },
    { hour: 12, rate_cents: 30, tier: 'MID_PEAK' },
    { hour: 18, rate_cents: 50, tier: 'ON_PEAK' },
  ],
};

function makePlan(over: Partial<ChargePlan> = {}): ChargePlan {
  return {
    id: 1,
    vehicle_id: 7,
    target_soc: 80,
    depart_by: '2026-01-16T07:30:00Z',
    scheduled_start: '2026-01-16T02:00:00Z',
    scheduled_end: '2026-01-16T05:00:00Z',
    rate_plan: 'PG&E EV2-A',
    estimated_kwh: 42,
    estimated_cost: 3.25,
    charge_now_cost: 8.5,
    savings: 5.25,
    status: 'completed',
    applied_at: null,
    completed_at: '2026-01-16T05:00:00Z',
    created_at: '2026-01-15T10:00:00Z',
    ...over,
  };
}

const backendRatePlans: RatePlanInfo[] = [
  { id: 'pge-ev2a', name: 'PG&E EV2-A', utility: 'PG&E' },
  { id: 'ladwp-r1b', name: 'LADWP R1B', utility: 'LADWP' },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SmartChargePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const optimizeButton = () => screen.getByRole('button', { name: /Find Cheapest Window/i });

beforeEach(() => {
  vi.clearAllMocks();
  mockSelected.mockReturnValue(selected(7));
  mockOptimize.mockReturnValue(optimizeState());
  mockApply.mockReturnValue(applyState());
  mockPlans.mockReturnValue(makeQuery({ data: [] }));
  mockRatePlans.mockReturnValue(makeQuery({ data: [] }));
});

// ───────────────────────────── pure utilities ─────────────────────────────

describe('planStatusVariant', () => {
  it('maps each lifecycle status onto its semantic badge variant', () => {
    expect(planStatusVariant('completed')).toBe('success');
    expect(planStatusVariant('scheduled')).toBe('info');
    expect(planStatusVariant('applied')).toBe('info');
    expect(planStatusVariant('pending')).toBe('warning');
    expect(planStatusVariant('cancelled')).toBe('danger');
    expect(planStatusVariant('failed')).toBe('danger');
  });

  it('falls back to neutral for unknown / empty statuses', () => {
    expect(planStatusVariant('mystery')).toBe('neutral');
    expect(planStatusVariant('')).toBe('neutral');
  });
});

describe('defaultDepartBy', () => {
  it('seeds tomorrow at 07:30 local time in minute-precision datetime-local shape', () => {
    const exp = new Date();
    exp.setDate(exp.getDate() + 1);
    exp.setHours(7, 30, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    const expected = `${exp.getFullYear()}-${pad(exp.getMonth() + 1)}-${pad(exp.getDate())}T07:30`;

    const value = defaultDepartBy();
    expect(value).toBe(expected);
    // Exactly yyyy-MM-ddTHH:mm — no seconds/millis/zone suffix.
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('does not leak UTC — the wall-clock time stays 07:30 regardless of offset', () => {
    // Regression guard for the old toISOString().slice(0,16): under a non-UTC
    // TZ that would emit 11:30/12:30, not 07:30.
    expect(defaultDepartBy().endsWith('T07:30')).toBe(true);
  });
});

// ─────────────────────────── page: pre-optimize ───────────────────────────

describe('SmartChargePage — before an optimization runs', () => {
  it('shows the labelled cost-comparison region with em-dash placeholders', () => {
    renderPage();
    const kpi = screen.getByRole('region', { name: 'Cost comparison' });
    expect(within(kpi).getByText('Charge Now')).toBeInTheDocument();
    expect(within(kpi).getByText('Optimized Cost')).toBeInTheDocument();
    expect(within(kpi).getByText('Savings')).toBeInTheDocument();
    expect(within(kpi).getByText('Energy Needed')).toBeInTheDocument();
    // All four metric values render the placeholder, never a blank tile.
    expect(within(kpi).getAllByText('—')).toHaveLength(4);
  });

  it('renders per-panel empty states for timeline, schedule, and alternatives', () => {
    renderPage();
    expect(
      screen.getByText(/Run an optimization to see the 24-hour rate timeline/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Optimize a schedule to see the recommended charge window/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Optimize a schedule to compare alternative charge windows/i),
    ).toBeInTheDocument();
  });

  it('threads the selected vehicle into the AI suggestion card', () => {
    renderPage();
    expect(screen.getByTestId('ai-suggestion').getAttribute('data-vehicle-id')).toBe('7');
  });
});

// ─────────────────────────── page: rate plans ─────────────────────────────

describe('SmartChargePage — rate plan select', () => {
  it('falls back to the built-in California TOU plans when the backend list is empty', () => {
    mockRatePlans.mockReturnValue(makeQuery({ data: [] }));
    renderPage();
    const select = screen.getByLabelText('Rate Plan') as HTMLSelectElement;
    expect(within(select).getByRole('option', { name: 'PG&E EV2-A' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'SCE TOU-D' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'SDG&E TOU-DR1' })).toBeInTheDocument();
  });

  it('uses the backend rate plans (name + utility) when they are available', () => {
    mockRatePlans.mockReturnValue(makeQuery({ data: backendRatePlans }));
    renderPage();
    const select = screen.getByLabelText('Rate Plan');
    expect(within(select).getByRole('option', { name: 'LADWP R1B (LADWP)' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'PG&E EV2-A (PG&E)' })).toBeInTheDocument();
  });
});

// ─────────────────────────── page: optimize flow ──────────────────────────

describe('SmartChargePage — optimize interaction', () => {
  it('disables Optimize and prompts for a vehicle when none is selected', () => {
    mockSelected.mockReturnValue(selected(null));
    renderPage();
    expect(optimizeButton()).toBeDisabled();
    expect(
      screen.getByText('Select a vehicle to optimize a charge schedule.'),
    ).toBeInTheDocument();
  });

  it('seeds the Depart By field with a local (non-UTC) 07:30 wall-clock value', () => {
    renderPage();
    const departInput = screen.getByLabelText('Depart By') as HTMLInputElement;
    expect(departInput.value).toMatch(/T07:30$/);
  });

  it('sends a snake_case payload assembled from the live form state', () => {
    const mutate = vi.fn();
    mockOptimize.mockReturnValue(optimizeState({ mutate }));
    renderPage();

    fireEvent.change(screen.getByLabelText('Rate Plan'), { target: { value: 'sce-tou-d' } });
    fireEvent.change(screen.getByLabelText('Max Amps'), { target: { value: '40' } });
    fireEvent.click(optimizeButton());

    expect(mutate).toHaveBeenCalledTimes(1);
    const [payload] = mutate.mock.calls[0];
    expect(payload).toMatchObject({
      vehicle_id: 7,
      target_soc: 80,
      rate_plan_id: 'sce-tou-d',
      max_amps: 40,
      battery_capacity_kwh: 75,
    });
    // depart_by is normalised to an ISO instant before hitting the API.
    expect(payload.depart_by).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('renders a spinner + skeletons and blocks re-submit while pending', () => {
    mockOptimize.mockReturnValue(optimizeState({ isPending: true }));
    const { container } = renderPage();
    expect(optimizeButton()).toBeDisabled();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('surfaces the optimizer error message on failure', () => {
    mockOptimize.mockReturnValue(
      optimizeState({ isError: true, error: new Error('rate service unavailable') }),
    );
    renderPage();
    expect(screen.getAllByText('rate service unavailable').length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────── page: populated result ───────────────────────

describe('SmartChargePage — after a successful optimization', () => {
  function optimizeToResult() {
    const mutate = vi.fn((_vars: unknown, opts?: { onSuccess?: (r: OptimizeChargeResponse) => void }) =>
      opts?.onSuccess?.(RESULT),
    );
    mockOptimize.mockReturnValue(optimizeState({ mutate }));
    renderPage();
    fireEvent.click(optimizeButton());
  }

  it('fills the KPI band, energy tile, and savings delta from the response', () => {
    optimizeToResult();
    const kpi = screen.getByRole('region', { name: 'Cost comparison' });
    expect(within(kpi).getByText('$8.50')).toBeInTheDocument(); // charge now
    expect(within(kpi).getByText('$3.25')).toBeInTheDocument(); // optimized
    expect(within(kpi).getByText('$5.25')).toBeInTheDocument(); // savings
    expect(within(kpi).getByText('42.0 kWh')).toBeInTheDocument(); // energy
    expect(within(kpi).getByText(/62%/)).toBeInTheDocument(); // savings_percent delta
    expect(screen.queryAllByText('—')).toHaveLength(0);
  });

  it('renders the rate-timeline legend incl. the highlighted charge window', () => {
    optimizeToResult();
    expect(screen.getByText('Off-Peak')).toBeInTheDocument();
    expect(screen.getByText('Mid-Peak')).toBeInTheDocument();
    expect(screen.getByText('On-Peak')).toBeInTheDocument();
    expect(screen.getByText('Charge Window')).toBeInTheDocument();
    expect(screen.getByText('Optimal window: 02:00 — 05:00')).toBeInTheDocument();
  });

  it('renders the recommended-schedule facts and the alternative windows', () => {
    optimizeToResult();
    expect(screen.getByText('Current SOC')).toBeInTheDocument();
    expect(screen.getByText('35%')).toBeInTheDocument();
    expect(screen.getByText('Start Time')).toBeInTheDocument();
    expect(screen.getByText('End Time')).toBeInTheDocument();
    // Alternative windows list: distinct tier labels + formatted costs.
    expect(screen.getByText('SUPER_OFF_PEAK')).toBeInTheDocument();
    expect(screen.getByText('$4.10')).toBeInTheDocument();
    expect(screen.getByText('$4.80')).toBeInTheDocument();
  });

  it('applies the schedule and confirms with a success badge', () => {
    const optimizeMutate = vi.fn((_v: unknown, o?: { onSuccess?: (r: OptimizeChargeResponse) => void }) =>
      o?.onSuccess?.(RESULT),
    );
    const applyMutate = vi.fn((_v: unknown, o?: { onSuccess?: () => void }) => o?.onSuccess?.());
    mockOptimize.mockReturnValue(optimizeState({ mutate: optimizeMutate }));
    mockApply.mockReturnValue(applyState({ mutate: applyMutate }));
    renderPage();

    fireEvent.click(optimizeButton());
    fireEvent.click(screen.getByRole('button', { name: /Apply Schedule/i }));

    expect(applyMutate).toHaveBeenCalledTimes(1);
    expect(applyMutate.mock.calls[0][0]).toEqual({ plan_id: 555 });
    expect(screen.getByText('Schedule Applied!')).toBeInTheDocument();
  });

  it('shows the apply error copy when applying fails', () => {
    const optimizeMutate = vi.fn((_v: unknown, o?: { onSuccess?: (r: OptimizeChargeResponse) => void }) =>
      o?.onSuccess?.(RESULT),
    );
    mockOptimize.mockReturnValue(optimizeState({ mutate: optimizeMutate }));
    mockApply.mockReturnValue(applyState({ isError: true, error: new Error('vehicle offline') }));
    renderPage();

    fireEvent.click(optimizeButton());
    expect(screen.getByText('vehicle offline')).toBeInTheDocument();
  });
});

// ─────────────────────────── page: plan history ───────────────────────────

describe('SmartChargePage — plan history', () => {
  it('renders a skeleton while history is loading and there is nothing cached', () => {
    mockPlans.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(
      screen.queryByText(/No charge plans yet/i),
    ).not.toBeInTheDocument();
  });

  it('shows a retryable error and wires Retry to refetch when history fails', () => {
    const refetch = vi.fn();
    mockPlans.mockReturnValue(
      makeQuery({ data: undefined, isError: true, error: new Error('history down'), refetch }),
    );
    renderPage();
    const retry = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders history rows with semantically-coloured status badges', () => {
    mockPlans.mockReturnValue(
      makeQuery({
        data: [
          makePlan({ id: 1, status: 'completed', rate_plan: 'PG&E EV2-A' }),
          makePlan({ id: 2, status: 'pending', rate_plan: 'SCE TOU-D', estimated_cost: null, savings: null }),
        ],
      }),
    );
    renderPage();
    // Scope to the single history <table> so the rate-plan cells aren't
    // confused with the identically-labelled Rate Plan <select> options.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('PG&E EV2-A')).toBeInTheDocument();
    expect(table.getByText('SCE TOU-D')).toBeInTheDocument();
    // planStatusVariant surfaced through the shared Badge colour classes.
    expect(table.getByText('completed').className).toContain('bg-green-100');
    expect(table.getByText('pending').className).toContain('bg-yellow-100');
  });

  it('shows the empty message when there are no charge plans', () => {
    mockPlans.mockReturnValue(makeQuery({ data: [] }));
    renderPage();
    expect(
      screen.getByText('No charge plans yet. Optimize a schedule above to get started.'),
    ).toBeInTheDocument();
  });
});
