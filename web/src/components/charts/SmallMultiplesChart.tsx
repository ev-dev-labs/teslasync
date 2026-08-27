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
import { downsampleChartRows } from './chartSampling';

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
  showDots: boolean;
}

function lowerQuartile(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.25)] ?? 0;
}

/**
 * Project a union-timestamp series without treating every absent union row as
 * a telemetry outage. Regular sparse cadence rows are omitted; only a gap
 * substantially larger than the signal's lower-quartile cadence gets one null marker.
 * Finite samples get dots in that sparse mode, so isolated observations stay
 * visible while true outages still break the line.
 */
export function projectSmallMultipleSeries(
  data: readonly Record<string, unknown>[],
  signal: string,
  xKey: string,
  maxPoints: number,
): CellProjection {
  const finiteIndexes = data.flatMap((row, index) =>
    isFinitePoint(row[signal]) ? [index] : [],
  );
  const cadence = finiteIndexes.length >= 3
    ? lowerQuartile(finiteIndexes.slice(1).map((index, position) => index - finiteIndexes[position]))
    : 0;
  const finiteRows = finiteIndexes.map((index) => ({
    index,
    row: { [xKey]: data[index][xKey], [signal]: data[index][signal] },
  }));
  const rawMarkers = cadence > 0 ? finiteIndexes.slice(1).flatMap((nextIndex, position) => {
    const previousIndex = finiteIndexes[position];
    // Three cadence intervals is deliberately conservative: burst pairs
    // establish the lower cadence while normal sparse sampling remains joined.
    if (nextIndex - previousIndex <= cadence * 3) return [];
    const markerIndex = Math.min(nextIndex - 1, previousIndex + cadence);
    return [{ index: markerIndex, row: { [xKey]: data[markerIndex][xKey], [signal]: null } }];
  }) : [];
  // Marker count is capped as part of the same rendering budget. This retains
  // outage semantics without turning a sparse union matrix back into its full
  // cross-product of null rows.
  const markerBudget = Math.min(rawMarkers.length, Math.floor(Math.max(0, maxPoints) / 3));
  const markers = downsampleChartRows(rawMarkers, Math.max(2, markerBudget)).rows
    .slice(0, markerBudget);
  const valueBudget = Math.max(2, Math.max(0, Math.floor(maxPoints)) - markers.length);
  const values = downsampleChartRows(finiteRows, valueBudget).rows;
  const rows = [...values, ...markers]
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.row);
  return {
    rows,
    hasData: finiteRows.length > 0,
    showDots: finiteRows.length < data.length,
  };
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
   * series, retaining null rows as visible gaps, then stride-sample down to
   * `maxPointsPerCell`. This is the
   * single biggest perf win in this component — recharts no longer
   * iterates 60 × 5,021 = 300k row-cells on every render pass.
   */
  const cellProjections = useMemo(() => {
    const map = new Map<string, CellProjection>();
    for (const sig of series) {
      map.set(sig, projectSmallMultipleSeries(data, sig, xKey, maxPointsPerCell));
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
            showDots={projection?.showDots ?? false}
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
  showDots: boolean;
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
  showDots,
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
              dot={showDots ? { r: 2, strokeWidth: 0 } : false}
              name={label}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
