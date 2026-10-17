import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { briefSource, type BriefSource } from './briefSource';

export function SubjectsOperationalBrief({ subjectCount, accessMode, sessionStatus, source }: {
  subjectCount: number | null; accessMode: string | null; sessionStatus: string | null; source: BriefSource;
}) {
  const { t } = useTranslation();
  const scope = t('impersonation.users.brief.scope', 'Current impersonation status and available session subjects are independent sources. Open mode disables subject discovery.');
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'subjects-available', rawValue: subjectCount,
      label: t('impersonation.users.kpi.available', 'Available subjects'), description: scope },
    { metricId: 'status', occurrenceId: 'subjects-access', rawValue: accessMode,
      label: t('impersonation.users.kpi.accessMode', 'Access mode'), description: scope },
    { metricId: 'status', occurrenceId: 'subjects-session', rawValue: sessionStatus,
      label: t('impersonation.users.kpi.session', 'Session status'), description: scope },
    { metricId: 'duration', occurrenceId: 'subjects-limit', rawValue: 900,
      display: { units: { duration: 'min' }, precision: 0 },
      label: t('impersonation.users.kpi.limit', 'Session limit'),
      description: t('impersonation.users.brief.limit', 'Configured policy limit of 15 minutes, not the active session’s remaining time.') },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <OperationalBrief compact testId="subjects-operational-brief" metrics={operationalMetrics}
    eyebrow={t('impersonation.users.title', 'Subjects')} title={t('impersonation.users.brief.title', 'Subject and session posture')}
    description={scope} scope={t('admin.operationalBrief.periodUnknown', 'Observation time and complete analysis bounds are not supplied by this source.')}
    provenance={t('impersonation.users.brief.provenance', 'Authenticated-session telemetry and impersonation policy')}
    {...briefSource(t, source)} loading={source.loading && !source.retained} />;
}
