/**
 * ProjectedRangeWidget tests.
 *
 * The widget projects a vehicle's usable range (current vs EPA/new) plus a
 * battery-health read sourced from `useProjectedRange()`. Everything on the
 * wire is SI kilometres; the widget lifts to metres and converts to the user's
 * display unit at the render boundary via `convertDistanceFromSI` +
 * `useUnits().unitPrefs.distance`. Its behaviour surface — the thing under test:
 *
 *   1. Three responsive layouts driven by `size.cols`:
 *        - compact (cols <= 1): a titled shell with the projected-range big
 *          number + "Projected" caption + a health badge, or an EmptyState.
 *        - standard (cols === 2): a titled "Projected Range" shell with the
 *          range number, a health badge, and the projected-vs-EPA comparison bar.
 *        - wide (cols >= 3): standard + a four-row "Range Factors" list
 *          (degradation, avg daily usage, capacity, cycles).
 *   2. The `healthBadge` thresholds (an internal pure helper): >= 90 Excellent
 *      (green), >= 70 Good (green), >= 50 Fair (amber), else Poor (red) — asserted
 *      through the rendered <Badge> text and variant colour class.
 *   3. The comparison bar (`ComparisonBar`): rangePct = round(projected / EPA *
 *      100) clamped to 100, the colour band (>= 80 green, >= 60 amber, else red),
 *      the accessible progressbar semantics, and the null (indeterminate) case
 *      when EPA is missing or zero.
 *   4. Unit-awareness: the SAME payload renders km or mi depending on the
 *      distance preference — every number and unit chip follows.
 *   5. The query states every data source must handle: loading (skeleton),
 *      empty (EmptyState — never a blank panel), and graceful degradation on a
 *      transient background-refetch error (cached numbers stay, the freshness
 *      dot flips to its error state instead of blanking the panel).
 *   6. Null-safety: a partial `{}` payload degrades the range to "—", drops the
 *      badge, and renders an indeterminate progressbar rather than throwing.
 *   7. Vehicle resolution: an explicit `vehicleId` wins, else the first vehicle;
 *      a missing vehicle passes `null` which disables the query.
 *   8. The freshness control: clicking refetches, but only when a fetch is not
 *      already in flight.
 *
 * `@/api/hooks/useEnergy`, `@/api/hooks/useVehicles`, and `@/hooks/useUnits`
 * are mocked so the network is never touched and every query state + unit
 * preference is driven deterministically. `convertDistanceFromSI` runs for real
 * so the conversion math is genuinely exercised. `react-i18next` is stubbed with
 * a passthrough `t(key, default)` so assertions read the English defaults. The
 * shared WidgetShell / WidgetBigNumber / AnimatedNumber / Badge / FreshnessDot /
 * EmptyState primitives all run for real, so assertions exercise the true
 * rendered DOM. `<MemoryRouter>` wraps every render because a couple of shared
 * primitives reach for router context.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ProjectedRangeData } from '@/types/energy';
import ProjectedRangeWidget from './ProjectedRangeWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

// jsdom lacks matchMedia; AnimatedNumber (the range big number) and FreshnessDot
// both read it during render. Report `prefers-reduced-motion: reduce` so the
// AnimatedNumber tween is skipped and the value lands on its target
// synchronously — that makes the numeric assertions deterministic and disables
// framer-motion animation timers.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
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

const { useProjectedRangeMock, useVehiclesMock, useUnitsMock } = vi.hoisted(() => ({
  useProjectedRangeMock: vi.fn(),
  useVehiclesMock: vi.fn(),
  useUnitsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useEnergy', () => ({
  useProjectedRange: (vehicleId: string | null) => useProjectedRangeMock(vehicleId),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => useUnitsMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      return options
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Assert semantic roles independently of their light/dark palette values.
const GREEN = 'var(--semantic-success)';
const AMBER = 'var(--semantic-warning)';
const RED = 'var(--semantic-danger)';

function makeData(overrides: Partial<ProjectedRangeData> = {}): ProjectedRangeData {
  return {
    current_range_km: 0,
    new_range_km: 0,
    degradation_pct: 0,
    total_cycles: 0,
    health_score: 0,
    current_capacity_pct: 0,
    avg_daily_km: 0,
    ...overrides,
  };
}

interface QueryState {
  data: ProjectedRangeData | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  error?: unknown;
  fetchStatus?: 'idle' | 'fetching' | 'paused';
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<QueryState> = {}): QueryState {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(
  size: { cols: number; rows: number } = { cols: 2, rows: 2 },
  vehicleId?: number,
  packId: PackId = 'classic',
) {
  const content = (nextSize = size, nextVehicleId = vehicleId, nextPackId = packId) => (
    <MemoryRouter>
      <PackBoundary requestedPackId={nextPackId}>
        <ProjectedRangeWidget size={nextSize} vehicleId={nextVehicleId} />
      </PackBoundary>
    </MemoryRouter>
  );
  const result = render(content());
  return {
    ...result,
    rerenderWidget: (nextSize = size, nextVehicleId = vehicleId, nextPackId = packId) =>
      result.rerender(content(nextSize, nextVehicleId, nextPackId)),
  };
}

async function expectPack(container: HTMLElement, packId: PackId) {
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId === 'classic') {
    expect(container.querySelector('[data-widget-family]')).toBeNull();
  } else {
    await waitFor(() => {
      expect(container.querySelector('[data-widget-family="meter"]'))
        .toHaveAttribute('data-widget-appearance', PACK_APPEARANCES[packId]);
    });
  }
}

/** The inner fill <div> inside the comparison bar's progressbar track. */
function barFill(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-metric-fill]');
  if (!el) throw new Error('progressbar fill not found');
  return el as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so a test that forgets to seed a hook still renders
  // rather than crashing on a destructure of `undefined`.
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useUnitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
  useProjectedRangeMock.mockReturnValue(makeQuery());
});

it('keeps four real wide range-model operands without replacing the projected hero and comparison', () => {
  useProjectedRangeMock.mockReturnValue(makeQuery({ data: makeData({
    current_range_km: 350, new_range_km: 500, health_score: 95,
    degradation_pct: 0, avg_daily_km: 0, current_capacity_pct: undefined,
  }) }));
  renderWidget({ cols: 3, rows: 4 });
  const brief = screen.getByTestId('dashboard-projected-range-factors-brief');
  // Four operands, but the unknown capacity is omitted from the face (counted as hidden in the drawer below).
  expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(3);
  expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(0);
  expect(brief).toHaveTextContent('0%');
  expect(brief).toHaveTextContent('0 km');
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  const factorsDrawer = screen.getByRole('dialog');
  expect(factorsDrawer.querySelector('[data-drawer-header]')).toHaveTextContent('inferred range analysis');
  expect(within(factorsDrawer).getByText('1 empty fields are hidden.')).toBeInTheDocument();
  fireEvent.keyDown(factorsDrawer, { key: 'Escape' });
  expect(screen.getByText('350')).toBeInTheDocument();
  expect(screen.getByText('70% of EPA rated')).toBeInTheDocument();
});

it.each([1, 2, 3])('keeps an accessible heading at %s columns', cols => {
  renderWidget({ cols, rows: 2 });
  expect(screen.getByRole('heading', { name: 'Projected range', level: 3 })).toBeVisible();
});

afterEach(() => {
  cleanup();
});

describe('ProjectedRangeWidget — standard layout (km)', () => {
  it('renders the titled shell, the converted range, the health badge and the comparison bar', () => {
    useProjectedRangeMock.mockReturnValue(
      makeQuery({
        data: makeData({
          current_range_km: 350,
          new_range_km: 500,
          health_score: 95,
        }),
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // Titled shell + the current range converted straight through in km.
    expect(screen.getByText('Projected range')).toBeInTheDocument();
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getAllByText('km').length).toBeGreaterThan(0);

    // Health 95 → "Excellent" chip carrying the score.
    const badge = screen.getByText(/Excellent/);
    expect(badge).toHaveTextContent('Excellent');
    expect(badge).toHaveTextContent('95%');

    // Comparison bar: 350 / 500 = 70% → amber, indeterminate off.
    const bar = screen.getByRole('progressbar', {
      name: 'Projected range vs EPA rated',
    });
    expect(bar).toHaveAttribute('aria-valuenow', '70');
    expect(barFill(container).style.width).toBe('70%');
    expect(screen.getByText('70% of EPA rated')).toBeInTheDocument();
    // EPA readout on the right of the bar.
    expect(screen.getByText('EPA: 500 km')).toBeInTheDocument();
  });
});

describe('ProjectedRangeWidget — After hero', () => {
  it('shows projected once as headline with rated EPA on the right and no fabricated Helix factors', () => {
    useProjectedRangeMock.mockReturnValue(makeQuery({ data: makeData({ current_range_km: 350, new_range_km: 500, health_score: 95 }) }));
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getAllByText(/EPA: 500 km/)).toHaveLength(1);
    expect(screen.getByText('70% of EPA rated')).toBeInTheDocument();
    expect(screen.queryByText(/Helix|Highway share|Overnight|Elevation/)).toBeNull();
  });
});

describe('ProjectedRangeWidget — health badge thresholds', () => {
  const cases: Array<{ score: number; text: string; klass: string }> = [
    { score: 95, text: 'Excellent', klass: 'bg-[var(--semantic-success-bg)]' },
    { score: 75, text: 'Good', klass: 'bg-[var(--semantic-success-bg)]' },
    { score: 55, text: 'Fair', klass: 'bg-[var(--semantic-warning-bg)]' },
    { score: 30, text: 'Poor', klass: 'bg-[var(--semantic-danger-bg)]' },
  ];

  it.each(cases)(
    'maps a health score of $score to the "$text" badge',
    ({ score, text, klass }) => {
      useProjectedRangeMock.mockReturnValue(
        makeQuery({
          data: makeData({ current_range_km: 300, new_range_km: 500, health_score: score }),
        }),
      );

      renderWidget({ cols: 2, rows: 2 });

      const badge = screen.getByText(new RegExp(text));
      expect(badge).toHaveTextContent(text);
      expect(badge).toHaveTextContent(`${score}%`);
      expect(badge.className).toContain(klass);
    },
  );
});

describe('ProjectedRangeWidget — comparison bar colour bands', () => {
  it('paints the fill green and clamps the width to 100% when projected exceeds EPA', () => {
    useProjectedRangeMock.mockReturnValue(
      makeQuery({ data: makeData({ current_range_km: 600, new_range_km: 500, health_score: 80 }) }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    const bar = screen.getByRole('progressbar');
    // 600 / 500 = 120% → clamped to 100.
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    const fill = barFill(container);
    expect(fill.style.width).toBe('100%');
    expect(fill.style.background).toBe(GREEN);
  });

  it('paints the fill amber in the 60–79 band', () => {
    useProjectedRangeMock.mockReturnValue(
      makeQuery({ data: makeData({ current_range_km: 350, new_range_km: 500, health_score: 80 }) }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(barFill(container).style.background).toBe(AMBER);
  });

  it('paints the fill red below 60', () => {
    useProjectedRangeMock.mockReturnValue(
      makeQuery({ data: makeData({ current_range_km: 200, new_range_km: 500, health_score: 40 }) }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(barFill(container).style.background).toBe(RED);
  });

  it('renders an indeterminate progressbar (no aria-valuenow, no caption) when EPA is zero', () => {
    useProjectedRangeMock.mockReturnValue(
      makeQuery({ data: makeData({ current_range_km: 300, new_range_km: 0, health_score: 60 }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByText(/of EPA rated/)).not.toBeInTheDocument();
  });
});

describe('ProjectedRangeWidget — wide layout (range factors)', () => {
  it('renders the four range factors with formatted values on top of the standard content', () => {
    useProjectedRangeMock.mockReturnValue(
      makeQuery({
        data: makeData({
          current_range_km: 350,
          new_range_km: 500,
          health_score: 92,
          degradation_pct: 8.5,
          avg_daily_km: 40,
          current_capacity_pct: 91.2,
          total_cycles: 512,
        }),
      }),
    );

    renderWidget({ cols: 4, rows: 2 });

    // Section header + the four labels.
    expect(screen.getByText('Range factors')).toBeInTheDocument();
    expect(screen.getByText('Battery degradation')).toBeInTheDocument();
    expect(screen.getByText('Avg daily usage')).toBeInTheDocument();
    expect(screen.getByText('Current capacity')).toBeInTheDocument();
    expect(screen.getByText('Battery cycles')).toBeInTheDocument();

    // … and their formatted values (avg daily = 40 km converted straight through).
    expect(screen.getByText('9%')).toBeInTheDocument();
    expect(screen.getByText('40 km')).toBeInTheDocument();
    expect(screen.getByText('91%')).toBeInTheDocument();
    expect(screen.getByText('512')).toBeInTheDocument();

    // The primary range + comparison bar still render in wide mode.
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70');
  });
});

describe('ProjectedRangeWidget — compact layout', () => {
  it('renders the range big number + "Projected" caption + badge, and drops the title, bar and factors', () => {
    useProjectedRangeMock.mockReturnValue(
      makeQuery({
        data: makeData({ current_range_km: 350, new_range_km: 500, health_score: 95 }),
      }),
    );

    renderWidget({ cols: 1, rows: 2 });

    // Reduced motion → AnimatedNumber lands on 350 (0 dp) immediately.
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getByText('Projected')).toBeInTheDocument();
    expect(screen.getByText('km')).toBeInTheDocument();
    expect(screen.getByText('Excellent')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Projected range', level: 3 })).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('Range factors')).not.toBeInTheDocument();
  });

  it('shows an EmptyState (never a blank panel) when compact and data-less', () => {
    useProjectedRangeMock.mockReturnValue(makeQuery({ data: undefined }));

    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('No projected range data')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Projected range', level: 3 })).toBeVisible();
  });
});

describe('ProjectedRangeWidget — unit conversion', () => {
  it('converts the same payload to miles when the distance preference is mi', () => {
    useUnitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    useProjectedRangeMock.mockReturnValue(
      makeQuery({
        data: makeData({ current_range_km: 350, new_range_km: 500, health_score: 90 }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // 350 km = 350 000 m / 1609.344 ≈ 217 mi (rounded by AnimatedNumber, 0 dp).
    expect(screen.getByText('217')).toBeInTheDocument();
    expect(screen.getAllByText('mi').length).toBeGreaterThan(0);
    // EPA 500 km ≈ 311 mi — proves the EPA readout converted too.
    expect(screen.getByText('EPA: 311 mi')).toBeInTheDocument();
    // The km value must NOT leak through — proves the conversion ran.
    expect(screen.queryByText('350')).not.toBeInTheDocument();
    // The ratio is unit-independent, so the bar percentage is unchanged.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70');
  });
});

describe('ProjectedRangeWidget — query states', () => {
  it('shows an initial failure rather than mislabeling it as empty data', () => {
    useProjectedRangeMock.mockReturnValue(makeQuery({ isError: true, error: new Error('offline'), data: undefined }));
    renderWidget();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No projected range data')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps wide range factors unknown without rendering fabricated zero metrics', () => {
    useProjectedRangeMock.mockReturnValue(makeQuery({ data: {} as ProjectedRangeData }));
    renderWidget({ cols: 3, rows: 2 });
    expect(screen.getByText('Range factors')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(1);
    const unknownBrief = screen.getByTestId('dashboard-projected-range-factors-brief');
    fireEvent.click(within(unknownBrief).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('4 empty fields are hidden.')).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('km')).toBeNull();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });
  it('keeps the heading while loading without a range or empty message', () => {
    useProjectedRangeMock.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
    expect(screen.queryByText('Projected range')).toBeInTheDocument();
    expect(screen.queryByText('No projected range data')).not.toBeInTheDocument();
  });

  it('renders the titled shell with an EmptyState placeholder when data is absent', () => {
    useProjectedRangeMock.mockReturnValue(
      makeQuery({ data: undefined, isLoading: false }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Projected range')).toBeInTheDocument();
    expect(screen.getByText('No projected range data')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('keeps rendering cached data and flags the freshness dot on a transient background error', () => {
    useProjectedRangeMock.mockReturnValue(
      makeQuery({
        data: makeData({ current_range_km: 350, new_range_km: 500, health_score: 95 }),
        isError: true,
        isFetching: false,
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Data is still on screen …
    expect(screen.getByText('Projected range')).toBeInTheDocument();
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getByText(/Excellent/)).toBeInTheDocument();
    // … and the freshness indicator is in its error state (red dot).
    const freshness = screen.getByRole('button', { name: /^Refresh data\b/i });
    expect(freshness.querySelector('[aria-hidden="true"][class*="bg-[var(--semantic-danger)]"]')).toBeTruthy();
  });

  it('degrades a partial payload to a "—" range and an indeterminate bar without throwing', () => {
    useProjectedRangeMock.mockReturnValue(
      makeQuery({ data: {} as ProjectedRangeData }),
    );

    expect(() => {
      renderWidget({ cols: 2, rows: 2 });
    }).not.toThrow();

    // Titled shell still renders; the range degrades to a dash and the badge drops.
    expect(screen.getByText('Projected range')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/Excellent|Good|Fair|Poor/)).not.toBeInTheDocument();
    // Progressbar is present but indeterminate.
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar.querySelector('[data-metric-fill]')).toBeNull();
    expect(bar).toHaveAttribute('aria-label', 'Projected range vs EPA rated');
  });
});

describe('ProjectedRangeWidget — vehicle resolution', () => {
  it('resolves the first vehicle id (as a string) when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }, { id: 7 }] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useProjectedRangeMock).toHaveBeenCalledWith('42');
  });

  it('prefers an explicit vehicleId prop over the first vehicle', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });

    renderWidget({ cols: 2, rows: 2 }, 7);

    expect(useProjectedRangeMock).toHaveBeenCalledWith('7');
  });

  it('passes null (disabling the query) when no vehicle can be resolved', () => {
    useVehiclesMock.mockReturnValue({ data: [] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useProjectedRangeMock).toHaveBeenCalledWith(null);
  });
});

describe('ProjectedRangeWidget — freshness interaction', () => {
  it('refetches when the accessible refresh control is clicked', () => {
    const refetch = vi.fn();
    useProjectedRangeMock.mockReturnValue(
      makeQuery({
        data: makeData({ current_range_km: 350, new_range_km: 500, health_score: 90 }),
        isFetching: false,
        refetch,
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh data\b/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch while a fetch is already in flight', () => {
    const refetch = vi.fn();
    useProjectedRangeMock.mockReturnValue(
      makeQuery({
        data: makeData({ current_range_km: 350, new_range_km: 500, health_score: 90 }),
        isFetching: true,
        refetch,
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh data\b/i }));

    expect(refetch).not.toHaveBeenCalled();
  });
});

describe.each(PACK_IDS)('ProjectedRangeWidget — %s acceptance', packId => {
  it.each(['km', 'mi'] as const)('preserves the wide range, EPA, factors and inferred source in %s', async distance => {
    useUnitsMock.mockReturnValue({ unitPrefs: { distance } });
    useProjectedRangeMock.mockReturnValue(makeQuery({ data: makeData({
      current_range_km: 350, new_range_km: 500, health_score: 92,
      degradation_pct: 8.5, avg_daily_km: 40, current_capacity_pct: 91.2, total_cycles: 512,
    }) }));

    const { container } = renderWidget({ cols: 3, rows: 4 }, 7, packId);
    await expectPack(container, packId);

    expect(screen.getByRole('heading', { name: 'Projected range', level: 3 })).toBeVisible();
    expect(screen.getByText(distance === 'km' ? '350' : '217')).toBeInTheDocument();
    expect(screen.getByText(distance === 'km' ? 'EPA: 500 km' : 'EPA: 311 mi')).toBeInTheDocument();
    expect(screen.getByText('Excellent · 92%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Projected range vs EPA rated' }))
      .toHaveAttribute('aria-valuenow', '70');
    expect(screen.getByText('70% of EPA rated')).toBeInTheDocument();
    const brief = screen.getByTestId('dashboard-projected-range-factors-brief');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(4);
    expect(within(brief).getByText('9%')).toBeInTheDocument();
    expect(within(brief).getByText(distance === 'km' ? '40 km' : '25 mi')).toBeInTheDocument();
    expect(within(brief).getByText('91%')).toBeInTheDocument();
    expect(within(brief).getByText('512')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('Vehicle 7 · inferred range analysis');
    expect(drawer).toHaveTextContent('exact observation bounds and recording completeness are not supplied');
    expect(within(drawer).getByLabelText('Estimated')).toHaveAttribute('data-provenance', 'inferred');
    expect(drawer).toHaveTextContent('not a vehicle speed');
    expect(drawer).toHaveTextContent('not assumed to be an integer event population');
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps responsive content, vehicle resolution and refresh behavior after the family loads', async () => {
    const refetch = vi.fn();
    const data = makeData({ current_range_km: 350, new_range_km: 500, health_score: 95 });
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
    useProjectedRangeMock.mockReturnValue(makeQuery({ data, refetch }));
    const view = renderWidget({ cols: 1, rows: 2 }, undefined, packId);
    await expectPack(view.container, packId);

    expect(useProjectedRangeMock).toHaveBeenLastCalledWith('42');
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getByText('Excellent')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/EPA:/)).toBeNull();
    expect(screen.queryByText('Range factors')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data\b/i }));
    expect(refetch).toHaveBeenCalledTimes(1);

    view.rerenderWidget({ cols: 2, rows: 2 }, 7);
    await expectPack(view.container, packId);
    expect(useProjectedRangeMock).toHaveBeenLastCalledWith('7');
    expect(screen.getByText('Excellent · 95%')).toBeInTheDocument();
    expect(screen.getByText('EPA: 500 km')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70');
    expect(screen.queryByText('Range factors')).toBeNull();

    useProjectedRangeMock.mockReturnValue(makeQuery({ data, refetch, isFetching: true }));
    view.rerenderWidget({ cols: 2, rows: 2 }, 7);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data\b/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('350')).toBeInTheDocument();
  });

  it('distinguishes invalid or missing readings, genuine zeros and an unavailable EPA denominator', async () => {
    useProjectedRangeMock.mockReturnValue(makeQuery({ data: makeData({
      current_range_km: Number.NaN, new_range_km: Number.POSITIVE_INFINITY,
      health_score: Number.NaN, degradation_pct: Number.NaN, avg_daily_km: Number.POSITIVE_INFINITY,
      current_capacity_pct: Number.NaN, total_cycles: Number.POSITIVE_INFINITY,
    }) }));
    const view = renderWidget({ cols: 3, rows: 4 }, 7, packId);
    await expectPack(view.container, packId);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity|Excellent|Good|Fair|Poor/)).toBeNull();
    expect(screen.queryByText(/EPA:/)).toBeNull();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    const brief = screen.getByTestId('dashboard-projected-range-factors-brief');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(brief).toHaveTextContent('No metric values are available yet.');

    useProjectedRangeMock.mockReturnValue(makeQuery({ data: {} as ProjectedRangeData }));
    view.rerenderWidget();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/Excellent|Good|Fair|Poor|EPA:/)).toBeNull();
    expect(screen.queryByText('No projected range data')).toBeNull();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);

    useProjectedRangeMock.mockReturnValue(makeQuery({ data: makeData({ new_range_km: 500 }) }));
    view.rerenderWidget();
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getByText('Poor · 0%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0% of EPA rated')).toBeInTheDocument();
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(4);
    expect(brief).toHaveTextContent('0 km');

    useProjectedRangeMock.mockReturnValue(makeQuery({ data: makeData() }));
    view.rerenderWidget();
    expect(screen.getByText('EPA: 0 km')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByText(/of EPA rated/)).toBeNull();
  });

  it('preserves loading, empty, retry and retained-error states across presentations', async () => {
    const refetch = vi.fn();
    useProjectedRangeMock.mockReturnValue(makeQuery({ isLoading: true, isFetching: true, refetch }));
    const view = renderWidget({ cols: 3, rows: 4 }, 7, packId);
    expect(screen.getByRole('heading', { name: 'Projected range', level: 3 })).toBeVisible();
    expect(view.container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
    expect(screen.queryByText('No projected range data')).toBeNull();

    useProjectedRangeMock.mockReturnValue(makeQuery({ refetch }));
    view.rerenderWidget();
    await expectPack(view.container, packId);
    expect(screen.getByText('No projected range data')).toBeInTheDocument();
    expect(screen.getByText('Range factors')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByRole('alert')).toBeNull();

    useProjectedRangeMock.mockReturnValue(makeQuery({ isError: true, error: new Error('offline'), refetch }));
    view.rerenderWidget();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No projected range data')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button'));
    expect(refetch).toHaveBeenCalledTimes(1);

    useProjectedRangeMock.mockReturnValue(makeQuery({
      data: makeData({ current_range_km: 350, new_range_km: 500, health_score: 95 }),
      isError: true, error: new Error('refresh failed'), isStale: true, refetch,
    }));
    view.rerenderWidget();
    await expectPack(view.container, packId);
    expect(screen.getByText('350')).toBeInTheDocument();
    expect(screen.getByText('70% of EPA rated')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-projected-range-factors-brief')
      .querySelectorAll('[data-operational-value]')).toHaveLength(4);
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data\b/i }));
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
