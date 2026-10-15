import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { useUnits } from '@/hooks/useUnits';
import { formatDayKey } from '@/lib/dateFormat';
import type { FsdKpiBand } from '../fsd-insights/FsdKpiBand';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof FsdKpiBand> & { scope: string; retained: boolean };

export function FsdEvidenceBrief({ insights, state, scope, retained }: Props) {
  const { t } = useTranslation();
  const { unitPrefs, formatDistance } = useUnits();
  const totals = insights?.totals;
  const quality = insights?.quality;
  const best = totals?.best_day;
  const available = !state.noVehicle && !state.isLoading && state.error == null;
  const measured = totals?.fsd_distance_m != null;
  const metrics: readonly StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'fsd-distance', rawValue: available ? totals?.fsd_distance_m : null,
      label: t('fsd.kpi.distance', 'Supervised self-driving distance'),
      description: measured ? t('fsd.kpi.distanceHint', 'Reported counter change')
        : t('fsd.kpi.distanceUnavailable', 'Self-driving counter not reported in this period'),
      display: { formatter: (raw) => ({ value: formatDistance(raw), unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'share', rawValue: available ? totals?.fsd_share_pct : null,
      label: t('fsd.kpi.share', 'Share of observed driving'),
      description: totals?.fsd_share_pct != null
        ? t('fsd.kpi.shareHint', 'of {{distance}} observed driving', { distance: formatDistance(totals.driving_distance_m ?? null) })
        : !measured ? t('fsd.kpi.shareNoFsd', 'Needs the self-driving counter, which was not reported')
          : quality?.driving_denominator_available && !quality.share_basis_available
            ? t('fsd.kpi.shareUnaligned', 'Counter spans do not align for a trustworthy share')
            : t('fsd.kpi.shareUnavailable', 'Observed-driving counter not reported') },
    { metricId: 'count', occurrenceId: 'days', rawValue: available && measured ? totals?.active_days : null,
      label: t('fsd.kpi.activeDays', 'Days with self-driving distance'),
      description: totals && measured ? t('fsd.kpi.activeDaysHint', 'of {{days}} measured days', { days: totals.measured_days })
        : totals ? t('fsd.kpi.activeDaysUnavailable', 'No day could be measured')
          : t('fsd.kpi.noPeriod', 'No period loaded yet') },
    { metricId: 'distance', occurrenceId: 'best-day', rawValue: available ? best?.fsd_distance_m : null,
      label: t('fsd.kpi.bestDay', 'Best day'),
      description: best ? formatDayKey(best.date, { locale: unitPrefs.locale, style: 'long' })
        : measured ? t('fsd.kpi.bestDayNone', 'No day accumulated distance yet')
          : t('fsd.kpi.bestDayUnavailable', 'Nothing measured in this period'),
      display: { formatter: (raw) => ({ value: formatDistance(raw), unit: '' }) } },
  ];
  return <section aria-label={t('fsd.kpi.section', 'Supervised self-driving summary')} data-testid="fsd-kpis">
    <DrivingSummaryBrief metrics={metrics} title={t('fsd.kpi.section', 'Supervised self-driving summary')}
      description={t('fsd.brief.description', 'Reported self-driving counter deltas, not estimated engagement time; a share requires aligned observed-driving spans.')}
      scope={scope} provenance={t('fsd.brief.source', 'Reported supervised self-driving and observed-driving counters, grouped by the requested local calendar window.')}
      loading={state.isLoading} error={state.error} retained={retained} onRetry={state.onRetry}
      statusLabel={state.noVehicle ? t('fsd.brief.noVehicle', 'Select a vehicle') : undefined} />
  </section>;
}
