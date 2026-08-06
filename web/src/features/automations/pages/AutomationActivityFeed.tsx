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
import { formatDurationMs, formatRelativeTime } from '@/lib/dateFormat';
import { fmtPercent } from '@/lib/numberFormat';
import { GlassPanel, Badge, SectionTitle, Text, Caption } from '@/components/ui';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  CheckCircle, XCircle, SkipForward, Activity, Clock, Wifi, WifiOff, Zap,
} from 'lucide-react';
import type { AutomationHistory, AutomationHistoryStats } from '@/api/types';
import type { AutomationActivityEvent } from '@/hooks/useAutomationEvents';

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
  const cfg = statusConfig[item.status] ?? statusConfig.running;
  const Icon = cfg.icon;

  return (
    <div className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-white/[0.02]">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', cfg.color)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <Text as="p" variant="body" className="truncate font-medium">
          {item.automation_name}
        </Text>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Caption>{formatRelativeTime(item.triggered_at)}</Caption>
          <Caption aria-hidden="true">·</Caption>
          <Caption>{formatDurationMs(item.duration_ms)}</Caption>
          {item.actions_total > 0 && (
            <>
              <Caption aria-hidden="true">·</Caption>
              <Caption>{item.actions_succeeded ?? 0}/{item.actions_total}</Caption>
            </>
          )}
        </div>
        {item.error && (
          <Text as="p" variant="bodySm" className="mt-0.5 truncate text-rose-300">
            {item.error}
          </Text>
        )}
      </div>
    </div>
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
    <div className="flex items-start gap-2.5 rounded-lg bg-cyan-500/[0.05] px-2.5 py-2">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0 animate-pulse', cfg.color)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Text as="span" variant="body" className="truncate font-medium">
            {name}
          </Text>
          <Badge variant="neutral" size="sm" className="shrink-0">
            {t(`automations.event.${suffix}`, suffix)}
          </Badge>
        </div>
        {errMsg && (
          <Text as="p" variant="bodySm" className="mt-0.5 truncate text-rose-300">
            {errMsg}
          </Text>
        )}
        {reason && <Caption className="mt-0.5 block truncate">{reason}</Caption>}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface AutomationActivityFeedProps {
  history: AutomationHistory[];
  historyStats: AutomationHistoryStats | null;
  isLoading: boolean;
  /** Error from the history query — surfaces a QueryError in place. */
  error?: unknown;
  liveEvents: AutomationActivityEvent[];
  connectionState: 'connected' | 'reconnecting';
}

export function AutomationActivityFeed({
  history,
  historyStats,
  isLoading,
  error,
  liveEvents,
  connectionState,
}: AutomationActivityFeedProps) {
  const { t } = useTranslation();

  const recentLive = useMemo(() => (liveEvents ?? []).slice(0, 5), [liveEvents]);
  const items = history ?? [];

  return (
    <FadeIn delay={0.1}>
      <GlassPanel className="p-4 sm:p-5">
        {/* Header */}
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
            <SectionTitle>{t('automations.recentActivity', 'Recent Activity')}</SectionTitle>
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
          {historyStats && historyStats.total_executions > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Caption>
                {t('automations.totalRunsCount', '{{count}} total', {
                  count: historyStats.total_executions,
                })}
              </Caption>
              <Caption className="text-emerald-300">
                {t('automations.successRateValue', '{{value}} success', {
                  value: fmtPercent(historyStats.success_rate ?? 0, 0),
                })}
              </Caption>
              <Caption>
                {t('automations.avgDurationValue', '{{value}} avg', {
                  value: formatDurationMs(historyStats.avg_duration_ms),
                })}
              </Caption>
            </div>
          )}
        </div>

        {/* Body — self-contained loading / error / live+history / empty */}
        {error ? (
          <QueryError error={error} />
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={`hist-skel-${i}`} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            {recentLive.length > 0 && (
              <div className="mb-3 space-y-1">
                {recentLive.map((evt) => (
                  <LiveEventRow key={evt.id} event={evt} />
                ))}
              </div>
            )}
            {items.length > 0 ? (
              <div className="space-y-0.5">
                {items.map((item) => (
                  <HistoryRow key={item.id} item={item} />
                ))}
              </div>
            ) : recentLive.length === 0 ? (
              // no-action: history only grows once the automation engine runs
              // a job; the page's "create automation" EmptyState owns that path.
              <EmptyState
                icon={<Activity className="h-8 w-8" />}
                message={t('automations.noHistory', 'No execution history yet')}
              />
            ) : null}
          </>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
