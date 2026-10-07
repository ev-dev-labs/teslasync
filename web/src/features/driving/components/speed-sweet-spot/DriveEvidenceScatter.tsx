import { ScatterChart as ScatterIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { Badge } from '@/components/ui';
import { formatDate } from '@/lib/dateFormat';

import type { SweetSpotResult } from '../../lib/speedSweetSpot';
import {
  DriveEvidencePlot,
  type DriveScatterRow,
} from './DriveEvidencePlot';
import type { SpeedSweetSpotSectionState } from './types';
import { useSpeedSweetSpotDisplay } from './useSpeedSweetSpotDisplay';

interface DriveEvidenceScatterProps {
  summary: SweetSpotResult;
  state: SpeedSweetSpotSectionState;
}

export function DriveEvidenceScatter({
  summary,
  state,
}: DriveEvidenceScatterProps) {
  const { t } = useTranslation();
  const {
    convertDistance,
    convertDriveSpeed,
    convertEfficiency,
    convertBandSpeed,
    distanceUnit,
    efficiencyUnit,
    speedUnit,
    unitPrefs,
  } = useSpeedSweetSpotDisplay();
  const inBandName = t('sweetSpot.scatter.inBand', 'Best-band drives');
  const otherName = t('sweetSpot.scatter.other', 'Other eligible drives');
  const speedName = t('sweetSpot.scatter.speed', 'Whole-drive average speed');
  const consumptionName = t('sweetSpot.consumption', 'Consumption');
  const distanceName = t('sweetSpot.col.distance', 'Distance');
  const rows = useMemo<DriveScatterRow[]>(
    () =>
      summary.driveEvidence.map((point) => ({
        driveId: point.driveId,
        date: formatDate(point.startTs, { locale: unitPrefs.locale }),
        speed: Math.round(convertDriveSpeed(point.avgSpeedMps) * 10) / 10,
        consumption:
          Math.round(convertEfficiency(point.whPerKm) * 10) / 10,
        distance: Math.round(convertDistance(point.distanceM) * 10) / 10,
        group:
          point.bucketKey === summary.sweetSpot?.key
            ? inBandName
            : otherName,
      })),
    [
      convertDistance,
      convertDriveSpeed,
      convertEfficiency,
      inBandName,
      otherName,
      summary.driveEvidence,
      summary.sweetSpot?.key,
      unitPrefs.locale,
    ],
  );
  const inBand = rows.filter((row) => row.group === inBandName);
  const other = rows.filter((row) => row.group === otherName);
  const winning = summary.sweetSpot;

  return (
    <section
      aria-label={t(
        'sweetSpot.sections.scatter',
        'Drive-level speed and consumption evidence',
      )}
      data-testid="speed-sweet-spot-scatter"
    >
      <ChartContainer
        title={t(
          'sweetSpot.scatter.title',
          'Drive-level whole-drive evidence',
        )}
        subtitle={
          summary.driveEvidenceCapped
            ? t(
                'sweetSpot.scatter.cappedSubtitle',
                '{{shown}} evenly sampled points from {{total}} eligible drives; every eligible drive still feeds the aggregates.',
                {
                  shown: summary.driveEvidence.length,
                  total: summary.driveEvidenceTotal,
                },
              )
            : t(
                'sweetSpot.scatter.subtitle',
                '{{shown}} eligible drives; marker size follows distance and each point is one whole drive.',
                { shown: summary.driveEvidence.length },
              )
        }
        ariaLabel={t(
          'sweetSpot.scatter.aria',
          'Scatter plot of whole-drive average speed against drive consumption with distance represented by marker size',
        )}
        action={
          <Badge
            variant={summary.driveEvidenceCapped ? 'warning' : 'neutral'}
            dot
          >
            {summary.driveEvidenceCapped
              ? t('sweetSpot.scatter.sampled', 'Visual sample')
              : t('sweetSpot.scatter.allPoints', 'All eligible points')}
          </Badge>
        }
        chartKey="speed-sweet-spot-drive-evidence"
        loading={state.isLoading}
        empty={false}
        height={390}
        exportable={!state.error && !state.isLoading && rows.length > 0}
        exportFilename="speed-sweet-spot-drive-evidence"
        exportData={rows}
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'driveId', label: t('sweetSpot.scatter.drive', 'Drive') },
          { key: 'date', label: t('sweetSpot.scatter.date', 'Date') },
          { key: 'group', label: t('sweetSpot.scatter.group', 'Evidence group') },
          { key: 'speed', label: `${speedName} (${speedUnit})` },
          {
            key: 'consumption',
            label: `${consumptionName} (${efficiencyUnit})`,
          },
          {
            key: 'distance',
            label: `${distanceName} (${distanceUnit})`,
          },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState /* no-action: the plot appears when eligible drives are returned. */
              className="h-full"
              icon={<ScatterIcon className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'sweetSpot.scatter.empty',
                'No eligible drives are available for drive-level evidence.',
              )}
            />
          ) : (
            <DriveEvidencePlot
              inBand={inBand}
              other={other}
              winning={winning}
              inBandName={inBandName}
              otherName={otherName}
              speedName={speedName}
              consumptionName={consumptionName}
              distanceName={distanceName}
              speedUnit={speedUnit}
              efficiencyUnit={efficiencyUnit}
              distanceUnit={distanceUnit}
              convertBandSpeed={convertBandSpeed}
              isHidden={(key) => hiddenSeries?.isHidden(key) ?? false}
            />
          )
        }
      </ChartContainer>
    </section>
  );
}
