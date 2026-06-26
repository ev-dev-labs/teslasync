// Native parity port of
// web/src/features/trips/components/TripReplayCharts.tsx.
//
// `TripReplayCharts` wraps the trip-replay speed/power timeline chart in a
// `<ChartTimeRangeProvider syncId syncMethod="value">` and bridges the
// persistent cursor-sync store to the parent's `onSeekToIndex` callback. The
// public API (`TripReplayChartPoint`, `TripReplayChartsProps`), every state /
// prop name (`data`, `currentIndex`, `speedUnit`, `onSeekToIndex`, `syncId`,
// `height`, `cursorTime`, `lastForwardedRef`), the `syncMethod="value"`
// contract, the click-to-seek index math, and the `nearestIndexByTime` binary
// search are preserved verbatim. The render-only `ChartCursorBridge` sibling
// (so cursor moves re-render the bridge, not the chart) is kept structurally
// identical and stays fully functional against the native in-memory sync store.
//
// Web modules -> native-safe mappings (contract rules 4-7, documented in the
// sidecar):
//   - react (`useEffect`/`useMemo`/`useRef`, L1) -> kept (RN-compatible).
//   - react-i18next `useTranslation` (L2) -> a local key-preserving fallback
//     shim (no react-i18next in the native deps). i18next resolves a missing
//     translation to the supplied default, so `t(key, 'English')` -> 'English'
//     and `t(key)` -> key — the SpeedProfilePage / ChargingDetailPage precedent.
//   - lucide-react `Activity` (L3, SVG) has no native analog -> a decorative
//     a11y-hidden 📈 emoji `Glyph` (the ChargingDetailPage chart empty-state
//     precedent); the adjacent message carries the meaning.
//   - the `@/components/charts` barrel (L4-23) -> the reused web-parity charts
//     barrel, which preserves the Recharts public API while rendering
//     React-Native-safe placeholders (no Recharts / SVG / DOM). `ChartContainer`,
//     `ChartTimeRangeProvider`, `useSyncedCursor`, `useSyncedReferenceLineX`,
//     `AREA_DEFAULTS`, `areaGradient`, `axisTick`, `CHART_COLORS`, `fmt` are
//     reused 1:1; the leaf primitives (`AreaChart`/`Area`/`XAxis`/`YAxis`/
//     `Tooltip`/`ResponsiveContainer`/`ReferenceLine`) render inert accessible
//     placeholders. The web spread `<CartesianGrid {...chartGrid} />` becomes the
//     native `{chartGrid}` element (native `chartGrid` is a ready-to-render
//     placeholder, not a props object) — the ChargingDetailPage precedent.
//   - `EmptyState` from `@/components/feedback` (L24) -> a faithful local
//     `{ icon?, message }` shim (a centred muted message + optional glyph); the
//     shared native EmptyState requires a `title` the source never supplies.
//
// Native-unavailable behavior (contract rule 7, documented): the Recharts area
// chart, its SVG gradient fills, and DOM mouse events are unavailable on native,
// so the `onClick` (click-to-seek) and `onMouseMove` (hover cursor-sync) handlers
// + the visual `ReferenceLine` playhead and `cursor-pointer` affordance do not
// fire / render on the inert chart placeholder. They are kept structurally
// faithful (every `dataKey`/`stroke`/`fill`/`name`/`yAxisId`/`domain`/`syncId`/
// `syncMethod` verbatim) and the cursor-sync STORE + `ChartCursorBridge` remain
// fully functional for programmatic / cross-chart cursor moves. No DOM-only
// modules, browser HTML elements, Recharts, Leaflet, or old web UI components are
// imported.

import React, {useEffect, useMemo, useRef} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {spacing} from '../../../../theme/tokens';
import {
  Area,
  AreaChart,
  AREA_DEFAULTS,
  areaGradient,
  axisTick,
  chartGrid,
  CHART_COLORS,
  ChartContainer,
  ChartTimeRangeProvider,
  fmt,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  useSyncedCursor,
  useSyncedReferenceLineX,
  XAxis,
  YAxis,
} from '../../../components/charts';

/* ── i18n shim ─────────────────────────────────────────────────── */
// react-i18next has no native parity module. i18next resolves a missing
// translation to the supplied default, so: `t(key)` -> key; `t(key, 'English')`
// -> 'English'. No source call uses interpolation params.
type TFunc = (key: string, fallback?: string) => string;

const translate: TFunc = (key, fallback) =>
  typeof fallback === 'string' ? fallback : key;

function useTranslation(): {t: TFunc} {
  return {t: translate};
}

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
  return (
    <ChartTimeRangeProvider syncId={syncId} syncMethod="value">
      <TimelineChart
        data={data}
        currentIndex={currentIndex}
        speedUnit={speedUnit}
        onSeekToIndex={onSeekToIndex}
        height={height}
      />
      <ChartCursorBridge data={data} onSeekToIndex={onSeekToIndex} />
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
  const {t} = useTranslation();
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
      ariaLabel={t(
        'replay.timeline.aria',
        'Trip replay speed and power timeline area chart',
      )}
      height={height}
    >
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart
            data={data}
            syncId={syncProps.syncId}
            syncMethod={syncProps.syncMethod}
            onMouseMove={syncProps.onMouseMove}
            onClick={(state: {activeTooltipIndex?: number} | null) => {
              if (!state) return;
              const idx = state.activeTooltipIndex;
              if (typeof idx === 'number' && idx >= 0 && idx < data.length) {
                onSeekToIndex(data[idx].index);
              }
            }}
          >
            {areaGradient('speedGrad', CHART_COLORS[0])}
            {areaGradient('powerGrad', CHART_COLORS[1])}
            {chartGrid}
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
                style: {fontSize: 10, fill: '#9ca3af'},
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
                style: {fontSize: 10, fill: '#9ca3af'},
              }}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(0,0,0,0.85)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(v: number) => `${fmt(v, 1)} min`}
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
        // no-action: transient empty state — surfaces when source data is missing; no specific recovery action available
        <EmptyState
          icon="📈"
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
function ChartCursorBridge({data, onSeekToIndex}: ChartCursorBridgeProps) {
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
  if (data.length === 0) return 0;
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

/* ── decorative glyph (lucide icon substitute) ─────────────────── */
function Glyph({
  children,
  style,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      allowFontScaling={false}
      importantForAccessibility="no"
      style={style}>
      {children}
    </AppText>
  );
}

/* ── local EmptyState (web @/components/feedback EmptyState) ────── */
// Mirrors the API used here (`{ icon?, message }`): a centred muted message with
// an optional decorative glyph. The shared native EmptyState requires a `title`
// the source never supplies, so this icon+message shim stays faithful.
function EmptyState({icon, message}: {icon?: string; message: string}) {
  return (
    <View accessibilityRole="text" style={styles.emptyState}>
      {icon ? <Glyph style={styles.emptyIcon}>{icon}</Glyph> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyIcon: {
    fontSize: 28,
    marginBottom: spacing.sm,
    opacity: 0.4,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
});
