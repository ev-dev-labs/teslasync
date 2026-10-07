/**
 * TirePressureVisualWidget — behaviour + hardening tests.
 *
 * TirePressureVisualWidget is a dashboard tile that resolves a target vehicle
 * (`vehicleId` prop → first vehicle from `useVehicles` → 0) and renders that
 * vehicle's latest TPMS snapshot (`useLatestTirePressure`, polled every 10s).
 * Inside `WidgetShell` it draws a top-down car diagram with four colour-coded
 * tire rects, a FL/FR/RL/RR value column on each side, and a footer with a
 * status Badge + the pressure unit + the most-recent reading time.
 *
 * Backend contract (the crux of this suite): tire pressure is stored and
 * served in **SI Pascals** (`front_left` ≈ 200 000–350 000 Pa). Two facets of
 * the widget therefore have to bridge Pa → display:
 *   - the corner VALUES convert Pa → kPa (`paToKpa`) before the pressure
 *     formatter (which expects the frontend kPa SI floor), then to the user's
 *     unit — so 290 000 Pa renders "2.9" (bar), never "2,900.0";
 *   - the tire COLOURS come from the shared, Pa-aware `tirePressureVariant`
 *     helper (success/warning/danger/neutral), so a healthy 250 000 Pa tire is
 *     green — not the critical-red every reading used to get when raw Pascals
 *     were compared against bar thresholds.
 *
 * The two data hooks are mocked at the `@/api/hooks/useVehicles` boundary so
 * every orchestration branch is deterministic and the network is never touched.
 * `usePressureFormat` + the `paToKpa`/`tirePressureVariant` helpers run for real
 * against the global `useSettings` stub (metric → bar) from src/test-setup.ts,
 * so the Pa→bar conversion is exercised end-to-end. `react-i18next` is
 * echo-mocked (returns the English fallback); `matchMedia` is polyfilled because
 * `<DataFreshness>` reads it via `useMotionPreference`.
 *
 * Facets covered:
 *   - vehicle resolution: explicit prop wins → first vehicle → 0, always with
 *     the 10s poll interval.
 *   - shell states: loading skeleton, error `QueryError`, and empty state —
 *     never a blank panel.
 *   - standard vs compact layout (title suppressed at cols ≤ 1).
 *   - Pa→display conversion (the hardening): 290 000 Pa → "2.9", not "2,900.0".
 *   - status colour bands from the Pa value: green / amber / red / grey across
 *     the shared helper's thresholds, plus the aggregate All-Normal vs
 *     Check-Pressure badge.
 *   - null-safety: null corners render "—" + a neutral grey tile (never red),
 *     and the aggregate badge flips to Check Pressure.
 *   - relative reading-time footer: no-reading / just-now / m / h / d / invalid
 *     branches, and "latest wins" across the four corners.
 *   - refresh wiring from both the standard and compact tiles.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : undefined) as
        | Record<string, unknown>
        | undefined;
      let base = typeof fb === 'string' ? fb : key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Both vehicle hooks are mocked so the widget's orchestration is deterministic.
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn(), useLatestTirePressure: vi.fn() };
});

// jsdom lacks matchMedia; useMotionPreference (via <DataFreshness>) reads it.
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

import TirePressureVisualWidget from './TirePressureVisualWidget';
import { useVehicles, useLatestTirePressure } from '@/api/hooks/useVehicles';
import type { TirePressureSnapshot } from '@/api/types';
import type { WidgetProps, WidgetSize } from './types';

const mockVehicles = vi.mocked(useVehicles);
const mockLatest = vi.mocked(useLatestTirePressure);

const STANDARD: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

// Tire-rect fill hexes from the widget's VARIANT_STYLE map (Pa-derived band).
const GREEN = '#22c55e'; // success
const AMBER = '#f59e0b'; // warning
const RED = '#ef4444'; // danger
const GREY = '#6b7280'; // neutral / unknown

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): never {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

/** `useVehicles()` stub — the widget only reads `.data[0].id`. */
function vehicles(ids: number[]): never {
  return { data: ids.map((id) => ({ id })) } as never;
}

/**
 * A TirePressureSnapshot with all four corners at a healthy 250 000 Pa
 * (≈ 2.5 bar / 36 psi → 'success'). Override per test.
 */
function makeSnap(over: Partial<TirePressureSnapshot> = {}): TirePressureSnapshot {
  return {
    id: 1,
    vehicle_id: 1,
    front_left: 250_000,
    front_right: 250_000,
    rear_left: 250_000,
    rear_right: 250_000,
    created_at: '2026-07-06T00:00:00Z',
    ...over,
  };
}

/** ISO timestamp `ms` milliseconds in the past. */
function agoIso(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function renderWidget(size: WidgetSize, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TirePressureVisualWidget size={size} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockVehicles.mockReturnValue(vehicles([1]));
  mockLatest.mockReturnValue(qr({ data: makeSnap() }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TirePressureVisualWidget — vehicle resolution', () => {
  it('prefers the explicit vehicleId prop over the vehicle list (with the 10s poll)', () => {
    mockVehicles.mockReturnValue(vehicles([7, 9]));
    renderWidget(STANDARD, { vehicleId: 42 });

    expect(mockLatest).toHaveBeenCalledWith(42, 10_000);
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockVehicles.mockReturnValue(vehicles([7, 9]));
    renderWidget(STANDARD);

    expect(mockLatest).toHaveBeenCalledWith(7, 10_000);
  });

  it('falls back to 0 when there is neither a prop nor any vehicle', () => {
    mockVehicles.mockReturnValue(vehicles([]));
    mockLatest.mockReturnValue(qr({ data: null }));
    renderWidget(STANDARD);

    expect(mockLatest).toHaveBeenCalledWith(0, 10_000);
    // No data → explicit empty state, never a blank panel.
    expect(screen.getByText('No tire pressure data')).toBeInTheDocument();
  });
});

describe('TirePressureVisualWidget — shell states', () => {
  it('shows a skeleton (never a blank panel) and no refresh control while loading', () => {
    mockLatest.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No tire pressure data')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Refresh/i })).toBeNull();
  });

  it('renders an explicit empty state (no car diagram) when no snapshot has arrived', () => {
    mockLatest.mockReturnValue(qr({ data: null }));
    const { container } = renderWidget(STANDARD);

    expect(screen.getByText('No tire pressure data')).toBeInTheDocument();
    // The car diagram (tire rects) is absent — only the empty-state icon remains.
    expect(container.querySelector('rect')).toBeNull();
    expect(screen.queryByText('FL')).toBeNull();
  });

  it('surfaces a fetch error as a QueryError alert, not an empty state', () => {
    mockLatest.mockReturnValue(
      qr({ isError: true, error: new Error('tpms down'), data: undefined }),
    );
    renderWidget(STANDARD);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No tire pressure data')).toBeNull();
    expect(screen.queryByText('FL')).toBeNull();
  });
});

describe('TirePressureVisualWidget — layout', () => {
  it('renders the title, four corner labels, values, diagram, unit and All-Normal badge', () => {
    const { container } = renderWidget(STANDARD);

    expect(screen.getByText('Tire Pressure')).toBeInTheDocument();
    expect(screen.getByText('FL')).toBeInTheDocument();
    expect(screen.getByText('FR')).toBeInTheDocument();
    expect(screen.getByText('RL')).toBeInTheDocument();
    expect(screen.getByText('RR')).toBeInTheDocument();

    // All four corners at 250 000 Pa → "2.5" (bar) and a green tire rect each.
    expect(screen.getAllByText('2.5')).toHaveLength(4);
    expect(container.querySelectorAll(`rect[fill="${GREEN}"]`)).toHaveLength(4);

    // Footer shows the user's pressure unit and the aggregate status.
    expect(container.textContent).toContain('bar');
    expect(screen.getByText('All Normal')).toBeInTheDocument();
    expect(screen.queryByText('Check Pressure')).toBeNull();
  });

  it('suppresses the title in the compact (cols ≤ 1) tile but still renders the values', () => {
    renderWidget(COMPACT);

    expect(screen.queryByText('Tire Pressure')).toBeNull();
    expect(screen.getByText('FL')).toBeInTheDocument();
    expect(screen.getAllByText('2.5')).toHaveLength(4);
  });
});

describe('TirePressureVisualWidget — Pa→display conversion (hardening)', () => {
  it('converts SI Pascals to the user unit (290 000 Pa → "2.9"), not ~1000× too big', () => {
    mockLatest.mockReturnValue(
      qr({
        data: makeSnap({
          front_left: 290_000,
          front_right: 290_000,
          rear_left: 290_000,
          rear_right: 290_000,
        }),
      }),
    );
    renderWidget(STANDARD);

    expect(screen.getAllByText('2.9')).toHaveLength(4);
    // Pre-fix, raw Pascals went straight through the kPa formatter (~1000×).
    expect(screen.queryByText('2,900.0')).toBeNull();
  });
});

describe('TirePressureVisualWidget — Pa-derived status colours', () => {
  it('paints each corner from its own Pa band and flips the aggregate badge', () => {
    mockLatest.mockReturnValue(
      qr({
        data: makeSnap({
          front_left: 250_000, // success  → green  → "2.5"
          front_right: 240_000, // low      → amber  → "2.4"
          rear_left: 200_000, // crit-low  → red    → "2.0"
          rear_right: null, // unknown   → grey   → "—"
        }),
      }),
    );
    const { container } = renderWidget(STANDARD);

    expect(container.querySelectorAll(`rect[fill="${GREEN}"]`)).toHaveLength(1);
    expect(container.querySelectorAll(`rect[fill="${AMBER}"]`)).toHaveLength(1);
    expect(container.querySelectorAll(`rect[fill="${RED}"]`)).toHaveLength(1);
    expect(container.querySelectorAll(`rect[fill="${GREY}"]`)).toHaveLength(1);

    expect(screen.getByText('2.5')).toBeInTheDocument();
    expect(screen.getByText('2.4')).toBeInTheDocument();
    expect(screen.getByText('2.0')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();

    // Any non-success corner flips the aggregate badge.
    expect(screen.getByText('Check Pressure')).toBeInTheDocument();
    expect(screen.queryByText('All Normal')).toBeNull();
  });

  it('flags an over-inflated (critical-high) tire as red', () => {
    mockLatest.mockReturnValue(
      qr({
        data: makeSnap({
          front_left: 350_000,
          front_right: 350_000,
          rear_left: 350_000,
          rear_right: 350_000,
        }),
      }),
    );
    const { container } = renderWidget(STANDARD);

    expect(container.querySelectorAll(`rect[fill="${RED}"]`)).toHaveLength(4);
    expect(screen.getAllByText('3.5')).toHaveLength(4);
    expect(screen.getByText('Check Pressure')).toBeInTheDocument();
  });

  it('colours the value text with the same severity variant as its tire', () => {
    mockLatest.mockReturnValue(
      qr({
        data: makeSnap({
          front_left: 200_000, // danger
          front_right: 250_000,
          rear_left: 250_000,
          rear_right: 250_000,
        }),
      }),
    );
    renderWidget(STANDARD);

    // The unique "2.0" front-left value renders in the danger text colour.
    expect(screen.getByText('2.0').className).toContain('text-rose-300');
  });
});

describe('TirePressureVisualWidget — null safety', () => {
  it('renders "—" + a neutral grey tile (never red) when every corner is null', () => {
    mockLatest.mockReturnValue(
      qr({
        data: makeSnap({
          front_left: null,
          front_right: null,
          rear_left: null,
          rear_right: null,
        }),
      }),
    );
    const { container } = renderWidget(STANDARD);

    // Four "—" corner placeholders (the footer says "No reading", not "—").
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(container.querySelectorAll(`rect[fill="${GREY}"]`)).toHaveLength(4);
    // Pre-fix this rendered four critical-red tiles; now it's calm neutral grey.
    expect(container.querySelectorAll(`rect[fill="${RED}"]`)).toHaveLength(0);
    expect(screen.getByText('Check Pressure')).toBeInTheDocument();
  });
});

describe('TirePressureVisualWidget — reading-time footer', () => {
  it('shows "No reading" when no per-corner last-seen timestamp is present', () => {
    const { container } = renderWidget(STANDARD);
    expect(container.textContent).toContain('bar · No reading');
  });

  it('renders "Just now" for a sub-minute reading', () => {
    mockLatest.mockReturnValue(qr({ data: makeSnap({ last_seen_time_fl: agoIso(20_000) }) }));
    const { container } = renderWidget(STANDARD);
    expect(container.textContent).toContain('Just now');
  });

  it('renders a minutes-ago label', () => {
    mockLatest.mockReturnValue(qr({ data: makeSnap({ last_seen_time_fl: agoIso(5 * 60_000) }) }));
    const { container } = renderWidget(STANDARD);
    expect(container.textContent).toContain('5m ago');
  });

  it('renders an hours-ago label', () => {
    mockLatest.mockReturnValue(qr({ data: makeSnap({ last_seen_time_fl: agoIso(3 * 3_600_000) }) }));
    const { container } = renderWidget(STANDARD);
    expect(container.textContent).toContain('3h ago');
  });

  it('renders a days-ago label', () => {
    mockLatest.mockReturnValue(qr({ data: makeSnap({ last_seen_time_fl: agoIso(2 * 86_400_000) }) }));
    const { container } = renderWidget(STANDARD);
    expect(container.textContent).toContain('2d ago');
  });

  it('surfaces the most-recent timestamp across the four corners', () => {
    mockLatest.mockReturnValue(
      qr({
        data: makeSnap({
          last_seen_time_fl: agoIso(3 * 86_400_000), // 3 days ago
          last_seen_time_rr: agoIso(20_000), // 20s ago — should win
        }),
      }),
    );
    const { container } = renderWidget(STANDARD);
    expect(container.textContent).toContain('Just now');
    expect(container.textContent).not.toContain('3d ago');
  });

  it('degrades an unparseable timestamp to a "—" placeholder', () => {
    mockLatest.mockReturnValue(qr({ data: makeSnap({ last_seen_time_fl: 'not-a-date' }) }));
    const { container } = renderWidget(STANDARD);
    expect(container.textContent).toContain('bar · —');
  });
});

describe('TirePressureVisualWidget — refresh wiring', () => {
  it('invokes the query refetch when the freshness control is activated (standard)', () => {
    const refetch = vi.fn();
    mockLatest.mockReturnValue(qr({ data: makeSnap(), refetch }));
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('invokes the query refetch from the compact tile too', () => {
    const refetch = vi.fn();
    mockLatest.mockReturnValue(qr({ data: makeSnap(), refetch }));
    renderWidget(COMPACT);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
