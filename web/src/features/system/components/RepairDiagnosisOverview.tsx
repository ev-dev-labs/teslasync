import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SystemSummaryBrief } from './operationalbrief-all/SystemSummaryBrief';
import { InlineCallout } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

interface RepairDiagnosisOverviewProps {
  totalSuggestions: number | null;
  driveSuggestions: number | null;
  chargingSuggestions: number | null;
  blocked: number | null;
  truncated: boolean;
  loading?: boolean;
  retained?: boolean;
}

export function RepairDiagnosisOverview({
  totalSuggestions,
  driveSuggestions,
  chargingSuggestions,
  blocked,
  truncated,
  loading = false,
  retained = false,
}: RepairDiagnosisOverviewProps) {
  const { t } = useTranslation();

  return (
    <>
      <FadeIn>
        <SystemSummaryBrief
          title={t('dataRepair.kpis', 'Repair summary')}
          description={t('dataRepair.brief.description', 'Suggested session boundary repairs and blocked cases from the durable-history diagnosis response.')}
          scope={truncated
            ? t('dataRepair.truncated', 'The scan hit its per-request limit, so more sessions may need repair than are listed here. Apply what is shown and refresh.')
            : t('dataRepair.brief.scope', 'Current diagnosis response; not a complete lifetime count.')}
          available={totalSuggestions != null} loading={loading} retained={retained}
          metricTones={{ blocked: blocked == null ? 'warning' : blocked === 0 ? 'success' : 'danger' }}
          metrics={[
            { metricId: 'count', occurrenceId: 'suggestions', rawValue: totalSuggestions, label: t('dataRepair.kpi.suggestions', 'Suggested repairs') },
            { metricId: 'count', occurrenceId: 'drive', rawValue: driveSuggestions, label: t('dataRepair.kpi.driveSuggestions', 'Drive boundaries') },
            { metricId: 'count', occurrenceId: 'charging', rawValue: chargingSuggestions, label: t('dataRepair.kpi.chargingSuggestions', 'Charging boundaries') },
            { metricId: 'count', occurrenceId: 'blocked', rawValue: blocked, label: t('dataRepair.kpi.blocked', 'Blocked') },
          ]}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <InlineCallout variant="warning" icon={<ShieldAlert />}>
          {t(
            'dataRepair.callout',
            'Suggestions come from durable history only: a session is listed when its stored state is contradicted by a later signal, never because it is simply old. Applying a repair rewrites the end timestamp (and, for drives, the derived duration) of that one session, is recorded in the audit log, and is never done automatically.',
          )}
        </InlineCallout>
      </FadeIn>

      {truncated ? (
        <FadeIn delay={0.12}>
          <InlineCallout variant="info" icon={<AlertTriangle />}>
            {t(
              'dataRepair.truncated',
              'The scan hit its per-request limit, so more sessions may need repair than are listed here. Apply what is shown and refresh.',
            )}
          </InlineCallout>
        </FadeIn>
      ) : null}
    </>
  );
}
