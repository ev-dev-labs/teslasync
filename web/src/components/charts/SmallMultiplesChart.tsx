/**
 * SmallMultiplesChart — grid of mini line charts, one per series.
 *
 * The "small multiples" / "trellis" / Grafana-style "Stat panel grid"
 * visualization. Each cell renders one series with its own y-scale so
 * series with very different magnitudes don't compress each other into
 * a flat line, which is the classic failure mode of overlay charts when
 * many series are pinned at once.
 *
 * Cells share a single `syncId` so hovering one cell moves the crosshair
 * in every other cell at the same timestamp — that's the whole point of
 * small multiples. Per-cell tooltips remain local to keep noise down.
 *
 * Performance — three layers (added when 50+ cells started hanging):
 *   1. Per-cell data projection: each cell only sees rows where its
 *      series has a finite numeric value, NOT the full time-aligned
 *      matrix. A signal with 11 points stops scanning 5,021 rows.
 *   2. Stride downsampling: each cell capped at `maxPointsPerCell`
 *      (default 400). Visually indistinguishable at the cell's pixel
 *      width but huge perf win for high-frequency series.
 *   3. Lazy-mount via IntersectionObserver: off-screen cells render a
 *      lightweight placeholder until scrolled into view. With 60 cells
 *      we mount ~9 ResponsiveContainers up-front instead of all 60.
 *
 * Reusable: this component knows nothing about telemetry signals. It
 * takes a `data` array (one row per timestamp) and a list of `series`
 * keys to project out into individual cells. Lives in `components/
 * charts/` so any feature that needs "show me N series side-by-side
 * with shared time axis" can use it.
 */

import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from '@/components/charts';
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
   * single biggest perf win in this component — recharts no longer
   * iterates 60 × 5,021 = 300k row-cells on every render pass.
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

  const gridStyle = useMemo<React.CSSProperties>(
    () =>
      columns && columns > 0
        ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
        : { gridTemplateColumns: `repeat(auto-fill, minmax(${cellMinWidth}px, 1fr))` },
    [columns, cellMinWidth],
  );

  const noData = emptyCellLabel ?? t('smallMultiples.noData', 'No data');

  return (
    <div
      className={cn('grid gap-3', className)}
      style={gridStyle}
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
            syncId={resolvedSyncId}
            noData={noData}
            onCellClick={onCellClick}
          />
        );
      })}
    </div>
  );
}

/**
 * Single cell — extracted so each can use its own `useInView` and
 * lazy-mount the heavy ResponsiveContainer + LineChart only when it
 * scrolls into view. Off-screen cells render a slim placeholder of the
 * same height so scroll position stays stable.
 */
interface SmallMultiplesCellProps {
  sig: string;
  label: string;
  color: string;
  cellHeight: number;
  hasData: boolean;
  rows: Array<Record<string, unknown>>;
  xKey: string;
  syncId: string;
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
  syncId,
  noData,
  onCellClick,
}: SmallMultiplesCellProps) {
  const { formatTime } = useDateFormat();
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '300px' });
  const cellInteractive = Boolean(onCellClick);
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-md border border-[var(--glass-border)] bg-[var(--glass-bg-subtle,transparent)] p-2',
        cellInteractive && 'cursor-pointer hover:border-[var(--theme-primary)]',
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
          className="truncate font-mono text-xs font-semibold"
          style={{ color }}
          title={label}
        >
          {label}
        </span>
      </div>
      {!hasData ? (
        <div
          className="flex items-center justify-center text-2xs text-[var(--text-muted)]"
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
        <ResponsiveContainer width="100%" height={cellHeight}>
          <LineChart
            data={rows}
            syncId={syncId}
            margin={{ top: 4, right: 6, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--glass-border)"
              strokeOpacity={0.25}
              vertical={false}
            />
            <XAxis
              dataKey={xKey}
              tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
              tickFormatter={(v: string) => formatTime(v)}
              minTickGap={24}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
              width={32}
              tickLine={false}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<ChartTooltip />} />
            <Line
              type="monotone"
              dataKey={sig}
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              name={label}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
