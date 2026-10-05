import { useTranslation } from 'react-i18next';
import { StatStrip, type StatMetric, type StatPeriod } from '@/components/data-display/stat-reference';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { HelperText } from '@/components/ui';
import type { GuardPageModel } from './useGuardPageModel';

export function GuardOverview({ model: m }: { model: GuardPageModel }) {
  const { t } = useTranslation();
  const unavailable = t('guard.modernization.sourceUnknown', 'Source unavailable; no security conclusion can be drawn.');
  const policyContext = t('guard.modernization.policyOnly', 'Saved policy only; not confirmation of active monitoring or successful arming.');
  const notSaved = t('guard.modernization.notSaved', 'No saved guard policy yet');
  const loading = t('guard.updating', 'Updating…');
  const configMissing = m.configQuery.isLoading ? loading : m.guardConfig === null ? notSaved : unavailable;
  const eventsMissing = m.eventsQuery.isLoading ? loading : unavailable;
  const vehicleMissing = m.vehicleStateQuery.isLoading ? loading : undefined;
  const metrics: StatMetric[] = [
    {
      metricId: 'status', occurrenceId: 'guard-state',
      label: t('guard.kpiState', 'Guard state'),
      description: policyContext,
      rawValue: m.isTriggered ? t('guard.triggered', 'Triggered') : m.guardConfig != null ? m.policyLabel : null,
      missingReason: configMissing,
      context: m.isTriggered
        ? t('guard.modernization.eventTrigger', 'Triggered denotes the latest unacknowledged non-test event, not confirmed theft or an active monitoring engine.')
        : policyContext,
    },
    {
      metricId: 'status', occurrenceId: 'guard-sentry',
      label: t('guard.kpiSentry', 'Sentry mode'),
      description: t('guard.kpiSentry', 'Sentry mode'),
      rawValue: m.sentryOn == null ? null : m.sentryOn ? t('guard.on', 'On') : t('guard.off', 'Off'),
      missingReason: vehicleMissing ?? t('guard.sentryUnknown', 'Sentry status unavailable'),
    },
    {
      metricId: 'status', occurrenceId: 'guard-lock',
      label: t('guard.kpiLock', 'Lock state'),
      description: t('guard.kpiLock', 'Lock state'),
      rawValue: m.isLocked == null ? null : m.isLocked ? t('guard.locked', 'Locked') : t('guard.unlocked', 'Unlocked'),
      missingReason: vehicleMissing ?? t('guard.lockUnknown', 'Lock state unavailable'),
    },
    {
      metricId: 'text', occurrenceId: 'guard-sensitivity',
      label: t('guard.kpiSensitivity', 'Sensitivity'),
      description: t('guard.modernization.sensitivityPolicy', 'Saved movement threshold policy; automatic detection is not established.'),
      rawValue: m.guardConfig != null ? m.sensitivityLabel : null,
      missingReason: configMissing,
      context: m.guardConfig != null && m.effectiveSensitivity !== m.guardConfig.sensitivity
        ? t('guard.modernization.unsavedDraft', 'Unsaved draft') : undefined,
    },
    {
      metricId: 'count', occurrenceId: 'guard-unacknowledged',
      label: t('guard.kpiUnack', 'Unacknowledged'),
      description: t('guard.modernization.eventsCoverage', 'Counts cover the returned security event history, not a theft detection assessment.'),
      rawValue: m.eventsKnown ? m.unacknowledgedCount : null,
      missingReason: eventsMissing,
    },
    {
      metricId: 'count', occurrenceId: 'guard-total',
      label: t('guard.kpiTotal', 'Total events'),
      description: t('guard.modernization.eventsCoverage', 'Counts cover the returned security event history, not a theft detection assessment.'),
      rawValue: m.eventsKnown ? m.events.length : null,
      missingReason: eventsMissing,
    },
  ];
  const period: StatPeriod = {
    kind: 'snapshot',
    label: t('guard.overview', 'Guard status overview'),
    observedAt: m.stateResponse?.observedAt != null
      ? new Date(m.stateResponse.observedAt).toISOString() : null,
    provenance: t('guard.modernization.overviewSources', 'Saved policy, current verified vehicle fields, and returned security event history have independent sources.'),
  };

  return (
    <section aria-label={t('guard.overview', 'Guard status overview')} className="min-w-0">
      <StatStrip id="guard-overview" metrics={metrics} period={period}
        retained={m.configState.refreshError != null || m.eventsState.refreshError != null || m.vehicleState.refreshError != null}
        footer={<div className="space-y-3">
          {m.noVehicle && <HelperText>{t('guard.modernization.selectVehicle', 'Select a vehicle in the workspace header to load guard data.')}</HelperText>}
          {m.configState.fatalError && <QueryError error={m.configState.fatalError} onRetry={m.configState.retry ?? undefined} />}
          {m.eventsState.fatalError && <QueryError error={m.eventsState.fatalError} onRetry={m.eventsState.retry ?? undefined} />}
          {m.vehicleState.fatalError && <QueryError error={m.vehicleState.fatalError} onRetry={m.vehicleState.retry ?? undefined} />}
          <StaleRefreshWarning state={m.configState} label={t('guard.settings', 'Guard settings')} />
          <StaleRefreshWarning state={m.eventsState} label={t('guard.eventTimeline', 'Event timeline')} />
          <StaleRefreshWarning state={m.vehicleState} label={t('guard.status', 'Status')} />
        </div>} />
    </section>
  );
}
