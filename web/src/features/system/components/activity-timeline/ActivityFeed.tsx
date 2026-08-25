import { useTranslation } from 'react-i18next';
import { Badge, GlassPanel } from '@/components/ui';
import { TimelineItem } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { formatTime } from '@/lib/dateFormat';
import { Icons } from '@/lib/icons';
import { useUnits } from '@/hooks/useUnits';
import type { ActivityItem } from '@/types/activity';
import { groupActivityByDay } from './helpers';
import { KIND_ACCENT, KIND_ICON, severityBadgeVariant, statusBadgeVariant } from './constants';

export interface ActivityFeedProps {
  items: readonly ActivityItem[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  /** Vehicle IANA timezone for day-bucketing; falls back to browser-local. */
  timezone?: string;
  className?: string;
}

const STATUS_FALLBACK: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  sent: 'Sent',
  pending: 'Pending',
  failed: 'Failed',
  deferred_dnd: 'Deferred by quiet hours',
  installed: 'Installed',
  installing: 'Installing',
  downloading: 'Downloading',
  available: 'Available',
  milestone: 'Milestone',
  maintenance: 'Maintenance',
  trip: 'Trip',
  issue: 'Issue',
  upgrade: 'Upgrade',
  custom: 'Custom',
};

const SOURCE_FALLBACK: Record<ActivityItem['kind'], string> = {
  drive: 'Driving history',
  charging: 'Charging history',
  alert: 'Alert delivery log',
  software_update: 'Software update history',
  annotation: 'User annotation',
};

const SEVERITY_FALLBACK: Record<string, string> = {
  info: 'Info',
  warn: 'Warning',
  critical: 'Critical',
};

/**
 * Chronological, day-grouped rendering of the unified activity timeline.
 * Each day is its own `GlassPanel` section; rows use the shared
 * `TimelineItem` component (icon swatch + title/subtitle/time/badges),
 * with a severity badge (alerts only), a status badge, and a provenance
 * caption, and navigate via `TimelineItem`'s `href` when the item carries
 * a safe `path`.
 */
export function ActivityFeed({
  items,
  isLoading,
  isError,
  error,
  onRetry,
  timezone,
  className,
}: ActivityFeedProps) {
  const { t } = useTranslation();
  const { formatDuration, formatEnergy } = useUnits();

  if (isLoading) {
    return (
      <GlassPanel className={className}>
        <Skeleton lines={6} />
      </GlassPanel>
    );
  }

  if (isError) {
    return (
      <GlassPanel className={className}>
        <QueryError error={error} onRetry={onRetry} resourceName="activity" />
      </GlassPanel>
    );
  }

  if (items.length === 0) {
    return (
      <GlassPanel className={className}>
        {/* no-action: nothing to widen-and-retry here; use the range/kind filters above. */}
        <EmptyState
          icon={<Icons.activity className="h-8 w-8" aria-hidden="true" />}
          message={t('activity.timeline.empty', 'No activity in this window.')}
        />
      </GlassPanel>
    );
  }

  const groups = groupActivityByDay(items, timezone);

  return (
    <div className={className}>
      {groups.map((group) => (
        <GlassPanel key={group.dayKey} className="mb-4 p-4 sm:p-6">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">{group.label}</h3>
          <div>
            {group.items.map((item, i) => {
              const Icon = KIND_ICON[item.kind];
              const title = (() => {
                if (item.title) return item.title;
                switch (item.kind) {
                  case 'drive':
                    return item.status === 'in_progress'
                      ? t('activity.timeline.item.driveInProgress', 'Drive in progress')
                      : t('activity.timeline.item.drive', 'Drive');
                  case 'charging':
                    return item.status === 'in_progress'
                      ? t('activity.timeline.item.chargingInProgress', 'Charging in progress')
                      : t('activity.timeline.item.charging', 'Charging session');
                  case 'software_update':
                    return item.version
                      ? t('activity.timeline.item.softwareVersion', 'Software update {{version}}', {
                          version: item.version,
                        })
                      : t('activity.timeline.item.software', 'Software update');
                  case 'alert':
                    return t('activity.timeline.item.alert', 'Alert');
                  case 'annotation':
                    return t('activity.timeline.item.annotation', 'Annotation');
                }
              })();
              const measurements: string[] = [];
              if (item.duration_s != null) {
                measurements.push(formatDuration(item.duration_s, { precision: 1 }));
              }
              if (item.start_soc_pct != null && item.end_soc_pct != null) {
                measurements.push(
                  t('activity.timeline.item.socChange', '{{start}}% → {{end}}%', {
                    start: Math.round(item.start_soc_pct),
                    end: Math.round(item.end_soc_pct),
                  }),
                );
              }
              if (item.energy_added_wh != null) {
                measurements.push(formatEnergy(item.energy_added_wh, { precision: 1 }));
              }
              if (item.summary) measurements.push(item.summary);
              const summary = measurements.join(' · ');
              const statusFallback =
                STATUS_FALLBACK[item.status] ?? item.status.replace(/_/g, ' ');
              const status = t(`activity.timeline.status.${item.status}`, statusFallback);
              const severity = item.severity
                ? t(
                    `activity.timeline.severity.${item.severity}`,
                    SEVERITY_FALLBACK[item.severity] ?? item.severity,
                  )
                : null;
              const source = t(
                `activity.timeline.source.${item.kind}`,
                SOURCE_FALLBACK[item.kind],
              );
              return (
                <TimelineItem
                  key={item.id}
                  icon={<Icon className="h-4 w-4" aria-hidden="true" />}
                  color={KIND_ACCENT[item.kind]}
                  title={title}
                  subtitle={summary || undefined}
                  time={formatTime(item.occurred_at)}
                  href={item.path ?? undefined}
                  isLast={i === group.items.length - 1}
                  badges={
                    <>
                      {item.severity && (
                        <Badge variant={severityBadgeVariant(item.severity)} size="sm">
                          {severity}
                        </Badge>
                      )}
                      <Badge variant={statusBadgeVariant(item.status)} size="sm">
                        {status}
                      </Badge>
                      <span
                        className="text-2xs text-[var(--text-muted)]"
                        title={t(
                          'activity.timeline.sourceRecord',
                          '{{source}} record {{id}}',
                          {
                            source,
                            id: item.source_id,
                          },
                        )}
                      >
                        {t('activity.timeline.provenance', 'Source: {{source}}', {
                          source,
                        })}
                      </span>
                    </>
                  }
                />
              );
            })}
          </div>
        </GlassPanel>
      ))}
    </div>
  );
}
