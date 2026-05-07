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
}

interface TimelineBucket {
  time: string;
  [fsmType: string]: string | number;
}

export function FSMTimelineChart({ transitions, hours }: FSMTimelineChartProps) {
  const { t } = useTranslation();

  const { buckets, fsmTypes } = useMemo(() => {
    if (transitions.length === 0) return { buckets: [] as TimelineBucket[], fsmTypes: [] as string[] };

    // Determine bucket size: ≤6h → 10min, ≤24h → 30min, else 2h
    const bucketMs = hours <= 6 ? 10 * 60_000 : hours <= 24 ? 30 * 60_000 : 2 * 60 * 60_000;

    const now = Date.now();
    const start = now - hours * 60 * 60_000;

    // Collect FSM names
    const typeSet = new Set<string>();
    for (const tr of transitions) typeSet.add(tr.fsm_name);
    const types = Array.from(typeSet).sort();

    // Create buckets
    const bucketMap = new Map<number, Record<string, number>>();
    for (let ts = start; ts <= now; ts += bucketMs) {
      const key = Math.floor(ts / bucketMs) * bucketMs;
      const record: Record<string, number> = {};
      for (const type of types) record[type] = 0;
      bucketMap.set(key, record);
    }

    // Fill buckets
    for (const tr of transitions) {
      const ts = new Date(tr.ts).getTime();
      const key = Math.floor(ts / bucketMs) * bucketMs;
      const bucket = bucketMap.get(key);
      if (bucket) {
        bucket[tr.fsm_name] = (bucket[tr.fsm_name] ?? 0) + 1;
      }
    }

    // Convert to array
    const result: TimelineBucket[] = Array.from(bucketMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, counts]) => {
        const d = new Date(ts);
        const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        return { time: timeStr, ...counts };
      });

    return { buckets: result, fsmTypes: types };
  }, [transitions, hours]);

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
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('fsm.noTimelineData', 'No transition data for timeline')} />
      )}
    </ChartContainer>
  );
}
