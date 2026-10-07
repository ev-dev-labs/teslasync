import { ListOrdered, Timer } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';

import type { ParkingStint, ParkingSummary } from '../../lib/parkingDwell';
import { ParkingSectionBody } from './ParkingSectionBody';
import type { ParkingSectionState } from './types';

interface RankedStint extends ParkingStint {
  rank: number;
}

interface LongestParkingStintsProps {
  summary: ParkingSummary;
  state: ParkingSectionState;
  className?: string;
}

/** Deterministic top-ten ranking with censoring status exposed per stint. */
export function LongestParkingStints({
  summary,
  state,
  className,
}: LongestParkingStintsProps) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { formatDuration } = useUnits();
  const rows = useMemo<RankedStint[]>(
    () =>
      summary.rankedStints.slice(0, 10).map((stint, index) => ({
        ...stint,
        rank: index + 1,
      })),
    [summary.rankedStints],
  );
  const columns = useMemo<Column<RankedStint>[]>(
    () => [
      {
        key: 'rank',
        header: t('parking.longest.rank', 'Rank'),
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="body" mono>
            {fmtInt(row.rank)}
          </Text>
        ),
      },
      {
        key: 'location',
        header: t('parking.location', 'Location'),
        visibleOnMobile: true,
        render: (row) => (
          <Text
            variant="bodySm"
            className="block max-w-56 truncate"
            title={row.location ?? undefined}
          >
            {row.location ?? t('parking.unknown', 'Unknown location')}
          </Text>
        ),
      },
      {
        key: 'startMs',
        header: t('parking.longest.started', 'Parked at'),
        render: (row) => (
          <Text variant="bodySm">{formatDateTime(new Date(row.startMs))}</Text>
        ),
      },
      {
        key: 'durationMs',
        header: t('parking.longest.duration', 'Observed duration'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="body" mono>
            {formatDuration(row.durationMs / 1_000, { precision: 1 })}
          </Text>
        ),
      },
      {
        key: 'status',
        header: t('parking.longest.status', 'Status'),
        align: 'right',
        render: (row) => (
          <Badge
            variant={row.ongoing ? 'info' : row.rightCensored ? 'warning' : 'neutral'}
            size="sm"
          >
            {row.ongoing
              ? t('parking.longest.ongoing', 'Ongoing')
              : row.rightCensored
                ? t('parking.longest.rangeEdge', 'Range edge')
                : t('parking.longest.complete', 'Between drives')}
          </Badge>
        ),
      },
    ],
    [formatDateTime, formatDuration, t],
  );

  return (
    <section
      className={className}
      aria-label={t('parking.sections.longest', 'Longest parking stints')}
      data-testid="parking-longest"
    >
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-amber-300" aria-hidden="true" />
          {t('parking.longest.title', 'Longest Observed Stints')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mt-1">
          {t(
            'parking.longest.subtitle',
            'Showing {{shown}} of {{count}} reconstructed stints; range-edge durations are observed minimums.',
            {
              shown: rows.length,
              count: summary.stints.length,
            },
          )}
        </Text>
        <ParkingSectionBody state={state} className="mt-3 min-h-72">
          {rows.length === 0 ? (
            <EmptyState
              className="h-full"
              icon={<Timer className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'parking.longest.empty',
                'No positive parking gaps are available to rank in this window.',
              )}
              actionTo={{
                label: t('parking.browseDrives', 'Browse drives'),
                to: '/drives',
              }}
            />
          ) : (
            <DataTable
              tableId="vehicles:parking-longest"
              columns={columns}
              data={rows}
              keyExtractor={(row) =>
                `${row.sourceDriveId}:${row.startMs}:${row.endMs}`
              }
              emptyMessage={t(
                'parking.longest.empty',
                'No positive parking gaps are available to rank in this window.',
              )}
              mobileColumns={['rank', 'location', 'durationMs']}
            />
          )}
        </ParkingSectionBody>
      </GlassPanel>
    </section>
  );
}
