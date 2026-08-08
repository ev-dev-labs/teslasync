/**
 * ElevationProfile — behaviour, branch, null-safety, a11y + interaction cover.
 *
 * The component is a presentational leaf: given a pre-shaped
 * `ElevationDataPoint[]` it renders a shared <ChartContainer> wrapping a
 * recharts area series, a gain/loss subtitle, an optional click-to-seek
 * handler and an optional playhead <ReferenceLine>. The interesting logic —
 * the null-safe series guard, the elevation gain/loss reducer, the
 * activeTooltipIndex → `index` mapping (with bounds guard) and the finite
 * cursor-distance guard — is what this file pins.
 *
 * Recharts measures its SVG bounding box and jsdom returns 0 × 0, so the real
 * chart body never paints. We therefore replace the recharts primitives that
 * ElevationProfile uses (re-exported through `@/components/charts`) with light
 * DOM doubles: <AreaChart> renders one focusable <button> per sample plus a
 * few edge-case triggers so we can drive its `onClick({ activeTooltipIndex })`
 * contract deterministically, and <ReferenceLine> renders a marker carrying
 * its `x`. Everything else — <ChartContainer>, <EmptyState>, the gain/loss
 * subtitle — stays real. <ChartContainer> pulls in react-query + react-router
 * (annotation / export wiring), so the tree is wrapped in QueryClientProvider +
 * MemoryRouter and those hooks are stubbed. Network is never touched.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (reached via shared UI) reads it.
// Install a benign stub before any shared module evaluates.
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

// i18n → return the developer fallback string, interpolating {{vars}} so the
// subtitle reads as real numbers. Handles t(key, 'fallback') and
// t(key, 'fallback', { vars }).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (template: string, vars?: Record<string, unknown>) =>
    vars
      ? template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        )
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        if (second && typeof second === 'object') {
          const opts = second as Record<string, unknown>;
          const template = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
          return interpolate(template, opts);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// <ChartContainer> owns the export lifecycle via useChartExport; only inert
// spies are needed so opening the menu never reaches image-capture code.
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));

// <ChartContainer> wires annotation hooks unconditionally; ElevationProfile
// never supplies annotationsConfig, so stub them to no-ops.
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

// Replace the recharts primitives ElevationProfile renders (re-exported by the
// `@/components/charts` barrel) with DOM doubles. All other recharts exports —
// and all non-recharts barrel exports (ChartContainer, fmt, areaGradient …) —
// stay real because we spread the actual module.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  const React = await vi.importActual<typeof import('react')>('react');
   
  const AreaChart = (props: any) => {
    const { children, data, onClick, className } = props;
    const fire = (activeTooltipIndex: unknown) => () =>
      onClick && onClick(activeTooltipIndex === null ? null : { activeTooltipIndex });
    const samples = (Array.isArray(data) ? data : []).map((_: unknown, i: number) =>
      React.createElement(
        'button',
        { key: `s${i}`, type: 'button', 'data-testid': `sample-${i}`, onClick: fire(i) },
        `s${i}`,
      ),
    );
    const edges = [
      React.createElement('button', { key: 'high', type: 'button', 'data-testid': 'sample-oob-high', onClick: fire(9999) }, 'high'),
      React.createElement('button', { key: 'neg', type: 'button', 'data-testid': 'sample-oob-neg', onClick: fire(-1) }, 'neg'),
      React.createElement('button', { key: 'null', type: 'button', 'data-testid': 'sample-null', onClick: fire(null) }, 'null'),
      React.createElement('button', { key: 'noidx', type: 'button', 'data-testid': 'sample-noidx', onClick: () => onClick && onClick({}) }, 'noidx'),
    ];
    // Render the recharts children (gradient <defs>, axes, area, cursor) inside
    // a real <svg> so SVG-cased tags don't trip React's casing warning.
    return React.createElement(
      'div',
      { 'data-testid': 'area-chart', className: className || '' },
      ...samples,
      ...edges,
      React.createElement('svg', { key: 'svg' }, children),
    );
  };
   
  const ResponsiveContainer = (props: any) =>
    React.createElement('div', { 'data-testid': 'responsive-container' }, props.children);
   
  const ReferenceLine = (props: any) =>
    React.createElement('g', { 'data-testid': 'reference-line', 'data-x': String(props.x) });
  const Noop = () => null;
  return {
    ...actual,
    ResponsiveContainer,
    AreaChart,
    ReferenceLine,
    Area: Noop,
    XAxis: Noop,
    YAxis: Noop,
    CartesianGrid: Noop,
    Tooltip: Noop,
  };
});

import { ElevationProfile, type ElevationDataPoint } from './ElevationProfile';

const POPULATED_ARIA = 'Elevation profile chart along the route, with total gain and loss in meters';
const EMPTY_ARIA = 'Elevation profile chart — no data available yet';
const TITLE = 'Elevation Profile';

/** Build a contiguous series; each field defaults to a sensible value. */
function makePoint(over: Partial<ElevationDataPoint> = {}): ElevationDataPoint {
  return { index: 0, distance: 0, elevation: 0, ...over };
}

interface RenderOver {
  data?: ElevationDataPoint[];
  currentIndex?: number;
  onClickIndex?: (index: number) => void;
  distanceUnit?: string;
  className?: string;
}

function renderProfile(over: RenderOver = {}) {
  // Distinguish "data omitted" (use a default) from "data explicitly
  // undefined" (exercise the component's own `data ?? []` guard).
  const data = 'data' in over ? (over.data as ElevationDataPoint[]) : [makePoint()];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ElevationProfile
          data={data}
          currentIndex={over.currentIndex}
          onClickIndex={over.onClickIndex}
          distanceUnit={over.distanceUnit}
          className={over.className}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ElevationProfile — empty / null-safety branch', () => {
  it('renders the empty placeholder (never a blank panel) with the frame still mounted', () => {
    renderProfile({ data: [] });

    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: EMPTY_ARIA })).toBeInTheDocument();
    expect(screen.getByText('No elevation data available')).toBeInTheDocument();
    // No chart body and no playhead in the empty branch.
    expect(screen.queryByTestId('area-chart')).toBeNull();
    expect(screen.queryByTestId('reference-line')).toBeNull();
  });

  it('treats an undefined data prop as empty without crashing (null-safety regression)', () => {
    // A caller whose query has not resolved may pass `undefined`; the pre-fix
    // `data.length` read would throw. `data ?? []` must route to the empty state.
    expect(() =>
      renderProfile({ data: undefined as unknown as ElevationDataPoint[] }),
    ).not.toThrow();
    expect(screen.getByText('No elevation data available')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });
});

describe('ElevationProfile — populated chrome', () => {
  it('mounts the accessible chart frame with one interactive sample per data point', () => {
    renderProfile({
      data: [
        makePoint({ index: 0, distance: 0, elevation: 100 }),
        makePoint({ index: 1, distance: 1, elevation: 120 }),
        makePoint({ index: 2, distance: 2, elevation: 90 }),
      ],
    });

    expect(screen.getByRole('heading', { level: 3, name: TITLE })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: POPULATED_ARIA })).toBeInTheDocument();
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^sample-\d+$/)).toHaveLength(3);
    // Not the empty placeholder, and no cursor without a currentIndex.
    expect(screen.queryByText('No elevation data available')).toBeNull();
    expect(screen.queryByTestId('reference-line')).toBeNull();
  });

  it('passes className through to the figure and renders a custom distanceUnit without crashing', () => {
    const { container } = renderProfile({
      data: [makePoint({ elevation: 10 }), makePoint({ index: 1, distance: 3, elevation: 20 })],
      className: 'my-elevation-panel',
      distanceUnit: 'mi',
    });

    const figure = container.querySelector('figure');
    expect(figure).not.toBeNull();
    expect(figure?.className).toContain('my-elevation-panel');
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });
});

describe('ElevationProfile — elevation gain/loss subtitle', () => {
  it('reduces the series into rounded total gain and loss shown in the subtitle', () => {
    // deltas: +50, -30, +10  → gain 60, loss 30
    renderProfile({
      data: [
        makePoint({ index: 0, distance: 0, elevation: 100 }),
        makePoint({ index: 1, distance: 1, elevation: 150 }),
        makePoint({ index: 2, distance: 2, elevation: 120 }),
        makePoint({ index: 3, distance: 3, elevation: 130 }),
      ],
    });

    expect(screen.getByText(/↑\s*60m\s*↓\s*30m/)).toBeInTheDocument();
  });

  it('coerces null elevation samples to 0 so the subtitle never renders NaN (regression)', () => {
    renderProfile({
      data: [
        makePoint({ index: 0, distance: 0, elevation: 100 }),
        makePoint({ index: 1, distance: 1, elevation: null as unknown as number }),
        makePoint({ index: 2, distance: 2, elevation: 130 }),
      ],
    });

    const subtitle = screen.getByText(/↑/);
    expect(subtitle.textContent).not.toContain('NaN');
    // (null→0): loss = |0-100| = 100, gain = 130-0 = 130.
    expect(subtitle.textContent).toMatch(/↑\s*130m/);
    expect(subtitle.textContent).toMatch(/↓\s*100m/);
  });
});

describe('ElevationProfile — click-to-seek', () => {
  const clickable = [
    makePoint({ index: 10, distance: 0, elevation: 100 }),
    makePoint({ index: 11, distance: 1, elevation: 150 }),
    makePoint({ index: 12, distance: 2, elevation: 120 }),
  ];

  it('emits the sample\'s own `index` (not its array position) via onClickIndex', () => {
    const onClickIndex = vi.fn();
    renderProfile({ data: clickable, onClickIndex });

    fireEvent.click(screen.getByTestId('sample-2'));

    // Array position 2 maps to point.index === 12 — proves the mapping.
    expect(onClickIndex).toHaveBeenCalledTimes(1);
    expect(onClickIndex).toHaveBeenCalledWith(12);
  });

  it('ignores clicks with an out-of-range, missing, or null active index (bounds guard)', () => {
    const onClickIndex = vi.fn();
    renderProfile({ data: clickable, onClickIndex });

    fireEvent.click(screen.getByTestId('sample-oob-high'));
    fireEvent.click(screen.getByTestId('sample-oob-neg'));
    fireEvent.click(screen.getByTestId('sample-null'));
    fireEvent.click(screen.getByTestId('sample-noidx'));

    expect(onClickIndex).not.toHaveBeenCalled();
  });

  it('is inert (and does not throw) when onClickIndex is omitted', () => {
    renderProfile({ data: clickable });

    expect(() => fireEvent.click(screen.getByTestId('sample-1'))).not.toThrow();
    // Without a seek handler the plot area is not marked interactive.
    expect(screen.getByTestId('area-chart')).not.toHaveClass('cursor-pointer');
  });

  it('marks the plot area with cursor-pointer when onClickIndex is provided', () => {
    renderProfile({ data: clickable, onClickIndex: vi.fn() });
    expect(screen.getByTestId('area-chart')).toHaveClass('cursor-pointer');
  });
});

describe('ElevationProfile — playhead cursor', () => {
  const cursored = [
    makePoint({ index: 0, distance: 0, elevation: 100 }),
    makePoint({ index: 1, distance: 10, elevation: 150 }),
    makePoint({ index: 2, distance: 20, elevation: 120 }),
  ];

  it('draws the reference line at the current point\'s distance', () => {
    renderProfile({ data: cursored, currentIndex: 1 });

    const line = screen.getByTestId('reference-line');
    expect(line).toBeInTheDocument();
    expect(line).toHaveAttribute('data-x', '10');
  });

  it('hides the cursor when currentIndex is out of range', () => {
    renderProfile({ data: cursored, currentIndex: 99 });
    expect(screen.queryByTestId('reference-line')).toBeNull();
  });

  it('hides the cursor when the current point distance is non-finite (finite guard)', () => {
    renderProfile({
      data: [
        makePoint({ index: 0, distance: Number.NaN, elevation: 100 }),
        makePoint({ index: 1, distance: 10, elevation: 150 }),
      ],
      currentIndex: 0,
    });
    expect(screen.queryByTestId('reference-line')).toBeNull();
  });
});
