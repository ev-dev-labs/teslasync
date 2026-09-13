/**
 * OCPP charge points — operator view over the non-Tesla chargers reporting
 * to cmd/ocpp-server. Lists each charger with live connector statuses plus
 * recent charging transactions. Rendered on SmartChargePage so mixed-fleet
 * charging lives next to Tesla smart charging, not in a separate silo.
 */
import { useTranslation } from 'react-i18next';
import { PlugZap } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Badge, Caption } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { useOcppChargePoints, useOcppSessions } from '@/api/hooks/useOcpp';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'Charging':
      return 'success';
    case 'Preparing':
    case 'SuspendedEV':
    case 'SuspendedEVSE':
      return 'info';
    case 'Finishing':
    case 'Reserved':
      return 'warning';
    case 'Faulted':
    case 'Unavailable':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function ChargePointsPanel() {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { formatEnergy } = useUnits();

  const pointsQuery = useOcppChargePoints();
  const sessionsQuery = useOcppSessions('', 10);

  const points = pointsQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <PlugZap className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('ocpp.title', 'OCPP Charge Points')}
      </PanelTitle>

      {pointsQuery.isLoading ? (
        <Skeleton height={140} />
      ) : pointsQuery.isError ? (
        <QueryError error={pointsQuery.error} onRetry={() => pointsQuery.refetch()} />
      ) : points.length === 0 ? (
        <EmptyState /* no-action: steady state until a charger connects to cmd/ocpp-server */
          icon={<PlugZap className="h-8 w-8" />}
          message={t(
            'ocpp.noChargePoints',
            'No OCPP chargers reporting yet. Point a charger at the OCPP server to see it here.',
          )}
        />
      ) : (
        <ul className="space-y-2">
          {points.map((cp) => (
            <li
              key={cp.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2"
            >
              <div className="min-w-0">
                <Text variant="bodySm" className="font-medium">
                  {cp.vendor || cp.model ? `${cp.vendor} ${cp.model}`.trim() : cp.id}
                </Text>
                <Caption className="truncate tabular-nums">
                  {t('ocpp.lastSeen', 'last seen {{when}}', {
                    when: formatDateTime(cp.last_seen_at),
                  })}
                </Caption>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(cp.connectors ?? []).map((c) => (
                  <Badge key={c.connector_id} variant={statusVariant(c.status)} size="sm">
                    {t('ocpp.connector', '#{{id}} {{status}}', {
                      id: c.connector_id,
                      status: c.status,
                    })}
                  </Badge>
                ))}
                {cp.active_sessions > 0 && (
                  <Badge variant="success" size="sm">
                    {t('ocpp.activeSessions', '{{count}} active', { count: cp.active_sessions })}
                  </Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {sessions.length > 0 && (
        <div className="mt-4">
          <Text variant="bodySm" className="mb-2 font-medium">
            {t('ocpp.recentSessions', 'Recent sessions')}
          </Text>
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li
                key={s.transaction_id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2"
              >
                <Caption className="truncate">
                  {s.charge_point_id} · #{s.transaction_id}
                </Caption>
                <Text variant="bodySm" className="tabular-nums">
                  {s.energy_delivered_wh != null
                    ? formatEnergy(s.energy_delivered_wh)
                    : t('ocpp.inProgress', 'in progress')}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlassPanel>
  );
}
