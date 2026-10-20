import type { ReactNode, ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle, Badge, Text, Caption } from '@/components/ui';
import { LinearGauge } from '@/components/charts';
import { KVList } from '@/components/data-display';
import { knownNumber } from '@/api/dataState';
import { formatDateShort, formatDurationMinutes } from '@/lib/dateFormat';
import { Icons } from '@/lib/icons';
import { cn } from '@/lib/cn';
import type { ScoredDrive } from '../../pages/DriveScorePage';

interface ScoreExtremeDriveProps {
  kind: 'best' | 'worst';
  entry: ScoredDrive | null;
  badgeVariant: NonNullable<ComponentProps<typeof Badge>['variant']>;
  sourceFallback: ReactNode;
  insight: string;
  formatDistance: (value: number) => string;
  formatEfficiency: (value: number) => string;
}

export function ScoreExtremeDrive({
  kind, entry, badgeVariant, sourceFallback, insight, formatDistance, formatEfficiency,
}: ScoreExtremeDriveProps) {
  const { t } = useTranslation();
  const best = kind === 'best';
  const Icon = best ? Icons.star : Icons.severityWarn;
  return (
    <GlassPanel className="min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex min-w-0 items-center gap-2">
        <Icon className={cn('h-5 w-5 shrink-0', best ? 'text-emerald-300' : 'text-rose-300')} aria-hidden="true" />
        <PanelTitle>{best ? t('driveScore.bestDrive', 'Best Drive') : t('driveScore.worstDrive', 'Worst Drive')}</PanelTitle>
      </div>
      {sourceFallback ?? (entry ? (
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Caption>{formatDateShort(entry.drive.startTs)}</Caption>
            <Badge variant={badgeVariant} size="sm">{entry.score.grade}</Badge>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <LinearGauge value={entry.score.total} max={100} label={t('driveScore.score', 'Score')}
              tone={best ? 'success' : 'danger'} size={72} className="w-28 shrink-0" />
            <div className="min-w-0 flex-1">
              <KVList layout="responsive" items={[
                { id: 'distance', label: t('driveScore.distance', 'Distance'), value: formatDistance(entry.drive.distanceM) },
                {
                  id: 'duration',
                  label: t('driveScore.durationLabel', 'Duration'),
                  value: knownNumber(entry.drive.durationS) != null
                    ? formatDurationMinutes(entry.drive.durationS / 60) : '—',
                },
                { id: 'consumption', label: t('driveScore.consumption', 'Consumption'), value: formatEfficiency(entry.score.whPerKm) },
              ]} />
            </div>
          </div>
          <div className={cn('rounded-lg border p-3',
            best ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10')}>
            <Text variant="bodySm" className={best ? 'text-emerald-300' : 'text-rose-300'}>
              <Icon className="me-1 inline h-3 w-3" aria-hidden="true" />{insight}
            </Text>
          </div>
        </div>
      ) : <Caption>{t('driveScore.noDrives', 'No drives available')}</Caption>)}
    </GlassPanel>
  );
}
