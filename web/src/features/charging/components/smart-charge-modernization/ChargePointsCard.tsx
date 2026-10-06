import { useTranslation } from 'react-i18next';
import { PlugZap } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Text, Badge, Caption } from '@/components/ui';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { safeArray } from '@/lib/safeArray';
import { useOcppChargePoints, useOcppSessions } from '@/api/hooks/useOcpp';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'Charging': return 'success';
    case 'Preparing':
    case 'SuspendedEV':
    case 'SuspendedEVSE': return 'info';
    case 'Finishing':
    case 'Reserved': return 'warning';
    case 'Faulted':
    case 'Unavailable': return 'danger';
    default: return 'neutral';
  }
}

/** Charger inventory and recent transactions never erase each other on failure. */
export function ChargePointsCard() {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { formatEnergy } = useUnits();
  const pointsQuery = useOcppChargePoints();
  const sessionsQuery = useOcppSessions('', 10);
  const pointsState = useDataState(pointsQuery);
  const sessionsState = useDataState(sessionsQuery, { provenance: 'historical' });
  const points = safeArray(pointsState.data);
  const sessions = safeArray(sessionsState.data);

  return (
    <LayoutCard title={t('ocpp.title', 'OCPP Charge Points')}>
      <StaleRefreshWarning state={pointsState} />
      {pointsQuery.isLoading && !pointsState.hasData ? <Skeleton height={140} /> : pointsState.fatalError ? (
        <QueryError error={pointsState.fatalError} onRetry={() => void pointsQuery.refetch()} />
      ) : points.length === 0 ? (
        <EmptyState /* no-action: requires a charger to connect to the OCPP server */
          icon={<PlugZap className="h-8 w-8" aria-hidden="true" />}
          message={t('ocpp.noChargePoints', 'No OCPP chargers reporting yet. Point a charger at the OCPP server to see it here.')} />
      ) : (
        <ul className="space-y-2">
          {points.map(cp => (
            <li key={cp.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2">
              <div className="min-w-0">
                <Text variant="bodySm" className="break-words font-medium">
                  {cp.vendor || cp.model ? `${cp.vendor} ${cp.model}`.trim() : cp.id}
                </Text>
                <Caption className="break-words tabular-nums">
                  {t('ocpp.lastSeen', 'last seen {{when}}', { when: formatDateTime(cp.last_seen_at) })}
                </Caption>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {safeArray(cp.connectors).map(connector => (
                  <Badge key={connector.connector_id} variant={statusVariant(connector.status)} size="sm">
                    {t('ocpp.connector', '#{{id}} {{status}}', { id: connector.connector_id, status: connector.status })}
                  </Badge>
                ))}
                {cp.active_sessions > 0 && <Badge variant="success" size="sm">
                  {t('ocpp.activeSessions', '{{count}} active', { count: cp.active_sessions })}
                </Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="min-w-0 space-y-2">
        <Text variant="bodySm" className="font-medium">{t('ocpp.recentSessions', 'Recent sessions')}</Text>
        <StaleRefreshWarning state={sessionsState} />
        {sessionsQuery.isLoading && !sessionsState.hasData ? <Skeleton height={100} /> : sessionsState.fatalError ? (
          <QueryError error={sessionsState.fatalError} onRetry={() => void sessionsQuery.refetch()} />
        ) : sessions.length === 0 ? (
          <EmptyState /* no-action: transactions appear when chargers report sessions */
            message={t('chargePlanner.modernization.noOcppSessions', 'No recent OCPP charging sessions have been reported.')} />
        ) : (
          <ul className="space-y-2">
            {sessions.map(session => (
              <li key={session.transaction_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2">
                <Caption className="min-w-0 break-words">{session.charge_point_id} · #{session.transaction_id}</Caption>
                <Text variant="bodySm" className="tabular-nums">
                  {session.energy_delivered_wh != null && Number.isFinite(session.energy_delivered_wh)
                    ? formatEnergy(session.energy_delivered_wh)
                    : t('ocpp.inProgress', 'in progress')}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </div>
    </LayoutCard>
  );
}
