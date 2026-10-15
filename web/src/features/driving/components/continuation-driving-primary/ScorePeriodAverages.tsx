import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { GlassPanel, Text, Caption, Label } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { isFiniteNumber } from '@/lib/numberFormat';
import type { PeriodStats } from '../../pages/DriveScorePage';

function scoreTextClass(score: number | null): string {
  return isFiniteNumber(score) ? typography.color.primary : typography.color.muted;
}

export function ScorePeriodAverages({ stats, sourceFallback }: { stats: PeriodStats | null; sourceFallback?: ReactNode }) {
  const { t } = useTranslation();
  const { fmtInt, fmtScientificNumber } = useNumberFormatting();
  const reading = (value: number | null | undefined) => isFiniteNumber(value) ? fmtInt(value) : '—';
  const comparison = (current: number | null | undefined, previous: number | null | undefined) => {
    if (!isFiniteNumber(current) || !isFiniteNumber(previous)) return null;
    const delta = current - previous;
    if (!isFiniteNumber(delta)) return null;
    const val = fmtScientificNumber(Math.abs(delta), 0);
    const text = delta === 0
      ? t('driveScore.periodEqual', 'No change')
      : delta > 0
        ? t('driveScore.periodIncrease', 'Increased by {{val}}', { val })
        : t('driveScore.periodDecrease', 'Decreased by {{val}}', { val });
    return <Text as="span" variant="caption" className={typography.color.secondary}>{text}</Text>;
  };
  const tiles = [
    {
      id: 'this-week', label: t('driveScore.thisWeek', 'This Week'), value: reading(stats?.thisWeekAvg),
      color: scoreTextClass(stats?.thisWeekAvg ?? null),
      comparison: comparison(stats?.thisWeekAvg, stats?.lastWeekAvg),
      detail: t('driveScore.vsLastWeek', 'vs {{val}} last week', { val: reading(stats?.lastWeekAvg) }),
    },
    {
      id: 'this-month', label: t('driveScore.thisMonth', 'This Month'), value: reading(stats?.thisMonthAvg),
      color: scoreTextClass(stats?.thisMonthAvg ?? null),
      comparison: comparison(stats?.thisMonthAvg, stats?.lastMonthAvg),
      detail: t('driveScore.vsLastMonth', 'vs {{val}} last month', { val: reading(stats?.lastMonthAvg) }),
    },
    {
      id: 'best-week', label: t('driveScore.bestWeek', 'Best Week'), value: reading(stats?.bestWeek.avg),
      color: scoreTextClass(stats?.bestWeek.avg ?? null), detail: stats?.bestWeek.label ?? '—',
    },
    {
      id: 'best-month', label: t('driveScore.bestMonth', 'Best Month'), value: reading(stats?.bestMonth.avg),
      color: scoreTextClass(stats?.bestMonth.avg ?? null), detail: stats?.bestMonth.label ?? '—',
    },
    {
      id: 'total-drives', label: t('driveScore.totalDrivesLabel', 'Total Drives'), value: reading(stats?.totalDrives),
      color: typography.color.primary, detail: t('driveScore.drivesScored', 'drives scored'),
    },
    {
      id: 'a-or-better', label: t('driveScore.ratedAPlus', 'Rated A+/A'), value: reading(stats?.aOrBetter),
      color: scoreTextClass(stats?.aOrBetter ?? null),
      detail: !stats || !isFiniteNumber(stats.totalDrives) || !isFiniteNumber(stats.aOrBetter) ? '—' : stats.totalDrives > 0
        ? t('driveScore.percentOfDrives', '{{val}}% of drives', { val: reading((stats.aOrBetter / stats.totalDrives) * 100) })
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
