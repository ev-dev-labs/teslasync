import type { StatMetric } from '@/components/data-display';
import type { StatPeriod } from '@/lib/metric-reference';
import type { RedisSignalsResponse } from '@/api/hooks/useRedisSignals';

type Translate = (key: string, fallback: string) => string;

export function redisMetrics(
  data: RedisSignalsResponse | undefined, t: Translate,
  formatDateTime: (value: string) => string,
): { metrics: StatMetric[]; period: StatPeriod } {
  const entries = data?.signals ? Object.values(data.signals) : undefined;
  const count = (type: string) => entries?.filter(entry => entry.type === type).length;
  const freshness = (value: string | null | undefined) => value ? formatDateTime(value) : '—';
  return {
    period: { kind: 'snapshot', label: t('redis.cachedSignals', 'Cached signals'), observedAt: null,
      provenance: t('redis.subtitle', 'Inspect cached signal values in Redis (L2)') },
    metrics: [
      { metricId: 'count', occurrenceId: 'total', rawValue: data?.signal_count,
        label: t('redis.totalSignals', 'Total signals') },
      { metricId: 'count', occurrenceId: 'numeric', rawValue: count('number'),
        label: t('redis.numbers', 'Numbers') },
      { metricId: 'count', occurrenceId: 'string', rawValue: count('string'),
        label: t('redis.strings', 'Strings') },
      { metricId: 'count', occurrenceId: 'boolean', rawValue: count('boolean'),
        label: t('redis.booleans', 'Booleans') },
      { metricId: 'count', occurrenceId: 'l1', rawValue: data?.meta?.l1_signal_count,
        label: t('redis.l1Signals', 'L1 signals'),
        context: `${t('redis.l1Subtitle', 'In-process store')} · ${t('redis.diag.l1Seen', 'L1 last seen')}: ${freshness(data?.meta?.l1_last_seen_at)}` },
      { metricId: 'count', occurrenceId: 'l2', rawValue: data?.meta?.redis_field_count,
        label: t('redis.l2Fields', 'L2 fields'),
        context: `${t('redis.l2Subtitle', 'Redis HSET')} · ${t('redis.diag.l2Seen', 'L2 last seen')}: ${freshness(data?.meta?.l2_last_seen_at)}` },
    ],
  };
}
