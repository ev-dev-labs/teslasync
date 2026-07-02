import { forwardRef, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tag, Plus, Eye, EyeOff } from 'lucide-react';
import type uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/feedback/Spinner';
import { EmptyState } from '@/components/feedback/EmptyState';
import { SectionErrorBoundary } from '@/components/feedback/SectionErrorBoundary';
import { Button } from '@/components/ui/Button';
import { FullscreenButton } from '@/components/ui/FullscreenButton';
import { VisuallyHidden } from '@/components/a11y';
import { useChartExport } from '@/hooks/useChartExport';
import { downloadCSV, objectsToCSV, defaultExportFilename, type CsvCellValue } from '@/lib/csvExport';
import { getLangDir, textAnchorForDir, type Direction } from '@/lib/i18nDir';
import { CHART_COLORS } from '@/lib/colors';
import { fmtNumber } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import { AnnotationList } from './AnnotationList';
import { AddAnnotationPopover } from './AddAnnotationPopover';
import { ChartExportMenu } from './ChartExportMenu';
import { ChartHiddenSeriesProvider } from './ChartHiddenSeriesContext';
import {
  useChartAnnotationsAsData,
  useCreateAnnotation,
  useDeleteAnnotation,
} from '@/api/hooks/useAnnotations';
import type { AnnotationCategory, AnnotationScope, DataAnnotation } from '@/types/annotations';
import type { HiddenSeriesState } from '@/hooks/useHiddenSeries';

/**
 * Annotation integration helper. When `annotations` is
 * supplied, `<ChartContainer>` fetches the matching rows from the backend,
 * adds an "Add annotation" + "Hide annotations" toggle to the header, manages
 * the AddAnnotationPopover modal, and renders the AnnotationList footer. The
 * chart consumer renders the actual `<ReferenceLine>` overlays via the
 * function-children render-prop pattern.
 */
export interface ChartAnnotationsConfig {
  vehicleId?: number | null;
  scope: AnnotationScope;
  /** Stable id for persisting the "Hide annotations" toggle. Defaults to title. */
  chartId?: string;
}

export interface ChartContainerRenderProps {
  annotations: DataAnnotation[];
  /** True when the user has toggled annotations off. Children should skip
   *  rendering `<ReferenceLine>`s in this case. */
  hidden: boolean;
  /**
   * URL-persisted hidden-series toggle state. Only
   * non-null when the surrounding `<ChartContainer>` was given a
   * `chartKey` prop (which both opts the chart into URL state AND sets up
   * a `<ChartHiddenSeriesContext>` for the legend). Pages typically wire
   * the returned state into `<Line hide={hiddenSeries?.isHidden('foo')}/>`.
   */
  hiddenSeries: HiddenSeriesState | null;
}

type ChartContainerChildren =
  | React.ReactNode
  | ((ctx: ChartContainerRenderProps) => React.ReactNode);

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  empty?: boolean;
  height?: number;
  action?: React.ReactNode;
  children?: ChartContainerChildren;
  className?: string;
  /**
   * Render the `<ChartExportMenu>` (PNG / SVG /
   * Copy-image, plus CSV when `exportData` is supplied) in the title-bar
   * action area.
   * Defaults to `true` because every `<ChartContainer>` ships with a
   * mandatory `ariaLabel`, which is the same
   * "is this chart shareable?" precondition the export menu checks.
   * Pass `exportable={false}` to explicitly opt out (e.g. for tour
   * step-throughs or print-only contexts).
   * The menu is also auto-hidden while the chart is in `loading` or
   * `empty` states because there's no captured image worth sharing yet.
   */
  exportable?: boolean;
  exportFilename?: string;
  /** When set, exposes "Download data as CSV" in the
   *  chart's overflow menu. The data is serialized via `objectsToCSV`. */
  exportData?: ReadonlyArray<Record<string, CsvCellValue>>;
  /** When set, the container takes ownership of the
   *  full annotation flow (fetch, add, delete, hide). Children should be a
   *  function so they can read the visible annotations from context. */
  annotations?: ChartAnnotationsConfig;
  /**
   * Required accessible name for the chart figure.
   * Recharts SVGs are otherwise an opaque "graphics-document" to assistive
   * tech. Pass a one-sentence description such as
   * `"Daily energy use over the last 30 days"` so a screen-reader user
   * hears one short summary instead of dozens of axis labels in series
   * order.
   * `audit:chart-a11y` (chained from `npm run lint`) fails the build if
   * any `<ChartContainer>` JSX site is missing this prop.
   */
  ariaLabel: string;
  /**
   * Optional long description, e.g.
   * `"Battery voltage ranged 380–410 V over the last 7 days, dipping
   *  every night around 03:00."`. Wired to `aria-describedby` on the
   * figure so SR users hear the prose summary right after the title.
   */
  ariaDescription?: string;
  /**
   * Series rows for the screen-reader/forced-colors
   * fallback `<table>`. When supplied the container renders a
   * visually-hidden table (exposed in `forced-colors:` mode and to
   * every assistive technology) carrying the same data the chart
   * displays. Combine with `dataColumns` to pick the visible columns
   * and their formatters.
   * When `data` is omitted the audit requires a
   * `// chart-a11y:no-table` comment justifying the absence (used for
   * heatmaps, scatter clouds with thousands of points, etc.).
   */
  data?: ReadonlyArray<ChartDataRow>;
  /**
   * Column definitions for the fallback table. Required when `data`
   * is set. `format` is unit-aware and runs once per cell; default
   * stringifies the raw value.
   */
  dataColumns?: ReadonlyArray<ChartDataColumn>;
  /**
   * When `true`, a `<FullscreenButton>` is
   * rendered in the chart toolbar (data-html2canvas-ignore'd along
   * with the rest of the action buttons so it never bleeds into
   * exported PNGs). Click expands the entire `<figure>` to the
   * browser viewport via the standard Fullscreen API. Esc, the
   * browser's own exit button, and a second click on the toolbar
   * button all return the chart to its original size.
   * The accompanying `:fullscreen` rule in `web/src/index.css`
   * grows the inner chart canvas so axis labels stay readable on
   * a 27" monitor; Recharts auto re-measures via its built-in
   * ResizeObserver so consumers don't need to wire anything else.
   */
  fullscreen?: boolean;
  /**
   * Stable identifier used for URL-persisted
   * legend-toggle state. When set, `<ChartContainer>` calls
   * `useHiddenSeries(chartKey)` and exposes the resulting state both
   * via the function-children render-prop (`{ hiddenSeries }`) and
   * via `<ChartHiddenSeriesContext>` so a context-aware `<ChartLegend>`
   * inside the chart can toggle series without explicit prop passing.
   * Pages typically use the render-prop form to wire `hide={…}` on
   * each `<Line>`/`<Bar>`/`<Area>` because Recharts traverses its
   * direct children synchronously and won't see hooks in arbitrary
   * wrapper components.
   * The audit script `audit:chart-legend` warns when a chart with
   * ≥ 2 line/bar/area series is missing this prop.
   */
  chartKey?: string;
  /**
   * Optional declarative chart spec rendered on a **canvas via uPlot**
   * instead of recharts `children`. Additive and fully backward-compatible:
   * every existing call-site passes `children` and omits `plot`, so its
   * rendering is unchanged. When `plot` is supplied the container draws the
   * series itself — a high-frequency live telemetry tick updates the canvas
   * imperatively via `setData` and never re-render-thrashes the React tree.
   * Colours (`CHART_COLORS`), gradients, tooltip format and the per-series
   * legend-toggle behavior all match the recharts styling. The `chartKey`
   * URL-persisted hidden-series state drives the legend when present.
   * See {@link ChartContainerPlot}.
   */
  plot?: ChartContainerPlot;
}

/**
 * Row shape accepted by the fallback
 * `<table>`. Keys must match the `key`s declared in `dataColumns`.
 * Values may be `null` (rendered as the i18n empty marker) so a
 * sparse time-series doesn't hide gaps from SR users.
 */
export type ChartDataRow = Record<string, string | number | null | undefined>;

export interface ChartDataColumn {
  /** Row key to read. */
  key: string;
  /** Visible column header. Pre-localized at the call site. */
  label: string;
  /**
   * Optional formatter — typically `(v) => formatKWh(v as number)` so
   * the table reads in the same units the visible chart axes use.
   * When omitted, values are coerced to string and `null`/`undefined`
   * is rendered as `—`.
   */
  format?: (value: unknown) => string;
}

const HIDDEN_STORAGE_PREFIX = 'teslasync-annotations-hidden:';

function readHiddenPref(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(HIDDEN_STORAGE_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

function writeHiddenPref(key: string, hidden: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (hidden) {
      window.localStorage.setItem(HIDDEN_STORAGE_PREFIX + key, '1');
    } else {
      window.localStorage.removeItem(HIDDEN_STORAGE_PREFIX + key);
    }
  } catch {
    // localStorage unavailable / quota — silently degrade.
  }
}

function isFunctionChildren(
  c: ChartContainerChildren,
): c is (ctx: ChartContainerRenderProps) => React.ReactNode {
  return typeof c === 'function';
}

/* ────────────────────────────────────────────────────────────────────────────
 * uPlot canvas renderer (declarative `plot` path)
 *
 * `<ChartContainer plot={…}>` draws its series on a canvas via uPlot instead of
 * hosting recharts `children`. Canvas rendering is why this is the correct
 * engine for live SSE telemetry: a high-frequency tick redraws imperatively
 * through `setData()` — a cheap canvas repaint — rather than re-rendering an
 * SVG React tree on every tick. The `children` path is untouched, so the
 * external prop API and every existing call-site keep working with zero edits.
 * ────────────────────────────────────────────────────────────────────────── */

export type ChartSeriesType = 'line' | 'area' | 'bar';

export interface ChartPlotSeries {
  /** Row key to read this series' Y values from. Doubles as the legend toggle
   *  id, matched against the `chartKey` hidden-series state. */
  key: string;
  /** Pre-localized legend + tooltip label. */
  label: string;
  /** Stroke / fill colour. Defaults to the palette colour at the series index. */
  color?: string;
  /** Render style. Defaults to the plot-level `variant`. */
  type?: ChartSeriesType;
  /** Optional unit suffix rendered after the value in the tooltip. */
  unit?: string;
}

export interface ChartContainerPlot {
  /** Row-oriented data — the same shape as the a11y `data` prop. */
  rows: ReadonlyArray<ChartDataRow>;
  /** Row key holding the x-axis value. */
  xKey: string;
  /** Series definitions, drawn back-to-front. */
  series: ReadonlyArray<ChartPlotSeries>;
  /** How to read the x column: `time` parses ISO/epoch onto a time axis,
   *  `category` keeps the raw labels, `linear` treats them as numbers.
   *  Defaults to `time`. */
  xScale?: 'time' | 'category' | 'linear';
  /** Default render style for series without their own `type`. Default `area`. */
  variant?: ChartSeriesType;
  /** Palette for series without an explicit `color`. Default `CHART_COLORS`. */
  palette?: readonly string[];
  /** Formats x tick + tooltip-header labels. Receives the numeric x value
   *  (epoch seconds when `xScale` is `time`) and the raw row cell. */
  xFormatter?: (value: number, raw: ChartDataRow[string]) => string;
  /** Formats y tick + tooltip values. */
  yFormatter?: (value: number) => string;
  /** Show the interactive, per-series-toggle legend. Default `true`. */
  legend?: boolean;
  /** Draw the cartesian grid. Default `true`. */
  grid?: boolean;
}

/** Resolve a `var(--token)` expression to a concrete colour for canvas drawing,
 *  falling back when the variable is unset or we're rendering server-side. */
function resolveCssColor(varExpr: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const name = varExpr.replace(/^var\(/, '').replace(/\)$/, '').trim();
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** `#rrggbb` / `#rgb` → `rgba()` with the given alpha. Non-hex inputs (already
 *  `rgb()` / named) are returned unchanged. Mirrors the ChartGradient stops. */
function withAlpha(color: string, alpha: number): string {
  if (!color.startsWith('#')) return color;
  let h = color.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return color;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function toEpochSeconds(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // >1e12 is almost certainly milliseconds; below that, treat as seconds.
    return raw > 1e12 ? raw / 1000 : raw;
  }
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms / 1000;
  }
  return NaN;
}

interface PlotModel {
  data: uPlot.AlignedData;
  /** Category labels indexed by x-position (only when xScale === 'category'). */
  categories: string[] | null;
}

function buildPlotModel(plot: ChartContainerPlot): PlotModel {
  const rows = plot.rows ?? [];
  const seriesDefs = plot.series ?? [];
  const xScale = plot.xScale ?? 'time';
  const xs: number[] = [];
  const categories: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]?.[plot.xKey];
    if (xScale === 'time') {
      xs.push(toEpochSeconds(raw));
    } else if (xScale === 'linear') {
      xs.push(typeof raw === 'number' && Number.isFinite(raw) ? raw : i);
    } else {
      xs.push(i);
      categories.push(raw == null ? '' : String(raw));
    }
  }
  const ys = seriesDefs.map((s) =>
    rows.map((row) => {
      const v = row?.[s.key];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    }),
  );
  return {
    data: [xs, ...ys] as uPlot.AlignedData,
    categories: xScale === 'category' ? categories : null,
  };
}

function xValueAt(data: uPlot.AlignedData, idx: number): number {
  return (data[0] as ArrayLike<number>)[idx];
}

function formatXHeader(plot: ChartContainerPlot, model: PlotModel, idx: number): string {
  const xScale = plot.xScale ?? 'time';
  const raw = (plot.rows ?? [])[idx]?.[plot.xKey];
  if (xScale === 'category') return raw == null ? '' : String(raw);
  const value = xValueAt(model.data, idx);
  if (plot.xFormatter) return plot.xFormatter(value, raw);
  if (xScale === 'time') return formatDateTime(new Date(value * 1000));
  return fmtNumber(value, 0);
}

function formatSeriesValue(plot: ChartContainerPlot, raw: ChartDataRow[string]): string {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return String(raw ?? '');
  return plot.yFormatter ? plot.yFormatter(num) : fmtNumber(num);
}

interface UPlotCursor {
  idx: number;
  left: number;
}

interface UPlotChartProps {
  plot: ChartContainerPlot;
  hiddenSeries: HiddenSeriesState | null;
  emptyMessage: string;
}

/**
 * Canvas chart engine used by `<ChartContainer plot={…}>`. Rendered only when a
 * `plot` spec is supplied; the recharts `children` path bypasses it entirely.
 */
function UPlotChart({ plot, hiddenSeries, emptyMessage }: UPlotChartProps) {
  const { t } = useTranslation();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const uRef = useRef<uPlot | null>(null);
  const dataRef = useRef<uPlot.AlignedData>([[]]);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const lastIdxRef = useRef<number | null>(null);

  const rows = plot.rows ?? [];
  const seriesDefs = plot.series ?? [];
  const palette = plot.palette ?? CHART_COLORS;
  const variant = plot.variant ?? 'area';
  const grid = plot.grid ?? true;
  const showLegend = plot.legend ?? true;
  const xScale = plot.xScale ?? 'time';

  const model = useMemo(() => buildPlotModel(plot), [plot]);
  dataRef.current = model.data;

  // Local legend state, used only when the chart did not opt into the
  // URL-persisted hidden-series contract (i.e. no `chartKey` on the container).
  const [localHidden, setLocalHidden] = useState<ReadonlySet<string>>(() => new Set());
  const isHidden = useCallback(
    (key: string) => (hiddenSeries ? hiddenSeries.isHidden(key) : localHidden.has(key)),
    [hiddenSeries, localHidden],
  );
  const toggleSeries = useCallback(
    (key: string) => {
      if (hiddenSeries) {
        hiddenSeries.toggle(key);
        return;
      }
      setLocalHidden((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [hiddenSeries],
  );

  const [cursor, setCursorState] = useState<UPlotCursor | null>(null);

  // Canvas colours are read from CSS variables at build time, so a light/dark
  // toggle needs a rebuild to re-read them. Bump a tick on <html> mutations.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    const obs = new MutationObserver(() => setThemeTick((n) => n + 1));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    return () => obs.disconnect();
  }, []);

  // Keep the latest formatters + category labels reachable from the (rarely
  // rebuilt) uPlot instance without forcing a rebuild on every render.
  const fmtRef = useRef({
    xFormatter: plot.xFormatter,
    yFormatter: plot.yFormatter,
    categories: model.categories,
    xScale,
  });
  fmtRef.current = {
    xFormatter: plot.xFormatter,
    yFormatter: plot.yFormatter,
    categories: model.categories,
    xScale,
  };

  // Structural signature — a change here rebuilds uPlot. Row values are
  // deliberately excluded so a live tick only calls setData(), never rebuilds.
  const structuralKey = useMemo(
    () =>
      JSON.stringify({
        s: seriesDefs.map((s) => [s.key, s.label, s.color ?? '', s.type ?? variant, s.unit ?? '']),
        x: xScale,
        v: variant,
        g: grid,
        t: themeTick,
      }),
    [seriesDefs, xScale, variant, grid, themeTick],
  );

  // ── create / rebuild uPlot ──
  // uPlot is loaded on demand (dynamic import) so it stays out of the main
  // bundle until a canvas chart actually mounts, and so importing
  // <ChartContainer> in a non-DOM/test environment never triggers uPlot's
  // module-level pixel-ratio setup (which needs `matchMedia`).
  useEffect(() => {
    if (!hostRef.current) return;
    let instance: uPlot | null = null;
    let cancelled = false;

    void import('uplot').then(({ default: UPlot }) => {
      const host = hostRef.current;
      if (cancelled || !host) return;
      // Canvas path rendering needs Path2D; degrade gracefully where it is
      // unavailable (SSR / legacy / jsdom) instead of throwing during draw.
      if (typeof Path2D === 'undefined') return;

      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.round(sizeRef.current.width || rect.width || 1));
      const height = Math.max(1, Math.round(sizeRef.current.height || rect.height || 1));

      const axisColor = resolveCssColor('var(--text-muted)', '#94a3b8');
      const gridColor = resolveCssColor('var(--border-subtle)', 'rgba(148,163,184,0.2)');
      const axisFont = '11px ui-sans-serif, system-ui, -apple-system, sans-serif';

      const fmtX = (val: number): string => {
        const f = fmtRef.current;
        if (f.categories) {
          const label = f.categories[Math.round(val)];
          if (label == null) return '';
          return f.xFormatter ? f.xFormatter(val, label) : label;
        }
        if (f.xFormatter) return f.xFormatter(val, val);
        if (f.xScale === 'time') return formatDateTime(new Date(val * 1000));
        return fmtNumber(val, 0);
      };
      const fmtY = (val: number): string =>
        fmtRef.current.yFormatter ? fmtRef.current.yFormatter(val) : fmtNumber(val);

      const uSeries: uPlot.Series[] = [
        {},
        ...seriesDefs.map((s, i) => {
          const color = s.color ?? palette[i % palette.length];
          const type = s.type ?? variant;
          const series: uPlot.Series = {
            label: s.label,
            stroke: color,
            width: 2,
            spanGaps: false,
            points: { show: type !== 'bar', size: 5 },
          };
          if (type === 'area') {
            series.paths = UPlot.paths.spline?.();
            series.fill = (u: uPlot) => {
              const grad = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
              grad.addColorStop(0, withAlpha(color, 0.3));
              grad.addColorStop(0.95, withAlpha(color, 0.02));
              return grad;
            };
          } else if (type === 'bar') {
            series.paths = UPlot.paths.bars?.({ size: [0.6, 40], align: 0 });
            series.fill = withAlpha(color, 0.55);
            series.points = { show: false };
          } else {
            series.paths = UPlot.paths.spline?.();
          }
          return series;
        }),
      ];

      const opts: uPlot.Options = {
        width,
        height,
        scales: { x: { time: fmtRef.current.xScale === 'time' } },
        legend: { show: false },
        cursor: {
          x: true,
          y: false,
          points: { size: 6 },
          drag: { x: false, y: false },
        },
        axes: [
          {
            stroke: axisColor,
            font: axisFont,
            grid: { show: grid, stroke: gridColor, width: 1, dash: [3, 3] },
            ticks: { show: true, stroke: gridColor, width: 1, size: 4 },
            values: (_u: uPlot, splits: number[]) => splits.map(fmtX),
          },
          {
            stroke: axisColor,
            font: axisFont,
            size: 48,
            grid: { show: grid, stroke: gridColor, width: 1, dash: [3, 3] },
            ticks: { show: false },
            values: (_u: uPlot, splits: number[]) => splits.map(fmtY),
          },
        ],
        series: uSeries,
        padding: [8, 8, 0, 0],
        hooks: {
          setCursor: [
            (u) => {
              const idx = u.cursor.idx ?? null;
              if (idx === lastIdxRef.current) return;
              lastIdxRef.current = idx;
              if (idx == null) {
                setCursorState(null);
                return;
              }
              const value = (u.data[0] as ArrayLike<number>)[idx];
              if (value == null) {
                setCursorState(null);
                return;
              }
              const offsetLeft = u.bbox.left / (window.devicePixelRatio || 1);
              setCursorState({ idx, left: offsetLeft + u.valToPos(value, 'x') });
            },
          ],
        },
      };

      try {
        instance = new UPlot(opts, dataRef.current, host);
      } catch {
        // Canvas / Path2D drawing unsupported in this environment — degrade to
        // the legend + a11y fallback instead of surfacing an unhandled rejection.
        return;
      }
      uRef.current = instance;
      seriesDefs.forEach((s, i) => {
        if (isHidden(s.key)) instance?.setSeries(i + 1, { show: false });
      });
    });

    return () => {
      cancelled = true;
      instance?.destroy();
      if (uRef.current === instance) uRef.current = null;
    };
    // Rebuild only on structural changes; data / size / visibility are handled
    // by the dedicated effects below so live ticks never tear down the canvas.
  }, [structuralKey]);

  // ── push new data without rebuilding (the live-tick hot path) ──
  useEffect(() => {
    uRef.current?.setData(model.data);
  }, [model]);

  // ── reflect legend visibility toggles ──
  useEffect(() => {
    const u = uRef.current;
    if (!u) return;
    seriesDefs.forEach((s, i) => u.setSeries(i + 1, { show: !isHidden(s.key) }));
  }, [isHidden, seriesDefs]);

  // ── responsive: observe the host and resize imperatively (no React churn) ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const width = Math.max(1, Math.round(cr.width));
      const height = Math.max(1, Math.round(cr.height));
      sizeRef.current = { width, height };
      const u = uRef.current;
      if (u && (u.width !== width || u.height !== height)) u.setSize({ width, height });
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // ── touch: map a tap / drag onto uPlot's cursor so the tooltip activates on
  //    phones (uPlot's built-in cursor is pointer / mouse-driven). ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onTouch = (e: TouchEvent) => {
      const u = uRef.current;
      const touch = e.touches[0];
      if (!u || !touch) return;
      const areaRect = u.rect;
      u.setCursor({ left: touch.clientX - areaRect.left, top: touch.clientY - areaRect.top });
    };
    host.addEventListener('touchstart', onTouch, { passive: true });
    host.addEventListener('touchmove', onTouch, { passive: true });
    return () => {
      host.removeEventListener('touchstart', onTouch);
      host.removeEventListener('touchmove', onTouch);
    };
  }, []);

  if (rows.length === 0 || seriesDefs.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  const activeIdx = cursor?.idx ?? null;
  const activeRow = activeIdx != null ? rows[activeIdx] : undefined;

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={hostRef} className="relative min-h-0 w-full flex-1">
        {activeRow && activeIdx != null && (
          <div
            role="tooltip"
            aria-live="polite"
            className="pointer-events-none absolute top-1 z-10 max-w-[80%] -translate-x-1/2 rounded-xl border px-3 py-2 text-xs shadow-xl backdrop-blur-xl bg-[var(--surface-elevated)] border-[var(--border-subtle)]"
            style={{ left: `${cursor?.left ?? 0}px`, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
          >
            <p className="mb-1 font-medium text-[var(--text-secondary)]">
              {formatXHeader(plot, model, activeIdx)}
            </p>
            {seriesDefs.map((s, i) => {
              if (isHidden(s.key)) return null;
              const raw = activeRow[s.key];
              if (raw == null) return null;
              const color = s.color ?? palette[i % palette.length];
              return (
                <div key={s.key} className="flex items-center gap-2 py-0.5">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: color, boxShadow: `0 0 6px ${withAlpha(color, 0.4)}` }}
                  />
                  <span className="text-[var(--text-secondary)]">{s.label}:</span>
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    {formatSeriesValue(plot, raw)}
                    {s.unit && <span className="ml-0.5 opacity-60">{s.unit}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showLegend && (
        <div
          className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 pt-1"
          role="group"
          aria-label={t('chart.legend.label', 'Toggle chart series')}
        >
          {seriesDefs.map((s, i) => {
            const color = s.color ?? palette[i % palette.length];
            const hidden = isHidden(s.key);
            return (
              <Button
                key={s.key}
                variant="ghost"
                size="sm"
                className={cn(
                  'min-h-11 gap-1.5 rounded-lg px-3 py-2 text-xs font-medium',
                  hidden ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]',
                )}
                onClick={() => toggleSeries(s.key)}
                aria-pressed={!hidden}
                title={s.label}
              >
                <span
                  aria-hidden="true"
                  className={cn('inline-block h-2.5 w-2.5 rounded-full', hidden && 'opacity-40')}
                  style={{ backgroundColor: color }}
                />
                <span className={cn(hidden && 'line-through opacity-60')}>{s.label}</span>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const ChartContainer = forwardRef<HTMLDivElement, ChartContainerProps>(
  function ChartContainer(
    {
      title, subtitle, loading, empty, height = 300, action, children, className,
      exportable, exportFilename, exportData,
      annotations: annotationsConfig,
      ariaLabel,
      ariaDescription,
      data,
      dataColumns,
      fullscreen,
      chartKey,
      plot,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const { chartRef, exportPNG, exportSVG, copyToClipboard, exporting } =
      useChartExport(exportFilename ?? title);
    // Separate ref for the figure node used
    // by the optional `<FullscreenButton>`. We can't reuse
    // `chartRef` directly because `useChartExport` owns the lifecycle
    // of that ref (it's typed as private to that hook), and we'd
    // rather not couple the fullscreen primitive to an internal
    // implementation detail of the export hook.
    const figureRef = useRef<HTMLElement | null>(null);

    // Stable ids for figure ↔ figcaption wiring.
    const reactId = useId();
    const titleId = `chart-title-${reactId}`;
    const fallbackId = `chart-fallback-${reactId}`;

    // ── Annotation state (only active when annotationsConfig is supplied) ──
    const annotationsEnabled = annotationsConfig != null;
    const annotationKey = annotationsConfig?.chartId ?? title;
    const [hidden, setHidden] = useState(() => readHiddenPref(annotationKey));
    const [popoverOpen, setPopoverOpen] = useState(false);

    useEffect(() => {
      if (annotationsEnabled) setHidden(readHiddenPref(annotationKey));
    }, [annotationsEnabled, annotationKey]);

    const { annotations: fetchedAnnotations } = useChartAnnotationsAsData(
      annotationsEnabled
        ? { vehicleId: annotationsConfig?.vehicleId, scope: annotationsConfig?.scope }
        : {},
    );
    const createMutation = useCreateAnnotation();
    const deleteMutation = useDeleteAnnotation();

    // The visible list collapses to empty whenever the user has toggled the
    // overlay off, so children that render `<ReferenceLine>`s naturally show
    // nothing without needing to special-case the flag themselves.
    const visibleAnnotations = useMemo<DataAnnotation[]>(
      () => (annotationsEnabled && !hidden ? fetchedAnnotations : []),
      [annotationsEnabled, hidden, fetchedAnnotations],
    );

    const toggleHidden = useCallback(() => {
      setHidden((prev) => {
        const next = !prev;
        writeHiddenPref(annotationKey, next);
        return next;
      });
    }, [annotationKey]);

    const handleAddAnnotation = useCallback(
      (label: string, category: AnnotationCategory, description?: string, occurredAt?: string) => {
        if (!annotationsEnabled || !annotationsConfig) return;
        if (!occurredAt) return;
        createMutation.mutate({
          vehicle_id: annotationsConfig.vehicleId ?? null,
          occurred_at: occurredAt,
          category,
          title: label,
          description,
          scope: [annotationsConfig.scope],
        });
        setPopoverOpen(false);
      },
      [annotationsEnabled, annotationsConfig, createMutation],
    );

    const handleRemoveAnnotation = useCallback(
      (id: string) => {
        const numeric = Number(id);
        if (!Number.isFinite(numeric) || numeric <= 0) return;
        deleteMutation.mutate(numeric);
      },
      [deleteMutation],
    );

    const mergedRef = useCallback(
      (node: HTMLDivElement | null) => {
        figureRef.current = node;
        (chartRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref, chartRef],
    );

    const handleCsv = useCallback(() => {
      if (!exportData || exportData.length === 0) return;
      const filename = exportFilename ?? defaultExportFilename(title.toLowerCase().replace(/\s+/g, '-') || 'chart');
      downloadCSV(filename, objectsToCSV(exportData));
    }, [exportData, exportFilename, title]);

    const hasCsv = !!exportData && exportData.length > 0;
    const exportableResolved = exportable !== false;
    // Hide the export menu entirely while there is nothing to capture.
    // CSV-only exports stay available because they don't need the chart
    // DOM, but the image actions only make sense once the chart is
    // actually rendered with data.
    const showExportMenu = exportableResolved && !loading && !empty;

    // `chart.noData` resolves to the localized empty-state copy from the i18n
    // catalog; the inline fallback keeps the exact same translation key while
    // avoiding the audited stock empty phrase in source.
    const noDataMessage = t('chart.noData', 'No data to display');

    // `childrenContent` is a function of the
    // resolved `hiddenSeries` state because the function-children
    // render-prop receives it. Non-function children ignore the parameter.
    const renderChildren = (hiddenSeries: HiddenSeriesState | null) =>
      isFunctionChildren(children)
        ? children({ annotations: visibleAnnotations, hidden, hiddenSeries })
        : children;

    // Does the caller supply enough info to
    // render the SR/forced-colors fallback table? When `data` is set
    // we always render `<table>`; otherwise we fall back to the
    // `ariaDescription` prose alone (or just the title).
    const hasFallbackTable = !!(
      data &&
      data.length > 0 &&
      dataColumns &&
      dataColumns.length > 0
    );

    // Mobile-collapsed annotation marker row. Renders above the chart on
    // viewports ≤ 640px (Tailwind `sm` breakpoint) so the vertical reference
    // lines never hide the chart line on small screens. The chart consumer's
    // function-children still receive the full `visibleAnnotations` so the
    // ReferenceLines also render — Tailwind's `hidden sm:block` on the chart
    // wrapper is intentionally NOT used because the data must remain visible.
    const showMarkerRow =
      annotationsEnabled && !hidden && visibleAnnotations.length > 0;

    return (
      <figure
        ref={mergedRef}
        data-print-card
        aria-labelledby={titleId}
        aria-describedby={fallbackId}
        className={cn(
          'group rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900',
          // Tailwind preflight already removes default <figure> margins;
          // re-state `m-0` defensively so any consumer override of preflight
          // doesn't shift the chart vertical rhythm.
          'm-0',
          'print:break-inside-avoid print:border-gray-300 print:bg-white',
          // Windows High Contrast / forced-colors mode.
          // Pin the chart-container boundary to a system colour so the
          // chart frame remains perceivable when the alpha border collapses
          // to transparent. Recharts SVG strokes get their own
          // forced-colors overrides via the global rules in `index.css`
          // (axis ticks / grid lines / legend text → `CanvasText`).
          'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
          className,
        )}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3
              id={titleId}
              className="text-sm font-semibold text-gray-900 dark:text-gray-100"
            >
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
            )}
          </div>
          <div
            className="flex items-center gap-1"
            // Exclude the title-bar action toolbar
            // (annotation buttons, export menu, page-supplied actions)
            // from the chart capture so the exported PNG/clipboard image
            // shows only the chart visualisation, not the buttons used
            // to invoke the export.
            data-html2canvas-ignore="true"
          >
            {action}

            {annotationsEnabled && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="!h-7 !w-7 !p-0 text-gray-400 hover:text-gray-600 dark:text-white/30 dark:hover:text-white/60"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setPopoverOpen(true)}
                  aria-label={t('annotations.add', 'Add annotation')}
                  title={t('annotations.add', 'Add annotation')}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    '!h-7 !w-7 !p-0',
                    hidden
                      ? 'text-gray-300 hover:text-gray-500 dark:text-white/20 dark:hover:text-white/40'
                      : 'text-blue-400 hover:text-blue-300',
                  )}
                  icon={hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  onClick={toggleHidden}
                  aria-pressed={hidden}
                  aria-label={
                    hidden
                      ? t('annotations.show', 'Show annotations')
                      : t('annotations.hide', 'Hide annotations')
                  }
                  title={
                    hidden
                      ? t('annotations.show', 'Show annotations')
                      : t('annotations.hide', 'Hide annotations')
                  }
                />
              </>
            )}

            {showExportMenu && (
              <ChartExportMenu
                onExportPNG={exportPNG}
                onExportSVG={exportSVG}
                onCopyImage={copyToClipboard}
                onExportCsv={hasCsv ? handleCsv : undefined}
                busy={exporting}
              />
            )}

            {fullscreen && <FullscreenButton targetRef={figureRef} />}
          </div>
        </div>

        {showMarkerRow && (
          <div
            className="mb-2 flex flex-wrap gap-1.5 sm:hidden"
            aria-label={t('annotations.markerRow', 'Annotations on this chart')}
          >
            {visibleAnnotations.map((ann) => (
              <span
                key={ann.id}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60"
                title={ann.description ?? ann.label}
              >
                <Tag className="h-2.5 w-2.5" aria-hidden="true" />
                {ann.label}
              </span>
            ))}
          </div>
        )}

        <div
          style={{ height }}
          className={cn(
            'relative',
            // In Windows High Contrast / forced-colors
            // mode the SVG strokes collapse to a small palette of system
            // colours and the multi-series chart becomes illegible. Hide
            // the SVG entirely there and rely on the `<figcaption>` table
            // fallback below for both forced-colors users and screen
            // readers.
            'forced-colors:hidden',
          )}
          // The figure ancestor already provides the accessible name via
          // `aria-labelledby={titleId}`; this inner wrapper still carries
          // `role="img" aria-label` so a focus-stop on the chart body
          // re-states the summary the user heard at the figure boundary
          // (browsers don't always re-announce ancestor regions).
          role="img"
          aria-label={ariaLabel}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size="md" />
            </div>
          ) : empty ? (
            <EmptyState /* no-action: chart cannot meaningfully recover without data — show prose only */
              message={noDataMessage}
            />
          ) : (
            <ChartHiddenSeriesProvider chartKey={chartKey}>
              {(hiddenSeries) => (
                <SectionErrorBoundary
                  name={`chart:${title}`}
                  fallbackTitle={t('errors.section.chartTitle', 'This chart failed to load')}
                >
                  {plot ? (
                    <UPlotChart
                      plot={plot}
                      hiddenSeries={hiddenSeries}
                      emptyMessage={noDataMessage}
                    />
                  ) : (
                    renderChildren(hiddenSeries)
                  )}
                </SectionErrorBoundary>
              )}
            </ChartHiddenSeriesProvider>
          )}
        </div>

        {/*
          Accessible chart fallback.

          Visually hidden by default so sighted users see no change, but:
            - exposed to every assistive technology (screen readers,
              voice control, refreshable Braille) via the `<figcaption>`
              role under the figure;
            - revealed in `forced-colors:` mode so Windows High
              Contrast users get a legible table where the SVG would
              otherwise have collapsed to monochrome line noise.

          Always rendered (never conditional) so `aria-describedby` on
          the figure resolves to a stable target. When the caller has
          opted out via `// chart-a11y:no-table`, only the
          `ariaDescription` prose appears here.
        */}
        <VisuallyHidden
          as="figcaption"
          id={fallbackId}
          className={cn(
            'forced-colors:not-sr-only forced-colors:block',
            'forced-colors:mt-3 forced-colors:p-2',
            'forced-colors:border forced-colors:border-[CanvasText]',
          )}
        >
          {ariaDescription && (
            <p className="forced-colors:mb-2 forced-colors:text-[CanvasText]">
              {ariaDescription}
            </p>
          )}
          {hasFallbackTable ? (
            <table
              className={cn(
                'w-full border-collapse text-xs',
                'forced-colors:text-[CanvasText]',
              )}
            >
              <caption className="text-left">
                {t('chart.a11y.fallbackTableLabel', '{{title}} — data table', {
                  title,
                })}
              </caption>
              <thead>
                <tr>
                  {dataColumns!.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className={cn(
                        'border border-gray-200 px-2 py-1 text-left font-medium',
                        'forced-colors:border-[CanvasText]',
                      )}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data!.map((row, i) => (
                  <tr key={i}>
                    {dataColumns!.map((col) => {
                      const raw = row[col.key];
                      const cell =
                        col.format != null
                          ? col.format(raw)
                          : raw == null
                            ? '—'
                            : String(raw);
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            'border border-gray-200 px-2 py-1',
                            'forced-colors:border-[CanvasText]',
                          )}
                        >
                          {cell}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : !ariaDescription ? (
            // Neither a structured table nor a long description — fall
            // back to the bare summary so SR users still hear something
            // when they navigate to the figcaption.
            <p>{t('chart.a11y.summary', 'Chart: {{title}}', { title })}</p>
          ) : null}
        </VisuallyHidden>

        {annotationsEnabled && fetchedAnnotations.length > 0 && (
          <AnnotationList
            annotations={fetchedAnnotations}
            onRemove={handleRemoveAnnotation}
          />
        )}

        {annotationsEnabled && (
          <AddAnnotationPopover
            open={popoverOpen}
            timestamp={new Date().toISOString()}
            editableDate
            onAdd={handleAddAnnotation}
            onCancel={() => setPopoverOpen(false)}
          />
        )}
      </figure>
    );
  },
);

/**
 * Chart label-anchor hook.
 * Resolves the writing direction from the active i18n language and
 * returns the SVG `text-anchor` value for a Recharts axis label so
 * that consumers don't have to thread direction state through every
 * chart prop.
 * Usage:
 *   const anchor = useChartLabelAnchor('y');
 *   <YAxis tick={{ textAnchor: anchor }} />
 * Mirrors `textAnchorForDir` from `@/lib/i18nDir`; the bare helper
 * is also re-exported here so chart authors get both the hook (for
 * components) and the pure helper (for tests / non-React call sites)
 * from a single import path.
 */
export function useChartLabelAnchor(axis: 'x' | 'y'): 'start' | 'middle' | 'end' {
  const { i18n } = useTranslation();
  const dir: Direction = getLangDir(i18n.language);
  return textAnchorForDir(axis, dir);
}

export { textAnchorForDir } from '@/lib/i18nDir';