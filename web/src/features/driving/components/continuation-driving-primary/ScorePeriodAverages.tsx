import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { GlassPanel, Text, Caption, Label } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { Icons } from '@/lib/icons';
import type { PeriodStats } from '../../pages/DriveScorePage';

function scoreTextClass(score: number | null): string {
  if (score == null) return typography.color.muted;
  if (score >= 80) return 'text-emerald-300';
  if (score >= 60) return 'text-amber-300';
  return 'text-rose-300';
}

export function ScorePeriodAverages({ stats, sourceFallback }: { stats: PeriodStats | null; sourceFallback?: ReactNode }) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const comparison = (current: number | null | undefined, previous: number | null | undefined) => {
    if (current == null || previous == null) return null;
    return <Text as="span" variant="caption" className={cn(
      'flex items-center', current >= previous ? 'text-emerald-300' : 'text-rose-300',
    )}>
      {current >= previous
        ? <Icons.drillThrough className="h-3 w-3" aria-hidden="true" />
        : <Icons.drillDown className="h-3 w-3" aria-hidden="true" />}
      {Math.abs(current - previous)}
    </Text>;
  };
  const tiles = [
    {
      id: 'this-week', label: t('driveScore.thisWeek', 'This Week'), value: stats?.thisWeekAvg ?? '—',
      color: scoreTextClass(stats?.thisWeekAvg ?? null),
      comparison: comparison(stats?.thisWeekAvg, stats?.lastWeekAvg),
      detail: t('driveScore.vsLastWeek', 'vs {{val}} last week', { val: stats?.lastWeekAvg ?? '—' }),
    },
    {
      id: 'this-month', label: t('driveScore.thisMonth', 'This Month'), value: stats?.thisMonthAvg ?? '—',
      color: scoreTextClass(stats?.thisMonthAvg ?? null),
      comparison: comparison(stats?.thisMonthAvg, stats?.lastMonthAvg),
      detail: t('driveScore.vsLastMonth', 'vs {{val}} last month', { val: stats?.lastMonthAvg ?? '—' }),
    },
    {
      id: 'best-week', label: t('driveScore.bestWeek', 'Best Week'), value: stats?.bestWeek.avg ?? '—',
      color: scoreTextClass(stats?.bestWeek.avg ?? null), detail: stats?.bestWeek.label ?? '—',
    },
    {
      id: 'best-month', label: t('driveScore.bestMonth', 'Best Month'), value: stats?.bestMonth.avg ?? '—',
      color: scoreTextClass(stats?.bestMonth.avg ?? null), detail: stats?.bestMonth.label ?? '—',
    },
    {
      id: 'total-drives', label: t('driveScore.totalDrivesLabel', 'Total Drives'), value: stats?.totalDrives ?? '—',
      color: typography.color.primary, detail: t('driveScore.drivesScored', 'drives scored'),
    },
    {
      id: 'a-or-better', label: t('driveScore.ratedAPlus', 'Rated A+/A'), value: stats?.aOrBetter ?? '—',
      color: stats ? 'text-emerald-300' : typography.color.muted,
      detail: !stats ? '—' : stats.totalDrives > 0
        ? `${fmtInt((stats.aOrBetter / stats.totalDrives) * 100)}% ${t('driveScore.ofDrives', 'of drives')}`
        : t('driveScore.noDrives', 'no drives'),
    },
  ];
  return <>{tiles.map((tile) => (
    <GlassPanel key={tile.id} className="flex min-w-0 flex-col gap-2 p-4 sm:p-5">
      <Label>{tile.label}</Label>
      {sourceFallback ?? <>
        <div className="flex flex-wrap items-end gap-2">
          <Text as="span" size="2xl" weight="bold" className={cn('tabular-nums', tile.color)}>{tile.value}</Text>
          {tile.comparison}
        </div>
        <Caption>{tile.detail}</Caption>
      </>}
    </GlassPanel>
  ))}</>;
}
