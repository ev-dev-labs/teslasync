import { ListOrdered } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import {
  Badge, DataTable, GlassPanel, PanelTitle, Text, type Column,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import type { TargetBand, WeekResult } from '../../lib/efficiencyTarget';
import { EfficiencyTargetSectionBody } from './EfficiencyTargetSectionBody';
import type { EfficiencyTargetSectionState } from './types';
import { useEfficiencyTargetDisplay } from './useEfficiencyTargetDisplay';

const RECENT_WEEK_COUNT = 8;
interface ScorecardRow {
  weekStart: string;
  week: string;
  rank: number | null;
  consumption: string;
  gap: string;
  distance: string;
  drives: number;
  status: string;
  band: TargetBand | null;
}

interface RecentWeekScorecardProps {
  completedWeeks: WeekResult[];
  state: EfficiencyTargetSectionState;
  className?: string;
}

export function RecentWeekScorecard(
  { completedWeeks, state, className }: RecentWeekScorecardProps,
) {
  const { t } = useTranslation();
  const {
    formatDistance,
    formatEfficiency,
    formatSignedEfficiency,
    formatWeek,
  } = useEfficiencyTargetDisplay();
  const statusLabel = (band: TargetBand | null) => {
    if (band === 'onTarget') return t('effTarget.status.onTarget', 'On target');
    if (band === 'nearMiss') return t('effTarget.status.nearMiss', 'Near miss');
    if (band === 'offTrack') return t('effTarget.status.offTrack', 'Off track');
    return t('effTarget.status.ungraded', 'Ungraded');
  };
  const variant = (band: TargetBand | null) => {
    if (band === 'onTarget') return 'success' as const;
    if (band === 'nearMiss') return 'warning' as const;
    if (band === 'offTrack') return 'danger' as const;
    return 'neutral' as const;
  };
  const rows = useMemo<ScorecardRow[]>(
    () =>
      completedWeeks
        .slice(-RECENT_WEEK_COUNT)
        .reverse()
        .map((week) => ({
          weekStart: week.weekStart,
          week: formatWeek(week.weekStart),
          rank: week.rank,
          consumption: formatEfficiency(week.whPerKm, 1),
          gap: formatSignedEfficiency(week.targetGapWhPerKm, 1),
          distance: formatDistance(week.distanceM, { precision: 1 }),
          drives: week.drives,
          status: statusLabel(week.band),
          band: week.band,
        })),
    [
      completedWeeks,
      formatDistance,
      formatEfficiency,
      formatSignedEfficiency,
      formatWeek,
      t,
    ],
  );
  const columns = useMemo<Column<ScorecardRow>[]>(
    () => [
      {
        key: 'rank',
        header: t('effTarget.score.rank', 'Rank'),
        render: (row) => (
          <Text as="span" variant="bodySm">
            {row.rank != null
              ? t('effTarget.score.rankValue', '#{{rank}}', { rank: row.rank })
              : '—'}
          </Text>
        ),
        visibleOnMobile: true,
        align: 'right',
      },
      {
        key: 'week',
        header: t('effTarget.col.week', 'Week'),
        render: (row) => row.week,
        visibleOnMobile: true,
      },
      {
        key: 'consumption',
        header: t('effTarget.col.consumption', 'Consumption'),
        render: (row) => row.consumption,
        visibleOnMobile: true,
        align: 'right',
      },
      {
        key: 'gap',
        header: t('effTarget.col.gap', 'Target gap'),
        render: (row) => row.gap,
        align: 'right',
      },
      {
        key: 'distance',
        header: t('effTarget.col.distance', 'Distance'),
        render: (row) => row.distance,
        align: 'right',
      },
      {
        key: 'drives',
        header: t('effTarget.col.drives', 'Drives'),
        render: (row) => row.drives,
        align: 'right',
      },
      {
        key: 'status',
        header: t('effTarget.col.status', 'Status'),
        render: (row) => (
          <Badge variant={variant(row.band)} dot>
            {row.status}
          </Badge>
        ),
        visibleOnMobile: true,
      },
    ],
    [t],
  );

  return (
    <GlassPanel
      className={cn('h-full p-5 sm:p-6', className)}
      role="region"
      aria-label={t(
        'effTarget.sections.scorecard',
        'Recent completed-week scorecard',
      )}
      data-testid="efficiency-target-scorecard"
    >
      <PanelTitle className="flex items-center gap-2">
        <ListOrdered className="h-4 w-4 text-purple-300" aria-hidden="true" />
        {t('effTarget.score.title', 'Recent completed-week scorecard')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mt-1">
        {t(
          'effTarget.score.subtitle',
          'Rank 1 is the lowest-consumption completed week in the observed history window.',
        )}
      </Text>

      <EfficiencyTargetSectionBody state={state} className="mt-4 min-h-80">
        {rows.length === 0 ? (
          <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
            className="min-h-80"
            icon={<ListOrdered className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'effTarget.score.empty',
              'No completed eligible weeks are available for the scorecard.',
            )}
          />
        ) : (
          <DataTable
            tableId="efficiency-target:recent-weeks"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.weekStart}
            mobileColumns={['rank', 'week', 'consumption', 'status']}
            density="compact"
            maxHeight={360}
            emptyMessage={t(
              'effTarget.score.empty',
              'No completed eligible weeks are available for the scorecard.',
            )}
            exportable
            exportFilename="efficiency-target-recent-weeks"
            exportRow={(row) => ({
              rank: row.rank,
              week: row.week,
              consumption: row.consumption,
              target_gap: row.gap,
              distance: row.distance,
              drives: row.drives,
              status: row.status,
            })}
          />
        )}
      </EfficiencyTargetSectionBody>
    </GlassPanel>
  );
}
