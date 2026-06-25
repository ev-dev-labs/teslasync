// Native parity port of web/src/components/charts/SmallMultiplesChart.tsx.
// Replaces Recharts, DOM grid layout, keyboard events, and
// IntersectionObserver lazy mounting with React Native-safe chart primitives.

import React, {useCallback, useId, useMemo, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {CHART_COLORS} from './chartUtils';

export const SMALL_MULTIPLES_NATIVE_CAPABILITIES = {
  cursorSync: {
    available: false,
    reason:
      'Recharts syncId hover crosshair synchronization depends on browser SVG pointer events and is unavailable in this React Native parity renderer.',
  },
  lazyMount: {
    available: false,
    reason:
      'IntersectionObserver is a browser API; native cells render their downsampled chart bodies immediately.',
  },
  tooltip: {
    available: false,
    reason:
      'Recharts hover tooltips are replaced by always-visible per-cell latest-value summaries for touch/native parity.',
  },
} as const;

export interface SmallMultiplesChartProps<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Time-ordered rows. Each row holds `timestamp` + arbitrary series keys. */
  data: T[];
  /** Series keys to render -- one cell per entry. */
  series: string[];
  /** Optional friendly label per series. Defaults to the key. */
  seriesLabel?: (series: string) => string;
  /** dataKey on each row holding the x-axis value. Default `'timestamp'`. */
  xKey?: string;
  /** Pixel height of each cell chart body. Default 120. */
  cellHeight?: number;
  /** Minimum native cell width used by the wrapping flex grid. Default 280. */
  cellMinWidth?: number;
  /** Force a specific column count by assigning a percentage flex basis. */
  columns?: number;
  /** Preserved for API parity; native hover crosshair sync is unavailable. */
  syncId?: string;
  /** Map series -> color index. Defaults to position in `series`. */
  colorIndex?: Record<string, number>;
  /** Optional cell-click handler -- useful for drill-in to detail view. */
  onCellClick?: (series: string) => void;
  /** Empty-cell label when a series has no points in `data`. */
  emptyCellLabel?: string;
  /** Cap per-cell point count via stride downsampling. Default 400. */
  maxPointsPerCell?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

interface CellProjection {
  rows: Array<Record<string, unknown>>;
  hasData: boolean;
}

interface SmallMultiplesCellProps {
  sig: string;
  label: string;
  color: string;
  cellHeight: number;
  cellMinWidth: number;
  cellBasis: DimensionValue | undefined;
  hasData: boolean;
  rows: Array<Record<string, unknown>>;
  xKey: string;
  syncId: string;
  noData: string;
  onCellClick?: (series: string) => void;
}

interface ChartDomain {
  min: number;
  max: number;
}

interface PlotPoint {
  key: string;
  label: string;
  value: number;
  x: number;
  y: number;
}

interface PlotSegment {
  angle: string;
  key: string;
  left: number;
  top: number;
  width: number;
}

type NativeTFunction = (key: string, fallback: string) => string;

const DEFAULT_CELL_HEIGHT = 120;
const DEFAULT_CELL_MIN_WIDTH = 280;
const DEFAULT_MAX_POINTS_PER_CELL = 400;
const PLOT_PADDING = 8;
const STROKE_WIDTH = 1.5;
const GRID_LINES = [0, 50, 100] as const;
const Y_AXIS_WIDTH = 44;
const MIN_PLOT_WIDTH = 160;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

function isFinitePoint(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Stride-downsample to `cap` points, always preserving first + last. */
function strideSample<T>(rows: T[], cap: number): T[] {
  if (cap <= 0 || rows.length <= cap) {
    return rows;
  }

  const stride = Math.ceil(rows.length / cap);
  const sampled: T[] = [];
  for (let index = 0; index < rows.length; index += stride) {
    sampled.push(rows[index]);
  }
  const last = rows[rows.length - 1];
  if (sampled[sampled.length - 1] !== last) {
    sampled.push(last);
  }
  return sampled;
}

export function SmallMultiplesChart<
  T extends Record<string, unknown> = Record<string, unknown>,
>({
  data,
  series,
  seriesLabel,
  xKey = 'timestamp',
  cellHeight = DEFAULT_CELL_HEIGHT,
  cellMinWidth = DEFAULT_CELL_MIN_WIDTH,
  columns,
  syncId,
  colorIndex,
  onCellClick,
  emptyCellLabel,
  maxPointsPerCell = DEFAULT_MAX_POINTS_PER_CELL,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
}: SmallMultiplesChartProps<T>) {
  const t = useNativeTranslationFallback();
  const fallbackSyncId = useId();
  const resolvedSyncId = syncId ?? fallbackSyncId;
  const safeData = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const safeSeries = useMemo(
    () => (Array.isArray(series) ? series : []),
    [series],
  );

  const cellProjections = useMemo(() => {
    const map = new Map<string, CellProjection>();
    for (const sig of safeSeries) {
      const projected: Array<Record<string, unknown>> = [];
      for (const row of safeData) {
        const value = row[sig];
        if (isFinitePoint(value)) {
          projected.push({[xKey]: row[xKey], [sig]: value});
        }
      }
      const rows = strideSample(projected, maxPointsPerCell);
      map.set(sig, {rows, hasData: rows.length > 0});
    }
    return map;
  }, [maxPointsPerCell, safeData, safeSeries, xKey]);

  const cellBasis = useMemo<DimensionValue | undefined>(
    () =>
      columns && columns > 0
        ? (`${100 / columns}%` as DimensionValue)
        : undefined,
    [columns],
  );
  const noData = emptyCellLabel ?? t('smallMultiples.noData', 'No data');

  return (
    <View
      accessible
      accessibilityLabel={`Small multiples chart with ${
        safeSeries.length
      } series. Native cursor sync unavailable for ${resolvedSyncId}.`}
      accessibilityRole="summary"
      style={[styles.grid, style]}
      testID={testID ?? dataTestID ?? 'small-multiples-grid'}>
      {safeSeries.map((sig, index) => {
        const colorSlot = colorIndex?.[sig] ?? index;
        const color =
          CHART_COLORS[Math.max(0, colorSlot) % CHART_COLORS.length];
        const projection = cellProjections.get(sig);
        const label = seriesLabel ? seriesLabel(sig) : sig;

        return (
          <SmallMultiplesCell
            key={sig}
            cellBasis={cellBasis}
            cellHeight={cellHeight}
            cellMinWidth={cellMinWidth}
            color={color}
            hasData={projection?.hasData === true}
            label={label}
            noData={noData}
            onCellClick={onCellClick}
            rows={projection?.rows ?? []}
            sig={sig}
            syncId={resolvedSyncId}
            xKey={xKey}
          />
        );
      })}
    </View>
  );
}

function SmallMultiplesCell({
  sig,
  label,
  color,
  cellHeight,
  cellMinWidth,
  cellBasis,
  hasData,
  rows,
  xKey,
  syncId,
  noData,
  onCellClick,
}: SmallMultiplesCellProps) {
  const [plotWidth, setPlotWidth] = useState(0);
  const cellInteractive = Boolean(onCellClick);
  const domain = useMemo(() => buildDomain(rows, sig), [rows, sig]);
  const yTicks = useMemo(() => buildYTicks(domain), [domain]);
  const xTicks = useMemo(() => pickXTicks(rows), [rows]);
  const resolvedPlotWidth =
    plotWidth > 0
      ? plotWidth
      : Math.max(MIN_PLOT_WIDTH, cellMinWidth - Y_AXIS_WIDTH - spacing.lg);
  const points = useMemo(
    () => buildPlotPoints(rows, sig, xKey, domain, resolvedPlotWidth, cellHeight),
    [cellHeight, domain, resolvedPlotWidth, rows, sig, xKey],
  );
  const segments = useMemo(() => buildPlotSegments(points), [points]);
  const latestRow = rows[rows.length - 1];
  const latestValue = isFinitePoint(latestRow?.[sig])
    ? latestRow[sig]
    : undefined;
  const latestLabel = latestRow ? formatTime(latestRow[xKey]) : '-';

  const handlePress = useCallback(() => {
    onCellClick?.(sig);
  }, [onCellClick, sig]);

  const handlePlotLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (Number.isFinite(width) && width > 0) {
      setPlotWidth(width);
    }
  }, []);

  return (
    <Pressable
      accessibilityLabel={
        hasData
          ? `${label}. ${rows.length} points. Latest ${formatNumber(
              latestValue,
            )} at ${latestLabel}. Sync group ${syncId}.`
          : `${label}. ${noData}. Sync group ${syncId}.`
      }
      accessibilityRole={cellInteractive ? 'button' : 'summary'}
      accessibilityState={{disabled: !cellInteractive}}
      disabled={!cellInteractive}
      onPress={cellInteractive ? handlePress : undefined}
      style={({pressed}) => [
        styles.cell,
        {
          flexBasis: cellBasis,
          minWidth: cellBasis == null ? cellMinWidth : 0,
        },
        cellInteractive && styles.cellInteractive,
        pressed && styles.cellPressed,
      ]}
      testID={`small-multiples-cell-${sig}`}>
      <View pointerEvents="none" style={styles.header}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.colorDot, {backgroundColor: color}]}
        />
        <AppText
          numberOfLines={1}
          style={[styles.label, {color}]}
          variant="caption"
          weight="semibold">
          {label}
        </AppText>
      </View>

      {!hasData ? (
        <View style={[styles.emptyCell, {height: cellHeight}]}>
          <AppText tone="muted" variant="caption">
            {noData}
          </AppText>
        </View>
      ) : (
        <>
          <View style={[styles.chartFrame, {height: cellHeight}]}>
            <View style={styles.yAxis}>
              {yTicks.map((tick, index) => (
                <AppText
                  key={`${tick}-${index}`}
                  numberOfLines={1}
                  style={styles.axisLabel}
                  variant="caption">
                  {formatNumber(tick)}
                </AppText>
              ))}
            </View>

            <View style={styles.plotColumn}>
              <View onLayout={handlePlotLayout} style={styles.plotArea}>
                {GRID_LINES.map(line => (
                  <View
                    key={`grid-${line}`}
                    pointerEvents="none"
                    style={[
                      styles.gridLine,
                      {top: `${line}%` as DimensionValue},
                    ]}
                  />
                ))}
                {segments.map(segment => (
                  <View
                    key={segment.key}
                    pointerEvents="none"
                    style={[
                      styles.segment,
                      {
                        backgroundColor: color,
                        left: segment.left,
                        top: segment.top,
                        transform: [{rotateZ: segment.angle}],
                        width: segment.width,
                      },
                    ]}
                  />
                ))}
                {points.length === 1 ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.singlePoint,
                      {
                        backgroundColor: color,
                        left: points[0].x - 3,
                        top: points[0].y - 3,
                      },
                    ]}
                  />
                ) : null}
              </View>

              <View style={styles.xAxis}>
                {xTicks.map((row, index) => (
                  <AppText
                    key={`${String(row[xKey])}-${index}`}
                    numberOfLines={1}
                    style={styles.xAxisLabel}
                    variant="caption">
                    {formatTime(row[xKey])}
                  </AppText>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.latestRow}>
            <AppText numberOfLines={1} tone="muted" variant="caption">
              Latest
            </AppText>
            <AppText numberOfLines={1} variant="caption" weight="semibold">
              {formatNumber(latestValue)}
            </AppText>
            <AppText numberOfLines={1} tone="muted" variant="caption">
              {latestLabel}
            </AppText>
          </View>
        </>
      )}
    </Pressable>
  );
}

function buildDomain(
  rows: Array<Record<string, unknown>>,
  sig: string,
): ChartDomain {
  let min = 0;
  let max = 0;
  let hasValue = false;

  rows.forEach(row => {
    const value = row[sig];
    if (!isFinitePoint(value)) {
      return;
    }
    min = hasValue ? Math.min(min, value) : value;
    max = hasValue ? Math.max(max, value) : value;
    hasValue = true;
  });

  if (!hasValue) {
    return {max: 1, min: 0};
  }
  if (min === max) {
    const padding = Math.max(Math.abs(max) * 0.1, 1);
    return {max: max + padding, min: min - padding};
  }
  return {max, min};
}

function buildYTicks(domain: ChartDomain): number[] {
  return [domain.max, (domain.max + domain.min) / 2, domain.min];
}

function pickXTicks(rows: Array<Record<string, unknown>>) {
  if (rows.length <= 3) {
    return rows;
  }

  const last = rows.length - 1;
  return [rows[0], rows[Math.round(last / 2)], rows[last]];
}

function buildPlotPoints(
  rows: Array<Record<string, unknown>>,
  sig: string,
  xKey: string,
  domain: ChartDomain,
  width: number,
  height: number,
): PlotPoint[] {
  const drawableWidth = Math.max(1, width - PLOT_PADDING * 2);
  const drawableHeight = Math.max(1, height - PLOT_PADDING * 2);
  const span = domain.max - domain.min || 1;

  return rows
    .map((row, index) => {
      const value = row[sig];
      if (!isFinitePoint(value)) {
        return null;
      }
      const ratio = rows.length <= 1 ? 0.5 : index / (rows.length - 1);
      const scaled = (value - domain.min) / span;
      return {
        key: `${index}-${String(row[xKey])}`,
        label: formatTime(row[xKey]),
        value,
        x: PLOT_PADDING + ratio * drawableWidth,
        y: PLOT_PADDING + (1 - scaled) * drawableHeight,
      };
    })
    .filter((point): point is PlotPoint => point != null);
}

function buildPlotSegments(points: PlotPoint[]): PlotSegment[] {
  return points.slice(1).map((point, index) => {
    const previousPoint = points[index];
    const deltaX = point.x - previousPoint.x;
    const deltaY = point.y - previousPoint.y;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const midpointX = previousPoint.x + deltaX / 2;
    const midpointY = previousPoint.y + deltaY / 2;
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

    return {
      angle: `${angle}deg`,
      key: `${previousPoint.key}-${point.key}`,
      left: midpointX - length / 2,
      top: midpointY - STROKE_WIDTH / 2,
      width: length,
    };
  });
}

function formatTime(value: unknown): string {
  if (value == null || value === '') {
    return '-';
  }

  const raw = value instanceof Date ? value.toISOString() : String(value);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatNumber(value: number | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }

  const abs = Math.abs(value);
  const precision = abs >= 100 ? 0 : abs >= 10 ? 1 : decimals;
  return value.toLocaleString('en-US', {
    maximumFractionDigits: precision,
    minimumFractionDigits: 0,
  });
}

const styles = StyleSheet.create({
  axisLabel: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'right',
  },
  cell: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexGrow: 1,
    gap: spacing.sm,
    margin: spacing.xs,
    overflow: 'hidden',
    padding: spacing.md,
  },
  cellInteractive: {
    borderColor: colors.borderAccent,
  },
  cellPressed: {
    opacity: 0.72,
  },
  chartFrame: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  colorDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  emptyCell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    width: '100%',
  },
  gridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.52,
    position: 'absolute',
    right: 0,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 18,
  },
  label: {
    flex: 1,
    fontFamily: 'monospace',
    minWidth: 0,
  },
  latestRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  plotArea: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  plotColumn: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  segment: {
    borderRadius: STROKE_WIDTH / 2,
    height: STROKE_WIDTH,
    position: 'absolute',
  },
  singlePoint: {
    borderColor: colors.background,
    borderRadius: 3,
    borderWidth: 1,
    height: 6,
    position: 'absolute',
    width: 6,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 16,
  },
  xAxisLabel: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 10,
    minWidth: 0,
    textAlign: 'center',
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingBottom: 18,
    width: Y_AXIS_WIDTH,
  },
});
