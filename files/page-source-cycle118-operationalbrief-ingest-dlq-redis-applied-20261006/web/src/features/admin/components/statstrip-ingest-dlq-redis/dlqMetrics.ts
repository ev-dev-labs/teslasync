import type { StatMetric } from '@/components/data-display';
import type { StatPeriod } from '@/lib/metric-reference';
import type { DLQListResponse } from '@/types/admin-diagnostics';

type Translate = (key: string, fallback: string) => string;

export function dlqMetrics(
  data: DLQListResponse | undefined, t: Translate,
): { metrics: StatMetric[]; period: StatPeriod } {
  const entries = data?.entries;
  const count = data?.count;
  const replayable = entries?.every(entry => typeof entry.replayable === 'boolean')
    ? entries.filter(entry => entry.replayable).length : undefined;
  const blocked = count != null && replayable != null ? Math.max(0, count - replayable) : undefined;
  const reasons = entries ? new Set(entries.map(entry =>
    entry.parsed_reason?.trim() || t('admin.dlq.reasons.unknown', 'unknown'))).size : undefined;
  const bytes = entries?.every(entry => Number.isFinite(entry.raw_payload_size) && entry.raw_payload_size >= 0)
    ? entries.reduce((sum, entry) => sum + entry.raw_payload_size, 0) : undefined;
  const replayMode = typeof data?.replay_enabled === 'boolean'
    ? data.replay_enabled ? t('admin.dlq.stats.enabled', 'Enabled') : t('admin.dlq.stats.disabled', 'Disabled')
    : undefined;
  return {
    period: { kind: 'snapshot', label: t('admin.dlq.stats.aria', 'Dead-letter queue summary'),
      observedAt: null, provenance: t('admin.dlq.stats.totalSub', 'in dead-letter queue') },
    metrics: [
      { metricId: 'count', occurrenceId: 'total', rawValue: count,
        label: t('admin.dlq.stats.total', 'Total entries'),
        context: t('admin.dlq.stats.totalSub', 'in dead-letter queue') },
      { metricId: 'count', occurrenceId: 'replayable', rawValue: replayable,
        label: t('admin.dlq.stats.replayable', 'Replayable'),
        context: t('admin.dlq.stats.replayableSub', 'parsed with source topic') },
      { metricId: 'count', occurrenceId: 'blocked', rawValue: blocked,
        label: t('admin.dlq.stats.blocked', 'Blocked'),
        context: t('admin.dlq.stats.blockedSub', 'no replay target') },
      { metricId: 'count', occurrenceId: 'reasons', rawValue: reasons,
        label: t('admin.dlq.stats.reasons', 'Distinct reasons'),
        context: t('admin.dlq.stats.reasonsSub', 'unique failure causes') },
      { metricId: 'bytes', occurrenceId: 'payload', rawValue: bytes,
        label: t('admin.dlq.stats.payload', 'Total payload'),
        context: t('admin.dlq.stats.payloadSub', 'raw bytes queued') },
      { metricId: 'status', occurrenceId: 'mode', rawValue: replayMode,
        label: t('admin.dlq.stats.replayMode', 'Replay mode'),
        context: t('admin.dlq.stats.replayModeSub', 'DLQ_REPLAY_ENABLED env') },
    ],
  };
}
