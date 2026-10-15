/**
 * TirePressurePage — pure-helper + page contract/hardening tests.
 *
 * Two layers:
 *
 *  1. Pure helpers (exported from the page for direct unit testing):
 *     `normaliseTpmsToPa` (Pa/kPa/psi/bar range detection + sentinel guard),
 *     `pressureStatus` / `pressureColor` (threshold bucketing, kept in lock-step),
 *     `statusVariant`, `hasTpmsWarning` (JSON-object / bare-boolean / non-JSON /
 *     malformed branches), and `getTirePressureValue` (corner → Pa mapping).
 *
 *  2. The page component, driven through the real TanStack Query stack with
 *     the network boundary (`@/api/client`'s `request`) mocked per-URL. Every
 *     data source gets loading / error / empty / populated coverage, the two
 *     TPMS banner variants, unit-aware display (bar vs psi), the sortable-table
 *     a11y contract, and the QueryError retry path. It also pins the
 *     partial-report regression fix: a corner that never reported (normalises
 *     to 0) is excluded from the Avg / Min / Warning-count KPIs instead of
 *     poisoning them with a phantom 0-bar reading.
 *
 * Repo conventions mirrored from the sibling GuardModePage / AutomationsListPage
 * suites: framer-motion is mocked so FadeIn renders eagerly (no matchMedia /
 * IntersectionObserver), react-i18next is stubbed with an interpolating
 * English-fallback `t`, and `@testing-library/user-event` is not installed so
 * interactions use `fireEvent`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { formatDateTime } from '@/lib/dateFormat';

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

import TirePressurePage, {
  hasTpmsWarning,
  normaliseTpmsToPa,
  getTirePressureValue,
  pressureColor,
  pressureStatus,
  statusVariant,
  TIRE_POSITIONS,
  type TirePressureReading,
  type TirePosition,
  type PressureStatus,
} from './TirePressurePage';

/* ── Hoisted, mutable state shared with the hoisted vi.mock factories ─────── */

const H = vi.hoisted(() => ({
  vehicleId: 42 as number | null,
  pressure: 'bar' as 'bar' | 'psi' | 'kPa',
  latest: { mode: 'resolve' as 'resolve' | 'reject' | 'pending', value: null as unknown },
  history: { mode: 'resolve' as 'resolve' | 'reject' | 'pending', value: [] as unknown },
  calls: { latest: 0, history: 0 },
  historyPaths: [] as string[],
  historySignals: [] as (AbortSignal | undefined)[],
  startInstant: '2026-06-01T00:00:00Z',
  endInstantExclusive: '2026-07-01T00:00:00Z',
  setRange: vi.fn(),
  dateOptions: { locale: 'en-US', tz: 'UTC' },
}));

/* ── framer-motion: render eagerly as plain divs (no matchMedia / IO). ────── */

function stripMotionProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (
      k === 'initial' || k === 'animate' || k === 'exit' || k === 'transition' ||
      k === 'whileHover' || k === 'whileTap' || k === 'whileInView' ||
      k === 'viewport' || k === 'variants' || k === 'layout' || k === 'layoutId'
    ) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

vi.mock('framer-motion', () => {
  // Stable identity keeps query updates from remounting the scoped KPI/table
  // nodes that async assertions are waiting on.
  const MotionElement = ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
    <div {...stripMotionProps(props)}>{children}</div>
  );
  return {
    motion: new Proxy({}, { get: () => MotionElement }),
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useInView: () => true,
    useReducedMotion: () => false,
  };
});

/* ── react-i18next: deterministic English-fallback `t` with interpolation. ── */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
      const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined;
      const opts =
        typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
          ? (fallbackOrOpts as Record<string, unknown>)
          : (maybeOpts as Record<string, unknown> | undefined);
      const interpolate = (s: string) =>
        opts
          ? Object.keys(opts).reduce(
              (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
              s,
            )
          : s;
      if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue);
      if (fallback != null) return interpolate(fallback);
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

/* ── Network boundary: request() resolves/rejects per-URL from H. ─────────── */

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual, // keep ApiError / isApiError / getApiBase for QueryError
    request: (path: string, options?: { signal?: AbortSignal }) => {
      if (path.startsWith('/tire-pressure/latest')) {
        H.calls.latest += 1;
        if (H.latest.mode === 'reject') return Promise.reject(new Error('latest boom'));
        if (H.latest.mode === 'pending') return new Promise(() => {});
        return Promise.resolve(H.latest.value);
      }
      if (path.startsWith('/tire-pressure?')) {
        H.calls.history += 1;
        H.historyPaths.push(path);
        H.historySignals.push(options?.signal);
        if (H.history.mode === 'reject') return Promise.reject(new Error('history boom'));
        if (H.history.mode === 'pending') return new Promise(() => {});
        return Promise.resolve(H.history.value);
      }
      return Promise.reject(new Error(`unexpected path: ${path}`));
    },
  };
});

/* ── App hooks the page reads (kept minimal — only what the page consumes). ─ */

vi.mock('@/hooks/useDateFormat', async (importOriginal) => {
  // wrapped-real-hook: keep every real formatter, override only what this file controls.
  const actual = await importOriginal<typeof import('@/hooks/useDateFormat')>();
  const overrides = await (async () => {
  const { useMemo } = await import('react');
  const { formatDateTime } = await import('@/lib/dateFormat');
  return {
    useDateFormat: () => {
      const { locale, tz } = H.dateOptions;
      return useMemo(() => ({
        formatDateTime: (value: string | Date | null | undefined) => formatDateTime(value, { locale, tz }),
      }), [locale, tz]);
    },
  };
})();
  return {
    ...actual,
    ...overrides,
    useDateFormat: (...args: Parameters<typeof actual.useDateFormat>) => ({
      ...actual.useDateFormat(...args),
      ...overrides.useDateFormat(...args),
    }),
  };
});

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: H.pressure,
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: undefined,
    },
    formatDistance: (v: unknown) => String(v),
    formatSpeed: (v: unknown) => String(v),
    formatTemperature: (v: unknown) => String(v),
    formatPressure: (v: unknown) => String(v),
    formatEnergy: (v: unknown) => String(v),
    formatDuration: (v: unknown) => String(v),
    formatPower: (v: unknown) => String(v),
  }),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: H.vehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    start: '2026-06-01',
    end: '2026-06-30',
    startInstant: H.startInstant,
    endInstantExclusive: H.endInstantExclusive,
    timezone: 'UTC',
    presetId: '30d',
    compare: false,
    comparePrev: undefined,
    setRange: H.setRange,
    setPreset: vi.fn(),
    setCompare: vi.fn(),
    reset: vi.fn(),
  }),
}));

/* ── Header controls + AI narration: inert probes. ───────────────────────── */

vi.mock('@/components/forms', () => ({
  VehicleSelect: ({ ariaLabel }: { ariaLabel?: string }) => (
    <div data-testid="vehicle-select" aria-label={ariaLabel} />
  ),
  RangePicker: ({
    onChange,
    triggerTestId,
  }: {
    onChange?: (v: { start: string; end: string }) => void;
    triggerTestId?: string;
  }) => (
    <button
      type="button"
      data-testid={triggerTestId ?? 'range-picker'}
      onClick={() => onChange?.({ start: '2026-05-01', end: '2026-05-31' })}
    >
      range
    </button>
  ),
}));

vi.mock('@/components/ai/AITirePressureTrendReasoning', () => ({
  AITirePressureTrendReasoning: () => null,
}));

/* ── Fixtures + render harness ───────────────────────────────────────────── */

function makeReading(over: Partial<TirePressureReading> = {}): TirePressureReading {
  return {
    id: 1,
    vehicle_id: 42,
    front_left: 300_000,
    front_right: 300_000,
    rear_left: 300_000,
    rear_right: 300_000,
    tpms_hard_warnings: null,
    tpms_soft_warnings: null,
    created_at: '2026-06-15T10:00:00Z',
    ...over,
  };
}

function setLatest(value: TirePressureReading | null, mode: 'resolve' | 'reject' | 'pending' = 'resolve') {
  H.latest.value = value;
  H.latest.mode = mode;
}

function setHistory(value: TirePressureReading[], mode: 'resolve' | 'reject' | 'pending' = 'resolve') {
  H.history.value = value;
  H.history.mode = mode;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(<TirePressurePage />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={['/tire-pressure']}>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </MemoryRouter>
      ),
    }),
  };
}

/** Scope to the real shared statistic, not its label/tooltip wrapper. */
function kpiCard(label: string) {
  const el = screen.getByText(label, { selector: '[data-operational-metric] > div:first-child > :first-child' }).closest('[data-operational-metric]');
  if (!el) throw new Error(`KPI card not found for label: ${label}`);
  return within(el as HTMLElement);
}

function historyTable() {
  const card = screen.getByRole('heading', { name: 'History table' }).closest('[data-card]');
  if (!(card instanceof HTMLElement)) throw new Error('Missing pressure history table shell');
  return within(card);
}

function pressureMetric(label: string, value: string, unit: string) {
  // OperationalBrief retains the formatted value and unit together.
  const card = kpiCard(label);
  expect(card.getByText(`${value} ${unit}`, { selector: '[data-operational-value]' })).toHaveTextContent(value);
  expect(card.getByText(`${value} ${unit}`, { selector: '[data-operational-value]' })).toHaveTextContent(unit);
}

beforeEach(() => {
  H.vehicleId = 42;
  H.pressure = 'bar';
  H.dateOptions = { locale: 'en-US', tz: 'UTC' };
  H.calls.latest = 0;
  H.calls.history = 0;
  H.historyPaths = [];
  H.historySignals = [];
  H.startInstant = '2026-06-01T00:00:00Z';
  H.endInstantExclusive = '2026-07-01T00:00:00Z';
  H.setRange.mockClear();
  setLatest(makeReading());
  setHistory([makeReading()]);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Pure helpers
 * ════════════════════════════════════════════════════════════════════════ */

describe('normaliseTpmsToPa — source-unit detection + sentinel guard', () => {
  it('passes SI Pascals straight through and up-scales kPa / psi / bar into Pascals', () => {
    expect(normaliseTpmsToPa(300_000)).toBe(300_000); // already Pa
    expect(normaliseTpmsToPa(50_000)).toBe(50_000); // lower Pa boundary
    expect(normaliseTpmsToPa(300)).toBe(300_000); // kPa → ×1000
    expect(normaliseTpmsToPa(35)).toBeCloseTo(35 * 6_894.757, 3); // psi
    expect(normaliseTpmsToPa(3)).toBe(300_000); // bar → ×100000
  });

  it('coerces every missing / non-finite / non-positive input to 0', () => {
    expect(normaliseTpmsToPa(0)).toBe(0);
    expect(normaliseTpmsToPa(-5)).toBe(0);
    expect(normaliseTpmsToPa(null)).toBe(0);
    expect(normaliseTpmsToPa(undefined)).toBe(0);
    expect(normaliseTpmsToPa(Number.NaN)).toBe(0);
    expect(normaliseTpmsToPa(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('pressureStatus — threshold bucketing (Pa)', () => {
  it('maps values into normal / low / high / critical buckets', () => {
    expect(pressureStatus(300_000)).toBe('normal');
    expect(pressureStatus(230_000)).toBe('low'); // 200k..250k
    expect(pressureStatus(370_000)).toBe('high'); // 350k..400k
    expect(pressureStatus(150_000)).toBe('critical'); // < soft-low
    expect(pressureStatus(450_000)).toBe('critical'); // > soft-high
  });

  it('treats the inclusive normal band edges as normal, not warnings', () => {
    expect(pressureStatus(250_000)).toBe('normal');
    expect(pressureStatus(350_000)).toBe('normal');
    // Just outside the band is a warning on each side.
    expect(pressureStatus(249_999)).toBe('low');
    expect(pressureStatus(350_001)).toBe('high');
  });
});

describe('pressureColor + statusVariant — kept consistent with pressureStatus', () => {
  it('colours normal green, soft-warning amber, and critical red', () => {
    expect(pressureColor(300_000)).toBe('#10b981');
    expect(pressureColor(230_000)).toBe('#f59e0b');
    expect(pressureColor(370_000)).toBe('#f59e0b');
    expect(pressureColor(150_000)).toBe('#ef4444');
    expect(pressureColor(450_000)).toBe('#ef4444');
  });

  it('maps each status to the matching Badge variant', () => {
    const cases: Array<[PressureStatus, string]> = [
      ['normal', 'success'],
      ['low', 'warning'],
      ['high', 'warning'],
      ['critical', 'danger'],
    ];
    for (const [status, variant] of cases) {
      expect(statusVariant(status)).toBe(variant);
    }
  });
});

describe('hasTpmsWarning — JSON object / bare boolean / malformed handling', () => {
  it('returns false for empty / missing / all-false payloads', () => {
    expect(hasTpmsWarning(null)).toBe(false);
    expect(hasTpmsWarning(undefined)).toBe(false);
    expect(hasTpmsWarning('')).toBe(false);
    expect(hasTpmsWarning('{}')).toBe(false);
    expect(hasTpmsWarning('{"front_left":false,"front_right":false}')).toBe(false);
    expect(hasTpmsWarning('false')).toBe(false); // JSON boolean → no own values
  });

  it('returns true when any corner flag is set, and falls back to truthy for non-JSON', () => {
    expect(hasTpmsWarning('{"front_left":true}')).toBe(true);
    expect(hasTpmsWarning('[true,false]')).toBe(true);
    expect(hasTpmsWarning('HARD_WARNING')).toBe(true); // not JSON → catch branch
  });
});

describe('getTirePressureValue — corner mapping through normaliseTpmsToPa', () => {
  it('reads each corner and normalises it to Pascals', () => {
    const reading = makeReading({
      front_left: 300_000, // Pa
      front_right: 3, // bar → 300k Pa
      rear_left: 35, // psi
      rear_right: 0, // missing
    });
    expect(getTirePressureValue(reading, 'fl')).toBe(300_000);
    expect(getTirePressureValue(reading, 'fr')).toBe(300_000);
    expect(getTirePressureValue(reading, 'rl')).toBeCloseTo(35 * 6_894.757, 3);
    expect(getTirePressureValue(reading, 'rr')).toBe(0);
  });

  it('covers all four canonical positions without gaps', () => {
    const reading = makeReading({
      front_left: 210_000,
      front_right: 220_000,
      rear_left: 230_000,
      rear_right: 240_000,
    });
    const seen = TIRE_POSITIONS.map((p: TirePosition) => getTirePressureValue(reading, p));
    expect(seen).toEqual([210_000, 220_000, 230_000, 240_000]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Page component
 * ════════════════════════════════════════════════════════════════════════ */

describe('TirePressurePage — populated data (bar)', () => {
  it('refreshes table, chart labels and summary on date preference changes without rewriting UTC data', async () => {
    const readings = [
      makeReading({ id: 2, created_at: '2026-06-16T00:30:00Z' }),
      makeReading({ id: 1, created_at: '2026-06-15T09:00:00Z' }),
    ];
    setHistory(readings);
    const original = readings.map(row => ({ ...row }));
    const { rerender, client } = renderPage();
    const newest = readings[0].created_at;
    await waitFor(() => {
      expect(kpiCard('Last updated').getByText(formatDateTime(newest, H.dateOptions))).toBeInTheDocument();
    });

    H.dateOptions = { locale: 'de-DE', tz: 'America/Los_Angeles' };
    rerender(<TirePressurePage />);
    const labels = readings.map(row => formatDateTime(row.created_at, H.dateOptions));
    await waitFor(() => {
      expect(kpiCard('Last updated').getByText(labels[0])).toBeInTheDocument();
      expect(historyTable().getAllByRole('row').slice(1)
        .map(row => within(row).getAllByRole('cell')[0].textContent)).toEqual(labels);
    });
    // The chart's accessible data table uses the same projected labels.
    const chartTable = screen.getByRole('table', { name: 'Pressure history — data table' });
    expect(within(chartTable).getAllByRole('row').slice(1)
      .map(row => within(row).getAllByRole('cell')[0].textContent)).toEqual([...labels].reverse());
    expect(client.getQueryData(['tire-pressure-history', 42, H.startInstant, H.endInstantExclusive])).toEqual(original);
    expect(readings).toEqual(original);
  });

  it('renders KPIs, four corner gauges with statuses, and the sorted history table', async () => {
    setLatest(
      makeReading({
        front_left: 300_000, // normal
        front_right: 200_000, // low  (< 250k)
        rear_left: 400_000, // high (> 350k)
        rear_right: 300_000, // normal
      }),
    );
    setHistory([
      makeReading({ id: 1, created_at: '2026-06-10T08:00:00Z', tpms_hard_warnings: 'false', tpms_soft_warnings: 'false' }),
      makeReading({ id: 2, created_at: '2026-06-15T09:00:00Z', tpms_soft_warnings: '{"rl":true}' }),
    ]);
    renderPage();

    // Header shell always renders.
    expect(screen.getByRole('heading', { level: 1, name: 'Tire pressure' })).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();

    // Wait for the latest reading to resolve (avg KPI is a unique post-resolution
    // string), then scope each KPI to its card. avg = 300k Pa = 3 bar,
    // min = 200k Pa = 2 bar, 2 warnings.
    await kpiCard('Avg pressure').findByText('3.00 bar', { selector: '[data-operational-value]' });
    pressureMetric('Avg pressure', '3.00', 'bar');
    pressureMetric('Min pressure', '2.00', 'bar');
    expect(kpiCard('Warning count').getByText('2')).toBeInTheDocument();

    // Gauge status badges reflect each corner's bucket.
    expect(screen.getAllByText('Normal')).toHaveLength(2);
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();

    // Accessible section landmarks.
    expect(screen.getByRole('region', { name: 'Tire pressure summary' })).toBeInTheDocument();

    // History table headers carry the active display unit; the soft-warning row
    // surfaces its badge and the clean row an OK badge. No empty/placeholder.
    expect(historyTable().getByRole('columnheader', { name: /Front left \(bar\)/ })).toBeInTheDocument();
    expect(historyTable().getByText('Soft warning')).toBeInTheDocument();
    expect(historyTable().getByText('OK')).toBeInTheDocument();
    expect(screen.queryByText('No history data')).not.toBeInTheDocument();
    expect(screen.queryByText('No current readings available')).not.toBeInTheDocument();
  });

  it('excludes a never-reported corner (0) from the Avg / Min / Warning KPIs (regression)', async () => {
    // front_right never reported → normalises to 0. Under the old aggregation
    // that dragged Min to 0.00 bar and counted a phantom warning.
    setLatest(
      makeReading({
        front_left: 300_000,
        front_right: 0,
        rear_left: 300_000,
        rear_right: 300_000,
      }),
    );
    setHistory([makeReading()]);
    renderPage();

    // Wait for the reading to resolve; avg + min both convert to 3.00 bar.
    await kpiCard('Avg pressure').findByText('3.00 bar', { selector: '[data-operational-value]' });
    pressureMetric('Min pressure', '3.00', 'bar');
    pressureMetric('Avg pressure', '3.00', 'bar');
    expect(kpiCard('Warning count').getByText('0')).toBeInTheDocument();
    expect(screen.getAllByRole('meter')).toHaveLength(3);
    // The phantom 0-bar reading must not leak into the KPI band.
    expect(screen.queryByText('0.00 bar')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Tire pressure summary' }))
      .queryByText('0.00 bar', { selector: '[data-operational-value]' })).not.toBeInTheDocument();
  });
});

describe('TirePressurePage — unit-aware display', () => {
  it('renders pressures + column headers in psi when that is the user preference', async () => {
    H.pressure = 'psi';
    setLatest(makeReading()); // all corners 300k Pa = 300 kPa ≈ 43.51 psi
    setHistory([makeReading()]);
    renderPage();

    // Column header advertises the psi unit ...
    expect(await historyTable().findByRole('columnheader', { name: /Front left \(psi\)/ })).toBeInTheDocument();
    // ... and the KPI values are converted into psi (not left as bar).
    pressureMetric('Avg pressure', '43.51', 'psi');
    expect(screen.queryByText('3.00 bar')).not.toBeInTheDocument();
  });
});

describe('TirePressurePage — TPMS warning banners', () => {
  it('shows the danger hard-warning banner and a Hard Warning row badge', async () => {
    setLatest(makeReading({ tpms_hard_warnings: '{"front_left":true}' }));
    setHistory([makeReading({ id: 9, tpms_hard_warnings: '{"front_left":true}' })]);
    renderPage();

    expect(await screen.findByText('Hard TPMS warning active')).toBeInTheDocument();
    expect(screen.getByText('Hard warning')).toBeInTheDocument();
    expect(screen.queryByText('Soft TPMS warning active')).not.toBeInTheDocument();
  });

  it('shows the softer warning banner when only a soft warning is active', async () => {
    setLatest(makeReading({ tpms_hard_warnings: null, tpms_soft_warnings: '{"rear_left":true}' }));
    setHistory([makeReading()]);
    renderPage();

    expect(await screen.findByText('Soft TPMS warning active')).toBeInTheDocument();
    expect(screen.queryByText('Hard TPMS warning active')).not.toBeInTheDocument();
  });
});

describe('TirePressurePage — loading / empty / error states', () => {
  it('distinguishes disabled vehicle prerequisites from successful empty responses', () => {
    H.vehicleId = null;
    renderPage();
    expect(screen.getAllByText('No vehicle selected')).toHaveLength(3);
    expect(screen.queryByText('No current readings available')).not.toBeInTheDocument();
    expect(screen.queryByText('No history data')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Retry$/ })).not.toBeInTheDocument();
    expect(H.calls).toEqual({ latest: 0, history: 0 });
    for (const title of ['Tire pressure summary', 'Current readings', 'Pressure history', 'History table']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('shows skeletons (not empty states) while both queries are in flight', async () => {
    setLatest(null, 'pending');
    setHistory([], 'pending');
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy());
    // Loading must not masquerade as "no data".
    expect(screen.queryByText('No current readings available')).not.toBeInTheDocument();
    expect(screen.queryByText('No history data')).not.toBeInTheDocument();
    expect(screen.queryByText('Normal')).not.toBeInTheDocument();
    // KPIs fall back to em-dash placeholders, never a stray 0-value.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('renders honest empty states when the vehicle has no readings/history', async () => {
    setLatest(null, 'resolve');
    setHistory([], 'resolve');
    renderPage();

    expect((await screen.findAllByText(/vehicle/i)).length).toBeGreaterThan(0);
    // Both the chart and the table surface an empty placeholder.
    expect(screen.getAllByText(/vehicle/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Normal')).not.toBeInTheDocument();
    expect(kpiCard('Avg pressure').getByText('—')).toBeInTheDocument();
  });

  it('names the failed source, preserves history, and keeps section retry working', async () => {
    setLatest(null, 'reject');
    setHistory([], 'resolve'); // isolate the failure to the "current readings" query
    renderPage();

    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByText('Partial data')).toBeInTheDocument();
    expect(screen.getByText('Latest tire pressure', { selector: 'li span' })).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Tire pressure history')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getAllByText('No history data').length).toBeGreaterThanOrEqual(1);

    const callsBefore = H.calls.latest;
    const historyCallsBefore = H.calls.history;
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/ }));
    await waitFor(() => expect(H.calls.latest).toBeGreaterThan(callsBefore));
    expect(H.calls.history).toBe(historyCallsBefore);
  });
});

describe('TirePressurePage — interactions + a11y', () => {
  it('retains pagination and raw-pressure filters without rewriting history values', async () => {
    const readings = Array.from({ length: 26 }, (_, index) => makeReading({
      id: index + 1,
      created_at: `2026-06-${String(index + 1).padStart(2, '0')}T09:00:00Z`,
      front_left: index === 0 ? 230_000 : 300_000,
    }));
    setHistory(readings);
    const { client } = renderPage();
    await historyTable().findByRole('columnheader', { name: /Front left/ });
    expect(historyTable().getAllByRole('row').slice(1)).toHaveLength(25);
    fireEvent.click(historyTable().getByRole('button', { name: /next page/i }));
    expect(historyTable().getAllByRole('row').slice(1)).toHaveLength(1);
    expect(historyTable().getByText('2.30 bar · Low')).toBeInTheDocument();
    fireEvent.click(historyTable().getByRole('button', { name: /Front left.*filter/i }));
    const filter = screen.getByRole('dialog', { name: /Front left.*filter/i });
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Select all shown values' }));
    fireEvent.click(within(filter).getByRole('checkbox', { name: '2.30 bar' }));
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }));
    expect(historyTable().getAllByRole('row').slice(1)).toHaveLength(1);
    expect(historyTable().getByText('2.30 bar · Low')).toBeInTheDocument();
    expect(client.getQueryData(['tire-pressure-history', 42, H.startInstant, H.endInstantExclusive])).toEqual(readings);
    expect(readings[0].front_left).toBe(230_000);
  });

  it('exposes aria-sort on the sortable Time column and toggles it on header click', async () => {
    setLatest(makeReading());
    setHistory([
      makeReading({ id: 1, created_at: '2026-06-10T08:00:00Z' }),
      makeReading({ id: 2, created_at: '2026-06-15T09:00:00Z' }),
    ]);
    renderPage();

    const timeHeader = await historyTable().findByRole('columnheader', { name: /Time/i });
    // Default sort is newest-first (descending) by created_at.
    expect(timeHeader).toHaveAttribute('aria-sort', 'descending');
    const newestFirst = historyTable().getAllByRole('row').slice(1)
      .map(row => within(row).getAllByRole('cell')[0].textContent);
    expect(newestFirst).toHaveLength(2);

    fireEvent.click(within(timeHeader).getByRole('button'));
    // Re-query rather than trust the pre-click node reference.
    expect(historyTable().getByRole('columnheader', { name: /Time/i })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(historyTable().getAllByRole('row').slice(1)
      .map(row => within(row).getAllByRole('cell')[0].textContent))
      .toEqual([...newestFirst].reverse());
  });

  it('uses the shared range for history without rendering a local range picker', async () => {
    renderPage();

    await historyTable().findByRole('columnheader', { name: /Front left \(bar\)/ });
    expect(H.historyPaths).toContain('/tire-pressure?vehicle_id=42&start=2026-06-01T00%3A00%3A00Z&end=2026-07-01T00%3A00%3A00Z');
    expect(screen.queryByTestId('tire-pressure-range')).not.toBeInTheDocument();
    expect(H.setRange).not.toHaveBeenCalled();
  });

  it('encodes workspace instants and isolates history cache entries when either bound changes', async () => {
    H.startInstant = '2026-06-15T08:30:00+05:30';
    H.endInstantExclusive = '2026-06-16T08:30:00+05:30';
    const initialHistory = [makeReading()];
    setHistory(initialHistory);
    const { client, rerender } = renderPage();
    const initialKey = ['tire-pressure-history', 42, H.startInstant, H.endInstantExclusive];

    await waitFor(() => expect(client.getQueryData(initialKey)).toEqual(initialHistory));
    expect(H.historyPaths).toEqual([
      '/tire-pressure?vehicle_id=42&start=2026-06-15T08%3A30%3A00%2B05%3A30&end=2026-06-16T08%3A30%3A00%2B05%3A30',
    ]);
    expect(H.historySignals[0]).toBeInstanceOf(AbortSignal);

    const updatedHistory = [makeReading({ id: 2, front_left: 230_000 })];
    setHistory(updatedHistory);
    H.startInstant = '2026-06-15T09:30:00+05:30';
    rerender(<TirePressurePage />);
    const startChangedKey = ['tire-pressure-history', 42, H.startInstant, H.endInstantExclusive];
    await waitFor(() => expect(client.getQueryData(startChangedKey)).toEqual(updatedHistory));

    H.endInstantExclusive = '2026-06-16T09:30:00+05:30';
    rerender(<TirePressurePage />);
    const endChangedKey = ['tire-pressure-history', 42, H.startInstant, H.endInstantExclusive];
    await waitFor(() => expect(client.getQueryData(endChangedKey)).toEqual(updatedHistory));
    expect(client.getQueryData(initialKey)).toEqual(initialHistory);
    expect(H.historyPaths).toHaveLength(3);
    const params = new URL(H.historyPaths[2], 'http://localhost').searchParams;
    expect(params.get('start')).toBe(H.startInstant);
    expect(params.get('end')).toBe(H.endInstantExclusive);
    expect(H.calls.latest).toBe(1);
    expect(await historyTable().findByText('2.30 bar · Low')).toBeInTheDocument();
    expect(screen.queryByTestId('range-picker')).not.toBeInTheDocument();
  });

  it('aborts an in-flight history request when the workspace window changes', async () => {
    setHistory([], 'pending');
    const { rerender, unmount } = renderPage();
    await waitFor(() => expect(H.historySignals).toHaveLength(1));
    const previousSignal = H.historySignals[0];
    expect(previousSignal?.aborted).toBe(false);

    H.endInstantExclusive = '2026-07-01T01:00:00Z';
    rerender(<TirePressurePage />);
    await waitFor(() => expect(H.historySignals).toHaveLength(2));
    expect(previousSignal?.aborted).toBe(true);
    expect(H.historySignals[1]?.aborted).toBe(false);
    unmount();
    expect(H.historySignals[1]?.aborted).toBe(true);
  });
});


/* Phase 5 page-only adoption: keep the entire inherited suite above intact. */
describe('TirePressurePage — restrained semantic presentation and preservation', () => {
  it('uses five theme-aware semantic bands while retaining all four labeled meters', async () => {
    renderPage();
    const meter = await screen.findByRole('meter', { name: 'Front left' });
    expect(screen.getAllByRole('meter')).toHaveLength(4);
    const bands = [...meter.querySelectorAll<HTMLElement>('[style*="background"]')];
    expect(bands).toHaveLength(5);
    expect(bands.map(band => band.style.background)).toEqual([
      'color-mix(in srgb, var(--semantic-danger) 55%, transparent)',
      'color-mix(in srgb, var(--semantic-warning) 55%, transparent)',
      'color-mix(in srgb, var(--semantic-success) 55%, transparent)',
      'color-mix(in srgb, var(--semantic-warning) 55%, transparent)',
      'color-mix(in srgb, var(--semantic-danger) 55%, transparent)',
    ]);
    expect(meter).toHaveAttribute('aria-valuemin', '1.5');
    expect(meter).toHaveAttribute('aria-valuemax', '4.5');
    expect(meter).toHaveAttribute('aria-valuetext', '3.00bar — Normal');
  });

  it('shows localized pressure units and severity text for every historical corner', async () => {
    setHistory([makeReading({ front_left: 300_000, front_right: 230_000,
      rear_left: 370_000, rear_right: 450_000 })]);
    renderPage();
    expect(await historyTable().findByText('3.00 bar · Normal')).toBeInTheDocument();
    expect(historyTable().getByText('2.30 bar · Low')).toBeInTheDocument();
    expect(historyTable().getByText('3.70 bar · High')).toBeInTheDocument();
    expect(historyTable().getByText('4.50 bar · Critical')).toBeInTheDocument();
  });

  it('keeps missing historical corners and absent TPMS flags unknown rather than healthy', async () => {
    setHistory([makeReading({ front_left: null, front_right: 0,
      rear_left: Number.NaN, rear_right: Number.POSITIVE_INFINITY })]);
    renderPage();
    await historyTable().findByRole('columnheader', { name: /Front left/ });
    expect(historyTable().getAllByText('— · Unknown')).toHaveLength(4);
    expect(historyTable().queryByText('OK')).not.toBeInTheDocument();
    expect(historyTable().queryByText(/0.00 bar/)).not.toBeInTheDocument();
    pressureMetric('Avg pressure', '3.00', 'bar');
  });

  it('treats small positive wire values as Pa and bridges to kPa only at display', async () => {
    H.pressure = 'kPa';
    const reading = Object.freeze(makeReading({ front_left: 300, front_right: 300,
      rear_left: 300, rear_right: 300 }));
    setLatest(reading);
    setHistory([reading]);
    renderPage();
    await kpiCard('Avg pressure').findByText('0.30 kPa', { selector: '[data-operational-value]' });
    pressureMetric('Min pressure', '0.30', 'kPa');
    expect(historyTable().getAllByText('0.30 kPa · Critical')).toHaveLength(4);
    expect(kpiCard('Warning count').getByText('4')).toBeInTheDocument();
    expect(reading.front_left).toBe(300);
    expect(screen.queryByText('300.00 kPa')).not.toBeInTheDocument();
  });

  it('keeps each persistent section visible and makes no requests without a selected vehicle', async () => {
    H.vehicleId = null;
    renderPage();
    expect(screen.getByRole('region', { name: 'Tire pressure summary' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Current readings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pressure history' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'History table' })).toBeInTheDocument();
    expect((await screen.findAllByText(/vehicle/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/vehicle/i).length).toBeGreaterThan(0);
    expect(H.calls).toEqual({ latest: 0, history: 0 });
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tire-pressure-range')).not.toBeInTheDocument();
  });

  it('preserves latest readings and their summary when only history fails', async () => {
    setHistory([], 'reject');
    renderPage();
    await kpiCard('Avg pressure').findByText('3.00 bar', { selector: '[data-operational-value]' });
    expect(screen.getAllByRole('meter')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Pressure history' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'History table' })).toBeInTheDocument();
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    pressureMetric('Min pressure', '3.00', 'bar');
  });

  it('sorts historical pressure columns by raw Pa, not localized severity labels', async () => {
    setHistory([makeReading({ id: 1, front_left: 400_000 }),
      makeReading({ id: 2, front_left: 200_000 })]);
    renderPage();
    const header = await historyTable().findByRole('columnheader', { name: /Front left/ });
    const sortFrontLeft = historyTable().getAllByRole('button', { name: /Front left/ })[0]!;
    fireEvent.click(sortFrontLeft);
    fireEvent.click(sortFrontLeft);
    expect(historyTable().getByRole('columnheader', { name: /Front left/ }))
      .toHaveAttribute('aria-sort', 'ascending');
    const values = historyTable().getAllByRole('row').slice(1)
      .map(row => within(row).getAllByRole('cell')[1].textContent);
    expect(values).toEqual(['2.00 bar · Low', '4.00 bar · High']);
  });
});
