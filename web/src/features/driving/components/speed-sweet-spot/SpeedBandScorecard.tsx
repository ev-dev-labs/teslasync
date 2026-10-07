import { ListOrdered } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import {
  Badge, DataTable, GlassPanel, PanelTitle, Text, type Column,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/numberFormat';
import type { SweetSpotResult } from '../../lib/speedSweetSpot';
import { SpeedSweetSpotSectionBody } from './SpeedSweetSpotSectionBody';
import type { SpeedSweetSpotSectionState } from './types';
import { useSpeedSweetSpotDisplay } from './useSpeedSweetSpotDisplay';

interface ScorecardRow {
  key: string;
  rank: number | null;
  band: string;
  consumption: string;
  distance: string;
  drives: number;
  distanceShare: string;
  qualification: string;
  qualified: boolean;
  gapToBest: string;
  gapToOverall: string;
}
interface SpeedBandScorecardProps {
  summary: SweetSpotResult;
  state: SpeedSweetSpotSectionState;
  className?: string;
}
export function SpeedBandScorecard(
  { summary, state, className }: SpeedBandScorecardProps,
) {
  const { t } = useTranslation();
  const {
    formatBand, formatDistance, formatEfficiency, formatSignedEfficiency,
  } = useSpeedSweetSpotDisplay();
  const rows = useMemo<ScorecardRow[]>(
    () =>
      [...summary.bands]
        .sort(
          (left, right) =>
            (left.rank ?? Number.POSITIVE_INFINITY) -
              (right.rank ?? Number.POSITIVE_INFINITY) ||
            left.fromKph - right.fromKph,
        )
        .map((band) => ({
          key: band.key,
          rank: band.rank,
          band: formatBand(band.fromKph, band.toKph),
          consumption: formatEfficiency(band.whPerKm, 1),
          distance: formatDistance(band.distanceM),
          drives: band.drives,
          distanceShare: `${fmtNumber(band.distanceShare * 100, 1)}%`,
          qualification: band.qualified
            ? t('sweetSpot.qualified', 'Qualified')
            : t('sweetSpot.unqualified', 'Below sample floor'),
          qualified: band.qualified,
          gapToBest: formatSignedEfficiency(band.gapToBestWhPerKm),
          gapToOverall: formatSignedEfficiency(band.gapToOverallWhPerKm),
        })),
    [
      formatBand, formatDistance, formatEfficiency, formatSignedEfficiency,
      summary.bands, t,
    ],
  );
  const columns = useMemo<Column<ScorecardRow>[]>(
    () => [
      {
        key: 'rank',
        header: t('sweetSpot.score.rank', 'Rank'),
        render: (row) =>
          row.rank != null
            ? t('sweetSpot.score.rankValue', '#{{rank}}', { rank: row.rank })
            : '—',
        visibleOnMobile: true,
        align: 'right',
      },
      {
        key: 'band',
        header: t('sweetSpot.col.band', 'Speed band'),
        render: (row) => row.band,
        visibleOnMobile: true,
      },
      {
        key: 'consumption',
        header: t('sweetSpot.col.consumption', 'Consumption'),
        render: (row) => row.consumption,
        visibleOnMobile: true,
        align: 'right',
      },
      {
        key: 'distance',
        header: t('sweetSpot.col.distance', 'Distance'),
        render: (row) => row.distance,
        align: 'right',
      },
      {
        key: 'drives',
        header: t('sweetSpot.col.drives', 'Drives'),
        render: (row) => row.drives,
        align: 'right',
      },
      {
        key: 'distanceShare',
        header: t('sweetSpot.col.distanceShare', 'Distance share'),
        render: (row) => row.distanceShare,
        align: 'right',
      },
      {
        key: 'qualification',
        header: t('sweetSpot.col.qualification', 'Qualification'),
        render: (row) => (
          <Badge variant={row.qualified ? 'success' : 'neutral'} dot>
            {row.qualification}
          </Badge>
        ),
        visibleOnMobile: true,
      },
      {
        key: 'gapToBest',
        header: t('sweetSpot.score.gapBest', 'Gap to best'),
        render: (row) => row.gapToBest,
        align: 'right',
      },
      {
        key: 'gapToOverall',
        header: t('sweetSpot.score.gapOverall', 'Gap to overall'),
        render: (row) => row.gapToOverall,
        align: 'right',
      },
    ],
    [t],
  );

  return (
    <GlassPanel
      className={cn('p-5 sm:p-6', className)}
      role="region"
      aria-label={t(
        'sweetSpot.sections.scorecard',
        'Detailed speed-band scorecard',
      )}
      data-testid="speed-sweet-spot-scorecard"
    >
      <PanelTitle className="flex items-center gap-2">
        <ListOrdered className="h-4 w-4 text-purple-300" aria-hidden="true" />
        {t('sweetSpot.score.title', 'Detailed band scorecard')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mt-1">
        {t(
          'sweetSpot.score.subtitle',
          'Qualified bands rank by lowest distance-weighted consumption; unqualified bands remain visible but unranked.',
        )}
      </Text>

      <SpeedSweetSpotSectionBody state={state} className="mt-4 min-h-80">
        {rows.length === 0 ? (
          <EmptyState /* no-action: the scorecard follows the selected data window. */
            className="min-h-80"
            icon={<ListOrdered className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'sweetSpot.score.empty',
              'No eligible speed bands are available for the scorecard.',
            )}
          />
        ) : (
          <DataTable
            tableId="speed-sweet-spot:bands"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.key}
            mobileColumns={['rank', 'band', 'consumption', 'qualification']}
            density="compact"
            maxHeight={440}
            emptyMessage={t(
              'sweetSpot.score.empty',
              'No eligible speed bands are available for the scorecard.',
            )}
            exportable
            exportFilename="speed-sweet-spot-bands"
            exportRow={(row) => ({
              rank: row.rank,
              band: row.band,
              consumption: row.consumption,
              distance: row.distance,
              drives: row.drives,
              distance_share: row.distanceShare,
              qualification: row.qualification,
              gap_to_best: row.gapToBest,
              gap_to_overall: row.gapToOverall,
            })}
          />
        )}
      </SpeedSweetSpotSectionBody>
    </GlassPanel>
  );
}
