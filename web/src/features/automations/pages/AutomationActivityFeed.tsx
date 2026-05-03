/**
 * AutomationActivityFeed — displays recent execution history + live SSE events.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { formatDurationMs } from '@/lib/dateFormat';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  CheckCircle, XCircle, SkipForward, Activity, Clock, Wifi, WifiOff, Zap,
} from 'lucide-react';
import type { AutomationHistory, AutomationHistoryStats } from '@/api/types';
import type { AutomationActivityEvent } from '@/hooks/useAutomationEvents';

// ─── History item ─────────────────────────────────────────────────────────────

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  success: { icon: CheckCircle, color: 'text-green-400', label: 'Succeeded' },
  partial: { icon: CheckCircle, color: 'text-amber-400', label: 'Partial' },
  failed: { icon: XCircle, color: 'text-red-400', label: 'Failed' },
  skipped: { icon: SkipForward, color: 'text-[var(--text-muted)]', label: 'Skipped' },
  test: { icon: Zap, color: 'text-neon-cyan', label: 'Test' },
  undo: { icon: Clock, color: 'text-purple-400', label: 'Undo' },
  running: { icon: Activity, color: 'text-blue-400', label: 'Running' },
  cancelled: { icon: XCircle, color: 'text-[var(--text-muted)]', label: 'Cancelled' },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function HistoryRow({ item }: { item: AutomationHistory }) {
  const cfg = statusConfig[item.status] ?? statusConfig.running;
  const Icon = cfg.icon;

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/[0.02]">
      <Icon className={cn('h-4 w-4 shrink-0', cfg.color)} />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-[var(--text-primary)]">{item.automation_name}</span>
        {item.error && (
          <span className="ml-2 text-xs text-red-400/80">— {item.error}</span>
        )}
      </div>
      <span className="shrink-0 text-xs text-[var(--text-muted)]">{timeAgo(item.triggered_at)}</span>
      <span className="shrink-0 text-xs text-[var(--text-muted)]">{formatDurationMs(item.duration_ms)}</span>
      {item.actions_total > 0 && (
        <span className="shrink-0 text-xs text-[var(--text-muted)]">
          {item.actions_succeeded}/{item.actions_total}
        </span>
      )}
    </div>
  );
}

// ─── Live SSE event row ───────────────────────────────────────────────────────

function LiveEventRow({ event }: { event: AutomationActivityEvent }) {
  const typeMap: Record<string, { icon: typeof CheckCircle; color: string }> = {
    'automation.triggered': { icon: Zap, color: 'text-neon-cyan' },
    'automation.succeeded': { icon: CheckCircle, color: 'text-green-400' },
    'automation.failed': { icon: XCircle, color: 'text-red-400' },
    'automation.skipped': { icon: SkipForward, color: 'text-[var(--text-muted)]' },
    'automation.state_changed': { icon: Activity, color: 'text-purple-400' },
  };
  const cfg = typeMap[event.type] ?? typeMap['automation.triggered'];
  const Icon = cfg.icon;
  const name = 'name' in event.data ? (event.data as { name: string }).name : `#${(event.data as { automation_id: number }).automation_id}`;

  return (
    <div className="flex items-center gap-3 rounded-lg bg-neon-cyan/[0.03] px-3 py-2 text-sm">
      <Icon className={cn('h-4 w-4 shrink-0 animate-pulse', cfg.color)} />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-[var(--text-primary)]">{name}</span>
        {'error' in event.data && (event.data as { error?: string }).error && (
          <span className="ml-2 text-xs text-red-400/80">— {(event.data as { error: string }).error}</span>
        )}
        {'reason' in event.data && (event.data as { reason?: string }).reason && (
          <span className="ml-2 text-xs text-[var(--text-muted)]">— {(event.data as { reason: string }).reason}</span>
        )}
      </div>
      <Badge variant="neutral">
        {event.type.replace('automation.', '')}
      </Badge>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface AutomationActivityFeedProps {
  history: AutomationHistory[];
  historyStats: AutomationHistoryStats | null;
  isLoading: boolean;
  liveEvents: AutomationActivityEvent[];
  connectionState: 'connected' | 'reconnecting';
}

export function AutomationActivityFeed({
  history,
  historyStats,
  isLoading,
  liveEvents,
  connectionState,
}: AutomationActivityFeedProps) {
  const { t } = useTranslation();

  const recentLive = useMemo(() => liveEvents.slice(0, 5), [liveEvents]);
  const items = history;

  return (
    <FadeIn delay={0.1}>
      <GlassPanel className="p-6">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-[var(--text-secondary)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {t('automations.recentActivity', 'Recent Activity')}
            </h2>
            {connectionState === 'connected' ? (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <Wifi className="h-3 w-3" />
                {t('automations.live', 'Live')}
              </span>
            ) : connectionState === 'reconnecting' ? (
              <span className="flex items-center gap-1 text-xs text-amber-400 animate-pulse">
                <WifiOff className="h-3 w-3" />
                {t('automations.reconnecting', 'Reconnecting')}
              </span>
            ) : null}
          </div>
          {historyStats && historyStats.total_executions > 0 && (
            <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
              <span>{historyStats.total_executions} {t('automations.totalRuns', 'total')}</span>
              <span className="text-green-400">{historyStats.success_rate.toFixed(0)}% {t('automations.successRate', 'success')}</span>
              <span>{formatDurationMs(historyStats.avg_duration_ms)} {t('automations.avgDuration', 'avg')}</span>
            </div>
          )}
        </div>

        {/* Live events (SSE) */}
        {recentLive.length > 0 && (
          <div className="mb-3 space-y-1">
            {recentLive.map((evt) => (
              <LiveEventRow key={evt.id} event={evt} />
            ))}
          </div>
        )}

        {/* History items */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={`skel-${i}`} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : items.length > 0 ? (
          <div className="space-y-0.5">
            {items.map((item) => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Activity className="h-8 w-8" />}
            message={t('automations.noHistory', 'No execution history yet')}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
