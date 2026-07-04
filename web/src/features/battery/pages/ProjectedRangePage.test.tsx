/**
 * ProjectedRangePage — comprehensive unit + integration coverage.
 *
 * Exercises every export of ProjectedRangePage.tsx:
 *   - the default page component (all render states + branches + the
 *     what-if slider interaction), and
 *   - the pure helpers it exports for testability: effColor, scenarioIcon,
 *     interpolateRange.
 *
 * Strategy (mirrors the repo convention in BatteryHealthPage.test.tsx):
 *   - The data hook (useRangeProjection) and the vehicle selector are mocked
 *     with hoisted vi.fn()s so the network is never touched and each render is
 *     deterministic.
 *   - react-i18next is mocked to resolve the developer fallback string and
 *     interpolate `{{vars}}`, so assertions read the real English copy.
 *   - <AIRangePrediction> (an AI surface gated by withAiFeature + useAiStream)
 *     is stubbed so the page mounts without its react-query / stream wiring;
 *     the stub records the vehicleId prop it receives.
 *   - The global test-setup mock for useSettings supplies km / °C, so the real
 *     useUnits()/unit-conversion path runs (SI → km/°C/kWh at the boundary).
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * page tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Car, Shield, Snowflake, Zap } from 'lucide-react';

// jsdom lacks matchMedia; framer-motion (<FadeIn>) reads it at module load for
// the reduced-motion preference. Install a no-op before any import runs.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// Shared, hoisted test doubles + a fallback-resolving `t` reachable by both the
// mock factories below and the specs.
const { tImpl, rangeMock, selectedVehicleMock, aiPropsMock } = vi.hoisted(() => {
  const tImpl = (key: string, second?: unknown, third?: unknown): string => {
    const template =
      typeof second === 'string'
        ? second
        : second && typeof second === 'object' && 'defaultValue' in (second as Record<string, unknown>)
          ? String((second as Record<string, unknown>).defaultValue)
          : key;
    const vars =
      third && typeof third === 'object'
        ? (third as Record<string, unknown>)
        : second && typeof second === 'object'
          ? (second as Record<string, unknown>)
          : undefined;
    if (!vars) return template;
    return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
      name in vars ? String(vars[name]) : `{{${name}}}`,
    );
  };
  return {
    tImpl,
    rangeMock: vi.fn(),
    selectedVehicleMock: vi.fn(),
    aiPropsMock: vi.fn(),
  };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: tImpl,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useAnalytics', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useAnalytics')>('@/api/hooks/useAnalytics');
  return {
    ...actual,
    useRangeProjection: (...args: unknown[]) => rangeMock(...args),
  };
});

vi.mock('@/hooks/useSelectedVehicle', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSelectedVehicle')>('@/hooks/useSelectedVehicle');
  return {
    ...actual,
    useSelectedVehicle: () => selectedVehicleMock(),
  };
});

// <AIRangePrediction> is a withAiFeature-wrapped surface that pulls useAiStream
// (react-query + SSE) transitively. Stub it to a leaf that records its props so
// the page mounts deterministically and we can assert the vehicle wiring.
vi.mock('@/components/ai/AIRangePrediction', () => ({
  AIRangePrediction: (props: { vehicleId?: number }) => {
    aiPropsMock(props);
    return <div data-testid="ai-range-prediction" />;
  },
}));

import ProjectedRangePage, {
  effColor,
  scenarioIcon,
  interpolateRange,
} from './ProjectedRangePage';
import type { EfficiencyBucket, RangeProjection, RangeScenario } from '@/api/hooks/useAnalytics';

/* ── Fixtures ─────────────────────────────────────────────────────── */

function makeScenario(overrides: Partial<RangeScenario> = {}): RangeScenario {
  return {
    name: 'Scenario',
    speed_kmh: 60,
    temp_c: 20,
    efficiency_wh_km: 180,
    range_km: 250,
    sample_count: 3,
    extras: [],
    ...overrides,
  };
}

function makeProjection(overrides: Partial<RangeProjection> = {}): RangeProjection {
  return {
    current_range_km: 300,
    projected_range_km: 280,
    battery_level: 72,
    efficiency_factor: 0.92,
    factors: [
      { name: 'temperature', impact_pct: -8.5, description: 'Cold weather reduces range' },
      { name: 'speed', impact_pct: 4.2, description: 'Efficient cruising speed' },
    ],
    projection_curve: [
      { battery_pct: 20, rated_range: 90, projected_range: 82 },
      { battery_pct: 50, rated_range: 220, projected_range: 205 },
      { battery_pct: 80, rated_range: 360, projected_range: 330 },
    ],
    current_battery_pct: 72,
    usable_capacity_wh: 75000,
    health_factor: 0.95,
    scenarios: [
      { name: 'Highway', speed_kmh: 110, temp_c: 22, efficiency_wh_km: 190, range_km: 300, sample_count: 12, extras: [], is_current: true },
      { name: 'Winter City', speed_kmh: 40, temp_c: -5, efficiency_wh_km: 240, range_km: 240, sample_count: 5, extras: ['sentry', 'preheat'] },
    ],
    // Deliberately NO 'suburban' bucket so the what-if calculator (speed 80 →
    // suburban) falls through to the deterministic heuristic branch.
    efficiency_matrix: [
      { temp_bucket: 'mild', speed_bucket: 'highway', wh_km: 190, samples: 8 },
      { temp_bucket: 'cold', speed_bucket: 'city', wh_km: 210, samples: 3 },
    ],
    tesla_estimate_km: 320,
    your_estimate_km: 300,
    accuracy_note: 'Based on 42 recent drives',
    ...overrides,
  };
}

interface QueryOverrides {
  data?: unknown;
  isLoading?: boolean;
  error?: unknown;
  refetch?: () => void;
}

function makeQuery(overrides: QueryOverrides = {}) {
  return {
    data: overrides.data,
    isLoading: overrides.isLoading ?? false,
    isFetching: false,
    isStale: false,
    isError: overrides.error != null,
    error: overrides.error ?? null,
    dataUpdatedAt: overrides.data != null ? Date.now() : 0,
    refetch: overrides.refetch ?? vi.fn(),
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectedRangePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Read a MetricCard's value text by its (unique) label. */
function metricValue(label: string): string {
  const labelSpan = screen.getByText(label);
  const container = labelSpan.closest('.flex-1');
  return container?.querySelector('p.text-xl')?.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  selectedVehicleMock.mockReturnValue({
    vehicleId: 7,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Model 3' }],
    setVehicleId: vi.fn(),
  });
  rangeMock.mockReturnValue(makeQuery({ data: makeProjection() }));
});

/* ── Pure helpers ─────────────────────────────────────────────────── */

describe('ProjectedRangePage · pure helpers', () => {
  it('effColor maps Wh/km efficiency onto the four heat bands (inclusive edges)', () => {
    expect(effColor(150)).toBe('bg-neon-green');
    expect(effColor(155)).toBe('bg-neon-green');
    expect(effColor(155.1)).toBe('bg-emerald-500');
    expect(effColor(180)).toBe('bg-emerald-500');
    expect(effColor(180.1)).toBe('bg-neon-amber');
    expect(effColor(210)).toBe('bg-neon-amber');
    expect(effColor(210.1)).toBe('bg-red-500');
    expect(effColor(999)).toBe('bg-red-500');
  });

  it('scenarioIcon prioritises Sentry > sub-zero > high-speed > baseline', () => {
    const sentry = scenarioIcon(makeScenario({ extras: ['sentry'], temp_c: -10, speed_kmh: 120 })) as ReactElement;
    expect(isValidElement(sentry)).toBe(true);
    expect(sentry.type).toBe(Shield);

    // Sub-zero wins over high-speed when there's no Sentry.
    expect((scenarioIcon(makeScenario({ temp_c: -1, speed_kmh: 120 })) as ReactElement).type).toBe(Snowflake);
    expect((scenarioIcon(makeScenario({ temp_c: 5, speed_kmh: 100 })) as ReactElement).type).toBe(Car);
    expect((scenarioIcon(makeScenario({ temp_c: 20, speed_kmh: 60 })) as ReactElement).type).toBe(Zap);
  });

  it('scenarioIcon tolerates null-ish fields via the ?? guards', () => {
    const bare = { name: 'x' } as unknown as RangeScenario;
    // extras, temp_c and speed_kmh all undefined -> neutral Zap, no throw.
    expect((scenarioIcon(bare) as ReactElement).type).toBe(Zap);
  });

  it('interpolateRange uses a matrix hit when the (temp,speed) bucket exists', () => {
    const matrix: EfficiencyBucket[] = [
      { temp_bucket: 'mild', speed_bucket: 'suburban', wh_km: 160, samples: 10 },
    ];
    // speed 70 → suburban, temp 20 → mild → hit 160 Wh/km.
    const r = interpolateRange(matrix, 70, 20, 100, 80000);
    expect(r.effWhKm).toBe(160);
    expect(r.rangeKm).toBe(500); // 80000 Wh × 100% ÷ 160 = 500 km
  });

  it('interpolateRange falls back to the smooth heuristic when no bucket matches', () => {
    // Empty matrix, speed 100 → highway, temp 20 → mild.
    // eff = 155 + (100-35)*0.5 + max(0,20-20)*1.5 = 187.5
    const r = interpolateRange([], 100, 20, 100, 80000);
    expect(r.effWhKm).toBe(187.5);
    expect(r.rangeKm).toBeCloseTo(426.7, 1);
  });

  it('interpolateRange never emits NaN/negative range — the guard fix', () => {
    // A NaN matrix cell would slip past `?? fallback` (nullish only) and past a
    // bare `eff <= 0` check, poisoning the division. It must collapse to 170.
    const poisoned = interpolateRange(
      [{ temp_bucket: 'mild', speed_bucket: 'suburban', wh_km: NaN, samples: 1 }],
      70, 20, 100, 80000,
    );
    expect(poisoned.effWhKm).toBe(170);
    expect(Number.isNaN(poisoned.rangeKm)).toBe(false);
    expect(poisoned.rangeKm).toBeCloseTo(470.6, 1);

    // Zero efficiency also collapses to the safe default.
    expect(
      interpolateRange([{ temp_bucket: 'mild', speed_bucket: 'suburban', wh_km: 0, samples: 1 }], 70, 20, 100, 80000).effWhKm,
    ).toBe(170);

    // Nonsense capacity/battery stay finite and clamp to a non-negative range.
    const nonsense = interpolateRange([], 80, 20, NaN, NaN);
    expect(Number.isFinite(nonsense.rangeKm)).toBe(true);
    expect(nonsense.rangeKm).toBe(0);
  });
});

/* ── Component: gating & async states ─────────────────────────────── */

describe('ProjectedRangePage · states', () => {
  it('shows the select-a-vehicle guard (not the dashboard) when no vehicle is scoped', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Projected Range' })).toBeInTheDocument();
    expect(screen.getByText('Select a vehicle to see its projected range.')).toBeInTheDocument();
    // The KPI band region must be absent in the guard state.
    expect(screen.queryByRole('region', { name: 'Range summary metrics' })).not.toBeInTheDocument();
    // The hook still runs (unconditionally) with the empty id.
    expect(rangeMock).toHaveBeenCalledWith('');
  });

  it('renders skeletons (never KPI numbers) while the projection query is in flight', () => {
    rangeMock.mockReturnValue(makeQuery({ isLoading: true }));
    const { container } = renderPage();

    // Panel shells stay visible; only the data slots are skeletoned.
    expect(screen.getByText('Range Scenarios')).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('Your Estimate')).not.toBeInTheDocument();
  });

  it('surfaces a retryable error banner in every data section on failure', () => {
    const refetch = vi.fn();
    rangeMock.mockReturnValue(makeQuery({ error: new Error('Network down'), refetch }));
    renderPage();

    // The network-failure branch of <QueryError> renders across the page.
    expect(screen.getAllByText("Can't reach server").length).toBeGreaterThan(0);

    const retryButtons = screen.getAllByRole('button', { name: 'Retry' });
    expect(retryButtons.length).toBeGreaterThan(0);
    fireEvent.click(retryButtons[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows calm empty states (not blank panels) when the payload itself is null', () => {
    rangeMock.mockReturnValue(makeQuery({ data: undefined }));
    renderPage();

    // KPI shell still renders (with safe zeros), proving no whole-section hiding.
    expect(metricValue('Your Estimate')).toContain('0');
    // The `!data` branches of the gauge, curve and what-if calculator.
    expect(screen.getByText('Efficiency data unavailable yet.')).toBeInTheDocument();
    expect(screen.getByText('Range projection curve will appear once this vehicle logs drives.')).toBeInTheDocument();
    expect(screen.getByText('Adjust sliders to calculate projected range.')).toBeInTheDocument();
  });
});

/* ── Component: happy-path render ─────────────────────────────────── */

describe('ProjectedRangePage · dashboard render', () => {
  it('renders unit-converted KPIs and wires the hooks with the scoped vehicle', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Projected Range' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Range summary metrics' })).toBeInTheDocument();

    // your_estimate_km 300 → SI metres → "300 km"; capacity Wh → kWh; % as-is.
    expect(metricValue('Your Estimate')).toContain('300');
    expect(metricValue('Your Estimate')).toContain('km');
    expect(metricValue('Tesla Estimate')).toContain('320');
    expect(metricValue('Battery')).toContain('72');
    expect(metricValue('Usable Capacity')).toContain('kWh');
    expect(metricValue('Health Factor')).toContain('95');

    // Hooks received the correctly-typed vehicle id (string for the query,
    // number forwarded to the AI surface).
    expect(rangeMock).toHaveBeenCalledWith('7');
    expect(aiPropsMock).toHaveBeenCalledWith({ vehicleId: 7 });
    expect(screen.getByTestId('ai-range-prediction')).toBeInTheDocument();
  });

  it('renders every section (no gutted panels): gauge, curve, scenarios, matrix, factors, tips', () => {
    renderPage();

    // Section headers present.
    expect(screen.getByText('Range Scenarios')).toBeInTheDocument();
    expect(screen.getByText('Personal Efficiency Matrix (Wh/km)')).toBeInTheDocument();
    expect(screen.getByText('What If Calculator')).toBeInTheDocument();
    expect(screen.getByText('Range Factors')).toBeInTheDocument();
    expect(screen.getByText('Tips to Maximize Range')).toBeInTheDocument();

    // Efficiency gauge rendered its accuracy note; the curve rendered its chart.
    expect(screen.getByText('Based on 42 recent drives')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Rated versus projected range across battery level' }),
    ).toBeInTheDocument();

    // Scenario cards: names, the "current" badge, drive count, and extras chips.
    expect(screen.getByText('Winter City')).toBeInTheDocument();
    expect(screen.getByText('12 drives')).toBeInTheDocument();
    expect(screen.getAllByText('Current').length).toBeGreaterThan(0);
    expect(screen.getByText('sentry')).toBeInTheDocument();
    expect(screen.getByText('preheat')).toBeInTheDocument();

    // Efficiency matrix: bucket labels + populated cells (samples in parens).
    expect(screen.getByText('Suburban')).toBeInTheDocument();
    expect(screen.getByText('Freezing')).toBeInTheDocument();
    expect(screen.getByText('190')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();

    // Factors: signed impact badges + descriptions.
    expect(screen.getByText('-8.5%')).toBeInTheDocument();
    expect(screen.getByText('+4.2%')).toBeInTheDocument();
    expect(screen.getByText('Cold weather reduces range')).toBeInTheDocument();

    // Static tips always render.
    expect(screen.getByText('Keep speed under 110 km/h for optimal efficiency.')).toBeInTheDocument();
  });

  it('renders per-section empty states when the analytics arrays are empty', () => {
    rangeMock.mockReturnValue(
      makeQuery({
        data: makeProjection({ scenarios: [], efficiency_matrix: [], factors: [], projection_curve: [] }),
      }),
    );
    renderPage();

    expect(screen.getByText('Drive more to see personalized scenario projections.')).toBeInTheDocument();
    expect(screen.getByText('Efficiency data requires drives in different conditions.')).toBeInTheDocument();
    expect(screen.getByText('Range factors will appear once enough driving data is collected.')).toBeInTheDocument();
    expect(screen.getByText('Range projection curve will appear once this vehicle logs drives.')).toBeInTheDocument();
    // KPIs + tips still render — the panels are never fully hidden.
    expect(metricValue('Your Estimate')).toContain('km');
    expect(screen.getByText('Keep speed under 110 km/h for optimal efficiency.')).toBeInTheDocument();
  });
});

/* ── Component: what-if interaction ───────────────────────────────── */

describe('ProjectedRangePage · what-if calculator', () => {
  it('recomputes efficiency and range when the temperature slider changes', () => {
    renderPage();

    // Default: speed 80 (suburban) + temp 20 (mild) → heuristic 177.5 Wh/km,
    // 75 000 Wh × 72% ÷ 177.5 ≈ 304 km.
    expect(screen.getByText('177.50 Wh/km')).toBeInTheDocument();
    expect(screen.getByText('304 km')).toBeInTheDocument();

    // Drag the temperature slider down to −10 °C (freezing): the heater penalty
    // pushes efficiency to 222.5 Wh/km and range down to ~243 km.
    const tempSlider = screen.getByLabelText('Temperature');
    fireEvent.change(tempSlider, { target: { value: '-10' } });

    expect(screen.getByText('222.50 Wh/km')).toBeInTheDocument();
    expect(screen.getByText('243 km')).toBeInTheDocument();
    expect(screen.queryByText('177.50 Wh/km')).not.toBeInTheDocument();
    expect(screen.queryByText('304 km')).not.toBeInTheDocument();
  });
});
