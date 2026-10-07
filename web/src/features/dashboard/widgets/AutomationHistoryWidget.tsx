import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayCircle, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useAutomationHistory } from '@/api/hooks/useAutomations';


import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed } from './shared';
import type { EventFeedItem } from './shared';
import type { WidgetProps } from './types';
import type { AutomationHistoryStatus } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import { WidgetBigNumber } from './shared';

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
  successRate: number | null;
  lastRunTime: string | null;
  t: (key: string, fallback: string) => string;
}) {
  const { fmtNumber } = useNumberFormatting();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <WidgetBigNumber
        value={successRate == null ? null : fmtNumber(successRate)}
        unit="%"
        label={t('widget.successRate', 'Success rate')}
        align="center"
      />
      {lastRunTime && (
        <TimeStamp value={lastRunTime} className="text-xs text-[var(--text-secondary)]" />
      )}
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function AutomationHistoryWidget({ size }: WidgetProps) {
  const { formatDurationMs, fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const query = useAutomationHistory();
  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const state = useDataState({ ...query, data: data ?? undefined }, { provenance: 'historical' });

  const isCompact = size.cols <= 1;
  const items = data?.items ?? [];
  const summary = data?.summary;
  const successRate = knownNumber(summary?.success_rate);
  const totalRuns = knownNumber(summary?.total_executions);
  const hasRuns = (totalRuns != null && totalRuns > 0) || items.length > 0;

  // A red "danger" chip for a 0% success rate must mean "runs are failing",
  // not "nothing has run yet" — otherwise a fresh install with zero executions
  // looks like a broken one. Fall back to a neutral chip until there is at
  // least one run to grade.
  const rateVariant = !hasRuns || successRate == null
    ? 'neutral'
    : successRate >= 90
      ? 'success'
      : successRate >= 50
        ? 'warning'
        : 'danger';

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      items.map((entry) => {
        const mapped = Object.prototype.hasOwnProperty.call(STATUS_MAP, entry.status)
          ? STATUS_MAP[entry.status]
          : DEFAULT_STATUS;
        const durationStr = formatDurationMs(entry.duration_ms ?? null);
        const statusLabel = entry.status ?? '—';
        return {
          id: entry.id,
          icon: mapped.icon,
          title: entry.automation_name ?? '—',
          subtitle: `${statusLabel} · ${durationStr}`,
          timestamp: entry.triggered_at ?? '',
          color: mapped.color,
          severity: mapped.severity,
          wrap: true,
        };
      }),
    [items, formatDurationMs],
  );

  const lastEntry = items.length > 0 ? items[0] : null;

  return (
    <WidgetShell
      title={t('widget.automationHistory', 'Automation history')}
      icon={<PlayCircle className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      dataState={{ ...state, status: state.status === 'initial' && !isLoading ? 'unavailable' : state.status }}
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
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<PlayCircle className="h-5 w-5" />}
            message={t('widget.noAutomationRuns', 'No automation runs yet')}
            className="py-4"
          />
        )
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          {/* Success rate header */}
          <div className="flex min-w-0 flex-wrap items-center gap-2 pb-1.5 border-b border-[var(--border-subtle)]">
            <Badge variant={rateVariant}>
              {successRate == null ? '—' : `${fmtNumber(successRate)}%`}{' '}{t('widget.successRate', 'Success rate')}
            </Badge>
            {summary && (
              <span className={dashboardTokens.metricLabel}>
                {totalRuns == null ? '—' : fmtInt(totalRuns)} {t('widget.totalRuns', 'runs')}
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
