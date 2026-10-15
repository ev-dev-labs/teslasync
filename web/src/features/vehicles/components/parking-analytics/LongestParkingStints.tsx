import { ListOrdered, Timer } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { Badge, DataTable, GlassPanel, PanelTitle, Text, type Column } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import type { ParkingStint, ParkingSummary } from '../../lib/parkingDwell';
import { ParkingSectionBody } from './ParkingSectionBody';
import type { ParkingSectionState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtInt } = useNumberFormatting();
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
        align: 'right',
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
        exportValue: (row) => row.location,
        render: (row) => (
          <Text
            variant="bodySm"
            className="block break-words"
            title={row.location ?? undefined}
          >
            {row.location ?? t('parking.unknown', 'Unknown location')}
          </Text>
        ),
      },
      {
        key: 'startMs',
        header: t('parking.longest.started', 'Parked at'),
        exportValue: (row) => new Date(row.startMs).toISOString(),
        render: (row) => (
          <Text variant="bodySm">{formatDateTime(new Date(row.startMs))}</Text>
        ),
      },
      {
        key: 'durationMs',
        header: t('parking.longest.duration', 'Observed duration'),
        align: 'right',
        visibleOnMobile: true,
        exportValue: (row) => formatDuration(row.durationMs / 1_000),
        render: (row) => (
          <Text variant="body" mono>
            {formatDuration(row.durationMs / 1_000)}
          </Text>
        ),
      },
      {
        key: 'sourceDriveId',
        header: t('chargeDepartureAlignment.modernization.driveId', 'Drive ID'),
        defaultVisible: false,
        exportValue: (row) => row.sourceDriveId,
        render: (row) => <Text variant="bodySm" mono>{String(row.sourceDriveId)}</Text>,
      },
      {
        key: 'endMs',
        header: t('parking.longest.ended', 'Ended at'),
        defaultVisible: false,
        exportValue: (row) => new Date(row.endMs).toISOString(),
        render: (row) => <Text variant="bodySm">{formatDateTime(new Date(row.endMs))}</Text>,
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
    [formatDateTime, formatDuration, t, fmtInt],
  );

  return (
    <section
      className={className}
      aria-label={t('parking.sections.longest', 'Longest parking stints')}
      data-testid="parking-longest"
    >
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          {t('parking.longest.title', 'Longest observed stints')}
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
              mobilePresentation={{
                roles: { location: 'title', durationMs: 'primary', rank: 'meta', startMs: 'meta', status: 'badge' },
                displayValue: (row, key) => {
                  switch (key) {
                    case 'rank': return fmtInt(row.rank);
                    case 'location': return row.location ?? t('parking.unknown', 'Unknown location');
                    case 'durationMs': return formatDuration(row.durationMs / 1_000);
                    case 'startMs': return formatDateTime(new Date(row.startMs));
                    case 'endMs': return formatDateTime(new Date(row.endMs));
                    case 'sourceDriveId': return String(row.sourceDriveId);
                    case 'status': return row.ongoing
                      ? t('parking.longest.ongoing', 'Ongoing')
                      : row.rightCensored
                        ? t('parking.longest.rangeEdge', 'Range edge')
                        : t('parking.longest.complete', 'Between drives');
                    default: return null;
                  }
                },
              }}
            />
          )}
        </ParkingSectionBody>
      </GlassPanel>
    </section>
  );
}
