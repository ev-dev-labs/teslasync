/**
 * LocationLeaderboardPanel — contract, branch, hardening + a11y cover.
 *
 * The panel is a presentational, self-contained view over a pre-shaped
 * `LeaderboardDatum[]` plus the loading / error flags its parent owns. It never
 * fetches, so the tests drive it directly with hand-built props rather than
 * mocking the network.
 *
 * Recharts renders 0×0 under jsdom (no layout engine), so the real BarChart
 * never paints its SVG/bars — which would make the component's own wiring (the
 * `value` bar's key/name/fill/radius, the category Y axis, the numeric X axis,
 * the grid, and the tooltip cursor) invisible to the DOM. Following the repo
 * convention (see SentryModeChart / PowerHistoryChart tests) we swap the shared
 * `@/components/charts` barrel for lightweight doubles that surface `data` and
 * each series' props as inspectable attributes. Only the pixel-pushing chart
 * library is stubbed; the panel's own logic (the branch order, the row
 * normalisation, and the responsive height maths) still runs. The real
 * GlassPanel / PanelTitle / Skeleton / EmptyState / QueryError render for real
 * so the loading / error / empty chrome is exercised end-to-end.
 *
 * Facets covered:
 *   1. Panel chrome — the titled heading + icon stay visible in every state so
 *      the panel is never a blank rectangle.
 *   2. Ready data   — every normalised row reaches the chart in a labelled `img`
 *      region; the container layout + row payload are wired.
 *   3. Ready series — the value bar wires the series label, dynamic colour, and
 *      rounded-right radius; props are forwarded (not hardcoded).
 *   4. Ready axes   — category Y axis on `name`, numeric X axis (no decimals),
 *      grid, and the tooltip cursor object.
 *   5. Height       — floors at 240px, grows per row, and caps at 15 rows.
 *   6. Loading      — a skeleton (not the chart); loading wins over a concurrent
 *      error + data.
 *   7. Error        — a retry-able QueryError, `onRetry` forwarded, chart hidden
 *      even with data present.
 *   8. Empty        — the caller's empty-state message, no chart.
 *   9. Null-safety  — an (untyped-at-runtime) undefined `data` prop renders the
 *      empty state instead of throwing on `.length` / `.map`.
 *  10. Hardening    — missing / invalid values remain unknown, genuine zero
 *      survives, missing names use an em dash, and caller data is not mutated.
 *  11. Display     — saved numeric preferences reach ticks, tooltips and the
 *      real accessible fallback table without rounding chart input.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps, ReactNode } from 'react';
import {
  getFormatterPreferences, setGlobalLocale, setGlobalPrecision,
} from '@/lib/numberFormat';

const displayProbe = vi.hoisted(() => ({ value: 1234.567, realFrame: false }));
const initialPreferences = getFormatterPreferences();

/* ── i18n: resolve t(key, fallback) → fallback so QueryError's copy is
 *    deterministic and locale-file independent. ─────────────────────────── */
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

/* ── charts: surface the data payload + per-series props for inspection. The
 *    real Recharts primitives would paint nothing under jsdom. ──────────── */
vi.mock('@/components/charts', async () => {
  const actual = await vi.importActual<typeof import('@/components/charts')>('@/components/charts');
  return {
  ...(await import('@/test/chartTestDoubles')).chartTestDoubles,
  EmbeddedChart: (props: ComponentProps<typeof actual.EmbeddedChart>) => displayProbe.realFrame ? (
    <actual.EmbeddedChart {...props} />
  ) : (
    <div role="img" aria-label={props.ariaLabel} data-height={String(props.height ?? '')}>
      {props.children as ReactNode}
    </div>
  ),
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({
    data,
    layout,
    margin,
    children,
  }: {
    data?: ReadonlyArray<Record<string, unknown>>;
    layout?: string;
    margin?: Record<string, number>;
    children?: ReactNode;
  }) => (
    <div
      data-testid="bar-chart"
      data-count={String((data ?? []).length)}
      data-layout={String(layout)}
      data-margin={JSON.stringify(margin ?? null)}
      data-rows={JSON.stringify(data ?? [])}
    >
      {children}
    </div>
  ),
  Bar: ({
    dataKey,
    name,
    fill,
    radius,
  }: {
    dataKey?: string;
    name?: string;
    fill?: string;
    radius?: number | number[];
  }) => (
    <div
      data-testid="bar"
      data-key={String(dataKey)}
      data-name={String(name)}
      data-fill={String(fill)}
      data-radius={JSON.stringify(radius ?? null)}
    />
  ),
  XAxis: ({
    type,
    allowDecimals,
    tickFormatter,
  }: {
    type?: string;
    allowDecimals?: boolean;
    tickFormatter?: (value: unknown) => string;
  }) => (
    <div
      data-testid="x-axis"
      data-type={String(type)}
      data-allow-decimals={String(allowDecimals)}
    >
      <span data-testid="axis-value">{tickFormatter?.(displayProbe.value)}</span>
    </div>
  ),
  YAxis: ({
    dataKey,
    type,
    width,
  }: {
    dataKey?: string;
    type?: string;
    width?: number;
  }) => (
    <div
      data-testid="y-axis"
      data-key={String(dataKey)}
      data-type={String(type)}
      data-width={String(width)}
    />
  ),
  Tooltip: ({ cursor, content, filterNull }: {
    cursor?: unknown;
    content?: ReactNode;
    filterNull?: boolean;
  }) => (
    <div
      data-testid="tooltip"
      data-cursor={JSON.stringify(cursor ?? null)}
      data-filter-null={String(filterNull)}
    >
      {content}
    </div>
  ),
  ChartTooltip: ({ valueFormatter }: {
    valueFormatter?: (value: unknown, name: string) => ReactNode;
  }) => (
    <span data-testid="tooltip-value">{valueFormatter?.(displayProbe.value, 'Visits')}</span>
  ),
  chartGrid: <div data-testid="chart-grid" />,
  axisTickSm: {},
  };
});

import {
  LocationLeaderboardPanel,
  type LeaderboardDatum,
} from './LocationLeaderboardPanel';

type PanelProps = ComponentProps<typeof LocationLeaderboardPanel>;

const ICON_TESTID = 'panel-icon';
const ARIA = 'Bar chart of the most-visited locations';

function datum(overrides: Partial<LeaderboardDatum> = {}): LeaderboardDatum {
  return { name: 'Home', value: 12, ...overrides };
}

function baseProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    title: 'Top Locations by Visits',
    icon: <span data-testid={ICON_TESTID} aria-hidden="true" />,
    seriesLabel: 'Visits',
    color: '#10b981',
    data: [datum({ name: 'Home', value: 12 }), datum({ name: 'Work', value: 8 })],
    loading: false,
    error: undefined,
    emptyMessage: 'No visited location data',
    ariaLabel: ARIA,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props = baseProps({ ...overrides, onRetry });
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LocationLeaderboardPanel {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, onRetry };
}

afterEach(() => {
  cleanup();
  displayProbe.value = 1234.567;
  displayProbe.realFrame = false;
  setGlobalLocale(initialPreferences.locale);
  setGlobalPrecision(initialPreferences.precision);
});

describe('LocationLeaderboardPanel — panel chrome', () => {
  it('keeps the titled heading + icon visible in every state so it is never blank', () => {
    const cases: Partial<PanelProps>[] = [
      {}, // ready
      { loading: true }, // loading
      { error: new Error('x') }, // error
      { data: [] }, // empty
    ];
    for (const props of cases) {
      const { unmount } = renderPanel(props);
      expect(
        screen.getByRole('heading', { name: 'Top Locations by Visits' }),
      ).toBeInTheDocument();
      // The decorative icon is passed through before the title.
      expect(screen.getByTestId(ICON_TESTID)).toBeInTheDocument();
      unmount();
    }
  });
});

describe('LocationLeaderboardPanel — ready state', () => {
  it('feeds every row to a vertical bar chart inside a labelled img region', () => {
    renderPanel({
      data: [
        datum({ name: 'Home', value: 12 }),
        datum({ name: 'Work', value: 8 }),
        datum({ name: 'Gym', value: 3 }),
      ],
    });

    const chart = screen.getByTestId('bar-chart');
    expect(chart).toHaveAttribute('data-count', '3');
    expect(chart).toHaveAttribute('data-layout', 'vertical');
    expect(JSON.parse(chart.getAttribute('data-rows') ?? '[]')).toEqual([
      { name: 'Home', value: 12 },
      { name: 'Work', value: 8 },
      { name: 'Gym', value: 3 },
    ]);

    // The chart body is wrapped in an accessible, labelled image region.
    const img = screen.getByRole('img', { name: ARIA });
    expect(img).toContainElement(chart);
  });

  it('wires the value bar with the series label, dynamic colour, and rounded-right radius', () => {
    renderPanel({ seriesLabel: 'Visits', color: '#10b981' });

    const bar = screen.getByTestId('bar');
    expect(bar).toHaveAttribute('data-key', 'value');
    expect(bar).toHaveAttribute('data-name', 'Visits');
    expect(bar).toHaveAttribute('data-fill', '#10b981');
    expect(JSON.parse(bar.getAttribute('data-radius') ?? 'null')).toEqual([0, 4, 4, 0]);
  });

  it('configures the category Y axis, numeric no-decimals X axis, grid, and tooltip cursor', () => {
    renderPanel();

    const y = screen.getByTestId('y-axis');
    expect(y).toHaveAttribute('data-key', 'name');
    expect(y).toHaveAttribute('data-type', 'category');
    expect(y).toHaveAttribute('data-width', '112');

    const x = screen.getByTestId('x-axis');
    expect(x).toHaveAttribute('data-type', 'number');
    expect(x).toHaveAttribute('data-allow-decimals', 'false');

    expect(screen.getByTestId('chart-grid')).toBeInTheDocument();
    expect(
      JSON.parse(screen.getByTestId('tooltip').getAttribute('data-cursor') ?? 'null'),
    ).toEqual({ fill: 'var(--surface-2)', opacity: 0.4 });
    expect(screen.getByTestId('tooltip')).toHaveAttribute('data-filter-null', 'false');
  });

  it('forwards a different colour, series label, and aria description (props are not hardcoded)', () => {
    renderPanel({
      color: '#a855f7',
      seriesLabel: 'Hours',
      ariaLabel: 'Bar chart of time spent per location',
    });

    const bar = screen.getByTestId('bar');
    expect(bar).toHaveAttribute('data-fill', '#a855f7');
    expect(bar).toHaveAttribute('data-name', 'Hours');
    expect(
      screen.getByRole('img', { name: 'Bar chart of time spent per location' }),
    ).toBeInTheDocument();
  });
});

describe('LocationLeaderboardPanel — responsive height', () => {
  it('floors the chart height at 240px for a short list', () => {
    renderPanel({ data: [datum(), datum({ name: 'Work' })] }); // 2 rows → floor
    expect(screen.getByRole('img', { name: ARIA })).toHaveAttribute('data-height', '240');
  });

  it('grows the chart height with the row count (34px per row)', () => {
    const rows = Array.from({ length: 8 }, (_, i) => datum({ name: `L${i}`, value: i }));
    renderPanel({ data: rows }); // 8 * 34 = 272
    expect(screen.getByRole('img', { name: ARIA })).toHaveAttribute('data-height', '272');
  });

  it('caps the chart height at 15 rows so a long list stays bounded', () => {
    const rows = Array.from({ length: 25 }, (_, i) => datum({ name: `L${i}`, value: i }));
    renderPanel({ data: rows }); // min(25, 15) * 34 = 510
    expect(screen.getByRole('img', { name: ARIA })).toHaveAttribute('data-height', '510');
  });
});

describe('LocationLeaderboardPanel — loading state', () => {
  it('shows a skeleton (not the chart) while loading', () => {
    const { container } = renderPanel({ loading: true });

    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('prefers the loading skeleton over a concurrent error + populated data', () => {
    const { container } = renderPanel({
      loading: true,
      error: new Error('boom'),
      data: [datum()],
    });

    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
});

describe('LocationLeaderboardPanel — error state', () => {
  it('renders a retry-able error, forwards onRetry, and hides the chart even with data present', () => {
    const { onRetry } = renderPanel({
      error: new Error('boom'),
      data: [datum()], // error must win even with data present
    });

    // Plain Error (no ApiError.status) → QueryError's online network branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('LocationLeaderboardPanel — empty + null safety', () => {
  it("shows the caller's empty-state message (no chart) for an empty dataset", () => {
    renderPanel({ data: [], emptyMessage: 'No visited location data' });

    expect(screen.getByText('No visited location data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument(); // EmptyState role
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('is null-safe: an undefined data prop renders the empty state instead of throwing', () => {
    expect(() =>
      renderPanel({ data: undefined as unknown as LeaderboardDatum[] }),
    ).not.toThrow();

    expect(screen.getByText('No visited location data')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
});

describe('LocationLeaderboardPanel — hardening (row normalisation)', () => {
  it('keeps nullish / non-finite values unknown and missing names as an em dash', () => {
    renderPanel({
      data: [
        datum({ name: undefined as unknown as string, value: null as unknown as number }),
        datum({ name: 'Work', value: Number.NaN }),
        datum({ name: 'Gym', value: 5 }),
      ],
    });

    const rows = JSON.parse(
      screen.getByTestId('bar-chart').getAttribute('data-rows') ?? '[]',
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ name: '—', value: null });
    expect(rows[1]).toEqual({ name: 'Work', value: null });
    expect(rows[2]).toEqual({ name: 'Gym', value: 5 });
  });

  it("does not mutate the caller's data array", () => {
    const original = Object.freeze([
      Object.freeze(datum({ name: 'Home', value: 1234.567 })),
      Object.freeze(datum({ name: 'Missing', value: undefined })),
      Object.freeze(datum({ name: 'Invalid', value: Number.NaN })),
      Object.freeze(datum({ name: 'Negative', value: -1 })),
      Object.freeze(datum({ name: 'Zero', value: 0 })),
    ]);
    const snapshot = original.map((row) => ({ ...row }));

    renderPanel({ data: original });

    expect(original).toEqual(snapshot);
    expect(original[2].value).toBeNaN();
  });

  it.each([
    ['missing', undefined], ['null', null], ['NaN', Number.NaN],
    ['infinity', Infinity], ['negative infinity', -Infinity], ['negative', -1],
    ['numeric string', '12'], ['empty string', ''], ['boolean', false],
  ])('keeps %s unknown without discarding its row or valid zero', (_label, value) => {
    renderPanel({
      data: [
        datum({ name: 'Unknown', value: value as number | null | undefined }),
        datum({ name: 'Zero', value: 0 }),
        datum({ name: 'Measured', value: 1234.567 }),
      ],
    });

    expect(JSON.parse(screen.getByTestId('bar-chart').getAttribute('data-rows') ?? '[]')).toEqual([
      { name: 'Unknown', value: null },
      { name: 'Zero', value: 0 },
      { name: 'Measured', value: 1234.567 },
    ]);
  });
});

describe('LocationLeaderboardPanel — saved numeric preferences', () => {
  it('updates ticks, tooltip and the real fallback table without changing plotted values', () => {
    displayProbe.realFrame = true;
    setGlobalLocale('de-DE');
    setGlobalPrecision(3);
    const original = Object.freeze([
      Object.freeze(datum({ name: 'Home', value: 1234.567 })),
      Object.freeze(datum({ name: 'Zero', value: 0 })),
      Object.freeze(datum({ name: 'Missing', value: null })),
      Object.freeze(datum({ name: 'Invalid', value: -1 })),
    ]);
    renderPanel({ data: original });

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Visits' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '1.234,567' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '0,000' })).toBeInTheDocument();
    expect(within(table).getAllByRole('cell', { name: '—' })).toHaveLength(2);
    expect(screen.getByTestId('axis-value')).toHaveTextContent('1.234,567');
    expect(screen.getByTestId('tooltip-value')).toHaveTextContent('1.234,567');
    const chartRows = screen.getByTestId('bar-chart').getAttribute('data-rows');

    act(() => {
      setGlobalLocale('en-US');
      setGlobalPrecision(1);
    });

    expect(within(table).getByRole('cell', { name: '1,234.6' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '0.0' })).toBeInTheDocument();
    expect(within(table).getAllByRole('cell', { name: '—' })).toHaveLength(2);
    expect(screen.getByTestId('axis-value')).toHaveTextContent('1,234.6');
    expect(screen.getByTestId('tooltip-value')).toHaveTextContent('1,234.6');
    expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-rows', chartRows);
    expect(original[0].value).toBe(1234.567);
    expect(original[2].value).toBeNull();
    expect(original[3].value).toBe(-1);
  });

  it.each([null, undefined, Number.NaN, Infinity, -Infinity, -1, '12', false])(
    'formats invalid tick/tooltip probes as unknown (%s)',
    (value) => {
      displayProbe.value = value as number;
      renderPanel();
      expect(screen.getByTestId('axis-value')).toHaveTextContent('—');
      expect(screen.getByTestId('tooltip-value')).toHaveTextContent('—');
    },
  );

  it('keeps the empty-filter reset action available', () => {
    const onResetFilters = vi.fn();
    renderPanel({ data: [], emptyActionLabel: 'Reset date range', onResetFilters });
    fireEvent.click(screen.getByRole('button', { name: 'Reset date range' }));
    expect(onResetFilters).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Top Locations by Visits' })).toBeInTheDocument();
  });
});
