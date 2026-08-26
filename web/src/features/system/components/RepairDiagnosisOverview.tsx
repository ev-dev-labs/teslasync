import { AlertTriangle, BatteryCharging, Route, ShieldAlert, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MetricCard } from '@/components/data-display';
import { InlineCallout, StatSkeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

interface RepairDiagnosisOverviewProps {
  totalSuggestions: number;
  driveSuggestions: number;
  chargingSuggestions: number;
  blocked: number;
  truncated: boolean;
  loading?: boolean;
}

export function RepairDiagnosisOverview({
  totalSuggestions,
  driveSuggestions,
  chargingSuggestions,
  blocked,
  truncated,
  loading = false,
}: RepairDiagnosisOverviewProps) {
  const { t } = useTranslation();

  return (
    <>
      <FadeIn>
        {loading ? (
          <StatSkeleton count={4} className="lg:grid-cols-4" />
        ) : (
        <section
          aria-label={t('dataRepair.kpis', 'Repair summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <MetricCard
            label={t('dataRepair.kpi.suggestions', 'Suggested Repairs')}
            value={totalSuggestions}
            icon={<Wrench className="h-4 w-4" />}
            color="amber"
            wrapLabel
          />
          <MetricCard
            label={t('dataRepair.kpi.driveSuggestions', 'Drive Boundaries')}
            value={driveSuggestions}
            icon={<Route className="h-4 w-4" />}
            color="purple"
            wrapLabel
          />
          <MetricCard
            label={t('dataRepair.kpi.chargingSuggestions', 'Charging Boundaries')}
            value={chargingSuggestions}
            icon={<BatteryCharging className="h-4 w-4" />}
            color="cyan"
            wrapLabel
          />
          <MetricCard
            label={t('dataRepair.kpi.blocked', 'Blocked')}
            value={blocked}
            icon={<AlertTriangle className="h-4 w-4" />}
            color={blocked === 0 ? 'green' : 'red'}
            wrapLabel
          />
        </section>
        )}
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
