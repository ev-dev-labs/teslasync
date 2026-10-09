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
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BADGE_VARIANTS } from '@/components/ui';

import type { ChargePlan, OptimizeChargeResponse, RatePlanInfo, AutopilotProfile, AutopilotSavings } from '@/types/charging';
import type { OcppChargePoint, OcppSession } from '@/api/hooks/useOcpp';

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
  const MotionElement = ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
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
  };
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get: () => MotionElement,
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
  // Consumed by the embedded AutopilotPanel (rendered for real).
  useAutopilotProfile: vi.fn(),
  useSaveAutopilotProfile: vi.fn(),
  useAutopilotPreview: vi.fn(),
  useAutopilotRun: vi.fn(),
  useAutopilotSavings: vi.fn(),
}));

// Consumed by the embedded ChargePointsPanel (rendered for real).
vi.mock('@/api/hooks/useOcpp', () => ({
  useOcppChargePoints: vi.fn(),
  useOcppSessions: vi.fn(),
}));

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useOptimizeCharge,
  useApplySchedule,
  useChargePlans,
  useRatePlans,
  useAutopilotProfile,
  useSaveAutopilotProfile,
  useAutopilotPreview,
  useAutopilotRun,
  useAutopilotSavings,
} from '@/api/hooks/useCharging';
import { useOcppChargePoints, useOcppSessions } from '@/api/hooks/useOcpp';
import SmartChargePage, { planStatusVariant, defaultDepartBy } from './SmartChargePage';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockOptimize = useOptimizeCharge as unknown as ReturnType<typeof vi.fn>;
const mockApply = useApplySchedule as unknown as ReturnType<typeof vi.fn>;
const mockPlans = useChargePlans as unknown as ReturnType<typeof vi.fn>;
const mockRatePlans = useRatePlans as unknown as ReturnType<typeof vi.fn>;
const mockAutopilotProfile = useAutopilotProfile as unknown as ReturnType<typeof vi.fn>;
const mockSaveAutopilot = useSaveAutopilotProfile as unknown as ReturnType<typeof vi.fn>;
const mockAutopilotPreview = useAutopilotPreview as unknown as ReturnType<typeof vi.fn>;
const mockAutopilotRun = useAutopilotRun as unknown as ReturnType<typeof vi.fn>;
const mockAutopilotSavings = useAutopilotSavings as unknown as ReturnType<typeof vi.fn>;
const mockOcppPoints = useOcppChargePoints as unknown as ReturnType<typeof vi.fn>;
const mockOcppSessions = useOcppSessions as unknown as ReturnType<typeof vi.fn>;

 
function makeQuery(over: Record<string, unknown> = {}) {
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

 
function optimizeState(over: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, isError: false, error: null, ...over };
}
 
function applyState(over: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, isError: false, error: null, ...over };
}

 
function selected(vehicleId: number | null) {
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
  // Embedded AutopilotPanel defaults (idle, no stored profile yet).
  mockAutopilotProfile.mockReturnValue(makeQuery({ data: undefined }));
  mockSaveAutopilot.mockReturnValue(optimizeState());
  mockAutopilotPreview.mockReturnValue({ mutate: vi.fn(), data: null, isPending: false, isError: false, error: null });
  mockAutopilotRun.mockReturnValue({ mutate: vi.fn(), data: null, isPending: false, isError: false, error: null });
  mockAutopilotSavings.mockReturnValue(makeQuery({ data: undefined }));
  // Embedded ChargePointsPanel defaults (no charger reporting).
  mockOcppPoints.mockReturnValue(makeQuery({ data: [] }));
  mockOcppSessions.mockReturnValue(makeQuery({ data: [] }));
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
    const costComparison = screen.getByRole('region', {
      name: (name, element) => name === 'Cost comparison' && element.hasAttribute('aria-label'),
    });
    const kpi = within(costComparison).getByRole('region', { name: 'Cost comparison' });
    expect(within(kpi).getByText('Charge now')).toBeInTheDocument();
    expect(within(kpi).getByText('Optimized cost')).toBeInTheDocument();
    expect(within(kpi).getByText('Savings')).toBeInTheDocument();
    expect(within(kpi).getByText('Energy needed')).toBeInTheDocument();
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
    expect(screen.getAllByText('PG&E EV2-A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SCE TOU-D').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SDG&E TOU-DR1').length).toBeGreaterThan(0);
  });

  it('uses the backend rate plans (name + utility) when they are available', () => {
    mockRatePlans.mockReturnValue(makeQuery({ data: backendRatePlans }));
    renderPage();
    expect(screen.getAllByText('LADWP R1B (LADWP)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PG&E EV2-A (PG&E)').length).toBeGreaterThan(0);
  });

  it('defaults the selection to the first backend plan (no hardcoded home plan)', () => {
    mockRatePlans.mockReturnValue(
      makeQuery({
        data: [
          { id: 'xcel-tou', name: 'Xcel TOU', utility: 'Xcel' },
          { id: 'ladwp-r1b', name: 'LADWP R1B', utility: 'LADWP' },
        ],
      }),
    );
    renderPage();
    expect(
      (document.getElementById('smart-charge-rate-plan') as HTMLSelectElement).value,
    ).toBe('xcel-tou');
  });

  it('keeps an explicit user choice when the plan list re-resolves', () => {
    mockRatePlans.mockReturnValue(makeQuery({ data: backendRatePlans }));
    renderPage();
    const select = document.getElementById('smart-charge-rate-plan') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'ladwp-r1b' } });
    // Force a re-render through unrelated state; the sync effect must not clobber.
    fireEvent.change(document.getElementById('smart-charge-max-amps') as HTMLInputElement, {
      target: { value: '40' },
    });
    expect(select.value).toBe('ladwp-r1b');
  });

  it('surfaces the rate-plans error with retry instead of silently substituting the fallback', () => {
    const refetch = vi.fn();
    mockRatePlans.mockReturnValue(
      makeQuery({ data: undefined, isError: true, error: new Error('plans down'), status: 'error', refetch }),
    );
    renderPage();
    const rail = (
      document.getElementById('smart-charge-rate-plan') as HTMLElement
    ).closest('div.space-y-4') as HTMLElement;
    const retry = within(rail).getByRole('button', { name: 'Retry' });
    expect(retry).toBeInTheDocument();
    // The fallback list stays usable so the form is not bricked …
    expect(within(rail).getAllByText('PG&E EV2-A').length).toBeGreaterThan(0);
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
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
    const departInput = screen.getByLabelText('Depart by') as HTMLInputElement;
    expect(departInput.value).toMatch(/T07:30$/);
  });

  it('sends a snake_case payload assembled from the live form state', () => {
    const mutate = vi.fn();
    mockOptimize.mockReturnValue(optimizeState({ mutate }));
    renderPage();

    fireEvent.change(document.getElementById('smart-charge-rate-plan') as HTMLSelectElement, {
      target: { value: 'sce-tou-d' },
    });
    fireEvent.change(document.getElementById('smart-charge-max-amps') as HTMLInputElement, {
      target: { value: '40' },
    });
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
    const mutate = vi.fn();
    mockOptimize.mockReturnValue(optimizeState({ isPending: true, mutate }));
    const { container } = renderPage();
    expect(optimizeButton()).toBeDisabled();
    expect(optimizeButton()).toHaveAttribute('aria-busy', 'true');
    const spinner = optimizeButton().querySelector('svg[aria-hidden="true"]');
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveAttribute('focusable', 'false');
    expect(spinner).toHaveClass('h-4', 'w-4');
    const timeline = container.querySelector('[data-chart-state="loading"]');
    expect(timeline).not.toBeNull();
    expect(timeline).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-chart-state="ready"]')).toBeNull();
    for (const title of ['Recommended schedule', 'Alternative windows']) {
      const panel = screen.getByRole('heading', { name: title }).closest('[data-card]');
      const skeleton = panel?.querySelector('[aria-hidden="true"][style="height: 120px;"]');
      expect(skeleton).not.toBeNull();
      expect(skeleton).toHaveClass('h-4', 'w-full', 'bg-[var(--skeleton-bg)]');
    }
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByText(/Optimize a schedule to see the recommended charge window/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Optimize a schedule to compare alternative charge windows/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply Schedule/i })).not.toBeInTheDocument();
    fireEvent.click(optimizeButton());
    expect(mutate).not.toHaveBeenCalled();
  });

  it('surfaces the optimizer error message on failure', () => {
    mockOptimize.mockReturnValue(
      optimizeState({ isError: true, error: new Error('rate service unavailable') }),
    );
    renderPage();
    expect(screen.getAllByText('rate service unavailable').length).toBeGreaterThanOrEqual(1);
  });

  it('blocks submit with an inline error (no crash, no mutate) when Depart By is cleared', () => {
    const mutate = vi.fn();
    mockOptimize.mockReturnValue(optimizeState({ mutate }));
    renderPage();

    fireEvent.change(screen.getByLabelText('Depart by'), { target: { value: '' } });
    fireEvent.click(optimizeButton());

    // Invalid Date.toISOString() used to throw an uncaught RangeError here.
    expect(screen.getByText('Enter a valid departure date and time.')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('blocks submit with an inline error when Max Amps is cleared or out of range', () => {
    const mutate = vi.fn();
    mockOptimize.mockReturnValue(optimizeState({ mutate }));
    renderPage();
    const amps = document.getElementById('smart-charge-max-amps') as HTMLInputElement;

    fireEvent.change(amps, { target: { value: '' } }); // Number('') === 0
    fireEvent.click(optimizeButton());
    expect(screen.getByText('Enter an amperage between 8 and 80.')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.change(amps, { target: { value: '100' } });
    fireEvent.click(optimizeButton());
    expect(screen.getByText('Enter an amperage between 8 and 80.')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('blocks submit with an inline error when Battery Capacity is cleared', () => {
    const mutate = vi.fn();
    mockOptimize.mockReturnValue(optimizeState({ mutate }));
    renderPage();

    // UnitInput commits to the parent on blur/Enter, not on every keystroke.
    const capacity = screen.getByLabelText('Battery capacity');
    fireEvent.change(capacity, { target: { value: '' } });
    fireEvent.blur(capacity);
    fireEvent.click(optimizeButton());

    expect(screen.getByText('Enter a battery capacity greater than 0.')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
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
    const costComparison = screen.getByRole('region', {
      name: (name, element) => name === 'Cost comparison' && element.hasAttribute('aria-label'),
    });
    const kpi = within(costComparison).getByRole('region', { name: 'Cost comparison' });
    expect(within(kpi).getByText('$8.50')).toBeInTheDocument(); // charge now
    expect(within(kpi).getByText('$3.25')).toBeInTheDocument(); // optimized
    expect(within(kpi).getByText('$5.25')).toBeInTheDocument(); // savings
    expect(within(kpi).getByText('42.00 kWh')).toBeInTheDocument(); // energy
    expect(within(kpi).getByText(/61\.80%/)).toBeInTheDocument(); // savings_percent delta
    // Scoped to the KPI band: sibling sections (Autopilot preview placeholders)
    // legitimately render '—' until they have their own data.
    expect(within(kpi).queryAllByText('—')).toHaveLength(0);
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
    expect(screen.getAllByText('Current SOC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('35%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Start time').length).toBeGreaterThan(0);
    expect(screen.getAllByText('End time').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SUPER_OFF_PEAK').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$4.10').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$4.80').length).toBeGreaterThan(0);
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
    expect(screen.getByText('Schedule applied!')).toBeInTheDocument();
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

  it('reports invalid optimizer measurements as unknown without manufacturing zero costs or energy', () => {
    const invalidResult: OptimizeChargeResponse = {
      ...RESULT,
      kwh_needed: Number.NaN,
      current_soc: Number.NaN,
      comparison: { ...RESULT.comparison, charge_now_cost: Number.NaN },
    };
    mockOptimize.mockReturnValue(optimizeState({
      mutate: vi.fn((_vars: unknown, opts?: { onSuccess?: (result: OptimizeChargeResponse) => void }) =>
        opts?.onSuccess?.(invalidResult)),
    }));
    renderPage();
    fireEvent.click(optimizeButton());
    const costComparison = screen.getByRole('region', {
      name: (name, element) => name === 'Cost comparison' && element.hasAttribute('aria-label'),
    });
    const kpi = within(within(costComparison).getByRole('region', { name: 'Cost comparison' }));
    expect(kpi.getAllByText('—')).toHaveLength(2);
    expect(kpi.queryByText('$0.00')).not.toBeInTheDocument();
    expect(kpi.queryByText('0.00 kWh')).not.toBeInTheDocument();
    expect(kpi.getByText('$3.25')).toBeInTheDocument();
  });

  it('does not display or apply a result that finishes after the selected vehicle changes', () => {
    let finish: ((result: OptimizeChargeResponse) => void) | undefined;
    mockOptimize.mockReturnValue(optimizeState({
      mutate: vi.fn((_vars: unknown, opts?: { onSuccess?: (result: OptimizeChargeResponse) => void }) => {
        finish = opts?.onSuccess;
      }),
    }));
    renderPage();
    fireEvent.click(optimizeButton());
    mockSelected.mockReturnValue(selected(8));
    // Native field interaction forces a render with the newly selected scope.
    fireEvent.change(screen.getByLabelText('Depart by'), { target: { value: '2026-01-17T07:30' } });
    act(() => finish?.(RESULT));
    expect(screen.queryByRole('button', { name: /Apply Schedule/i })).not.toBeInTheDocument();
    const costComparison = screen.getByRole('region', {
      name: (name, element) => name === 'Cost comparison' && element.hasAttribute('aria-label'),
    });
    const kpi = within(within(costComparison).getByRole('region', { name: 'Cost comparison' }));
    expect(kpi.getAllByText('—')).toHaveLength(4);
  });
});

// ─────────────────────────── page: plan history ───────────────────────────

describe('SmartChargePage — plan history', () => {
  it('renders a skeleton while history is loading and there is nothing cached', () => {
    mockPlans.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = renderPage();
    const history = screen.getByRole('heading', { name: 'Plan history' }).closest('[data-card]');
    const skeleton = history?.querySelector('[aria-hidden="true"][style="height: 200px;"]');
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveClass('h-4', 'w-full', 'bg-[var(--skeleton-bg)]');
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('table', { name: 'charging:smart-charge-history' })).not.toBeInTheDocument();
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
    const table = within(screen.getByRole('table', { name: 'charging:smart-charge-history' }));
    expect(table.getByText('PG&E EV2-A')).toBeInTheDocument();
    expect(table.getByText('SCE TOU-D')).toBeInTheDocument();
    // planStatusVariant surfaced through the shared Badge colour classes.
    expect(table.getByText('completed')).toHaveClass(...BADGE_VARIANTS.success.split(' '));
    expect(table.getByText('pending')).toHaveClass(...BADGE_VARIANTS.warning.split(' '));
  });

  it('shows the empty message when there are no charge plans', () => {
    mockPlans.mockReturnValue(makeQuery({ data: [] }));
    renderPage();
    expect(
      screen.getByText('No charge plans yet. Optimize a schedule above to get started.'),
    ).toBeInTheDocument();
  });

  it('retains history rows and shows an honest warning after a failed background refresh', () => {
    mockPlans.mockReturnValue(makeQuery({
      data: [makePlan()],
      isError: true,
      error: new Error('history refresh failed'),
    }));
    renderPage();
    const history = within(screen.getByRole('table', { name: 'charging:smart-charge-history' }));
    expect(history.getByText('PG&E EV2-A')).toBeInTheDocument();
    expect(history.getByText('$3.25')).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
  });

  it('keeps cached rate plans selected and reports an offline refresh without substituting defaults', () => {
    mockRatePlans.mockReturnValue(makeQuery({ data: backendRatePlans, fetchStatus: 'paused' }));
    renderPage();
    expect(screen.getAllByText('LADWP R1B (LADWP)').length).toBeGreaterThan(0);
    const settings = within(screen.getByRole('group', { name: 'Charge settings' }));
    const warning = settings.getByTestId('stale-refresh-warning');
    expect(warning).toHaveAttribute('role', 'status');
    expect(warning).toHaveAttribute('aria-live', 'polite');
    expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
    expect(within(warning).getByText('Data may be stale')).toBeInTheDocument();
    expect(within(warning).getByText('The latest values are temporarily unavailable. Previously loaded data remains visible.')).toBeInTheDocument();
    expect(within(warning).getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(settings.getByLabelText('Rate plan')).toHaveValue('pge-ev2a');
    expect(screen.queryByText(/device is offline/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
    expect(screen.queryByText('SCE TOU-D')).not.toBeInTheDocument();
  });

  it('sorts recorded history costs without changing their numerical values', () => {
    mockPlans.mockReturnValue(makeQuery({
      data: [
        makePlan({ id: 1, rate_plan: 'Expensive', estimated_cost: 9 }),
        makePlan({ id: 2, rate_plan: 'Affordable', estimated_cost: 2 }),
      ],
    }));
    renderPage();
    const liveTable = () => within(screen.getByRole('table', { name: 'charging:smart-charge-history' }));
    fireEvent.click(liveTable().getByRole('button', { name: 'Cost' }));
    const descendingRows = liveTable().getAllByRole('row');
    expect(within(descendingRows[1]).getByText('Expensive')).toBeInTheDocument();
    expect(within(descendingRows[1]).getByText('$9.00')).toBeInTheDocument();
    expect(within(descendingRows[2]).getByText('Affordable')).toBeInTheDocument();
    expect(within(descendingRows[2]).getByText('$2.00')).toBeInTheDocument();
    fireEvent.click(liveTable().getByRole('button', { name: 'Cost' }));
    const rows = liveTable().getAllByRole('row');
    expect(within(rows[1]).getByText('Affordable')).toBeInTheDocument();
    expect(within(rows[1]).getByText('$2.00')).toBeInTheDocument();
    expect(within(rows[2]).getByText('$9.00')).toBeInTheDocument();
  });

  it('preserves autopilot profile controls, preview/run actions and retained realized savings', () => {
    const profile: AutopilotProfile = {
      vehicle_id: 7, enabled: true, ready_by: '06:45', target_soc: 85,
      rate_plan: 'pge-ev2a', daily_cap_soc: 90, trip_override: true,
      precondition: false, max_amps: 40, battery_capacity_kwh: 75,
    };
    const savings: AutopilotSavings = { total_savings: 12.5, runs: 3 };
    mockAutopilotProfile.mockReturnValue(makeQuery({ data: profile }));
    mockAutopilotSavings.mockReturnValue(makeQuery({
      data: savings,
      isError: true, error: new Error('ledger refresh failed'),
    }));
    renderPage();
    expect(screen.getByLabelText('Ready by (daily)')).toHaveValue('06:45');
    expect(screen.getByRole('button', { name: 'Save Autopilot' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Preview next run' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeEnabled();
    expect(screen.getByText('$12.50 across 3 runs')).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
  });

  it('keeps OCPP charger and transaction readings visible after independent refresh failures', () => {
    const point: OcppChargePoint = {
      id: 'charger-1', vendor: 'Vendor', model: 'Model',
      serial_number: '', firmware_version: '', last_boot_at: null,
      last_seen_at: '2026-01-16T02:00:00Z', active_sessions: 1,
      connectors: [{ connector_id: 1, status: 'Charging', error_code: '', info: '',
        updated_at: '2026-01-16T02:00:00Z' }],
    };
    const session: OcppSession = {
      transaction_id: 12, charge_point_id: 'charger-1', connector_id: 1,
      started_at: '2026-01-16T02:00:00Z', ended_at: '2026-01-16T03:00:00Z',
      start_meter_wh: 0, end_meter_wh: 42000, energy_delivered_wh: 42000,
      stop_reason: 'Local',
    };
    mockOcppPoints.mockReturnValue(makeQuery({
      data: [point],
      isError: true, error: new Error('inventory refresh failed'),
    }));
    mockOcppSessions.mockReturnValue(makeQuery({
      data: [session],
      isError: true, error: new Error('transactions refresh failed'),
    }));
    renderPage();
    expect(screen.getByText('Vendor Model')).toBeInTheDocument();
    expect(screen.getByText('#1 Charging')).toBeInTheDocument();
    expect(screen.getByText('charger-1 · #12')).toBeInTheDocument();
    expect(screen.getByText(/42.*kWh/)).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
  });
});
