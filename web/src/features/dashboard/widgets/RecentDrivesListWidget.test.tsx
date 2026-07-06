/**
 * RecentDrivesListWidget — behaviour + hardening coverage.
 *
 * The widget lists a vehicle's most recent drives inside a WidgetShell: a
 * left column (distance in the user's unit + duration), an optional centre
 * column of start/end addresses (wide layout only), and a right column
 * (SOC range, an optional battery-used chip, and the drive date). It exposes
 * a default component plus two pure helpers (`truncateAddress`,
 * `batteryUsedPct`).
 *
 * Everything the widget touches is mocked so the network is never hit:
 *   - `useQuery` (the inline drives query) is driven per test.
 *   - `request` is stubbed so the captured `queryFn` can be exercised without
 *     a real fetch (the isApiError export is kept real for QueryError).
 *   - `useVehicles` supplies the vehicle-id fallback.
 *   - `useUnits` supplies the distance preference that flips km↔mi at the
 *     display boundary; the real `convertDistanceFromSI` + `fmtNumber` /
 *     `fmtInt` display math and the real `formatDurationMinutes` are exercised
 *     end-to-end.
 *   - `useDateFormat` is stubbed with a deterministic, timezone-independent
 *     `formatDateShort`.
 *
 * Facets covered:
 *   - truncateAddress: nullish → "—", within-limit passthrough (inclusive
 *     boundary), and over-limit slice + ellipsis.
 *   - batteryUsedPct: positive delta, the non-positive guard (flat / gained
 *     charge), and the non-finite / missing-reading guards.
 *   - rendering: the populated standard layout (title, View-all link, distance,
 *     duration, SOC range, used chip, date), the semantic list + per-row
 *     accessible labels, the wide-only addresses (with 30-char truncation), and
 *     the km→mi conversion of both the value and the unit label.
 *   - duration formatting: the sub-minute placeholder and the hour rollover.
 *   - null-safety / regressions: a missing end SOC collapses to "?" with no
 *     chip, a non-positive delta never renders a negative "%", and a
 *     zero-distance drive withholds the chip.
 *   - states: the empty state (role="status"), the loading skeleton, and the
 *     error branch (role="alert").
 *   - interaction/a11y: the freshness control is an accessible "Refresh" button
 *     that refetches.
 *   - data plumbing: the 5/7/10 size→limit mapping, explicit vehicleId,
 *     first-vehicle fallback, the disabled (id 0) query, and the prefix-free,
 *     snake_case drives URL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Drive } from '../types';

// ── i18n stub: return the English fallback (2nd arg) or the key. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string) => (typeof def === 'string' ? def : _key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── react-query: keep everything real except the inline drives query. ──
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: vi.fn() };
});

// ── api client: keep isApiError real (QueryError consumes it), stub request. ──
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn().mockResolvedValue([]) };
});

// ── data hooks + the display-boundary unit bridge, driven per test. ──
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useDateFormat', () => {
  // Deterministic, timezone-independent formatters mirroring the real "—"
  // fallback. The widget only reads formatDateShort; the rest exist because
  // WidgetShell's <DataFreshness> reaches for formatTime.
  const short = (v: unknown) => (v == null || v === '' ? '—' : String(v).slice(0, 10));
  const asString = (v: unknown) => (v == null || v === '' ? '—' : String(v));
  return {
    useDateFormat: () => ({
      opts: { locale: 'en-US', tz: 'UTC' },
      tz: 'UTC',
      locale: 'en-US',
      formatDate: short,
      formatDateTime: asString,
      formatTime: asString,
      formatDateShort: short,
      formatDateWithDay: short,
      formatRelative: asString,
      formatRelativeTime: asString,
      formatRelativeDays: short,
    }),
  };
});

import { useQuery } from '@tanstack/react-query';
import { request } from '@/api/client';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import RecentDrivesListWidget, { truncateAddress, batteryUsedPct } from './RecentDrivesListWidget';

const mockUseQuery = useQuery as unknown as ReturnType<typeof vi.fn>;
const mockRequest = request as unknown as ReturnType<typeof vi.fn>;
const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

function makeDrive(over: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicle_id: 42,
    started_at: '2026-06-01T08:00:00Z',
    ended_at: '2026-06-01T08:25:00Z',
    start_ts: '2026-06-01T08:00:00Z',
    distance_m: 10_000,
    duration_s: 1500,
    max_speed_mps: null,
    avg_speed_mps: null,
    avg_power_w: null,
    start_soc_pct: 80,
    end_soc_pct: 70,
    energy_used_wh: 1500,
    regen_energy_wh: null,
    start_address: '123 Main St',
    end_address: '456 Oak Ave',
    ...over,
  };
}

const SMALL = { cols: 1, rows: 1 }; // limit 5, not wide
const TALL = { cols: 1, rows: 2 }; // limit 7, not wide
const STANDARD = { cols: 2, rows: 4 }; // limit 7, not wide
const WIDE = { cols: 3, rows: 2 }; // limit 10, wide (addresses shown)

function setup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opts: { drives?: any; vehicles?: any; distancePref?: 'km' | 'mi' } = {},
) {
  mockVehicles.mockReturnValue(opts.vehicles ?? makeQuery({ data: [{ id: 42 }] }));
  mockUseQuery.mockReturnValue(opts.drives ?? makeQuery({ data: [] }));
  mockUnits.mockReturnValue({ unitPrefs: { distance: opts.distancePref ?? 'km' } });
}

function renderWidget(props: { size: { cols: number; rows: number }; vehicleId?: number }) {
  return render(
    <MemoryRouter>
      <RecentDrivesListWidget {...props} />
    </MemoryRouter>,
  );
}

/** Options passed to the mocked drives `useQuery` on the most recent render. */
function lastDrivesQuery(): {
  queryKey: unknown[];
  enabled: boolean;
  queryFn: () => Promise<unknown>;
} {
  const calls = mockUseQuery.mock.calls;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('useQuery was never called');
  return last[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('truncateAddress', () => {
  it('returns the em-dash placeholder for nullish or empty input', () => {
    expect(truncateAddress(undefined, 30)).toBe('—');
    expect(truncateAddress(null, 30)).toBe('—');
    expect(truncateAddress('', 30)).toBe('—');
  });

  it('returns the address unchanged when within the limit (inclusive boundary)', () => {
    expect(truncateAddress('123 Main St', 30)).toBe('123 Main St');
    // length === maxLen must NOT truncate (the guard is strictly greater-than).
    const exact = 'x'.repeat(10);
    expect(truncateAddress(exact, 10)).toBe(exact);
  });

  it('slices to the limit and appends a single-character ellipsis when longer', () => {
    const long = '123 Main Street, Springfield, Illinois';
    expect(truncateAddress(long, 10)).toBe('123 Main S…');
    // The ellipsis is one glyph, so the result is exactly maxLen + 1 chars.
    expect(truncateAddress(long, 10)).toHaveLength(11);
  });
});

describe('batteryUsedPct', () => {
  it('returns the positive start−end SOC delta', () => {
    expect(batteryUsedPct(80, 70)).toBe(10);
    expect(batteryUsedPct(55, 12)).toBe(43);
  });

  it('returns null for a non-positive delta (held flat or gained charge)', () => {
    // Regression guard: a negative "used %" (end SOC above start) is nonsense
    // and must never surface — the helper collapses it to null.
    expect(batteryUsedPct(70, 70)).toBeNull();
    expect(batteryUsedPct(60, 75)).toBeNull();
  });

  it('returns null when either reading is missing or non-finite', () => {
    expect(batteryUsedPct(null, 70)).toBeNull();
    expect(batteryUsedPct(80, null)).toBeNull();
    expect(batteryUsedPct(undefined, undefined)).toBeNull();
    expect(batteryUsedPct(Number.NaN, 70)).toBeNull();
  });
});

describe('RecentDrivesListWidget — rendering', () => {
  it('renders the title, View-all link, and a drive row at standard size', () => {
    setup({ drives: makeQuery({ data: [makeDrive()] }) });
    renderWidget({ size: STANDARD });

    expect(screen.getByText('Recent Drives')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/drives');

    // Left column: distance (10,000 m → 10.0 km) + duration (1500 s → 25m).
    expect(screen.getByText('10.0 km')).toBeInTheDocument();
    expect(screen.getByText('25m')).toBeInTheDocument();

    // Right column: SOC range, used chip (80 − 70 = 10%), and the date.
    expect(screen.getByText('80% → 70%')).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
    expect(screen.getByText('2026-06-01')).toBeInTheDocument();

    // Addresses are a wide-only column — withheld at 2 columns.
    expect(screen.queryByText('123 Main St')).not.toBeInTheDocument();
  });

  it('exposes each drive as a semantic list item with a concise accessible label', () => {
    setup({
      drives: makeQuery({
        data: [
          makeDrive({ id: 1 }),
          makeDrive({ id: 2, start_ts: '2026-06-02T08:00:00Z', distance_m: 20_000 }),
        ],
      }),
    });
    renderWidget({ size: STANDARD });

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    // The row link's accessible name is the summary aria-label, and it points
    // at the drive detail route.
    const first = screen.getByRole('link', { name: 'Drive: 10.0 km, 2026-06-01' });
    expect(first).toHaveAttribute('href', '/drives/1');
    expect(screen.getByRole('link', { name: 'Drive: 20.0 km, 2026-06-02' })).toHaveAttribute(
      'href',
      '/drives/2',
    );
  });

  it('renders both start and end addresses only in the wide layout', () => {
    setup({
      drives: makeQuery({
        data: [makeDrive({ start_address: '123 Main St', end_address: '456 Oak Ave' })],
      }),
    });
    renderWidget({ size: WIDE });

    expect(screen.getByText('123 Main St')).toBeInTheDocument();
    expect(screen.getByText('456 Oak Ave')).toBeInTheDocument();
  });

  it('truncates a long address to 30 characters with an ellipsis in the wide layout', () => {
    const long = 'A'.repeat(40);
    setup({ drives: makeQuery({ data: [makeDrive({ start_address: long, end_address: undefined })] }) });
    renderWidget({ size: WIDE });

    // Displayed text is the 30-char slice + ellipsis; the missing end address
    // collapses to the "—" placeholder.
    expect(screen.getByText('A'.repeat(30) + '…')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('converts the distance value and unit label to the mile preference', () => {
    setup({ drives: makeQuery({ data: [makeDrive({ distance_m: 10_000 })] }), distancePref: 'mi' });
    renderWidget({ size: STANDARD });

    // 10,000 m ÷ 1609.344 = 6.21 → "6.2 mi"; the km label never leaks.
    expect(screen.getByText('6.2 mi')).toBeInTheDocument();
    expect(screen.queryByText('10.0 km')).not.toBeInTheDocument();
  });
});

describe('RecentDrivesListWidget — duration & battery formatting', () => {
  it('formats a sub-minute drive with the compact placeholder and rolls hours over', () => {
    setup({
      drives: makeQuery({
        data: [
          makeDrive({ id: 1, duration_s: 30 }), // < 1 min → "<1m"
          makeDrive({ id: 2, duration_s: 3600, start_ts: '2026-06-02T00:00:00Z' }), // 1h 0m
        ],
      }),
    });
    renderWidget({ size: STANDARD });

    expect(screen.getByText('<1m')).toBeInTheDocument();
    expect(screen.getByText('1h 0m')).toBeInTheDocument();
  });

  it('shows "?" and withholds the used chip when the end SOC is missing', () => {
    setup({ drives: makeQuery({ data: [makeDrive({ end_soc_pct: null })] }) });
    renderWidget({ size: STANDARD });

    expect(screen.getByText('80% → ?%')).toBeInTheDocument();
    // No positive delta to compute → no used-% chip.
    expect(screen.queryByText('10%')).not.toBeInTheDocument();
  });

  it('never renders a negative used-% when the vehicle gained charge', () => {
    setup({ drives: makeQuery({ data: [makeDrive({ start_soc_pct: 60, end_soc_pct: 75 })] }) });
    renderWidget({ size: STANDARD });

    expect(screen.getByText('60% → 75%')).toBeInTheDocument();
    // Regression: a raw start − end used to render "-15%" here.
    expect(screen.queryByText('-15%')).not.toBeInTheDocument();
  });

  it('withholds the used chip for a zero-distance drive even when charge dropped', () => {
    setup({ drives: makeQuery({ data: [makeDrive({ distance_m: 0, start_soc_pct: 80, end_soc_pct: 70 })] }) });
    renderWidget({ size: STANDARD });

    expect(screen.getByText('0.0 km')).toBeInTheDocument();
    expect(screen.getByText('80% → 70%')).toBeInTheDocument();
    // dist === 0 gates the chip out despite a 10-point drop.
    expect(screen.queryByText('10%')).not.toBeInTheDocument();
  });
});

describe('RecentDrivesListWidget — states & interaction', () => {
  it('renders the empty state (role="status") but keeps the header when there are no drives', () => {
    setup({ drives: makeQuery({ data: [] }) });
    renderWidget({ size: STANDARD });

    expect(screen.getByText('No recent drives recorded')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Standard widgets keep their header even when empty…
    expect(screen.getByText('Recent Drives')).toBeInTheDocument();
    // …but the list itself is gated behind having rows.
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton and withholds header + content while loading', () => {
    setup({ drives: makeQuery({ isLoading: true, data: undefined }) });
    const { container } = renderWidget({ size: STANDARD });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Recent Drives')).not.toBeInTheDocument();
    expect(screen.queryByText('No recent drives recorded')).not.toBeInTheDocument();
  });

  it('renders the error branch (role="alert") instead of the list on query failure', () => {
    setup({ drives: makeQuery({ data: undefined, error: new Error('boom'), isError: true }) });
    renderWidget({ size: STANDARD });

    // A non-ApiError falls through QueryError to the network/unknown branch —
    // the misleading "No recent drives" empty state must NOT show here.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Recent Drives')).not.toBeInTheDocument();
    expect(screen.queryByText('No recent drives recorded')).not.toBeInTheDocument();
  });

  it('refetches the drives query when the accessible Refresh control is clicked', () => {
    const refetch = vi.fn();
    setup({ drives: makeQuery({ data: [makeDrive()], refetch }) });
    renderWidget({ size: STANDARD });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('RecentDrivesListWidget — data plumbing', () => {
  it('maps the layout size to a 5 / 7 / 10 drive limit', () => {
    setup({ drives: makeQuery({ data: [] }) });

    const small = renderWidget({ size: SMALL });
    expect(lastDrivesQuery().queryKey).toEqual(['drives', 42, 'recent-list-5']);
    small.unmount();

    const tall = renderWidget({ size: TALL });
    expect(lastDrivesQuery().queryKey).toEqual(['drives', 42, 'recent-list-7']);
    tall.unmount();

    renderWidget({ size: WIDE });
    expect(lastDrivesQuery().queryKey).toEqual(['drives', 42, 'recent-list-10']);
  });

  it('keys and enables the query on the explicit vehicleId prop', () => {
    setup({ drives: makeQuery({ data: [] }) });
    renderWidget({ size: STANDARD, vehicleId: 7 });

    const q = lastDrivesQuery();
    expect(q.queryKey).toEqual(['drives', 7, 'recent-list-7']);
    expect(q.enabled).toBe(true);
  });

  it('falls back to the first vehicle id when no vehicleId prop is supplied', () => {
    setup({ vehicles: makeQuery({ data: [{ id: 3 }, { id: 9 }] }), drives: makeQuery({ data: [] }) });
    renderWidget({ size: STANDARD });

    const q = lastDrivesQuery();
    expect(q.queryKey).toEqual(['drives', 3, 'recent-list-7']);
    expect(q.enabled).toBe(true);
  });

  it('keys the query on 0 and disables it when there is no vehicle to resolve', () => {
    setup({ vehicles: makeQuery({ data: [] }), drives: makeQuery({ data: [] }) });
    renderWidget({ size: STANDARD });

    const q = lastDrivesQuery();
    expect(q.queryKey).toEqual(['drives', 0, 'recent-list-7']);
    expect(q.enabled).toBe(false);
  });

  it('builds a prefix-free, snake_case drives URL', async () => {
    setup({ drives: makeQuery({ data: [] }) });
    renderWidget({ size: STANDARD, vehicleId: 7 });

    // The request() client auto-prepends /api/v1, so the hook must not; and the
    // query params are snake_case to match the Go router.
    await lastDrivesQuery().queryFn();
    expect(mockRequest).toHaveBeenCalledWith('/drives?vehicle_id=7&limit=7');
  });
});
