import { useTranslation } from 'react-i18next';
import { Info, CheckCircle2, Siren, Unlock, Car, AlertTriangle, type LucideIcon } from 'lucide-react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { LayoutCard } from '@/components/layout';
import { Badge, Button, Text, HelperText } from '@/components/ui';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import { isGuardEventAcknowledged, type GuardEvent } from '@/api/hooks/useGuard';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { EVENT_BADGE_VARIANT, eventLabelKey } from './eventMetadata';
import type { GuardPageModel } from './useGuardPageModel';

export function GuardEvents({ model: m }: { model: GuardPageModel }) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  const refreshAction = !m.noVehicle && m.eventsState.retry
    ? { label: t('common.refresh', 'Refresh'), onClick: m.eventsState.retry }
    : undefined;
  const vehicleAction = m.noVehicle
    ? { label: t('nav.manageVehicles', 'Manage vehicles'), to: '/vehicles' }
    : undefined;
  return (
    <div data-guard-section="events" className={cn('min-w-0', placement?.className)}>
      <LayoutCard title={t('guard.eventTimeline', 'Event timeline')}
        actions={m.unacknowledgedCount > 0 ? (
          <Badge variant="danger" size="sm">
            {t('guard.unackCount', '{{count}} unacknowledged', { count: m.unacknowledgedCount })}
          </Badge>
        ) : undefined}>
      <HelperText>{t('guard.modernization.eventsCoverage', 'Counts cover the returned security event history, not a theft detection assessment.')}</HelperText>
      <StaleRefreshWarning state={m.eventsState} label={t('guard.eventTimeline', 'Event timeline')} />
      {m.ackEvent.error && <QueryError error={m.ackEvent.error} compact />}
      {m.eventsState.fatalError ? (
        <QueryError error={m.eventsState.fatalError} onRetry={m.eventsState.retry ?? undefined} />
      ) : m.eventsQuery.isLoading && !m.eventsKnown ? (
        <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={96} className="rounded-lg" />)}
        </div>
      ) : !m.eventsKnown ? (
        <EmptyState icon={<Info className="h-8 w-8" aria-hidden="true" />}
          message={t('guard.modernization.sourceUnknown', 'Source unavailable; no security conclusion can be drawn.')}
          action={refreshAction} actionTo={vehicleAction} />
      ) : m.events.length === 0 ? (
        <EmptyState icon={<Info className="h-8 w-8" aria-hidden="true" />}
          message={t('guard.noEvents', 'No guard events yet')}
          action={refreshAction} actionTo={vehicleAction} />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 @3xl:grid-cols-2 @5xl:grid-cols-3">
          {m.events.map(event => (
            <EventCard key={event.id} event={event}
              onAcknowledge={m.handleAcknowledge} isAcking={m.ackEvent.isPending} />
          ))}
        </div>
      )}
      </LayoutCard>
    </div>
  );
}

function EventCard({ event, onAcknowledge, isAcking }: {
  event: GuardEvent;
  onAcknowledge: (eventId: number) => void;
  isAcking: boolean;
}) {
  const { t } = useTranslation();
  const acknowledged = isGuardEventAcknowledged(event);
  const type = event.event_type ?? '';
  const [labelKey, labelFallback] = eventLabelKey(type);
  const Icon: LucideIcon = acknowledged ? CheckCircle2
    : type === 'manual_panic' ? Siren
      : type.includes('unlock') ? Unlock
        : type.includes('drive') ? Car : AlertTriangle;
  return (
    <div data-guard-event={event.id}
      className="flex min-w-0 flex-wrap items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0',
        acknowledged ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]')} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1 break-words">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={EVENT_BADGE_VARIANT[type] ?? 'info'} size="sm">{t(labelKey, labelFallback)}</Badge>
          <TimeStamp value={event.ts} className={typography.role.caption} />
        </div>
        {(event.from_state != null || event.to_state != null) && (
          <Text as="p" variant="caption">{event.from_state ?? '—'} → {event.to_state ?? '—'}</Text>
        )}
        {event.acknowledged_by && (
          <Text as="p" variant="caption">
            {t('guard.acknowledgedBy', 'Acknowledged by')}: {event.acknowledged_by}
          </Text>
        )}
      </div>
      {!acknowledged && (
        <Button variant="secondary" size="sm" onClick={() => onAcknowledge(event.id)}
          disabled={isAcking} aria-label={t('guard.acknowledgeEvent', 'Acknowledge event')}
          className="min-h-11 shrink-0">
          {t('guard.acknowledge', 'Ack')}
        </Button>
      )}
    </div>
  );
}
