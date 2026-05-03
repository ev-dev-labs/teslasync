import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayCircle, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useAutomationHistory } from '@/api/hooks/useAutomations';
import { formatDurationMs } from '@/lib/dateFormat';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed } from './shared';
import type { EventFeedItem } from './shared';
import type { WidgetProps } from './types';
import type { AutomationHistoryStatus } from '@/api/types';

// ── Status → visual mapping ──────────────────────────────────────────

const STATUS_MAP: Record<
  AutomationHistoryStatus,
  { icon: React.ReactNode; color: string; severity: EventFeedItem['severity'] }
> = {
  success:   { icon: <CheckCircle className="h-3.5 w-3.5" />, color: '#22c55e', severity: 'info' },
  failed:    { icon: <XCircle className="h-3.5 w-3.5" />,     color: '#ef4444', severity: 'critical' },
  partial:   { icon: <Clock className="h-3.5 w-3.5" />,       color: '#f59e0b', severity: 'warning' },
  running:   { icon: <Clock className="h-3.5 w-3.5" />,       color: '#3b82f6', severity: 'info' },
  skipped:   { icon: <Clock className="h-3.5 w-3.5" />,       color: '#6b7280', severity: 'info' },
  cancelled: { icon: <XCircle className="h-3.5 w-3.5" />,     color: '#6b7280', severity: 'info' },
  test:      { icon: <PlayCircle className="h-3.5 w-3.5" />,  color: '#8b5cf6', severity: 'info' },
  undo:      { icon: <Clock className="h-3.5 w-3.5" />,       color: '#6b7280', severity: 'info' },
};

const DEFAULT_STATUS = {
  icon: <PlayCircle className="h-3.5 w-3.5" />,
  color: '#6b7280',
  severity: 'info' as const,
};

// ── Compact layout (1×2) ─────────────────────────────────────────────

function CompactView({
  successRate,
  lastRunTime,
  t,
}: {
  successRate: number;
  lastRunTime: string | null;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <span className="text-2xl font-bold text-[var(--text-primary)]">{fmtNumber(successRate, 1)}%</span>
      <span className="text-[10px] text-[var(--text-muted)]">{t('widget.successRate', 'Success Rate')}</span>
      {lastRunTime && (
        <TimeStamp value={lastRunTime} className="text-xs text-[var(--text-secondary)]" />
      )}
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function AutomationHistoryWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useAutomationHistory();

  const isCompact = size.cols <= 1;
  const items = data?.items ?? [];
  const summary = data?.summary;
  const successRate = summary?.success_rate ?? 0;

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      items.map((entry) => {
        const mapped = STATUS_MAP[entry.status] ?? DEFAULT_STATUS;
        const durationStr = formatDurationMs(entry.duration_ms ?? null);
        const statusLabel = entry.status ?? '—';
        return {
          id: entry.id,
          icon: mapped.icon,
          title: entry.automation_name ?? '—',
          subtitle: `${statusLabel} · ${durationStr}`,
          timestamp: entry.triggered_at ?? new Date(0).toISOString(),
          color: mapped.color,
          severity: mapped.severity,
        };
      }),
    [items],
  );

  const lastEntry = items.length > 0 ? items[0] : null;

  return (
    <WidgetShell
      title={t('widget.automationHistory', 'Automation History')}
      icon={<PlayCircle className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {isCompact ? (
        items.length > 0 ? (
          <CompactView
            successRate={successRate}
            lastRunTime={lastEntry?.triggered_at ?? null}
            t={t}
          />
        ) : (
          <EmptyState
            icon={<PlayCircle className="h-5 w-5" />}
            message={t('widget.noAutomationRuns', 'No automation runs yet')}
            className="py-4"
          />
        )
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          {/* Success rate header */}
          <div className="flex items-center gap-2 pb-1.5 border-b border-white/[0.06]">
            <Badge variant={successRate >= 90 ? 'success' : successRate >= 50 ? 'warning' : 'danger'}>
              {fmtNumber(successRate, 1)}% {t('widget.successRate', 'Success Rate')}
            </Badge>
            {summary && (
              <span className="text-[10px] text-[var(--text-muted)]">
                {fmtInt(summary.total_executions)} {t('widget.totalRuns', 'runs')}
              </span>
            )}
          </div>

          {/* Event feed */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <WidgetEventFeed
              items={feedItems}
              maxItems={10}
              compact={false}
              emptyMessage={t('widget.noAutomationRuns', 'No automation runs yet')}
              emptyIcon={<PlayCircle className="h-5 w-5" />}
            />
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
