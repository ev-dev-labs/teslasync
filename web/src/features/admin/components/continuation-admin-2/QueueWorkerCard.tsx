import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { QueueStat, QueueHeartbeatSeverity } from '@/api/types';
import { Button, Text, Caption } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { formatRelative } from '@/lib/dateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const COLOR: Record<QueueHeartbeatSeverity, string> = { ok: '#10b981', warn: '#f59e0b', critical: '#ef4444', down: '#94a3b8' };
const TONE: Record<QueueHeartbeatSeverity, string> = { ok: 'text-emerald-300', warn: 'text-amber-300', critical: 'text-rose-300', down: 'text-[var(--text-muted)]' };

export function QueueWorkerCard({ stat, onOpen }: { stat: QueueStat; onOpen: (worker: string) => void }) {
  const { t } = useTranslation();
  const { fmtNumber, formatDurationMsLong } = useNumberFormatting();
  const total = stat.pending + stat.in_progress;
  const oldestLabel = useMemo(() => stat.oldest_pending_age_seconds <= 0 ? null
    : t('queueStatus.oldestPending', 'Oldest pending: {{duration}}', { duration: formatDurationMsLong(stat.oldest_pending_age_seconds * 1000) }),
  [stat.oldest_pending_age_seconds, t, formatDurationMsLong]);
  const lastBeatLabel = stat.last_heartbeat_at ? t('queueStatus.heartbeatRelative', 'Last beat {{when}}', { when: formatRelative(stat.last_heartbeat_at) })
    : t('queueStatus.heartbeatNever', 'No heartbeat recorded');
  return (
    <Button type="button" variant="ghost" size="auto" onClick={() => onOpen(stat.worker)}
      className="h-auto w-full min-w-0 flex-col items-stretch justify-start rounded-xl border border-[var(--border-default)] bg-[var(--surface-1)] p-4 text-start"
      data-testid={`queue-worker-card-${stat.worker}`} aria-label={t('queueStatus.openDrawer', 'Show recent {{worker}} jobs', { worker: stat.display_name })}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Text variant="bodySm" weight="semibold" className="break-words">{stat.display_name}</Text>
          <Caption className="mt-0.5 block break-words">{stat.host ? t('queueStatus.hostVersion', '{{host}} · {{version}}', {
            host: stat.host, version: stat.version || t('queueStatus.versionUnknown', 'unknown'),
          }) : t('queueStatus.hostUnknown', 'No host reported')}</Caption>
        </div>
        <div className="flex items-center gap-1">
          <Text variant="caption" className={TONE[stat.heartbeat_severity]} data-testid={`queue-severity-${stat.worker}`}>{t(`queueStatus.severity.${stat.heartbeat_severity}`, stat.heartbeat_severity)}</Text>
          <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
        </div>
      </div>
      <div className="mt-3"><MetricBar value={total} max={total > 0 ? total : 1} color={COLOR[stat.heartbeat_severity]} label={t('queueStatus.queueDepth', 'Queue depth')}
        sublabel={t('queueStatus.queueDepthDetail', '{{pending}} pending · {{inProgress}} in progress', { pending: fmtNumber(stat.pending), inProgress: fmtNumber(stat.in_progress) })} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div><Caption>{t('queueStatus.metric.succeeded24h', 'Succeeded 24h')}</Caption><Text variant="bodySm" weight="medium" className="text-emerald-300" data-testid={`queue-succeeded-${stat.worker}`}>{fmtNumber(stat.succeeded_24h)}</Text></div>
        <div><Caption>{t('queueStatus.metric.failed24h', 'Failed 24h')}</Caption><Text variant="bodySm" weight="medium" className={stat.failed_24h > 0 ? 'text-rose-300' : 'text-[var(--text-primary)]'} data-testid={`queue-failed-${stat.worker}`}>{fmtNumber(stat.failed_24h)}</Text></div>
      </dl>
      <div className="mt-3 space-y-0.5">
        <Caption className={TONE[stat.heartbeat_severity]} data-testid={`queue-heartbeat-${stat.worker}`}>{stat.heartbeat_detail || lastBeatLabel}</Caption>
        {oldestLabel && <Caption className="text-amber-300">{oldestLabel}</Caption>}
      </div>
    </Button>
  );
}
