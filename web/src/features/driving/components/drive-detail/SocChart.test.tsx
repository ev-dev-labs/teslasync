/**
 * SocChart — contract, branch, hardening + a11y cover.
 *
 * <SocChart chartData /> is the presentational SOC-%-over-time area chart in
 * the Drive Detail stack. It never fetches: the parent hands it the pre-shaped
 * `ChartDataPoint[]` produced by `useDriveDetailData`, so the tests drive it
 * directly with hand-built samples.
 *
 * Recharts renders 0×0 under jsdom (no layout engine), so the real `<AreaChart>`
 * never paints its SVG — which would make the component's own wiring (the
 * `battery` series key, the emerald stroke, the `socGrad` fill, the 0–100
 * Y-domain, the `time` X key, and the synced-cursor reference line) invisible
 * to the DOM. Following the repo convention (see PowerHistoryChart /
 * SentryModeChart tests) we swap the shared `@/components/charts` barrel for
 * lightweight doubles that surface those props as inspectable attributes. Only
 * the pixel-pushing chart library + container chrome are stubbed; SocChart's
 * own logic (the `> 1`-sample branch, the null guard, the cursor-token wiring,
 * and the decorative-icon a11y contract) still runs.
 *
 * The two synced-cursor hooks are mocked through a `vi.hoisted` holder so each
 * test can decide whether another chart in the group has been hovered
 * (`syncedX`) and can assert that hover events are forwarded to the store.
 *
 * Facets covered:
 *   1. READY chrome  — titled heading, labelled `img` region, fixed 220px
 *                      height, and the `h-full` className passthrough.
 *   2. READY series  — every sample reaches the chart; the SOC area is keyed on
 *                      `battery` with the emerald stroke / `socGrad` fill / name.
 *   3. READY axes    — Y clamps to a 0–100 percent domain, X keys on `time`,
 *                      and the gradient + tooltip + grid mount.
 *   4. CURSOR idle   — no reference line until a sibling chart is hovered.
 *   5. CURSOR active — the persistent reference line renders at the synced x
 *                      with the shared cursor tokens.
 *   6. CURSOR wiring — the sync id/method are spread and hover is forwarded to
 *                      the cursor-sync store.
 *   7. EMPTY (0)     — the placeholder shows, no chart, decorative icon hidden.
 *   8. THRESHOLD (1) — a lone sample is not chartable (`> 1`) → placeholder.
 *   9. NULL-SAFE     — an (untyped-at-runtime) undefined data prop renders the
 *                      placeholder instead of throwing on `.length`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

import { chartTokens } from '@/lib/tokens';
import type { ChartDataPoint } from './types';

// ── Controllable synced-cursor state shared with the hoisted charts mock. ──
const H = vi.hoisted(() => ({
  syncedX: null as string | number | null,
  onMouseMove: vi.fn(),
}));

// i18n stub: resolve the fallback string so assertions read real user copy.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// charts: prop-echoing doubles. Recharts' <ResponsiveContainer> measures 0×0
// under jsdom, so the real chart never paints — the doubles surface the wiring.
vi.mock('@/components/charts', () => ({
  ChartContainer: ({
    title,
    ariaLabel,
    height,
    className,
    children,
  }: {
    title?: string;
    ariaLabel?: string;
    height?: number;
    className?: string;
    children?: ReactNode;
  }) => (
    <section data-testid="chart-container" data-height={String(height ?? '')} className={className}>
      <h3>{title}</h3>
      {/* Mirror the real container: a labelled img region wrapping the body. */}
      <div role="img" aria-label={ariaLabel}>
        {children}
      </div>
    </section>
  ),
  ChartTooltip: () => null,
  AREA_DEFAULTS: {},
  areaGradient: (id: string, color: string) => (
    <div data-testid="area-gradient" data-id={id} data-color={color} />
  ),
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({
    data,
    syncId,
    syncMethod,
    onMouseMove,
    children,
  }: {
    data?: unknown[];
    syncId?: string;
    syncMethod?: string;
    onMouseMove?: (state: { activeLabel?: string | number } | null) => void;
    children?: ReactNode;
  }) => (
    <div
      data-testid="area-chart"
      data-count={String((data ?? []).length)}
      data-syncid={String(syncId ?? '')}
      data-syncmethod={String(syncMethod ?? '')}
      onMouseMove={() => onMouseMove?.({ activeLabel: '08:01' })}
    >
      {children}
    </div>
  ),
  Area: ({
    dataKey,
    stroke,
    fill,
    name,
  }: {
    dataKey?: string;
    stroke?: string;
    fill?: string;
    name?: string;
  }) => (
    <div
      data-testid="area"
      data-key={String(dataKey)}
      data-stroke={String(stroke)}
      data-fill={String(fill)}
      data-name={String(name)}
    />
  ),
  ReferenceLine: ({
    x,
    stroke,
    strokeWidth,
    strokeDasharray,
  }: {
    x?: string | number;
    stroke?: string;
    strokeWidth?: number;
    strokeDasharray?: string;
  }) => (
    <div
      data-testid="reference-line"
      data-x={String(x)}
      data-stroke={String(stroke)}
      data-stroke-width={String(strokeWidth)}
      data-dash={String(strokeDasharray)}
    />
  ),
  XAxis: ({ dataKey }: { dataKey?: string }) => <div data-testid="x-axis" data-key={String(dataKey)} />,
  YAxis: ({ domain }: { domain?: unknown }) => (
    <div data-testid="y-axis" data-domain={JSON.stringify(domain ?? null)} />
  ),
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  useSyncedCursor: () => ({ syncId: 'drive-detail', syncMethod: 'index', onMouseMove: H.onMouseMove }),
  useSyncedReferenceLineX: () => H.syncedX,
}));

// jsdom lacks matchMedia (framer-motion's useReducedMotion via <FadeIn>).
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

import { SocChart } from './SocChart';

// Minimal per-sample fixture — SocChart only reads `time` (X) and `battery`
// (the SOC series); the remaining ChartDataPoint fields are irrelevant here.
function point(overrides: Partial<ChartDataPoint> = {}): ChartDataPoint {
  return {
    time: '08:00',
    speed: 0,
    battery: 80,
    elevation: 0,
    power: 0,
    outsideTemp: null,
    insideTemp: null,
    driverTemp: null,
    passengerTemp: null,
    idealRange: null,
    ratedRange: null,
    estRange: null,
    odometer: null,
    soc: null,
    usableSoc: null,
    tireFl: null,
    tireFr: null,
    tireRl: null,
    tireRr: null,
    climateOn: null,
    fanStatus: null,
    ...overrides,
  };
}

const twoSamples = (): ChartDataPoint[] => [
  point({ time: '08:00', battery: 82 }),
  point({ time: '08:01', battery: 81 }),
];

beforeEach(() => {
  H.syncedX = null;
  H.onMouseMove = vi.fn();
});

afterEach(cleanup);

describe('SocChart — ready state', () => {
  it('renders the titled, labelled chart figure at the fixed 220px drive-detail height', () => {
    render(<SocChart chartData={twoSamples()} />);

    expect(screen.getByRole('heading', { name: 'SOC % Over Time' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'State of charge percent over time area chart' }),
    ).toBeInTheDocument();
    const container = screen.getByTestId('chart-container');
    expect(container).toHaveAttribute('data-height', '220');
    expect(container).toHaveClass('h-full');
  });

  it('feeds every sample to the area chart and wires the SOC series to the battery field', () => {
    render(
      <SocChart
        chartData={[
          point({ time: '08:00', battery: 90 }),
          point({ time: '08:01', battery: 88 }),
          point({ time: '08:02', battery: 86 }),
        ]}
      />,
    );

    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-count', '3');

    const area = screen.getByTestId('area');
    expect(area).toHaveAttribute('data-key', 'battery');
    expect(area).toHaveAttribute('data-stroke', '#10b981');
    expect(area).toHaveAttribute('data-fill', 'url(#socGrad)');
    expect(area).toHaveAttribute('data-name', 'SOC %');
  });

  it('clamps the Y axis to a 0–100 percent domain, keys X on time, and mounts the gradient, tooltip, and grid', () => {
    render(<SocChart chartData={twoSamples()} />);

    // SOC is a percentage — a fixed 0–100 domain stops recharts auto-scaling
    // a flat trace into a misleadingly dramatic zoom.
    expect(screen.getByTestId('y-axis')).toHaveAttribute('data-domain', '[0,100]');
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'time');

    const gradient = screen.getByTestId('area-gradient');
    expect(gradient).toHaveAttribute('data-id', 'socGrad');
    expect(gradient).toHaveAttribute('data-color', '#10b981');

    expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    expect(screen.getByTestId('cartesian-grid')).toBeInTheDocument();
  });
});

describe('SocChart — synced cursor', () => {
  it('omits the persistent reference line until another chart in the group is hovered', () => {
    H.syncedX = null;
    render(<SocChart chartData={twoSamples()} />);

    expect(screen.queryByTestId('reference-line')).not.toBeInTheDocument();
  });

  it('draws the persistent cursor reference line at the synced x using the shared cursor tokens', () => {
    H.syncedX = '08:01';
    render(<SocChart chartData={twoSamples()} />);

    const line = screen.getByTestId('reference-line');
    expect(line).toHaveAttribute('data-x', '08:01');
    expect(line).toHaveAttribute('data-stroke', chartTokens.cursor.stroke);
    expect(line).toHaveAttribute('data-stroke-width', String(chartTokens.cursor.strokeWidth));
    expect(line).toHaveAttribute('data-dash', chartTokens.cursor.strokeDasharray);
  });

  it('spreads the sync id/method onto the chart and forwards hover to the cursor-sync store', () => {
    render(<SocChart chartData={twoSamples()} />);

    const chart = screen.getByTestId('area-chart');
    expect(chart).toHaveAttribute('data-syncid', 'drive-detail');
    expect(chart).toHaveAttribute('data-syncmethod', 'index');

    // The onMouseMove handler from useSyncedCursor must be wired onto the chart
    // so hovering this chart moves every synced sibling's cursor in lockstep.
    expect(H.onMouseMove).not.toHaveBeenCalled();
    fireEvent.mouseMove(chart);
    expect(H.onMouseMove).toHaveBeenCalledTimes(1);
    expect(H.onMouseMove).toHaveBeenCalledWith({ activeLabel: '08:01' });
  });
});

describe('SocChart — empty + null safety', () => {
  it('shows the empty telemetry placeholder (no chart, decorative icon hidden) when there are no samples', () => {
    render(<SocChart chartData={[]} />);

    expect(screen.getByText('No telemetry data available')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('area')).not.toBeInTheDocument();

    // The Activity glyph is decorative: the copy carries the message, so the
    // icon must be pulled out of the accessibility tree.
    const region = screen.getByRole('img', {
      name: 'State of charge percent over time area chart',
    });
    const icon = region.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('treats a single lone sample as not chartable and shows the placeholder (a line needs >1 point)', () => {
    render(<SocChart chartData={[point({ time: '08:00', battery: 80 })]} />);

    expect(screen.getByText('No telemetry data available')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('is null-safe: an undefined chartData renders the placeholder instead of throwing on .length', () => {
    expect(() =>
      render(<SocChart chartData={undefined as unknown as ChartDataPoint[]} />),
    ).not.toThrow();

    expect(screen.getByText('No telemetry data available')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });
});
