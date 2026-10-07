import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { EmptyState } from '@/components/feedback';
import type { DrivingRhythmKpis } from '../driving-rhythm/DrivingRhythmKpis';
import { useRhythmDayLabel } from '../driving-rhythm/useRhythmDayLabel';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof DrivingRhythmKpis> & { scope: string; retained: boolean };

export function DrivingRhythmBrief({ summary, isLoading, error, onRetry, scope, retained }: Props) {
  const { t } = useTranslation();
  const dayLabel = useRhythmDayLabel();
  const available = !isLoading && error == null;
  const favorite = summary.favorite;
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'drives', rawValue: available ? summary.total : null,
      label: t('rhythm.totalDrives', 'Drives'),
      description: available ? summary.excluded > 0
        ? t('rhythm.kpi.timestampCoverage', '{{included}} of {{observed}} returned rows included', { included: summary.total, observed: summary.observed })
        : t('rhythm.kpi.returnedCoverage', '{{count}} returned rows included', { count: summary.observed })
        : t('driving.brief.pending', 'Drive evidence is not available yet.') },
    { metricId: 'text', occurrenceId: 'favorite',
      rawValue: available && favorite ? `${dayLabel(favorite.day)} ${String(favorite.hour).padStart(2, '0')}:00` : null,
      label: t('rhythm.favoriteSlot', 'Favorite Slot'),
      description: available && favorite
        ? t('rhythm.driveCount', '{{count}} drives', { count: favorite.count })
        : t('rhythm.kpi.noFavorite', 'No valid departure starts') },
    { metricId: 'percent', occurrenceId: 'weekday',
      rawValue: available && summary.total > 0 ? Math.round(summary.weekdayCount / summary.total * 100) : null,
      label: t('rhythm.weekdayShare', 'Weekday Share'),
      description: available
        ? t('rhythm.weekendCount', '{{count}} weekend drives', { count: summary.weekendCount })
        : t('driving.brief.pending', 'Drive evidence is not available yet.'),
      display: { precision: 0 } },
    { metricId: 'score', occurrenceId: 'predictability', rawValue: available ? summary.predictability : null,
      label: t('rhythm.predictability', 'Predictability'),
      description: summary.predictability != null ? t('rhythm.of100', 'of 100')
        : t('rhythm.kpi.predictabilityFloor', 'Needs at least {{count}} valid drives', { count: summary.minPredictabilityDrives }),
      display: { precision: 0 } },
  ];
  return <section aria-label={t('rhythm.kpis', 'Driving rhythm summary metrics')} data-testid="driving-rhythm-kpis">
    <DrivingSummaryBrief metrics={metrics} title={t('rhythm.kpis', 'Driving rhythm summary metrics')}
      description={t('rhythm.brief.description', 'Departure timing in the selected local-time window; timestamp exclusions and evidence floors remain explicit.')}
      scope={scope} provenance={t('rhythm.brief.source', 'Returned calendar drive history; local departure timestamps.')}
      loading={isLoading} error={error} retained={retained} onRetry={onRetry} />
    {available && summary.total === 0 && <EmptyState message={t('rhythm.noDrives', 'No drives in this period yet.')}
      actionTo={{ label: t('rhythm.browseDrives', 'Browse drives'), to: '/drives' }} />}
  </section>;
}
