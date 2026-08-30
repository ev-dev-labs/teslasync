import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Alert, AlertDetail } from '@/api/types';
import { EntityPreviewDrawer } from '@/components/data-display';
import { Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { EmptyState, InlineCallout, QueryError, Skeleton } from '@/components/feedback';
import { AlertDetailTimeline } from '@/features/admin/components/AlertDetailTimeline';
import { formatDateTime } from '@/lib/dateFormat';
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough';
import { buildContextHref } from '@/lib/contextNavigation';
import { localDayKey } from '@/lib/drivesAggregation';
import { Icons } from '@/lib/icons';
import {
  Activity,
  BatteryCharging,
  Car,
  MapPin,
  Route,
  Wrench,
} from 'lucide-react';

export type AlertRemediationKind =
  | 'battery'
  | 'charging'
  | 'tire'
  | 'security'
  | 'software'
  | 'system'
  | 'driving'
  | 'signal'
  | 'general';

export function getAlertRemediationKind(alert: Alert): AlertRemediationKind {
  const context = `${alert.type ?? ''} ${alert.rule_signal ?? ''}`.toLowerCase();
  if (/(battery|soc|range)/.test(context)) return 'battery';
  if (/(charg|connector|voltage|current)/.test(context)) return 'charging';
  if (/(tire|tpms|pressure)/.test(context)) return 'tire';
  if (/(security|sentry|lock|door|window)/.test(context)) return 'security';
  if (/(software|update)/.test(context)) return 'software';
  if (/(system|database|mqtt|redis|worker|tesla_api)/.test(context)) return 'system';
  if (/(speed|drive|gear|power|efficiency)/.test(context)) return 'driving';
  if (alert.rule_signal) return 'signal';
  return 'general';
}

interface AlertDetailDrawerProps {
  alert: Alert | null;
  detail: AlertDetail | undefined;
  isLoading: boolean;
  error: unknown;
  vehicleName?: string | null;
  onClose: () => void;
  onAcknowledge: (alertId: number) => void;
  onReopen: (alertId: number) => void;
  onRetry: () => void;
}

export function AlertDetailDrawer({
  alert,
  detail,
  isLoading,
  error,
  vehicleName,
  onClose,
  onAcknowledge,
  onReopen,
  onRetry,
}: AlertDetailDrawerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeAlert = detail ?? alert;
  const isAcknowledged = Boolean(activeAlert?.acknowledged_at);
  const alertDay = localDayKey(activeAlert?.created_at);

  const remediation = activeAlert
    ? t(
        `operations.alerts.remediation.${getAlertRemediationKind(activeAlert)}`,
        remediationFallback(getAlertRemediationKind(activeAlert)),
      )
    : '';
  const vehicleLabel =
    vehicleName?.trim() ||
    (activeAlert && activeAlert.vehicle_id > 0
      ? t('operations.alerts.vehicleNumber', 'Vehicle #{{id}}', { id: activeAlert.vehicle_id })
      : t('operations.alerts.fleetWide', 'Fleet-wide'));

  const handleInvestigate = () => {
    if (!activeAlert) return;
    onClose();
    navigate(getAlertDrillthroughHref(activeAlert));
  };

  return (
    <EntityPreviewDrawer
      open={alert !== null}
      onClose={onClose}
      eyebrow={t('operations.alerts.drawerEyebrow', 'Alert evidence')}
      title={activeAlert?.title ?? t('operations.alerts.drawerTitle', 'Alert details')}
      description={activeAlert?.message}
      statusLabel={
        isAcknowledged
          ? t('operations.alerts.lifecycleAcknowledged', 'Acknowledged')
          : t('operations.alerts.lifecycleOpen', 'Open')
      }
      statusTone={
        isAcknowledged
          ? 'success'
          : activeAlert?.severity === 'critical'
            ? 'danger'
            : activeAlert?.severity === 'warning'
              ? 'warning'
              : 'info'
      }
      fields={[
        {
          key: 'severity',
          label: t('operations.alerts.severity', 'Severity'),
          value: activeAlert?.severity ?? '—',
        },
        {
          key: 'vehicle',
          label: t('operations.alerts.vehicle', 'Vehicle'),
          value: vehicleLabel,
        },
        {
          key: 'signal',
          label: t('operations.alerts.relatedSignal', 'Related signal'),
          value: activeAlert?.rule_signal ?? t('operations.alerts.noSignal', 'No signal metadata'),
          detail: activeAlert?.type?.replace(/_/g, ' '),
        },
        {
          key: 'triggered',
          label: t('operations.alerts.triggered', 'Triggered'),
          value: formatDateTime(activeAlert?.created_at),
        },
        {
          key: 'owner',
          label: t('operations.alerts.owner', 'Owner'),
          value:
            activeAlert?.acknowledged_by?.trim() ||
            t('operations.alerts.awaitingOwner', 'Awaiting acknowledgement'),
        },
        {
          key: 'state',
          label: t('operations.alerts.resolutionState', 'Resolution state'),
          value: isAcknowledged
            ? t('operations.alerts.lifecycleAcknowledged', 'Acknowledged')
            : t('operations.alerts.lifecycleOpen', 'Open'),
        },
      ]}
      primaryAction={
        activeAlert
          ? {
              label: isAcknowledged
                ? t('operations.alerts.reopen', 'Reopen alert')
                : t('operations.alerts.acknowledge', 'Acknowledge alert'),
              onClick: () => {
                if (isAcknowledged) onReopen(activeAlert.id);
                else onAcknowledge(activeAlert.id);
              },
            }
          : undefined
      }
      relatedActions={
        activeAlert && activeAlert.vehicle_id > 0
          ? [
              {
                key: 'vehicle',
                label: t('entityContext.vehicle', 'Vehicle'),
                to: `/vehicles/${activeAlert.vehicle_id}`,
                icon: <Car className="h-4 w-4" aria-hidden="true" />,
              },
              {
                key: 'drives',
                label: t('entityContext.drives', 'Drive history'),
                to: buildContextHref('/drives', { from: alertDay, to: alertDay }),
                icon: <Route className="h-4 w-4" aria-hidden="true" />,
              },
              {
                key: 'charging',
                label: t('entityContext.charging', 'Charging sessions'),
                to: buildContextHref('/charging', { from: alertDay, to: alertDay }),
                icon: <BatteryCharging className="h-4 w-4" aria-hidden="true" />,
              },
              {
                key: 'locations',
                label: t('entityContext.locations', 'Visited locations'),
                to: buildContextHref('/locations', { from: alertDay, to: alertDay }),
                icon: <MapPin className="h-4 w-4" aria-hidden="true" />,
              },
              {
                key: 'service',
                label: t('entityContext.service', 'Service history'),
                to: '/maintenance',
                icon: <Wrench className="h-4 w-4" aria-hidden="true" />,
              },
              {
                key: 'telemetry',
                label: t('entityContext.telemetry', 'Telemetry evidence'),
                to: buildContextHref('/signals', {
                  from: alertDay,
                  to: alertDay,
                  signals: activeAlert.rule_signal ? [activeAlert.rule_signal] : [],
                }),
                icon: <Activity className="h-4 w-4" aria-hidden="true" />,
              },
            ]
          : []
      }
    >
      <GlassPanel className="p-4">
        <PanelTitle>{t('operations.alerts.recommendedResponse', 'Recommended response')}</PanelTitle>
        <Text as="p" variant="bodySm" className="mt-2">
          {remediation}
        </Text>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          icon={<Icons.forward className="h-4 w-4" aria-hidden="true" />}
          onClick={handleInvestigate}
          disabled={!activeAlert}
        >
          {t('operations.alerts.investigateSignal', 'Investigate signal')}
        </Button>
      </GlassPanel>

      {activeAlert?.acknowledgement_note && (
        <GlassPanel className="p-4">
          <PanelTitle>{t('operations.alerts.responseNote', 'Response note')}</PanelTitle>
          <Text as="p" variant="bodySm" className="mt-2">
            {activeAlert.acknowledgement_note}
          </Text>
        </GlassPanel>
      )}

      <div>
        <PanelTitle>{t('alerts.timeline.title', 'Audit timeline')}</PanelTitle>
        <div className="mt-3">
          {detail ? (
            <>
              {error && (
                <InlineCallout
                  variant="warning"
                  action={{ label: t('common.retry', 'Retry'), onClick: onRetry }}
                  className="mb-3"
                >
                  {t(
                    'operations.alerts.cachedAuditWarning',
                    'The latest refresh failed. Showing the most recent cached audit trail.',
                  )}
                </InlineCallout>
              )}
              <AlertDetailTimeline events={detail.events} />
            </>
          ) : error ? (
            <QueryError error={error} onRetry={onRetry} resourceName={t('operations.alerts.auditTrail', 'alert audit trail')} />
          ) : isLoading ? (
            <div className="space-y-3" aria-label={t('common.loading', 'Loading')}>
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : (
            <EmptyState
              icon={<Icons.notifications className="h-6 w-6" />}
              title={t('alerts.timeline.empty', 'No events yet')}
              message={t(
                'operations.alerts.auditUnavailable',
                'The alert summary is available, but its audit trail has not loaded.',
              )}
              action={{ label: t('common.retry', 'Retry'), onClick: onRetry }}
              className="py-8"
            />
          )}
        </div>
      </div>
    </EntityPreviewDrawer>
  );
}

function remediationFallback(kind: AlertRemediationKind): string {
  switch (kind) {
    case 'battery':
      return 'Confirm the current state of charge and charging access. Schedule charging if the condition persists.';
    case 'charging':
      return 'Review charging telemetry, connector state, and recent interruptions before the next session.';
    case 'tire':
      return 'Inspect tire pressure and temperature before the next drive, then confirm the reading after adjustment.';
    case 'security':
      return 'Verify vehicle location and access state before acknowledging the event.';
    case 'software':
      return 'Review update readiness and schedule installation while the vehicle is safely parked.';
    case 'system':
      return 'Open diagnostics and verify the affected service before acknowledging the incident.';
    case 'driving':
      return 'Review the related drive and telemetry window, then record any required operator follow-up.';
    case 'signal':
      return 'Inspect the related signal around the trigger time and record the response when acknowledging.';
    default:
      return 'Review the alert source, timestamp, and audit history before acknowledging the response.';
  }
}

export default AlertDetailDrawer;
