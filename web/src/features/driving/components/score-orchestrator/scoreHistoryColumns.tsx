import type { TFunction } from 'i18next';
import { Badge, Caption, Text, type Column } from '@/components/ui';
import { formatDateShort, formatDurationMinutes } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { gradeTextClass, gradeVariant, type HistoryRow } from './scoreDomain';

export function createHistoryColumns(
  t: TFunction,
  formatDistance: (distanceM: number) => string,
  formatEfficiency: (whPerKm: number) => string,
): Column<HistoryRow>[] {
  return [
    {
      key: 'date',
      header: t('driveScore.colDate', 'Date'),
      sortable: true,
      visibleOnMobile: true,
      render: (row) => (
        <Text variant="bodySm" className="whitespace-nowrap">
          {formatDateShort(row.ts)}
        </Text>
      ),
    },
    {
      key: 'route',
      header: t('driveScore.colRoute', 'Route'),
      render: (row) => (
        <Text variant="bodySm" className="block min-w-0 max-w-[16rem] whitespace-normal break-words">
          {row.route}
        </Text>
      ),
    },
    {
      key: 'distance',
      header: t('driveScore.colDistance', 'Distance'),
      sortable: true,
      align: 'right',
      render: (row) => (
        <Text variant="body" className="tabular-nums">
          {formatDistance(row.distanceM)}
        </Text>
      ),
    },
    {
      key: 'duration',
      header: t('driveScore.colDuration', 'Duration'),
      align: 'right',
      render: (row) => (
        <Text variant="body" className="tabular-nums">
          {row.durationS != null ? formatDurationMinutes(row.durationS / 60) : '—'}
        </Text>
      ),
    },
    {
      key: 'efficiency',
      header: t('driveScore.colConsumption', 'Consumption'),
      sortable: true,
      align: 'right',
      render: (row) => (
        <Text variant="body" className="tabular-nums">
          {formatEfficiency(row.whPerKm)}
        </Text>
      ),
    },
    {
      key: 'score',
      header: t('driveScore.colScore', 'Score'),
      sortable: true,
      align: 'right',
      visibleOnMobile: true,
      render: (row) => (
        <Text
          as="span"
          size="sm"
          weight="semibold"
          className={cn('tabular-nums', gradeTextClass(row.grade))}
        >
          {row.total}/100
        </Text>
      ),
    },
    {
      key: 'grade',
      header: t('driveScore.colGrade', 'Grade'),
      align: 'center',
      render: (row) => (
        <Badge variant={gradeVariant(row.grade)} size="sm">
          {row.grade}
        </Badge>
      ),
    },
    {
      key: 'breakdown',
      header: t('driveScore.colBreakdown', 'Eff / Smo / Spd'),
      align: 'right',
      render: (row) => (
        <Caption className="tabular-nums">
          {row.efficiency}/{row.smoothness}/{row.speed}
        </Caption>
      ),
    },
  ];
}
