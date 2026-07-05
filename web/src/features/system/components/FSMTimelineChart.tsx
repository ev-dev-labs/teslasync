import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, CHART_COLORS,
  ChartContainer, ChartTooltip, chartGrid, axisTick,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import type { FSMTransition } from '@/types/fsm';

interface FSMTimelineChartProps {
  transitions: FSMTransition[];
  hours: number;
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
 * Axis label for a bucket start. Bare `HH:MM` inside a single day; prefixed with
 * `MM/DD` once the window spans more than a day so the 7d / 30d / 90d / all-time
 * views never render ambiguous, colliding time-of-day ticks.
 */
function bucketLabel(ts: number, bucketMs: number, spanMs: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  if (bucketMs >= DAY_MS) return md;
  if (spanMs > DAY_MS) return `${md} ${hh}:${mm}`;
  return `${hh}:${mm}`;
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
 */
export function buildFsmTimeline(
  transitions: readonly FSMTransition[] | null | undefined,
  hours: number,
  now: number = Date.now(),
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
  if (Number.isFinite(hours) && hours > 0) {
    end = now;
    start = now - hours * HOUR_MS;
  } else {
    let min = Infinity;
    let max = -Infinity;
    for (const tr of rows) {
      const ms = new Date(tr.ts).getTime();
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
  while (spanMs / bucketMs > MAX_BUCKETS) bucketMs *= 2;

  // Seed every in-window bucket with a zero per series (stacked areas need a
  // value at every x, not just where a transition happened to land).
  const bucketMap = new Map<number, Record<string, number>>();
  for (let key = Math.floor(start / bucketMs) * bucketMs; key <= end; key += bucketMs) {
    const record: Record<string, number> = {};
    for (const type of fsmTypes) record[type] = 0;
    bucketMap.set(key, record);
  }

  for (const tr of rows) {
    if (!tr || typeof tr.fsm_name !== 'string' || tr.fsm_name === '') continue;
    const ms = new Date(tr.ts).getTime();
    if (!Number.isFinite(ms)) continue;
    const key = Math.floor(ms / bucketMs) * bucketMs;
    const bucket = bucketMap.get(key);
    if (bucket) bucket[tr.fsm_name] = (bucket[tr.fsm_name] ?? 0) + 1;
  }

  const buckets: FsmTimelinePoint[] = Array.from(bucketMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, counts]) => ({ time: bucketLabel(ts, bucketMs, spanMs), ...counts }));

  return { buckets, fsmTypes };
}

export function FSMTimelineChart({ transitions, hours, emptyMessage }: FSMTimelineChartProps) {
  const { t } = useTranslation();

  const { buckets, fsmTypes } = useMemo(
    () => buildFsmTimeline(transitions, hours),
    [transitions, hours],
  );

  // chart-a11y:no-table dynamic per-FSM-type stacked series; transition list view holds the per-row detail
  return (
    <ChartContainer
      title={t('fsm.timelineChart', 'Transitions Over Time')}
      ariaLabel={t('fsm.timelineChart.aria', 'FSM transitions over time stacked area chart')}
      height={260}
    >
      {buckets.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={buckets}>
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="time" {...axisTick} />
            <YAxis {...axisTick} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            {fsmTypes.map((type, i) => (
              <Area
                key={type}
                type="monotone"
                dataKey={type}
                stackId="1"
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                fillOpacity={0.3}
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
