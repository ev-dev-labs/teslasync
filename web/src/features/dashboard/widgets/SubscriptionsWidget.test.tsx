/**
 * SubscriptionsWidget — behavioural, branch, null-safety and a11y coverage for
 * the dashboard "Subscriptions" widget plus its pure parsing helpers.
 *
 * The widget resolves a vehicle (from the `vehicleId` prop, else the first
 * vehicle, else id `0` → disabled query), reads `useVehicleSubscriptions()`
 * (TanStack Query), folds the raw data envelope into `ParsedSub[]` via
 * `parseSubscriptions`, and renders one of two layouts driven by `size.cols`:
 *   • compact (cols ≤ 1): the active-subscription count, an "active" caption and
 *     a badge with the soonest upcoming expiry — or an empty state;
 *   • full (cols ≥ 2): a titled `WidgetDetailCard` with one Active/Expired row
 *     per subscription — or an empty state.
 *
 * What this file pins:
 *   - the pure helpers — `asString` (string/number coercion + null cases),
 *     `daysUntil` (invalid-date + ceil rounding + sign), and the branch-heavy
 *     `parseSubscriptions` (known-type extraction, the `_expiry`/`_expiry_date`
 *     and `_renewal`/`_renewal_type` alternate keys, active-vs-expired by date,
 *     truthy-without-expiry, the falsy `null/false/''` skip, the generic
 *     `subscriptions[]` fallback with status/expiry branches, de-duplication
 *     against known types, and null/non-object safety);
 *   - the ERROR fix (the point of this pass): an errored INITIAL load with no
 *     cached data now surfaces an error panel instead of the misleading
 *     "No subscriptions" empty state, while a background-refetch error over
 *     cached data keeps the list on screen (mirrors the sibling widgets);
 *   - the LAYOUT SWITCH (compact vs full) and each layout's empty state;
 *   - the ACTIVE-COUNT / NEXT-EXPIRY derivation shown in the compact layout;
 *   - the VEHICLE-ID resolution ladder (prop → first vehicle → 0/disabled) and
 *     that the hook is subscribed with the resolved STRING id;
 *   - the REFRESH control wiring (accessible chip → `refetch`) and the title a11y.
 *
 * Strategy: `@/api/hooks/useVehicles` is the network boundary and is fully
 * controllable via hoisted mocks. `react-i18next` echoes each `t(key, fallback)`
 * fallback so assertions read against English copy. `useDateFormat` is stubbed
 * to a deterministic `fmt:<value>` formatter (and a `formatTime` used by the
 * freshness chip). `useMotionPreference` is stubbed so `DataFreshness` renders
 * without a provider. A `<MemoryRouter>` wraps every render because the error
 * panel (`QueryError`) calls `useNavigate` and `EmptyState` can render a `<Link>`.
 * The repo does not ship `@testing-library/user-event`, so interactions use
 * `fireEvent` — the established convention across the sibling widget tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { WidgetSize } from './types';

// ── Hoisted mocks (referenced inside vi.mock factories) ─────────────────────────

const { vehiclesMock, subscriptionsMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  subscriptionsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useVehicleSubscriptions: (...args: unknown[]) => subscriptionsMock(...args),
}));

// i18n → return the developer fallback so copy reads as English.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// Deterministic date formatting: the widget's `formatDate` and the freshness
// chip's `formatTime` both come from this hook.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDate: (v: unknown) => (v == null ? '—' : `fmt:${String(v)}`),
    formatTime: (v: unknown) => String(v),
  }),
}));

// DataFreshness reads motion preference; stub so the chip renders provider-free.
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));

import SubscriptionsWidget, {
  asString,
  daysUntil,
  parseSubscriptions,
  type ParsedSub,
} from './SubscriptionsWidget';

// ── Shared helpers ──────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
/** ISO timestamp `n` days from *now* (captured once per call by the caller). */
function isoInDays(n: number): string {
  return new Date(Date.now() + n * DAY_MS).toISOString();
}

/** A pass-through translator matching the widget's `t(key, fallback)` shape. */
const tt = (_key: string, fallback: string) => fallback;

// ════════════════════════════════════════════════════════════════════════════════
// Pure helper: asString
// ════════════════════════════════════════════════════════════════════════════════

describe('asString', () => {
  it('returns null for null, undefined and the empty string', () => {
    expect(asString(null)).toBeNull();
    expect(asString(undefined)).toBeNull();
    expect(asString('')).toBeNull();
  });

  it('passes a non-empty string through and stringifies numbers (including 0)', () => {
    expect(asString('active')).toBe('active');
    expect(asString(42)).toBe('42');
    expect(asString(0)).toBe('0');
  });

  it('returns null for booleans, objects and arrays', () => {
    expect(asString(true)).toBeNull();
    expect(asString(false)).toBeNull();
    expect(asString({ a: 1 })).toBeNull();
    expect(asString([1, 2])).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Pure helper: daysUntil
// ════════════════════════════════════════════════════════════════════════════════

describe('daysUntil', () => {
  const BASE = new Date('2026-07-06T00:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for empty and unparseable date strings', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil('')).toBeNull();
    expect(daysUntil('not-a-date')).toBeNull();
  });

  it('counts whole days ahead, is 0 today and negative once passed', () => {
    expect(daysUntil('2026-07-16T00:00:00.000Z')).toBe(10);
    expect(daysUntil('2026-07-06T00:00:00.000Z')).toBe(0);
    expect(daysUntil('2026-07-01T00:00:00.000Z')).toBe(-5);
  });

  it('rounds a partial future day up (ceil)', () => {
    // 1 day + 1 hour ahead → ceil(1.041…) === 2
    expect(daysUntil('2026-07-07T01:00:00.000Z')).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Pure helper: parseSubscriptions
// ════════════════════════════════════════════════════════════════════════════════

describe('parseSubscriptions', () => {
  it('returns an empty array for null / undefined data', () => {
    expect(parseSubscriptions(null, tt)).toEqual([]);
    expect(parseSubscriptions(undefined, tt)).toEqual([]);
  });

  it('extracts a known active subscription with a future expiry', () => {
    const exp = isoInDays(30);
    const res: ParsedSub[] = parseSubscriptions(
      { premium_connectivity: true, premium_connectivity_expiry_date: exp },
      tt,
    );

    expect(res).toHaveLength(1);
    expect(res[0].name).toBe('Premium Connectivity');
    expect(res[0].active).toBe(true);
    expect(res[0].expiryDate).toBe(exp);
    expect(res[0].daysLeft ?? 0).toBeGreaterThan(0);
  });

  it('marks a known subscription expired via the alternate `_expiry` key', () => {
    const exp = isoInDays(-10);
    const res = parseSubscriptions(
      { full_self_driving: true, full_self_driving_expiry: exp },
      tt,
    );

    expect(res[0].name).toBe('Full Self-Driving');
    expect(res[0].active).toBe(false);
    expect(res[0].expiryDate).toBe(exp);
    expect(res[0].daysLeft ?? 0).toBeLessThanOrEqual(0);
  });

  it('treats a truthy subscription without an expiry as active and keeps its renewal', () => {
    const res = parseSubscriptions(
      { enhanced_autopilot: 'included', enhanced_autopilot_renewal: 'annual' },
      tt,
    );

    expect(res[0].active).toBe(true);
    expect(res[0].expiryDate).toBeNull();
    expect(res[0].daysLeft).toBeNull();
    expect(res[0].renewalType).toBe('annual');
  });

  it('reads the alternate `_renewal_type` key when `_renewal` is absent', () => {
    const res = parseSubscriptions(
      { data_sharing: true, data_sharing_renewal_type: 'auto' },
      tt,
    );
    expect(res[0].renewalType).toBe('auto');
  });

  it('skips known types whose value is null, false or an empty string', () => {
    const res = parseSubscriptions(
      { premium_connectivity: false, full_self_driving: null, enhanced_autopilot: '' },
      tt,
    );
    expect(res).toEqual([]);
  });

  it('parses a generic subscriptions[] fallback across the status/expiry branches', () => {
    const activeExp = isoInDays(5);
    const res = parseSubscriptions(
      {
        subscriptions: [
          { name: 'LTE Data', status: 'active' },
          { type: 'Music', status: 'expired' },
          { name: 'Maps', expiry_date: activeExp },
        ],
      },
      tt,
    );

    expect(res).toHaveLength(3);
    expect(res.find((s) => s.name === 'LTE Data')?.active).toBe(true);
    expect(res.find((s) => s.name === 'Music')?.active).toBe(false);
    const maps = res.find((s) => s.name === 'Maps');
    expect(maps?.active).toBe(true);
    expect(maps?.expiryDate).toBe(activeExp);
  });

  it('de-duplicates a generic item that matches an already-added known type', () => {
    const res = parseSubscriptions(
      {
        premium_connectivity: true,
        subscriptions: [{ name: 'premium connectivity', status: 'active' }],
      },
      tt,
    );

    const matches = res.filter((s) => s.name.toLowerCase() === 'premium connectivity');
    expect(matches).toHaveLength(1);
  });

  it('ignores null/non-object entries and defaults a nameless item to "Unknown"', () => {
    const res = parseSubscriptions(
      { subscriptions: [null, 'nope', 42, {}] },
      tt,
    );

    expect(res).toHaveLength(1);
    expect(res[0].name).toBe('Unknown');
    expect(res[0].active).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Component: SubscriptionsWidget
// ════════════════════════════════════════════════════════════════════════════════

interface SubsEnvelope {
  data: Record<string, unknown> | null;
  fetched_at: string | null;
}

interface QueryOverrides {
  data?: SubsEnvelope;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

const NOW_MS = Date.parse('2026-07-06T12:00:00.000Z');

function setQuery(over: QueryOverrides = {}) {
  const q = {
    data: undefined as SubsEnvelope | undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: NOW_MS,
    refetch: vi.fn(),
    ...over,
  };
  subscriptionsMock.mockReturnValue(q);
  return q;
}

function makeEnvelope(subs: Record<string, unknown> | null): SubsEnvelope {
  return { data: subs, fetched_at: '2026-07-06T12:00:00.000Z' };
}

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 2 };

function renderWidget(size: WidgetSize = FULL, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <SubscriptionsWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7, display_name: 'Car' }] });
  setQuery({ data: makeEnvelope({}) });
});

// ── Loading & error states ────────────────────────────────────────────────────

describe('SubscriptionsWidget — loading & error states', () => {
  it('renders only a skeleton (no title or content) while loading', () => {
    setQuery({ isLoading: true, data: undefined });
    const { container } = renderWidget(FULL);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: /Subscriptions/i })).toBeNull();
    expect(screen.queryByText('No subscriptions')).toBeNull();
  });

  it('surfaces an error panel (not the empty state) when the initial load fails with no data', () => {
    setQuery({ isError: true, data: undefined });
    renderWidget(FULL);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No subscriptions')).toBeNull();
  });

  it('keeps cached subscriptions visible (no error panel) when a background refetch errors', () => {
    setQuery({ isError: true, data: makeEnvelope({ premium_connectivity: true }) });
    renderWidget(FULL);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText("Can't reach server")).toBeNull();
    expect(screen.getByText('Premium Connectivity')).toBeInTheDocument();
  });
});

// ── Compact layout ────────────────────────────────────────────────────────────

describe('SubscriptionsWidget — compact layout', () => {
  it('renders the active count, caption and the soonest-expiry badge', () => {
    const fut = isoInDays(20);
    const past = isoInDays(-3);
    setQuery({
      data: makeEnvelope({
        premium_connectivity: true,
        premium_connectivity_expiry_date: fut,
        full_self_driving: true,
        full_self_driving_expiry_date: past,
      }),
    });
    renderWidget(COMPACT);

    // Only the future-dated subscription is active → count of 1, not 2.
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText(`fmt:${fut}`)).toBeInTheDocument();
  });

  it('shows the empty state (not a count) when there are no subscriptions', () => {
    setQuery({ data: makeEnvelope({}) });
    renderWidget(COMPACT);

    expect(screen.getByText('No subscriptions')).toBeInTheDocument();
    expect(screen.queryByText('active')).toBeNull();
  });
});

// ── Full layout ─────────────────────────────────────────────────────────────────

describe('SubscriptionsWidget — full layout', () => {
  it('renders the title and an Active/Expired row per subscription', () => {
    const fut = isoInDays(45);
    const past = isoInDays(-30);
    setQuery({
      data: makeEnvelope({
        premium_connectivity: true,
        premium_connectivity_expiry_date: fut,
        full_self_driving: true,
        full_self_driving_expiry_date: past,
      }),
    });
    renderWidget(FULL);

    expect(screen.getByRole('heading', { name: /Subscriptions/i })).toBeInTheDocument();
    expect(screen.getByText('Premium Connectivity')).toBeInTheDocument();
    expect(screen.getByText('Full Self-Driving')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('shows the empty state when the envelope has no subscription data', () => {
    setQuery({ data: makeEnvelope({}) });
    renderWidget(FULL);

    expect(screen.getByRole('heading', { name: /Subscriptions/i })).toBeInTheDocument();
    expect(screen.getByText('No subscriptions')).toBeInTheDocument();
  });
});

// ── Vehicle-id resolution ───────────────────────────────────────────────────────

describe('SubscriptionsWidget — vehicle-id resolution', () => {
  it('subscribes with the explicit vehicleId prop as a string', () => {
    setQuery({ data: makeEnvelope({}) });
    renderWidget(FULL, 5);

    expect(subscriptionsMock).toHaveBeenCalledWith('5');
  });

  it('falls back to the first vehicle id when no prop is supplied', () => {
    vehiclesMock.mockReturnValue({ data: [{ id: 42, display_name: 'Other' }] });
    setQuery({ data: makeEnvelope({}) });
    renderWidget(FULL, undefined);

    expect(subscriptionsMock).toHaveBeenCalledWith('42');
  });

  it('subscribes with undefined (disabled) when no vehicle can be resolved', () => {
    vehiclesMock.mockReturnValue({ data: [] });
    setQuery({ data: undefined });
    renderWidget(FULL, undefined);

    expect(subscriptionsMock).toHaveBeenCalledWith(undefined);
  });
});

// ── Interactions & accessibility ────────────────────────────────────────────────

describe('SubscriptionsWidget — interactions & a11y', () => {
  it('invokes refetch when the accessible refresh control is activated', () => {
    const q = setQuery({ data: makeEnvelope({ premium_connectivity: true }) });
    renderWidget(FULL);

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    fireEvent.click(refresh);

    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('exposes the widget title as a heading', () => {
    setQuery({ data: makeEnvelope({ premium_connectivity: true }) });
    renderWidget(FULL);

    expect(screen.getByRole('heading', { name: /Subscriptions/i })).toBeInTheDocument();
  });
});
