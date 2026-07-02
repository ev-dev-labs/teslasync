/**
 * SmallMultiplesChart — grid of mini line charts, one per series.
 *
 * The "small multiples" / "trellis" / Grafana-style "Stat panel grid"
 * visualization. Each cell renders one series with its own y-scale so
 * series with very different magnitudes don't compress each other into
 * a flat line, which is the classic failure mode of overlay charts when
 * many series are pinned at once.
 *
 * Rendered with visx (D3-backed SVG primitives) rather than a charting
 * framework: this grid is a lower-frequency, bespoke surface that benefits
 * from full control over the SVG — hand-drawn axes, grid, crosshair and a
 * shared-cursor sync that works across every cell without a framework's
 * cross-instance machinery.
 *
 * Cells share a single cursor via `syncId`: hovering (or tapping) one cell
 * moves the crosshair in every other cell at the same timestamp — that's the
 * whole point of small multiples. Only the interacted cell shows a tooltip,
 * keeping the grid quiet.
 *
 * Performance — three layers (added when 50+ cells started hanging):
 *   1. Per-cell data projection: each cell only sees rows where its
 *      series has a finite numeric value, NOT the full time-aligned
 *      matrix. A signal with 11 points stops scanning 5,021 rows.
 *   2. Stride downsampling: each cell capped at `maxPointsPerCell`
 *      (default 400). Visually indistinguishable at the cell's pixel
 *      width but huge perf win for high-frequency series.
 *   3. Lazy-mount via IntersectionObserver: off-screen cells render a
 *      lightweight skeleton box until scrolled into view. With 60 cells
 *      we mount ~9 live canvases up-front instead of all 60.
 *
 * Mobile: the interaction surface uses Pointer Events so a tap activates the
 * crosshair + tooltip (not hover-only), keeps `touch-action: pan-y` so the
 * page still scrolls vertically through the grid, and the SVG measures its
 * own container so a cell reflows correctly down to a 375px viewport.
 *
 * Reusable: this component knows nothing about telemetry signals. It
 * takes a `data` array (one row per timestamp) and a list of `series`
 * keys to project out into individual cells. Lives in `components/
 * charts/` so any feature that needs "show me N series side-by-side
 * with shared time axis" can use it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { curveMonotoneX } from '@visx/curve';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { CHART_COLORS } from '@/lib/colors';
import { cn } from '@/lib/cn';
import { useInView } from '@/hooks/useInView';
import { useDateFormat } from '@/hooks/useDateFormat';

export interface SmallMultiplesChartProps<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Time-ordered rows. Each row holds `timestamp` + arbitrary series keys. */
  data: T[];
  /** Series keys to render — one cell per entry. */
  series: string[];
  /** Optional friendly label per series. Defaults to the key. */
  seriesLabel?: (series: string) => string;
  /** dataKey on each row holding the x-axis value. Default `'timestamp'`. */
  xKey?: string;
  /** Pixel height of each cell. Default 120. */
  cellHeight?: number;
  /**
   * Min cell width in CSS pixels for the responsive grid. Smaller values
   * = denser packing on wide screens. Default 280.
   */
  cellMinWidth?: number;
  /** Force a specific column count (overrides auto-fill). */
  columns?: number;
  /**
   * Cross-cell cursor sync id. Cells in the same SmallMultiplesChart
   * always share this id; pass a stable string if you want this grid to
   * also sync with charts outside it (e.g. a SignalChartPanel above).
   */
  syncId?: string;
  /** Map series -> color index. Defaults to position in `series`. */
  colorIndex?: Record<string, number>;
  /** Optional cell-click handler — useful for drill-in to detail view. */
  onCellClick?: (series: string) => void;
  /** Empty-cell label when a series has no points in `data`. */
  emptyCellLabel?: string;
  /**
   * Cap per-cell point count via stride downsampling. Default 400 — at
   * a typical cell width of ~280px that's >1px per point so visually
   * lossless. Set higher for export-quality renders, lower for very
   * dense grids on slow machines.
   */
  maxPointsPerCell?: number;
  className?: string;
}

function isFinitePoint(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Coerce an arbitrary cell value to a finite number, defaulting to 0. */
function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Parse an x-axis value to epoch ms for cross-cell nearest-time matching. */
function toEpoch(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? Number.NaN : t;
  }
  return Number.NaN;
}

interface CellProjection {
  rows: Array<Record<string, unknown>>;
  hasData: boolean;
}

/** Stride-downsample to `cap` points, always preserving first + last. */
function strideSample<T>(rows: T[], cap: number): T[] {
  if (rows.length <= cap) return rows;
  const stride = Math.ceil(rows.length / cap);
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += stride) out.push(rows[i]);
  const last = rows[rows.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/* ── Shared cursor: one active timestamp broadcast across every cell ── */

interface CursorContextValue {
  /** The x value (timestamp) currently under the cursor, or null. */
  activeX: string | number | null;
  /** The series key of the cell that owns the cursor (shows the tooltip). */
  activeCellId: string | null;
  setCursor: (cellId: string, x: string | number | null) => void;
  clearCursor: (cellId: string) => void;
}

const NOOP_CURSOR: CursorContextValue = {
  activeX: null,
  activeCellId: null,
  setCursor: () => {},
  clearCursor: () => {},
};

const CursorContext = createContext<CursorContextValue>(NOOP_CURSOR);

function CursorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ activeX: string | number | null; activeCellId: string | null }>({
    activeX: null,
    activeCellId: null,
  });

  const setCursor = useCallback((cellId: string, x: string | number | null) => {
    setState({ activeX: x, activeCellId: cellId });
  }, []);

  // Only the cell that currently owns the cursor may clear it, so a stale
  // pointer-leave from another cell can't wipe the active crosshair.
  const clearCursor = useCallback((cellId: string) => {
    setState((prev) => (prev.activeCellId === cellId ? { activeX: null, activeCellId: null } : prev));
  }, []);

  const value = useMemo<CursorContextValue>(
    () => ({ activeX: state.activeX, activeCellId: state.activeCellId, setCursor, clearCursor }),
    [state, setCursor, clearCursor],
  );

  return <CursorContext.Provider value={value}>{children}</CursorContext.Provider>;
}

export function SmallMultiplesChart<T extends Record<string, unknown> = Record<string, unknown>>({
  data,
  series,
  seriesLabel,
  xKey = 'timestamp',
  cellHeight = 120,
  cellMinWidth = 280,
  columns,
  syncId,
  colorIndex,
  onCellClick,
  emptyCellLabel,
  maxPointsPerCell = 400,
  className,
}: SmallMultiplesChartProps<T>) {
  const { t } = useTranslation();
  const fallbackSyncId = useId();
  const resolvedSyncId = syncId ?? fallbackSyncId;

  /**
   * Per-cell projected + downsampled rows. We walk `data` once per
   * series, keeping only rows where this signal has a finite numeric
   * value, then stride-sample down to `maxPointsPerCell`. This is the
   * single biggest perf win in this component — no cell iterates the full
   * 60 × 5,021 = 300k row-cells on every render pass.
   */
  const cellProjections = useMemo(() => {
    const map = new Map<string, CellProjection>();
    for (const sig of series) {
      const projected: Array<Record<string, unknown>> = [];
      for (const row of data) {
        const v = row[sig];
        if (isFinitePoint(v)) {
          projected.push({ [xKey]: row[xKey], [sig]: v });
        }
      }
      const rows = strideSample(projected, maxPointsPerCell);
      map.set(sig, { rows, hasData: rows.length > 0 });
    }
    return map;
  }, [data, series, xKey, maxPointsPerCell]);

  const gridStyle = useMemo<CSSProperties>(
    () =>
      columns && columns > 0
        ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
        : { gridTemplateColumns: `repeat(auto-fill, minmax(${cellMinWidth}px, 1fr))` },
    [columns, cellMinWidth],
  );

  const noData = emptyCellLabel ?? t('smallMultiples.noData', 'No data');

  return (
    <CursorProvider>
      <div
        className={cn('grid gap-3', className)}
        style={gridStyle}
        data-sync-id={resolvedSyncId}
        data-testid="small-multiples-grid"
      >
        {series.map((sig, i) => {
          const idx = colorIndex?.[sig] ?? i;
          const color = CHART_COLORS[Math.max(0, idx) % CHART_COLORS.length];
          const projection = cellProjections.get(sig);
          const hasData = projection?.hasData === true;
          const label = seriesLabel ? seriesLabel(sig) : sig;
          return (
            <SmallMultiplesCell
              key={sig}
              sig={sig}
              label={label}
              color={color}
              cellHeight={cellHeight}
              hasData={hasData}
              rows={projection?.rows ?? []}
              xKey={xKey}
              noData={noData}
              onCellClick={onCellClick}
            />
          );
        })}
      </div>
    </CursorProvider>
  );
}

/**
 * Single cell — extracted so each can use its own `useInView` and
 * lazy-mount the heavy canvas only when it scrolls into view. Off-screen
 * cells render a slim skeleton box of the same height so scroll position
 * stays stable.
 */
interface SmallMultiplesCellProps {
  sig: string;
  label: string;
  color: string;
  cellHeight: number;
  hasData: boolean;
  rows: Array<Record<string, unknown>>;
  xKey: string;
  noData: string;
  onCellClick?: (series: string) => void;
}

function SmallMultiplesCell({
  sig,
  label,
  color,
  cellHeight,
  hasData,
  rows,
  xKey,
  noData,
  onCellClick,
}: SmallMultiplesCellProps) {
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '300px' });
  const cellInteractive = Boolean(onCellClick);
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg-subtle,transparent)] p-2',
        cellInteractive && 'cursor-pointer hover:border-[var(--neon-cyan,#22d3ee)]',
      )}
      role={cellInteractive ? 'button' : 'group'}
      tabIndex={cellInteractive ? 0 : -1}
      onClick={cellInteractive ? () => onCellClick?.(sig) : undefined}
      onKeyDown={
        cellInteractive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onCellClick?.(sig);
              }
            }
          : undefined
      }
      aria-label={label}
      data-testid={`small-multiples-cell-${sig}`}
    >
      <div className="mb-1 flex items-center gap-1.5 px-1">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: color }}
        />
        <span
          className="truncate font-mono text-[11px] font-semibold"
          style={{ color }}
          title={label}
        >
          {label}
        </span>
      </div>
      {!hasData ? (
        <div
          className="flex items-center justify-center text-[10px] text-[var(--text-muted)]"
          style={{ height: cellHeight }}
        >
          {noData}
        </div>
      ) : !inView ? (
        <div
          className="rounded bg-[var(--glass-bg-subtle,transparent)]"
          style={{ height: cellHeight }}
          aria-hidden="true"
        />
      ) : (
        <SmallMultiplesCanvas
          sig={sig}
          label={label}
          color={color}
          cellHeight={cellHeight}
          rows={rows}
          xKey={xKey}
        />
      )}
    </div>
  );
}

/* ── Canvas layout + tick helpers ── */

const MARGIN = { top: 6, right: 8, bottom: 16, left: 34 } as const;
const MIN_TICK_GAP = 24;

/** d3-style "nice" step for a raw magnitude. */
function niceStep(range: number, round: boolean): number {
  if (!(range > 0)) return 1;
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice: number;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else if (frac <= 1) nice = 1;
  else if (frac <= 2) nice = 2;
  else if (frac <= 5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exp);
}

/**
 * Build a "nice" rounded y-domain + tick set, mirroring the auto-nice
 * behaviour the previous framework applied to `domain={['auto','auto']}`.
 * Flat series (min === max) collapse to a single baseline tick so the
 * line hugs the bottom rather than dividing by a zero-height range.
 */
function niceTicks(min: number, max: number, count = 4): { ticks: number[]; lo: number; hi: number } {
  if (!(max > min)) return { ticks: [min], lo: min, hi: min + 1 };
  const step = niceStep((max - min) / Math.max(1, count - 1), true);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return { ticks, lo, hi };
}

/** Compact numeric axis label so it fits the ~34px y gutter. */
function formatAxisNumber(v: number): string {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${trimZero(v / 1_000_000, 1)}M`;
  if (a >= 1_000) return `${trimZero(v / 1_000, 1)}k`;
  if (a === 0) return '0';
  if (a >= 100) return `${Math.round(v)}`;
  if (a >= 10) return trimZero(v, 1);
  return trimZero(v, 2);
}

function trimZero(n: number, dp: number): string {
  return Number(n.toFixed(dp)).toString();
}

/**
 * Choose evenly-spaced x indices whose on-screen labels stay ≥ MIN_TICK_GAP
 * apart and never crowd more than ~one label per 64px, always including the
 * first and last sample.
 */
function pickXTickIndices(n: number, innerWidth: number): number[] {
  if (n <= 0 || innerWidth <= 0) return [];
  if (n === 1) return [0];
  const pxPerIndex = innerWidth / (n - 1);
  const byGap = Math.max(1, Math.ceil(MIN_TICK_GAP / Math.max(pxPerIndex, 0.001)));
  const maxTicks = Math.max(2, Math.floor(innerWidth / 64));
  const byCount = Math.max(1, Math.ceil((n - 1) / (maxTicks - 1)));
  const step = Math.max(byGap, byCount);
  const idxs: number[] = [];
  for (let i = 0; i < n; i += step) idxs.push(i);
  if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
  // Drop the penultimate label if forcing the last one crowded it.
  if (idxs.length >= 3) {
    const gapPx = (idxs[idxs.length - 1] - idxs[idxs.length - 2]) * pxPerIndex;
    if (gapPx < MIN_TICK_GAP) idxs.splice(idxs.length - 2, 1);
  }
  return idxs;
}

/** Nearest index in `rows` for a broadcast x value (exact, else nearest-time). */
function matchIndex(rows: Array<Record<string, unknown>>, xKey: string, activeX: string | number | null): number {
  if (activeX == null || rows.length === 0) return -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][xKey] === activeX) return i;
  }
  const target = toEpoch(activeX);
  if (!Number.isFinite(target)) return -1;
  let best = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rows.length; i++) {
    const t = toEpoch(rows[i][xKey]);
    if (!Number.isFinite(t)) continue;
    const diff = Math.abs(t - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

/** Measure an element's content width via ResizeObserver (SSR/jsdom-safe). */
function useElementWidth<T extends HTMLElement>(): { ref: React.RefObject<T | null>; width: number } {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const initial = el.getBoundingClientRect().width;
    if (initial > 0) setWidth(initial);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect?.width ?? 0;
        if (w > 0) setWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/* ── The visx canvas for a single cell ── */

interface SmallMultiplesCanvasProps {
  sig: string;
  label: string;
  color: string;
  cellHeight: number;
  rows: Array<Record<string, unknown>>;
  xKey: string;
}

function SmallMultiplesCanvas({ sig, label, color, cellHeight, rows, xKey }: SmallMultiplesCanvasProps) {
  const { formatTime } = useDateFormat();
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const { activeX, activeCellId, setCursor, clearCursor } = useContext(CursorContext);

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, cellHeight - MARGIN.top - MARGIN.bottom);
  const n = rows.length;

  // Scales + geometry only recompute on size/data change, never on cursor
  // movement — that keeps a 60-cell grid smooth while the crosshair tracks.
  const geometry = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      const v = toNumber(row[sig]);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }
    const { ticks: yTicks, lo, hi } = niceTicks(min, max);
    const xScale = scaleLinear<number>({ domain: [0, Math.max(n - 1, 1)], range: [0, innerWidth] });
    const yScale = scaleLinear<number>({ domain: [lo, hi], range: [innerHeight, 0] });
    const xTickIdxs = pickXTickIndices(n, innerWidth);
    return { xScale, yScale, yTicks, xTickIdxs };
  }, [rows, sig, n, innerWidth, innerHeight]);

  const { xScale, yScale, yTicks, xTickIdxs } = geometry;

  const cursorIdx = useMemo(() => matchIndex(rows, xKey, activeX), [rows, xKey, activeX]);
  const showTooltip = activeCellId === sig && cursorIdx >= 0 && innerWidth > 0;

  const indexFromPointer = useCallback(
    (e: ReactPointerEvent<SVGRectElement>): number => {
      if (n === 0 || innerWidth <= 0) return -1;
      const box = e.currentTarget.getBoundingClientRect();
      const px = Math.min(innerWidth, Math.max(0, e.clientX - box.left));
      return Math.round((px / innerWidth) * (n - 1));
    },
    [n, innerWidth],
  );

  const broadcast = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      const i = indexFromPointer(e);
      if (i < 0) return;
      const xv = rows[i]?.[xKey];
      setCursor(sig, typeof xv === 'number' || typeof xv === 'string' ? xv : null);
    },
    [indexFromPointer, rows, xKey, setCursor, sig],
  );

  // Mouse pointers clear on leave. Touch pointers keep the last reading
  // visible after the finger lifts so a tap-to-read works; the next tap or a
  // scroll-cancel replaces or clears it.
  const handleLeave = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      if (e.pointerType !== 'touch') clearCursor(sig);
    },
    [clearCursor, sig],
  );
  const handleCancel = useCallback(() => clearCursor(sig), [clearCursor, sig]);

  const cursorX = cursorIdx >= 0 ? xScale(cursorIdx) : 0;
  const cursorY = cursorIdx >= 0 ? yScale(toNumber(rows[cursorIdx]?.[sig])) : 0;

  const tooltipLabel = showTooltip ? rows[cursorIdx]?.[xKey] : undefined;
  const tooltipValue = showTooltip ? toNumber(rows[cursorIdx]?.[sig]) : 0;
  const tooltipLeft = MARGIN.left + cursorX;
  const tooltipFlip = tooltipLeft > width * 0.6;

  return (
    <div ref={ref} className="relative w-full" style={{ height: cellHeight }}>
      {width > 0 && n > 0 ? (
        <svg
          width={width}
          height={cellHeight}
          role="img"
          aria-label={label}
          className="block touch-pan-y overflow-visible"
        >
          {/* Horizontal grid lines at each y tick. */}
          <g>
            {yTicks.map((tickVal) => {
              const y = MARGIN.top + yScale(tickVal);
              return (
                <line
                  key={`g-${tickVal}`}
                  x1={MARGIN.left}
                  x2={MARGIN.left + innerWidth}
                  y1={y}
                  y2={y}
                  stroke="var(--glass-border)"
                  strokeOpacity={0.25}
                  strokeDasharray="3 3"
                />
              );
            })}
          </g>

          {/* Y axis tick labels. */}
          <g>
            {yTicks.map((tickVal) => (
              <text
                key={`y-${tickVal}`}
                x={MARGIN.left - 5}
                y={MARGIN.top + yScale(tickVal)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={9}
                fill="var(--text-muted)"
              >
                {formatAxisNumber(tickVal)}
              </text>
            ))}
          </g>

          {/* X axis tick labels. */}
          <g>
            {xTickIdxs.map((i) => (
              <text
                key={`x-${i}`}
                x={MARGIN.left + xScale(i)}
                y={cellHeight - 4}
                textAnchor="middle"
                fontSize={9}
                fill="var(--text-muted)"
              >
                {formatTime(String(rows[i]?.[xKey] ?? ''))}
              </text>
            ))}
          </g>

          {/* Plot area: line, crosshair, and pointer surface. */}
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            <LinePath<Record<string, unknown>>
              data={rows}
              x={(_d, i) => xScale(i)}
              y={(d) => yScale(toNumber(d[sig]))}
              curve={curveMonotoneX}
              stroke={color}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {cursorIdx >= 0 ? (
              <g aria-hidden="true">
                <line
                  x1={cursorX}
                  x2={cursorX}
                  y1={0}
                  y2={innerHeight}
                  stroke="var(--text-muted)"
                  strokeOpacity={0.45}
                  strokeDasharray="3 3"
                />
                <circle cx={cursorX} cy={cursorY} r={2.75} fill={color} />
              </g>
            ) : null}
            <rect
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              onPointerMove={broadcast}
              onPointerDown={broadcast}
              onPointerLeave={handleLeave}
              onPointerCancel={handleCancel}
            />
          </g>
        </svg>
      ) : null}

      {showTooltip ? (
        <div
          className="pointer-events-none absolute z-20 top-0"
          style={{
            left: tooltipLeft,
            transform: tooltipFlip ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
          }}
        >
          <ChartTooltip
            active
            payload={[{ name: label, value: tooltipValue, color }]}
            label={
              typeof tooltipLabel === 'string' || typeof tooltipLabel === 'number' ? tooltipLabel : undefined
            }
          />
        </div>
      ) : null}
    </div>
  );
}
