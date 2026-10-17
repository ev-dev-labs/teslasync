import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CHART_COLORS,
  ChartContainer, ChartTooltip, chartGrid, axisTick,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { chartTokens } from '@/lib/tokens';
import type { FSMTransition } from '@/types/fsm';
import { useDateFormat } from '@/hooks/useDateFormat';
import { formatDate, formatDateShort, formatTime, type FormatOptions } from '@/lib/dateFormat';

interface FSMTimelineChartProps {
  transitions: FSMTransition[];
  hours: number;
  startInstant?: string;
  endInstantExclusive?: string;
  emptyMessage?: string;
}

/** One x-axis bucket: a `time` label plus a per-series (FSM/target-state) count. */
export interface FsmTimelinePoint {
  time: string;
  [fsmType: string]: string | number;
}

/** Result of {@link buildFsmTimeline}: plot-ready buckets + the stacked series keys. */
export interface FsmTimeline {
  buckets: FsmTimelinePoint[];
  fsmTypes: string[];
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Hard ceiling on the bucket count. Real presets top out around 1,080 buckets
 * (90 days at 2h); the cap only ever engages for a pathological span, where it
 * widens the bucket instead of letting the Map grow without bound — a non-finite
 * or multi-year window would otherwise freeze the tab / exhaust memory.
 */
const MAX_BUCKETS = 5_000;

/** Bucket width for a window of the given span (preserves the original tiers). */
function bucketWidthMs(spanHours: number): number {
  if (spanHours <= 6) return 10 * MINUTE_MS;
  if (spanHours <= 24) return 30 * MINUTE_MS;
  return 2 * HOUR_MS;
}

/**
 * Include a saved-zone date when the window crosses a calendar-day boundary.
 */
function bucketLabel(ts: number, bucketMs: number, showDate: boolean, opts?: FormatOptions): string {
  const d = new Date(ts);
  if (bucketMs >= DAY_MS) return formatDateShort(d, opts);
  if (showDate) return `${formatDateShort(d, opts)} ${formatTime(d, opts)}`;
  return formatTime(d, opts);
}

/**
 * Bucket FSM transitions into a stacked-area timeline.
 *
 * A positive, finite `hours` is a rolling-from-`now` window (the range presets).
 * `hours <= 0` or a non-finite value means "all time": the window is derived
 * from the actual transition timestamps so the chart spans the data instead of
 * collapsing to a single trailing bucket (and a non-finite `hours` can never spin
 * the bucket loop forever). Malformed rows (unparseable `ts`, empty `fsm_name`)
 * and out-of-window transitions are skipped; `transitions` may be null/undefined.
 * Explicit bounds override the rolling clock and use `[start, endExclusive)`.
 */
export function buildFsmTimeline(
  transitions: readonly FSMTransition[] | null | undefined,
  hours: number,
  now: number = Date.now(),
  startInstant?: string,
  endInstantExclusive?: string,
  opts?: FormatOptions,
): FsmTimeline {
  const rows = Array.isArray(transitions) ? transitions : [];
  if (rows.length === 0) return { buckets: [], fsmTypes: [] };

  const typeSet = new Set<string>();
  for (const tr of rows) {
    if (tr && typeof tr.fsm_name === 'string' && tr.fsm_name !== '') typeSet.add(tr.fsm_name);
  }
  const fsmTypes = Array.from(typeSet).sort();
  if (fsmTypes.length === 0) return { buckets: [], fsmTypes: [] };

  let start: number;
  let end: number;
  const hasExactBounds = Boolean(startInstant && endInstantExclusive);
  if (startInstant && endInstantExclusive) {
    start = Date.parse(startInstant);
    end = Date.parse(endInstantExclusive);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new RangeError('FSM timeline requires valid increasing range bounds');
    }
  } else if (Number.isFinite(hours) && hours > 0) {
    end = now;
    start = now - hours * HOUR_MS;
  } else {
    let min = Infinity;
    let max = -Infinity;
    for (const tr of rows) {
      const ms = Date.parse(tr.ts);
      if (Number.isFinite(ms)) {
        if (ms < min) min = ms;
        if (ms > max) max = ms;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { buckets: [], fsmTypes };
    start = min;
    end = max;
  }
  if (!(end >= start)) return { buckets: [], fsmTypes };

  const spanMs = end - start;
  let bucketMs = bucketWidthMs(spanMs / HOUR_MS);
  const lastInstant = hasExactBounds ? end - 1 : end;
  const bucketCount = () =>
    Math.floor(lastInstant / bucketMs) - Math.floor(start / bucketMs) + 1;
  while (bucketCount() > MAX_BUCKETS) bucketMs *= 2;

  // Seed every in-window bucket with a zero per series (stacked areas need a
  // value at every x, not just where a transition happened to land).
  const bucketMap = new Map<number, Record<string, number>>();
  for (let key = Math.floor(start / bucketMs) * bucketMs; key <= lastInstant; key += bucketMs) {
    const record: Record<string, number> = {};
    for (const type of fsmTypes) record[type] = 0;
    bucketMap.set(key, record);
  }

  for (const tr of rows) {
    if (!tr || typeof tr.fsm_name !== 'string' || tr.fsm_name === '') continue;
    const ms = Date.parse(tr.ts);
    if (!Number.isFinite(ms)) continue;
    if (ms < start || (hasExactBounds ? ms >= end : ms > end)) continue;
    const key = Math.floor(ms / bucketMs) * bucketMs;
    const bucket = bucketMap.get(key);
    if (bucket) bucket[tr.fsm_name] = (bucket[tr.fsm_name] ?? 0) + 1;
  }

  const showDate = spanMs > DAY_MS
    || formatDate(new Date(Math.floor(start / bucketMs) * bucketMs), opts)
      !== formatDate(new Date(lastInstant), opts);
  const buckets: FsmTimelinePoint[] = Array.from(bucketMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, counts]) => ({
      time: bucketLabel(ts, bucketMs, showDate, opts),
      ...counts,
    }));

  return { buckets, fsmTypes };
}

export function FSMTimelineChart({
  transitions, hours, startInstant, endInstantExclusive, emptyMessage,
}: FSMTimelineChartProps) {
  const { t } = useTranslation();
  const { opts } = useDateFormat();

  const { buckets, fsmTypes } = useMemo(
    () => buildFsmTimeline(transitions, hours, Date.now(), startInstant, endInstantExclusive, opts),
    [transitions, hours, startInstant, endInstantExclusive, opts],
  );

  // chart-a11y:no-table dynamic per-FSM-type stacked series; transition list view holds the per-row detail
  return (
    <ChartContainer
      title={t('fsm.timelineChart', 'Transitions over time')}
      ariaLabel={t('fsm.timelineChartAria', 'FSM transitions over time stacked area chart')}
      height={260}
    >
      {buckets.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={buckets}>
            {chartGrid}
            <XAxis dataKey="time" {...axisTick} />
            <YAxis {...axisTick} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={chartTokens.cursor} />
            {fsmTypes.map((type, i) => (
              <Area
                key={type}
                type="monotone"
                dataKey={type}
                stackId="1"
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={2}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                fillOpacity={0.08}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={emptyMessage ?? t('fsm.noTimelineData', 'No transition data for timeline')} />
      )}
    </ChartContainer>
  );
}
