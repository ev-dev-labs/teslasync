import { GlassPanel, PanelTitle } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { formatDurationMinutes } from '@/lib/dateFormat';
import { Icons } from '@/lib/icons';
import type { ScoreSectionProps } from './scoreSectionTypes';

type ScorePeriodStatisticsPanelProps = ScoreSectionProps<
  't' | 'noDrivesMsg' | 'completeDistance' | 'formatDistance' | 'filteredDrives'
  | 'completeDuration' | 'measuredMaxSpeeds' | 'formatSpeed' | 'fmtInt' | 'allScores'
>;

export function ScorePeriodStatisticsPanel({
  model, driveState,
}: ScorePeriodStatisticsPanelProps) {
  const {
    t, noDrivesMsg, completeDistance, formatDistance, filteredDrives,
    completeDuration, measuredMaxSpeeds, formatSpeed, fmtInt, allScores,
  } = model;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3">{t('driveScore.periodStats', 'Period Statistics')}</PanelTitle>
      {driveState(
        200,
        noDrivesMsg,
        <Icons.drive className="h-8 w-8" aria-hidden="true" />,
      ) ?? (
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
              value: completeDistance ? formatDistance(
                filteredDrives.length > 0
                  ? filteredDrives.reduce((sum, d) => sum + (d.distanceM ?? 0), 0) /
                      filteredDrives.length
                  : 0,
              ) : '—',
            },
            {
              id: 'average-duration',
              label: t('driveScore.avgDuration', 'Avg Duration/Drive'),
              value: completeDuration ? formatDurationMinutes(
                filteredDrives.length > 0
                  ? filteredDrives.reduce((sum, d) => sum + (d.durationS ?? 0), 0) /
                      filteredDrives.length /
                      60
                  : 0,
              ) : '—',
            },
            {
              id: 'highest-speed',
              label: t('driveScore.highestSpeed', 'Highest Max Speed'),
              value: measuredMaxSpeeds.length > 0
                ? formatSpeed(Math.max(...measuredMaxSpeeds)) : '—',
            },
            {
              id: 'a-plus-count',
              label: t('driveScore.aPlusCount', 'A+ Drives'),
              value: fmtInt(allScores.filter((s) => s.grade === 'A+').length),
            },
          ]}
        />
      )}
    </GlassPanel>
  );
}
