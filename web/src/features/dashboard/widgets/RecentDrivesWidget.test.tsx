/**
 * RecentDrivesWidget — behaviour, hardening & a11y contract.
 *
 * The widget resolves a vehicle (explicit prop → first vehicle → none), reads a
 * single `useQuery('/drives?…limit=5')` result and renders a compact list of
 * the five most-recent drives (distance in the user's unit, duration, SOC
 * transition, date) with a "View all" affordance — or an empty state. This
 * suite drives the whole component through its accessible surface:
 *
 *   - vehicle resolution (prop wins over the vehicle list; the list supplies the
 *     fallback; no vehicle → id 0 keeps the query disabled so `/drives` is never
 *     hit);
 *   - the loading / empty / error paths — most importantly the regression that a
 *     FAILED request must surface a `QueryError` ("never a blank panel"), NOT
 *     the misleading "No recent drives" empty state (the widget previously
 *     swallowed the error and rendered the empty copy);
 *   - the populated list: title, SI→display distance maths (km AND mi), the
 *     duration/SOC line, the date cell (formatter fed `start_ts`), the row +
 *     "View all" link targets, and the limit=5 request contract;
 *   - null-safety: a drive with 0 distance / 0 duration / null SOC renders
 *     "0.0 km", "0 min" and "?" placeholders instead of NaN / "undefined";
 *   - the freshness refresh interaction re-issues the `/drives` read.
 *
 * The network boundary (`request` from `@/api/client`) is mocked; TanStack Query
 * runs for real against it. `useVehicles`, `useUnits` and `useDateFormat` are
 * mocked at the hook boundary (the last provides `formatTime` too, which
 * `<DataFreshness>` inside `<WidgetShell>` also consumes). `react-i18next` is
 * stubbed to echo the English fallback. `@testing-library/user-event` is not
 * installed in this repo (see the sibling BackupMonitorWidget /
 * ChargeSessionChartWidget suites), so the one interaction goes through
 * `fireEvent`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options bag so any interpolated copy renders as real text.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : key;
      if (opts && typeof opts === 'object') {
        return base.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in opts ? String(opts[name]) : `{{${name}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Replace only the network primitive; keep the real `isApiError` etc. so
// <QueryError> classifies failures correctly.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// The vehicle list is a controllable vi.fn.
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
}));

// Unit preference is a controllable vi.fn so we can assert km vs mi maths
// without threading the real settings query.
vi.mock('@/hooks/useUnits', () => ({
  useUnits: vi.fn(),
}));

// Date formatting is deterministic. `formatDateShort` is a shared spy (so we
// can assert it is fed the drive's `start_ts`); `formatTime` is supplied too
// because <DataFreshness> inside <WidgetShell> reads it.
const { formatDateShortSpy } = vi.hoisted(() => ({
  formatDateShortSpy: vi.fn((_v: unknown) => 'May 1'),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    opts: {},
    tz: 'UTC',
    locale: 'en-US',
    formatDate: (v: unknown) => String(v),
    formatDateTime: (v: unknown) => String(v),
    formatTime: () => '12:00',
    formatDateShort: formatDateShortSpy,
    formatDateWithDay: (v: unknown) => String(v),
    formatRelative: (v: unknown) => String(v),
    formatRelativeTime: () => 'just now',
    formatRelativeDays: () => 'today',
  }),
}));

import RecentDrivesWidget from './RecentDrivesWidget';
import { request } from '@/api/client';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import type { Drive } from '../types';
import type { WidgetProps } from './types';

const mockRequest = vi.mocked(request);
const mockUseVehicles = vi.mocked(useVehicles);
const mockUseUnits = vi.mocked(useUnits);

// jsdom lacks matchMedia; framer-motion's useReducedMotion (via <DataFreshness>
// inside <WidgetShell>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Build a controllable `useUnits()` result with the given distance unit. */
function unitsResult(distance: 'km' | 'mi' = 'km'): ReturnType<typeof useUnits> {
  return {
    unitPrefs: {
      distance,
      speed: distance === 'mi' ? 'mph' : 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: undefined,
    },
  } as unknown as ReturnType<typeof useUnits>;
}

let driveSeq = 0;
function makeDrive(over: Partial<Drive> = {}): Drive {
  driveSeq += 1;
  return {
    id: driveSeq,
    vehicle_id: 1,
    started_at: '2024-05-01T10:00:00Z',
    ended_at: '2024-05-01T10:30:00Z',
    start_ts: '2024-05-01T10:00:00Z',
    distance_m: 5000,
    duration_s: 1800, // 30 min
    max_speed_mps: null,
    avg_speed_mps: null,
    avg_power_w: null,
    start_soc_pct: 80,
    end_soc_pct: 60,
    energy_used_wh: null,
    regen_energy_wh: null,
    ...over,
  };
}

/** Route `/drives` reads to the supplied drives; everything else → []. */
function routeDrives(drives: Drive[]) {
  mockRequest.mockImplementation((path: string) =>
    String(path).startsWith('/drives')
      ? Promise.resolve(drives)
      : Promise.resolve([]),
  );
}

const drivesCalls = () =>
  mockRequest.mock.calls.filter((c) => String(c[0]).startsWith('/drives'));

function renderWidget(vehicleId?: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  // `size` is required by WidgetProps but unused by this widget.
  const props = { vehicleId, size: { cols: 2, rows: 2 } } as WidgetProps;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RecentDrivesWidget {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  driveSeq = 0;
  vi.clearAllMocks();
  formatDateShortSpy.mockImplementation((_v: unknown) => 'May 1');
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] } as never);
  mockUseUnits.mockReturnValue(unitsResult('km'));
  routeDrives([]);
});

// ── Vehicle resolution ─────────────────────────────────────────────────────

describe('RecentDrivesWidget vehicle resolution', () => {
  it('prefers the explicit vehicleId prop over the vehicle list', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as never);
    routeDrives([makeDrive()]);
    renderWidget(42);

    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith('/drives?vehicle_id=42&limit=5'),
    );
    expect(mockRequest).not.toHaveBeenCalledWith('/drives?vehicle_id=7&limit=5');
  });

  it('falls back to the first vehicle when no prop is given', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as never);
    routeDrives([makeDrive()]);
    renderWidget();

    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith('/drives?vehicle_id=7&limit=5'),
    );
  });

  it('never queries /drives when no vehicle resolves (id === 0)', async () => {
    mockUseVehicles.mockReturnValue({ data: [] } as never);
    routeDrives([makeDrive()]); // would show data IF the guard were wrong
    renderWidget();

    // Empty state renders (never a blank panel) and no drives read fires.
    expect(await screen.findByText('No recent drives')).toBeInTheDocument();
    expect(drivesCalls()).toHaveLength(0);
  });
});

// ── States: loading / empty / error ─────────────────────────────────────────

describe('RecentDrivesWidget states', () => {
  it('renders a loading skeleton (no title, no empty copy) while fetching', () => {
    mockRequest.mockImplementation(() => new Promise(() => {})); // hang
    const { container } = renderWidget(1);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Recent Drives')).toBeNull();
    expect(screen.queryByText('No recent drives')).toBeNull();
  });

  it('shows an empty state (never a blank panel) when there are no drives', async () => {
    routeDrives([]);
    renderWidget(1);

    const empty = await screen.findByText('No recent drives');
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
  });

  it('surfaces a QueryError — not the empty state — when the drives request fails', async () => {
    mockRequest.mockImplementation((path: string) =>
      String(path).startsWith('/drives')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve([]),
    );
    renderWidget(1);

    // Regression: a failed request must NOT masquerade as "no drives".
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No recent drives')).toBeNull();
    expect(screen.queryByText('Recent Drives')).toBeNull();
  });
});

// ── Populated list ──────────────────────────────────────────────────────────

describe('RecentDrivesWidget populated list', () => {
  it('renders the title, distance, duration/SOC line, date and link targets', async () => {
    routeDrives([
      makeDrive({
        id: 42,
        distance_m: 5000,
        duration_s: 1800,
        start_soc_pct: 80,
        end_soc_pct: 60,
        start_ts: '2024-05-01T10:00:00Z',
      }),
    ]);
    renderWidget(1);

    // Header title.
    expect(await screen.findByText('Recent Drives')).toBeInTheDocument();

    // Distance: 5000 m → 5.0 km (default unit), rendered with its unit.
    expect(screen.getByText('5.0 km')).toBeInTheDocument();

    // Duration (1800 s → 30 min) + SOC transition on one line.
    expect(screen.getByText('30 min · 80% → 60%')).toBeInTheDocument();

    // Date cell is produced by the formatter, fed the drive's start_ts.
    expect(screen.getByText('May 1')).toBeInTheDocument();
    expect(formatDateShortSpy).toHaveBeenCalledWith('2024-05-01T10:00:00Z');

    // "View all" affordance points at the drives index…
    const viewAll = screen.getByRole('link', { name: /View all/ });
    expect(viewAll).toHaveAttribute('href', '/drives');

    // …and the row links to that specific drive.
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/drives/42');
  });

  it('renders one row per drive and honours the limit=5 request contract', async () => {
    routeDrives([
      makeDrive({ id: 1 }),
      makeDrive({ id: 2 }),
      makeDrive({ id: 3 }),
    ]);
    renderWidget(1);

    await screen.findByText('Recent Drives');

    // Three drive rows + the "View all" link = four links total.
    const driveLinks = screen
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'))
      .filter((h) => h?.startsWith('/drives/'));
    expect(driveLinks).toEqual(['/drives/1', '/drives/2', '/drives/3']);
    expect(drivesCalls()[0]?.[0]).toBe('/drives?vehicle_id=1&limit=5');
  });

  it('converts distance to miles when the unit preference is mi', async () => {
    mockUseUnits.mockReturnValue(unitsResult('mi'));
    routeDrives([makeDrive({ distance_m: 1609.344 })]); // exactly 1 mile
    renderWidget(1);

    expect(await screen.findByText('1.0 mi')).toBeInTheDocument();
    expect(screen.queryByText('1.0 km')).toBeNull();
  });

  it('is null-safe: 0 distance / 0 duration / null SOC render placeholders, not NaN', async () => {
    routeDrives([
      makeDrive({
        distance_m: 0,
        duration_s: 0,
        start_soc_pct: null as never,
        end_soc_pct: null,
      }),
    ]);
    renderWidget(1);

    expect(await screen.findByText('0.0 km')).toBeInTheDocument();
    expect(screen.getByText('0 min · ?% → ?%')).toBeInTheDocument();
    expect(screen.queryByText(/NaN|undefined/)).toBeNull();
  });
});

// ── Refresh interaction ─────────────────────────────────────────────────────

describe('RecentDrivesWidget refresh', () => {
  it('re-issues the /drives read when the freshness refresh control is activated', async () => {
    routeDrives([makeDrive()]);
    renderWidget(1);

    const refresh = await screen.findByRole('button', { name: /^Refresh/i });
    const before = drivesCalls().length;
    expect(before).toBeGreaterThanOrEqual(1);

    fireEvent.click(refresh);

    await waitFor(() => expect(drivesCalls().length).toBe(before + 1));
  });
});
