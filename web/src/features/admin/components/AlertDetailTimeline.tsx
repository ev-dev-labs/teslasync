/**
 * Alert detail timeline.
 * Renders the audit timeline of an alert (created → acknowledged →
 * commented → reopened → ...) using the shared `<Timeline>` primitive from
 * `@/components/data-display`. Pure presentational component — the parent
 * supplies the loaded `AlertEvent[]` from `useAlertDetail`.
 * The synthetic `created` entry is always present (server-side fabricated
 * from `notification_logs.created_at`); persisted events come from
 * `notification_log_events`.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Timeline } from '@/components/data-display/Timeline';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Icons } from '@/lib/icons';
import { formatDateTime } from '@/lib/dateFormat';
import type { AlertEvent } from '@/api/types';

export interface AlertDetailTimelineProps {
  events: AlertEvent[] | undefined;
  className?: string;
}

const KIND_COLOR: Record<string, string> = {
  created: '#00f0ff',
  acknowledged: '#10b981',
  reopened: '#f59e0b',
  commented: '#a855f7',
};

export function AlertDetailTimeline({ events, className }: AlertDetailTimelineProps) {
  const { t } = useTranslation();

  const items = useMemo(() => {
    if (!events?.length) return [];
    return events.map((ev) => {
      // Trim before both the anonymity check AND display — the raw actor can
      // carry leading/trailing whitespace from the audit log, which would
      // otherwise leak into the interpolated title (e.g. "Acknowledged by   x  ").
      const trimmedActor = ev.actor?.trim();
      const actor = trimmedActor && trimmedActor.length > 0 ? trimmedActor : null;
      const titleKey = actor
        ? `alerts.timeline.kind.${ev.kind}`
        : `alerts.timeline.kindAnonymous.${ev.kind}`;
      const fallback = actor
        ? defaultTitleWithActor(ev.kind, actor)
        : defaultTitleAnonymous(ev.kind);
      const title = t(titleKey, fallback, actor ? { actor } : undefined);
      const note = ev.note?.trim();
      return {
        title,
        subtitle: note && note.length > 0 ? note : undefined,
        time: formatDateTime(ev.occurred_at),
        color: KIND_COLOR[ev.kind] ?? KIND_COLOR.created,
        icon: kindIcon(ev.kind),
      };
    });
  }, [events, t]);

  if (!events || events.length === 0) {
    return (
      <EmptyState /* no-action: an alert always has a synthetic 'created' entry — empty is only possible while loading */
        className={className}
        icon={<Icons.notifications className="h-6 w-6" />}
        title={t('alerts.timeline.title', 'Audit timeline')}
        message={t('alerts.timeline.empty', 'No events yet')}
      />
    );
  }

  return <Timeline items={items} className={className} />;
}

function kindIcon(kind: string) {
  const cls = 'h-3 w-3';
  switch (kind) {
    case 'created':
      return <Icons.notifications className={cls} />;
    case 'acknowledged':
      return <Icons.success className={cls} />;
    case 'reopened':
      return <Icons.refresh className={cls} />;
    case 'commented':
      return <Icons.edit className={cls} />;
    default:
      return <Icons.info className={cls} />;
  }
}

function defaultTitleWithActor(kind: string, actor: string): string {
  switch (kind) {
    case 'created':
      return 'Alert created';
    case 'acknowledged':
      return `Acknowledged by ${actor}`;
    case 'reopened':
      return `Reopened by ${actor}`;
    case 'commented':
      return `Comment by ${actor}`;
    default:
      return kind;
  }
}

function defaultTitleAnonymous(kind: string): string {
  switch (kind) {
    case 'created':
      return 'Alert created';
    case 'acknowledged':
      return 'Acknowledged';
    case 'reopened':
      return 'Reopened';
    case 'commented':
      return 'Comment added';
    default:
      return kind;
  }
}

export default AlertDetailTimeline;
