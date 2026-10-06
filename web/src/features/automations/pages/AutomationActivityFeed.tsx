/**
 * AutomationActivityFeed — recent execution history + live SSE events.
 *
 * Rendered as the context sidebar of the automations hero split, so the layout
 * stays legible in a narrow column: each row wraps its metadata under the
 * automation name instead of relying on horizontal space. Owns its own
 * loading / empty / error states.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/dateFormat';

import { GlassPanel, Badge, SectionTitle, Text, Caption } from '@/components/ui';
import { OperationalBrief, TimelineItem } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { SourceContent } from '@/components/layout';
import { EmptyState, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  CheckCircle, XCircle, SkipForward, Activity, Clock, Wifi, WifiOff, Zap,
} from 'lucide-react';
import type { AutomationHistory, AutomationHistoryStats } from '@/api/types';
import type { AutomationActivityEvent } from '@/hooks/useAutomationEvents';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

// ─── Status → icon + toned accent (color is never the only signal) ────────────

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string }> = {
  success: { icon: CheckCircle, color: 'text-emerald-300' },
  partial: { icon: CheckCircle, color: 'text-amber-300' },
  failed: { icon: XCircle, color: 'text-rose-300' },
  skipped: { icon: SkipForward, color: 'text-[var(--text-muted)]' },
  test: { icon: Zap, color: 'text-cyan-300' },
  undo: { icon: Clock, color: 'text-purple-300' },
  running: { icon: Activity, color: 'text-indigo-300' },
  cancelled: { icon: XCircle, color: 'text-[var(--text-muted)]' },
};

const liveTypeMap: Record<string, { icon: typeof CheckCircle; color: string }> = {
  'automation.triggered': { icon: Zap, color: 'text-cyan-300' },
  'automation.succeeded': { icon: CheckCircle, color: 'text-emerald-300' },
  'automation.failed': { icon: XCircle, color: 'text-rose-300' },
  'automation.skipped': { icon: SkipForward, color: 'text-[var(--text-muted)]' },
  'automation.state_changed': { icon: Activity, color: 'text-purple-300' },
};

// ─── History item ─────────────────────────────────────────────────────────────

function HistoryRow({ item }: { item: AutomationHistory }) {
  const { formatDurationMs } = useNumberFormatting();
  const cfg = statusConfig[item.status] ?? statusConfig.running;
  const Icon = cfg.icon;

  return (
    <TimelineItem
      icon={<Icon className={cn('h-4 w-4', cfg.color)} aria-hidden="true" />}
      title={item.automation_name}
      time={formatRelativeTime(item.triggered_at)}
      wrap
      isLast
      metadata={<>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Caption>{item.duration_ms == null ? '—' : formatDurationMs(item.duration_ms)}</Caption>
          {item.actions_total > 0 && (
            <>
              <Caption aria-hidden="true">·</Caption>
              <Caption>{item.actions_succeeded ?? '—'}/{item.actions_total}</Caption>
            </>
          )}
        </div>
        {item.error && (
          <Text as="p" variant="bodySm" className="mt-0.5 break-words text-rose-300">
            {item.error}
          </Text>
        )}
      </>}
    />
  );
}

// ─── Live SSE event row ───────────────────────────────────────────────────────

function LiveEventRow({ event }: { event: AutomationActivityEvent }) {
  const { t } = useTranslation();
  const cfg = liveTypeMap[event.type] ?? liveTypeMap['automation.triggered'];
  const Icon = cfg.icon;
  const suffix = event.type.replace('automation.', '');
  const name = 'name' in event.data
    ? (event.data as { name: string }).name
    : `#${(event.data as { automation_id: number }).automation_id}`;
  const errMsg = 'error' in event.data ? (event.data as { error?: string }).error : undefined;
  const reason = 'reason' in event.data ? (event.data as { reason?: string }).reason : undefined;

  return (
    <TimelineItem
      icon={<Icon className={cn('h-4 w-4 animate-pulse motion-reduce:animate-none', cfg.color)} aria-hidden="true" />}
      title={name}
      time={formatRelativeTime(event.receivedAt.toISOString())}
      wrap
      isLast
      badges={
          <Badge variant="neutral" size="sm" className="shrink-0">
            {t(`automations.event.${suffix}`, suffix)}
          </Badge>
      }
      metadata={<>
        {errMsg && (
          <Text as="p" variant="bodySm" className="mt-0.5 break-words text-rose-300">
            {errMsg}
          </Text>
        )}
        {reason && <Caption className="mt-0.5 block break-words">{reason}</Caption>}
      </>}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface AutomationActivityFeedProps {
  history: AutomationHistory[];
  historyStats: AutomationHistoryStats | null;
  isLoading: boolean;
  /** History errors never replace independent live events or retained rows. */
  error?: unknown;
  onRetry?: () => void;
  liveEvents: AutomationActivityEvent[];
  connectionState: 'connected' | 'reconnecting';
}

export function AutomationActivityFeed({
  history,
  historyStats,
  isLoading,
  error,
  onRetry,
  liveEvents,
  connectionState,
}: AutomationActivityFeedProps) {
  const { formatDurationMs } = useNumberFormatting();
  const { fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();

  const recentLive = useMemo(() => (liveEvents ?? []).slice(0, 5), [liveEvents]);
  const items = history ?? [];
  const retainedHistory = items.length > 0 || historyStats != null;
  const source = useDataState({
    data: retainedHistory || (!isLoading && !error) ? items : undefined,
    error,
    isLoading,
    refetch: onRetry,
  });
  const summaryContext = t('automations.activityBrief.context', 'History aggregate window is not supplied. Independent live events and recent rows are not this summary denominator.');
  const noRuns = t('automations.historyBrief.noRuns', 'No completed runs in this summary; a rate and average duration are undefined.');
  const rawMetrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'total', rawValue: historyStats?.total_executions,
      label: t('automationList.kpi.runs', 'Total runs'), description: summaryContext,
      context: historyStats ? t('automations.totalRunsCount', '{{count}} total', { count: historyStats.total_executions }) : undefined },
    { metricId: 'percent', occurrenceId: 'rate', rawValue: historyStats && historyStats.total_executions > 0 ? historyStats.success_rate : null,
      label: t('automations.historyPage.rate', 'Success rate'), description: summaryContext,
      missingReason: historyStats?.total_executions === 0 ? noRuns : undefined,
      display: { formatter: (raw) => ({ value: fmtPercent(raw), unit: '' }) },
      context: historyStats && historyStats.total_executions > 0 ? t('automations.successRateValue', '{{value}} success', {
        value: historyStats.success_rate == null ? '—' : fmtPercent(historyStats.success_rate),
      }) : undefined },
    { metricId: 'duration', occurrenceId: 'duration', rawValue: historyStats && historyStats.total_executions > 0 && historyStats.avg_duration_ms != null ? historyStats.avg_duration_ms / 1000 : null,
      label: t('automations.historyPage.duration', 'Average duration'), description: summaryContext,
      missingReason: historyStats?.total_executions === 0 ? noRuns : undefined,
      display: { formatter: (raw) => ({ value: formatDurationMs(raw * 1000), unit: '' }) },
      context: historyStats && historyStats.total_executions > 0 ? t('automations.avgDurationValue', '{{value}} avg', {
        value: formatDurationMs(historyStats.avg_duration_ms),
      }) : undefined },
  ];
  const metrics = useOperationalMetrics(rawMetrics);

  return (
    <FadeIn delay={0.1}>
      <GlassPanel className="p-4 sm:p-5">
        {/* Header */}
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
            <SectionTitle>{t('automations.recentActivity', 'Recent activity')}</SectionTitle>
            {connectionState === 'connected' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5">
                <Wifi className="h-3 w-3 shrink-0 text-emerald-300" aria-hidden="true" />
                <Caption className="text-emerald-300">{t('automations.live', 'Live')}</Caption>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5">
                <WifiOff className="h-3 w-3 shrink-0 animate-pulse text-amber-300" aria-hidden="true" />
                <Caption className="text-amber-300">{t('automations.reconnecting', 'Reconnecting')}</Caption>
              </span>
            )}
          </div>
          <OperationalBrief
            compact
            testId="automation-activity-brief"
            eyebrow={t('automations.activityBrief.eyebrow', 'Execution history')}
            title={t('automations.historyPage.summary', 'Execution summary')}
            description={summaryContext}
            statusLabel={isLoading && !historyStats ? t('automations.historyBrief.loading', 'Loading executions')
              : !historyStats ? t('automations.historyBrief.unavailable', 'Summary unavailable')
                : source.refreshError || source.isRefreshBlocked ? t('automations.historyBrief.retained', 'Retained execution summary')
                  : t('automations.historyBrief.available', 'Summary loaded')}
            statusTone={source.refreshError || source.isRefreshBlocked || !historyStats ? 'warning' : 'neutral'}
            loading={isLoading && !historyStats}
            metrics={metrics}
            scope={t('automations.activityBrief.scope', 'History aggregate · window unknown')}
            freshness={t('automations.historyBrief.freshness', 'History response; live events are a separate source')}
            provenance={summaryContext}
          />
        </div>

        {recentLive.length > 0 && (
          <div className="mb-3 space-y-1">
            {recentLive.map((evt) => <LiveEventRow key={evt.id} event={evt} />)}
          </div>
        )}
        <SourceContent
          state={source.fatalError ? 'error'
            : !source.hasData && isLoading ? 'loading'
              : source.refreshError ? 'retained' : items.length === 0 ? 'empty' : 'ready'}
          label={t('automations.recentActivity', 'Recent activity')}
          emptyMessage={t('automations.noHistory', 'No execution history yet')}
          errorMessage={t('automations.historyPage.loadFailed', 'Could not load execution history.')}
          error={source.fatalError}
          errorRecovery={{ onRetry }}
          loadingContent={
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={`hist-skel-${i}`} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          }
          emptyContent={recentLive.length > 0 ? <></> : (
            <EmptyState
              icon={<Activity className="h-8 w-8" />}
              message={t('automations.noHistory', 'No execution history yet')}
              action={onRetry ? { label: t('common.refresh', 'Refresh'), onClick: onRetry } : undefined}
            />
          )}
        >
            {items.length > 0 && (
              <div className="space-y-0.5">
                {items.map((item) => (
                  <HistoryRow key={item.id} item={item} />
                ))}
              </div>
            )}
        </SourceContent>
      </GlassPanel>
    </FadeIn>
  );
}
