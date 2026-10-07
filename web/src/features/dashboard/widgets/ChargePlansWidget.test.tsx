/**
 * ChargePlansWidget — behaviour + hardening coverage.
 *
 * The widget surfaces the smart charge planner for the first (or explicitly
 * selected) vehicle: an active/scheduled plan plus the available TOU rate
 * plans. It exposes a default component and three pure helpers
 * (`badgeVariant`, `detailBadgeVariant`, `joinDateTime`). Every data hook is
 * mocked so the network is never touched, and the display-boundary formatters
 * (`useFormatting` / `useDateFormat`) are stubbed with deterministic,
 * timezone-independent implementations that mirror the real "—" fallback.
 *
 * Facets covered:
 *   - badgeVariant / detailBadgeVariant: full status→tone table, the
 *     danger→error remap for DetailEntry badges, and null/unknown collapse.
 *   - joinDateTime: valid join, single-sided fallback, and the "— —" double
 *     placeholder regression it was added to fix.
 *   - compact (1×N) layout: SOC hero + departure, and the no-plan empty state.
 *   - standard layout: combined-empty state, rate-only section, and the full
 *     active-plan render (status badge, summary stats, schedule, energy, cost,
 *     savings, rate plan).
 *   - null-safety: missing SOC/energy/cost/departure collapse to placeholders
 *     without crashing, and the savings row hides when non-positive.
 *   - active/scheduled prioritisation over an earlier completed plan.
 *   - loading skeleton with content withheld.
 *   - refresh wiring (refetches plans + rates).
 *   - vehicle-id resolution: explicit prop, first-vehicle fallback, and the
 *     disabled (undefined id) query when no vehicle exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChargePlan, RatePlanInfo } from '@/types/charging';

// ── i18n stub: return the English fallback (2nd arg) or the key. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string) => (typeof def === 'string' ? def : _key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── Display-boundary formatters: deterministic + timezone-independent, ──
// mirroring the real helpers' "—" fallback for empty/invalid input.
const isoDate = (v: unknown) => {
  if (v == null || v === '') return '—';
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
};
const isoTime = (v: unknown) => {
  if (v == null || v === '') return '—';
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(11, 16);
};
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    opts: { locale: 'en-US', tz: 'UTC' },
    tz: 'UTC',
    locale: 'en-US',
    formatDate: isoDate,
    formatDateTime: isoDate,
    formatTime: isoTime,
    formatDateShort: isoDate,
    formatDateWithDay: isoDate,
    formatRelative: isoDate,
    formatRelativeTime: isoTime,
    formatRelativeDays: isoDate,
  }),
}));
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

// ── Data hooks, driven per test. ──
vi.mock('@/api/hooks/useCharging', () => ({
  useChargePlans: vi.fn(),
  useRatePlans: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
}));

import { useChargePlans, useRatePlans } from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import ChargePlansWidget, {
  badgeVariant,
  detailBadgeVariant,
  joinDateTime,
} from './ChargePlansWidget';

const mockPlans = useChargePlans as unknown as ReturnType<typeof vi.fn>;
const mockRates = useRatePlans as unknown as ReturnType<typeof vi.fn>;
const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makePlan(over: Partial<ChargePlan> = {}): ChargePlan {
  return {
    id: 1,
    vehicle_id: 42,
    target_soc: 85,
    depart_by: '2026-06-01T08:00:00Z',
    scheduled_start: '2026-06-01T02:00:00Z',
    scheduled_end: '2026-06-01T06:30:00Z',
    rate_plan: 'Off-Peak Saver',
    estimated_kwh: 42.5,
    estimated_cost: 5.1,
    charge_now_cost: 9.2,
    savings: 4.1,
    status: 'scheduled',
    applied_at: null,
    completed_at: null,
    created_at: '2026-05-31T00:00:00Z',
    ...over,
  };
}

const RATE: RatePlanInfo = { id: 'ev2a', name: 'EV2-A', utility: 'PG&E' };

const STANDARD = { cols: 2, rows: 4 };
const COMPACT = { cols: 1, rows: 2 };

function setup(
   
  opts: { plans?: any; rates?: any; vehicles?: any } = {},
) {
  mockVehicles.mockReturnValue(opts.vehicles ?? makeQuery({ data: [{ id: 42 }] }));
  mockPlans.mockReturnValue(opts.plans ?? makeQuery({ data: [] }));
  mockRates.mockReturnValue(opts.rates ?? makeQuery({ data: [] }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('badgeVariant', () => {
  it('maps each known status to its Badge tone', () => {
    expect(badgeVariant('completed')).toBe('success');
    expect(badgeVariant('active')).toBe('warning');
    expect(badgeVariant('scheduled')).toBe('warning');
    expect(badgeVariant('failed')).toBe('danger');
    expect(badgeVariant('cancelled')).toBe('danger');
  });

  it('collapses unknown / nullish status to the neutral tone', () => {
    expect(badgeVariant('anything-else')).toBe('neutral');
    expect(badgeVariant('')).toBe('neutral');
    expect(badgeVariant(null)).toBe('neutral');
    expect(badgeVariant(undefined)).toBe('neutral');
  });
});

describe('detailBadgeVariant', () => {
  it('remaps the danger tone to "error" for DetailEntry badges', () => {
    expect(detailBadgeVariant('failed')).toBe('error');
    expect(detailBadgeVariant('cancelled')).toBe('error');
  });

  it('passes non-danger tones through unchanged', () => {
    expect(detailBadgeVariant('completed')).toBe('success');
    expect(detailBadgeVariant('scheduled')).toBe('warning');
    expect(detailBadgeVariant('active')).toBe('warning');
    expect(detailBadgeVariant('mystery')).toBe('neutral');
    expect(detailBadgeVariant(null)).toBe('neutral');
  });
});

describe('joinDateTime', () => {
  it('joins a valid date and time with a single space', () => {
    expect(joinDateTime('2026-06-01', '02:00')).toBe('2026-06-01 02:00');
  });

  it('returns only the populated side when the other is the placeholder', () => {
    expect(joinDateTime('2026-06-01', '—')).toBe('2026-06-01');
    expect(joinDateTime('—', '02:00')).toBe('02:00');
  });

  it('collapses to a single "—" instead of the "— —" double placeholder', () => {
    // Regression: the widget used a raw `${date} ${time}` template, so an
    // unscheduled plan rendered the nonsensical "— —" (both helpers return "—").
    expect(joinDateTime('—', '—')).toBe('—');
    expect(joinDateTime('', '')).toBe('—');
  });
});

describe('ChargePlansWidget', () => {
  it('compact layout shows the SOC hero + departure and no panel title', () => {
    setup({
      plans: makeQuery({
        data: [makePlan({ target_soc: 90, depart_by: '2026-06-01T08:15:00Z' })],
      }),
    });
    render(<ChargePlansWidget vehicleId={42} size={COMPACT} />);

    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('Target SOC')).toBeInTheDocument();
    expect(screen.getByText('08:15')).toBeInTheDocument();
    // Compact widgets are title-less — the "Charge Plans" header is standard-only.
    expect(screen.queryByText('Charge Plans')).not.toBeInTheDocument();
  });

  it('compact layout renders the no-plan empty state (ignoring rate data)', () => {
    setup({ plans: makeQuery({ data: [] }), rates: makeQuery({ data: [RATE] }) });
    render(<ChargePlansWidget vehicleId={42} size={COMPACT} />);

    expect(screen.getByText('No charge plans')).toBeInTheDocument();
    expect(screen.queryByText('Target SOC')).not.toBeInTheDocument();
    // Rate plans never surface in the compact hero.
    expect(screen.queryByText('EV2-A')).not.toBeInTheDocument();
  });

  it('standard layout shows the combined empty state with no plans and no rates', () => {
    setup({ plans: makeQuery({ data: [] }), rates: makeQuery({ data: [] }) });
    render(<ChargePlansWidget vehicleId={42} size={STANDARD} />);

    expect(screen.getByText('No charge plans or rate data')).toBeInTheDocument();
    // Standard widgets keep their header even when empty.
    expect(screen.getByText('Charge Plans')).toBeInTheDocument();
  });

  it('standard layout renders the rate-plan section + no-plan notice when only rates exist', () => {
    setup({ plans: makeQuery({ data: [] }), rates: makeQuery({ data: [RATE] }) });
    render(<ChargePlansWidget vehicleId={42} size={STANDARD} />);

    // hasData is true (rates present) → the active-plan branch shows its own
    // empty state…
    expect(screen.getByText('No charge plans')).toBeInTheDocument();
    // …and the rate-plans section renders utility, plan name, and id badge.
    expect(screen.getByText('Rate Plans')).toBeInTheDocument();
    expect(screen.getByText('PG&E')).toBeInTheDocument();
    expect(screen.getByText('EV2-A')).toBeInTheDocument();
    expect(screen.getByText('ev2a')).toBeInTheDocument();
  });

  it('standard layout renders status, stats, schedule, energy, cost, savings, and rate plan', () => {
    const plan = makePlan({
      status: 'scheduled',
      target_soc: 80,
      depart_by: '2026-06-01T08:00:00Z',
      scheduled_start: '2026-06-01T02:00:00Z',
      scheduled_end: '2026-06-01T06:30:00Z',
      estimated_kwh: 42.5,
      estimated_cost: 5.1,
      savings: 4.1,
      rate_plan: 'Off-Peak Saver',
    });
    setup({ plans: makeQuery({ data: [plan] }), rates: makeQuery({ data: [] }) });
    render(<ChargePlansWidget vehicleId={42} size={STANDARD} />);

    // Status badge + summary StatCards.
    expect(screen.getByText('scheduled')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('08:00')).toBeInTheDocument();
    // Detail rows (slice(2)): schedule start/end combined, energy, cost, savings.
    expect(screen.getByText('2026-06-01 02:00')).toBeInTheDocument();
    expect(screen.getByText('2026-06-01 06:30')).toBeInTheDocument();
    expect(screen.getByText('42.5 kWh')).toBeInTheDocument();
    expect(screen.getByText('$5.10')).toBeInTheDocument();
    expect(screen.getByText('$4.10')).toBeInTheDocument();
    expect(screen.getByText('saved')).toBeInTheDocument();
    // Rate plan appears in both the header and the detail row.
    expect(screen.getByText('Rate Plan')).toBeInTheDocument();
    expect(screen.getAllByText('Off-Peak Saver').length).toBeGreaterThanOrEqual(1);
  });

  it('omits the savings row when savings are zero or negative', () => {
    setup({ plans: makeQuery({ data: [makePlan({ savings: 0 })] }) });
    render(<ChargePlansWidget vehicleId={42} size={STANDARD} />);

    expect(screen.queryByText('saved')).not.toBeInTheDocument();
    expect(screen.queryByText('Savings')).not.toBeInTheDocument();
  });

  it('renders null-safe placeholders for missing SOC, energy, cost, and departure', () => {
    const plan = makePlan({
      target_soc: null as unknown as number,
      estimated_kwh: null,
      estimated_cost: null,
      depart_by: null,
      savings: null,
    });
    setup({ plans: makeQuery({ data: [plan] }) });
    render(<ChargePlansWidget vehicleId={42} size={STANDARD} />);

    expect(screen.getByText('0%')).toBeInTheDocument(); // target_soc ?? 0
    // Energy + cost + departure all collapse to the placeholder.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('saved')).not.toBeInTheDocument();
  });

  it('never renders the "— —" double placeholder for an unscheduled plan', () => {
    setup({ plans: makeQuery({ data: [makePlan({ scheduled_start: '', scheduled_end: '' })] }) });
    render(<ChargePlansWidget vehicleId={42} size={STANDARD} />);

    expect(screen.queryByText('— —')).not.toBeInTheDocument();
    // Each schedule row collapses to a single placeholder.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('shows a loading skeleton and withholds content while data loads', () => {
    setup({ plans: makeQuery({ isLoading: true, data: undefined }) });
    const { container } = render(<ChargePlansWidget vehicleId={42} size={STANDARD} />);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Charge Plans')).not.toBeInTheDocument();
    expect(screen.queryByText('No charge plans or rate data')).not.toBeInTheDocument();
  });

  it('refetches both charge plans and rate plans when the freshness control is clicked', () => {
    const refetchPlans = vi.fn();
    const refetchRates = vi.fn();
    setup({
      plans: makeQuery({ data: [makePlan()], refetch: refetchPlans }),
      rates: makeQuery({ data: [RATE], refetch: refetchRates }),
    });
    render(<ChargePlansWidget vehicleId={42} size={STANDARD} />);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetchPlans).toHaveBeenCalledTimes(1);
    expect(refetchRates).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first vehicle id when no vehicleId prop is supplied', () => {
    setup({
      vehicles: makeQuery({ data: [{ id: 7 }, { id: 9 }] }),
      plans: makeQuery({ data: [] }),
    });
    render(<ChargePlansWidget size={STANDARD} />);

    expect(mockPlans).toHaveBeenCalledWith(7);
  });

  it('disables the plans query (undefined id) when there is no vehicle to key on', () => {
    setup({ vehicles: makeQuery({ data: [] }), plans: makeQuery({ data: [] }) });
    render(<ChargePlansWidget size={STANDARD} />);

    expect(mockPlans).toHaveBeenCalledWith(undefined);
  });

  it('prioritises an active/scheduled plan over an earlier completed one', () => {
    const completed = makePlan({ id: 1, status: 'completed', target_soc: 100 });
    const scheduled = makePlan({ id: 2, status: 'scheduled', target_soc: 70 });
    setup({ plans: makeQuery({ data: [completed, scheduled] }) });
    render(<ChargePlansWidget vehicleId={42} size={STANDARD} />);

    expect(screen.getByText('scheduled')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.queryByText('completed')).not.toBeInTheDocument();
  });
});
