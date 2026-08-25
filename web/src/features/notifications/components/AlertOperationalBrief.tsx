import { useTranslation } from 'react-i18next';
import type { Alert } from '@/api/types';
import {
  DataFreshnessAuto,
  OperationalBrief,
  type FreshnessQuery,
  type OperationalAttention,
  type OperationalTone,
} from '@/components/data-display';
import { Badge, Button } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import { Icons } from '@/lib/icons';

interface AlertOperationalBriefProps {
  alerts: readonly Alert[];
  periodLabel: string;
  vehicleLabel: string;
  query: FreshnessQuery;
  onViewCritical: () => void;
  onManageRules: () => void;
}

export function AlertOperationalBrief({
  alerts,
  periodLabel,
  vehicleLabel,
  query,
  onViewCritical,
  onManageRules,
}: AlertOperationalBriefProps) {
  const { t } = useTranslation();
  const openAlerts = alerts.filter((alert) => !alert.acknowledged_at);
  const acknowledgedAlerts = alerts.filter((alert) => Boolean(alert.acknowledged_at));
  const openCritical = openAlerts.filter((alert) => alert.severity === 'critical');
  const namedResponders = new Set(
    acknowledgedAlerts
      .map((alert) => alert.acknowledged_by?.trim())
      .filter((actor): actor is string => Boolean(actor)),
  );
  const missingEvidence = openAlerts.filter((alert) => !alert.rule_signal).length;
  const oldestOpenMs = openAlerts.reduce<number | null>((oldest, alert) => {
    const createdMs = new Date(alert.created_at).getTime();
    if (!Number.isFinite(createdMs)) return oldest;
    return oldest == null || createdMs < oldest ? createdMs : oldest;
  }, null);
  const oldestOpenHours =
    oldestOpenMs == null ? 0 : Math.max(0, Math.floor((Date.now() - oldestOpenMs) / 3_600_000));

  let statusLabel = t('operations.alerts.statusClear', 'Queue clear');
  let statusTone: OperationalTone = 'success';
  if (openCritical.length > 0) {
    statusLabel = t('operations.alerts.statusCritical', 'Immediate triage');
    statusTone = 'danger';
  } else if (openAlerts.length > 0) {
    statusLabel = t('operations.alerts.statusReview', 'Review queue');
    statusTone = 'warning';
  } else if (alerts.length === 0) {
    statusLabel = t('operations.status.awaitingData', 'Awaiting data');
    statusTone = 'neutral';
  }

  const attention: OperationalAttention[] = [];
  if (openCritical.length > 0) {
    attention.push({
      key: 'critical',
      title: t(
        'operations.alerts.criticalTitle',
        '{{count}} critical alert requires response',
        { count: openCritical.length },
      ),
      description: t(
        'operations.alerts.criticalDescription',
        'Inspect the related signal, record an owner, and acknowledge the response.',
      ),
      tone: 'danger',
    });
  }
  if (oldestOpenHours >= 24) {
    attention.push({
      key: 'aging',
      title: t('operations.alerts.agingTitle', 'Open alert is aging'),
      description: t(
        'operations.alerts.agingDescription',
        'The oldest unacknowledged alert has been open for {{count}} hours.',
        { count: oldestOpenHours },
      ),
      tone: 'warning',
    });
  }
  if (missingEvidence > 0) {
    attention.push({
      key: 'evidence',
      title: t('operations.alerts.evidenceTitle', 'Context requires manual review'),
      description: t(
        'operations.alerts.evidenceDescription',
        '{{count}} open alert has no related signal metadata; use its source and timestamp to investigate.',
        { count: missingEvidence },
      ),
      tone: 'info',
    });
  }

  return (
    <OperationalBrief
      testId="alerts-operational-brief"
      eyebrow={t('operations.alerts.eyebrow', 'Alert posture')}
      title={t('operations.alerts.title', 'Triage, ownership, and evidence in one queue')}
      description={t(
        'operations.alerts.description',
        'Open issues are separated from acknowledged work, with direct access to the triggering signal and response history.',
      )}
      statusLabel={statusLabel}
      statusTone={statusTone}
      metrics={[
        {
          key: 'open',
          label: t('operations.alerts.open', 'Open'),
          value: fmtInt(openAlerts.length),
          detail: t('operations.alerts.openDetail', 'Awaiting acknowledgement or a recorded response.'),
          tone: openAlerts.length > 0 ? 'warning' : 'success',
        },
        {
          key: 'critical',
          label: t('operations.alerts.openCritical', 'Open critical'),
          value: fmtInt(openCritical.length),
          detail: t('operations.alerts.openCriticalDetail', 'Highest-severity items still requiring triage.'),
          tone: openCritical.length > 0 ? 'danger' : 'success',
        },
        {
          key: 'acknowledged',
          label: t('operations.alerts.acknowledged', 'Acknowledged'),
          value: fmtInt(acknowledgedAlerts.length),
          detail: t('operations.alerts.acknowledgedDetail', 'Items with a recorded response in this scope.'),
          tone: 'info',
        },
        {
          key: 'responders',
          label: t('operations.alerts.responders', 'Responders'),
          value: fmtInt(namedResponders.size),
          detail: t('operations.alerts.respondersDetail', 'Named owners recorded by acknowledgement events.'),
          tone: namedResponders.size > 0 ? 'success' : 'neutral',
        },
      ]}
      attention={attention}
      scope={
        <>
          <Badge variant="neutral" size="sm">{vehicleLabel}</Badge>
          <Badge variant="neutral" size="sm">{periodLabel}</Badge>
        </>
      }
      freshness={<DataFreshnessAuto query={query} compact />}
      actions={
        <>
          {openCritical.length > 0 && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              icon={<Icons.alertCircle className="h-4 w-4" aria-hidden="true" />}
              onClick={onViewCritical}
            >
              {t('operations.alerts.triageCritical', 'Triage critical')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<Icons.settingsAlt className="h-4 w-4" aria-hidden="true" />}
            onClick={onManageRules}
          >
            {t('operations.alerts.manageRules', 'Manage rules')}
          </Button>
        </>
      }
      provenance={t(
        'operations.alerts.provenance',
        'Derived from the alert event feed, rule metadata, and acknowledgement audit records for the active vehicle and date scope.',
      )}
    />
  );
}

export default AlertOperationalBrief;
