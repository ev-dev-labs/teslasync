import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ChartTooltip,
  ResponsiveContainer,
  ReferenceLine,
  ChartTimeRangeProvider,
  useSyncedCursor,
  useSyncedReferenceLineX,
  chartGrid,
  axisTick,
  fmt,
  CHART_COLORS,
  AREA_DEFAULTS,
  areaGradient,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';

/* ------------------------------------------------------------------ */
/*  Trip-replay charts with cursor sync                              */
/* ------------------------------------------------------------------ */

export interface TripReplayChartPoint {
  /** Index into the parent positions array. */
  index: number;
  /** Minutes since trip start (decimals OK). Doubles as the recharts
   *  X-axis dataKey AND the value used by the persistent cursor sync
   *  store, so `syncMethod="value"` is required on the provider. */
  time: number;
  /** Speed in user-preferred units. */
  speed: number;
  /** Power in kW. */
  power: number;
}

export interface TripReplayChartsProps {
  data: TripReplayChartPoint[];
  /** Drives the visual ReferenceLine that marks the playhead. */
  currentIndex: number;
  /** Speed unit label, shown on the left Y-axis. */
  speedUnit: string;
  /** Called when the user clicks the chart OR the persistent cursor
   *  sync moves (e.g. from another synced chart, or from this chart's
   *  own hover). The receiver should call `controls.seekTo(index)`. */
  onSeekToIndex: (index: number) => void;
  /** Stable identifier for the cursor-sync group. Defaults to
   *  `trip-replay`; exposed so tests can isolate per-render groups. */
  syncId?: string;
  height?: number;
}

/**
 * Wraps the trip-replay timeline chart in a
 * `<ChartTimeRangeProvider>` and bridges the persistent cursor-sync
 * store to the parent's `onSeekToIndex` callback.
 *
 * The bridge is a render-only sibling of the chart so the bridge's
 * `useSyncedReferenceLineX` subscription does not re-render the chart
 * itself when the cursor moves — only the parent (which owns
 * `currentIndex`) re-renders.
 */
export function TripReplayCharts({
  data,
  currentIndex,
  speedUnit,
  onSeekToIndex,
  syncId = 'trip-replay',
  height = 220,
}: TripReplayChartsProps) {
  // Defend the `.length` / `.map` / index access downstream against an
  // `undefined` data prop (the type says non-null, but a caller mid-load can
  // still pass nothing) — both children then fall back to the empty state.
  const safeData = data ?? [];
  return (
    <ChartTimeRangeProvider syncId={syncId} syncMethod="value">
      <TimelineChart
        data={safeData}
        currentIndex={currentIndex}
        speedUnit={speedUnit}
        onSeekToIndex={onSeekToIndex}
        height={height}
      />
      <ChartCursorBridge data={safeData} onSeekToIndex={onSeekToIndex} />
    </ChartTimeRangeProvider>
  );
}

/* ── chart ─────────────────────────────────────────────────────── */

interface TimelineChartProps {
  data: TripReplayChartPoint[];
  currentIndex: number;
  speedUnit: string;
  onSeekToIndex: (index: number) => void;
  height: number;
}

function TimelineChart({
  data,
  currentIndex,
  speedUnit,
  onSeekToIndex,
  height,
}: TimelineChartProps) {
  const { t } = useTranslation();
  const syncProps = useSyncedCursor();

  const cursorTime = useMemo(() => {
    if (data.length === 0) return undefined;
    return data[currentIndex]?.time;
  }, [data, currentIndex]);

  // chart-a11y:no-table dense per-sample replay timeline; per-segment summary appears in the trip overview panel
  return (
    <ChartContainer
      title={t('replay.timeline.title', 'Speed & Power Timeline')}
      subtitle={t('replay.timeline.subtitle', 'Click to seek replay position')}
      ariaLabel={t('replay.timeline.aria', 'Trip replay speed and power timeline area chart')}
      height={height}
    >
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart
            data={data}
            className="cursor-pointer"
            syncId={syncProps.syncId}
            syncMethod={syncProps.syncMethod}
            onMouseMove={syncProps.onMouseMove}
            onClick={(state: { activeTooltipIndex?: number } | null) => {
              if (!state) return;
              const idx = state.activeTooltipIndex;
              if (typeof idx === 'number' && idx >= 0 && idx < data.length) {
                onSeekToIndex(data[idx].index);
              }
            }}
          >
            {areaGradient('speedGrad', CHART_COLORS[0])}
            {areaGradient('powerGrad', CHART_COLORS[1])}
            <CartesianGrid {...chartGrid} />
            <XAxis
              dataKey="time"
              type="number"
              domain={['dataMin', 'dataMax']}
              {...axisTick}
              tickFormatter={(v: number) => `${fmt(v, 0)}m`}
            />
            <YAxis
              yAxisId="speed"
              {...axisTick}
              tickFormatter={(v: number) => fmt(v, 0)}
              label={{
                value: speedUnit,
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 10, fill: 'var(--text-muted)' },
              }}
            />
            <YAxis
              yAxisId="power"
              orientation="right"
              {...axisTick}
              tickFormatter={(v: number) => fmt(v, 0)}
              label={{
                value: 'kW',
                angle: 90,
                position: 'insideRight',
                style: { fontSize: 10, fill: 'var(--text-muted)' },
              }}
            />
            <Tooltip
              content={<ChartTooltip labelFormatter={(v) => `${fmt(v, 1)} min`} />}
            />
            <Area
              {...AREA_DEFAULTS}
              yAxisId="speed"
              dataKey="speed"
              name={t('replay.timeline.speed', 'Speed')}
              stroke={CHART_COLORS[0]}
              fill="url(#speedGrad)"
              isAnimationActive={false}
            />
            <Area
              {...AREA_DEFAULTS}
              yAxisId="power"
              dataKey="power"
              name={t('replay.timeline.power', 'Power')}
              stroke={CHART_COLORS[1]}
              fill="url(#powerGrad)"
              isAnimationActive={false}
            />
            {cursorTime != null && (
              <ReferenceLine
                x={cursorTime}
                stroke="#00b4d8"
                strokeWidth={2}
                strokeDasharray="4 2"
                yAxisId="speed"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Activity className="h-6 w-6" />}
          message={t('replay.timeline.noData', 'No telemetry data available')}
        />
      )}
    </ChartContainer>
  );
}

/* ── cursor sync bridge ─────────────────────────────────────────── */

interface ChartCursorBridgeProps {
  data: TripReplayChartPoint[];
  onSeekToIndex: (index: number) => void;
}

/**
 * Subscribes to the persistent cursor-sync store for the surrounding
 * provider's `syncId` and forwards moves into `onSeekToIndex`. Renders
 * nothing.
 *
 * Why a sibling component instead of folding the subscription into
 * `<TimelineChart>`: hover writes to the cursor-sync store on every
 * mousemove tick. Subscribing in the chart itself would re-render the
 * chart on every tick, defeating the whole point of the persistent
 * cursor pattern. As a sibling, only this 0-DOM bridge re-renders, and
 * the chart receives the new `currentIndex` from its parent the same
 * way it receives any other prop change.
 */
function ChartCursorBridge({ data, onSeekToIndex }: ChartCursorBridgeProps) {
  const cursorX = useSyncedReferenceLineX();

  // Track the last value we forwarded so we don't seek to the same
  // index every time React re-runs the effect after a parent state
  // change.
  const lastForwardedRef = useRef<number | null>(null);

  useEffect(() => {
    if (cursorX == null) return;
    const numeric = typeof cursorX === 'number' ? cursorX : Number(cursorX);
    if (!Number.isFinite(numeric)) return;
    if (data.length === 0) return;

    const idx = nearestIndexByTime(data, numeric);
    if (idx === lastForwardedRef.current) return;
    lastForwardedRef.current = idx;
    onSeekToIndex(data[idx].index);
  }, [cursorX, data, onSeekToIndex]);

  return null;
}

/** Binary search for the chart point whose `time` is closest to `target`. */
export function nearestIndexByTime(
  data: TripReplayChartPoint[],
  target: number,
): number {
  if (!data || data.length === 0) return 0;
  let lo = 0;
  let hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (data[mid].time < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && target - data[lo - 1].time < data[lo].time - target) {
    return lo - 1;
  }
  return lo;
}
