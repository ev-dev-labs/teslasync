import { GlassPanel, PanelTitle } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { SourceContent } from '@/components/layout';
import { Skeleton } from '@/components/feedback';
import { formatDurationMinutes } from '@/lib/dateConvert';
import type { ScoreSectionProps } from './scoreSectionTypes';

type ScorePeriodStatisticsPanelProps = ScoreSectionProps<
  't' | 'noDrivesMsg' | 'completeDistance' | 'formatDistance' | 'filteredDrives'
  | 'completeDuration' | 'measuredMaxSpeeds' | 'formatSpeed' | 'fmtInt' | 'allScores'
  | 'hasDrivePayload' | 'drivesLoading' | 'drivesSource' | 'refetch'
>;

export function ScorePeriodStatisticsPanel({
  model,
}: ScorePeriodStatisticsPanelProps) {
  const {
    t, noDrivesMsg, completeDistance, formatDistance, filteredDrives,
    completeDuration, measuredMaxSpeeds, formatSpeed, fmtInt, allScores,
    hasDrivePayload, drivesLoading, drivesSource, refetch,
  } = model;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3">{t('driveScore.periodStats', 'Period Statistics')}</PanelTitle>
      <SourceContent
        state={drivesLoading ? 'loading' : drivesSource.fatalError ? 'error' : 'ready'}
        label={t('driveScore.resource', 'drive')}
        emptyMessage={noDrivesMsg}
        errorMessage={t('driveScore.sourceError', 'Drive score evidence could not be loaded')}
        error={drivesSource.fatalError}
        errorRecovery={{ onRetry: () => { void refetch(); }, resourceName: t('driveScore.resource', 'drive') }}
        loadingContent={<Skeleton height={200} />}
      >
        <KVList
          layout="responsive"
          items={[
            {
              id: 'total-distance',
              label: t('driveScore.totalDistance', 'Total Distance'),
              value: completeDistance ? formatDistance(
                filteredDrives.reduce((sum, d) => sum + (d.distanceM ?? 0), 0),
              ) : '—',
            },
            {
              id: 'total-duration',
              label: t('driveScore.totalDuration', 'Total Duration'),
              value: completeDuration ? formatDurationMinutes(
                filteredDrives.reduce((sum, d) => sum + (d.durationS ?? 0), 0) / 60,
              ) : '—',
            },
            {
              id: 'average-distance',
              label: t('driveScore.avgDistance', 'Avg Distance/Drive'),
              value: completeDistance && filteredDrives.length > 0 ? formatDistance(
                filteredDrives.reduce((sum, d) => sum + (d.distanceM ?? 0), 0) /
                  filteredDrives.length,
              ) : '—',
            },
            {
              id: 'average-duration',
              label: t('driveScore.avgDuration', 'Avg Duration/Drive'),
              value: completeDuration && filteredDrives.length > 0 ? formatDurationMinutes(
                filteredDrives.reduce((sum, d) => sum + (d.durationS ?? 0), 0) /
                  filteredDrives.length / 60,
              ) : '—',
            },
            {
              id: 'highest-speed',
              label: t('driveScore.highestSpeed', 'Highest Max Speed'),
              value: hasDrivePayload && measuredMaxSpeeds.length > 0
                && measuredMaxSpeeds.length === filteredDrives.length
                ? formatSpeed(Math.max(...measuredMaxSpeeds)) : '—',
            },
            {
              id: 'a-plus-count',
              label: t('driveScore.aPlusCount', 'A+ Drives'),
              value: hasDrivePayload ? fmtInt(allScores.filter((s) => s.grade === 'A+').length) : '—',
            },
          ]}
        />
      </SourceContent>
    </GlassPanel>
  );
}
