import { Activity } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';

import type { SweetSpotResult } from '../../lib/speedSweetSpot';
import {
  ConsumptionSpeedPlot,
  type ConsumptionCurveRow,
} from './ConsumptionSpeedPlot';
import type { SpeedSweetSpotSectionState } from './types';
import { useSpeedSweetSpotDisplay } from './useSpeedSweetSpotDisplay';

interface ConsumptionSpeedCurveProps {
  summary: SweetSpotResult;
  state: SpeedSweetSpotSectionState;
}

export function ConsumptionSpeedCurve({
  summary,
  state,
}: ConsumptionSpeedCurveProps) {
  const { t } = useTranslation();
  const {
    convertBandSpeed,
    convertDistance,
    convertEfficiency,
    distanceUnit,
    efficiencyUnit,
    formatBand,
    speedUnit,
  } = useSpeedSweetSpotDisplay();
  const qualifiedName = t(
    'sweetSpot.curve.qualifiedSeries',
    'Qualified consumption',
  );
  const unqualifiedName = t(
    'sweetSpot.curve.unqualifiedSeries',
    'Unqualified consumption',
  );
  const distanceName = t('sweetSpot.distanceLogged', 'Observed distance');
  const rows = useMemo<ConsumptionCurveRow[]>(
    () =>
      summary.points.map((point) => ({
        band: formatBand(point.fromKph, point.toKph),
        speed: Math.round(convertBandSpeed(point.speedKph) * 10) / 10,
        qualifiedConsumption: point.qualified
          ? Math.round(convertEfficiency(point.whPerKm) * 10) / 10
          : null,
        unqualifiedConsumption: point.qualified
          ? null
          : Math.round(convertEfficiency(point.whPerKm) * 10) / 10,
        distance: Math.round(convertDistance(point.distanceM) * 10) / 10,
        drives: point.drives,
        qualification: point.qualified
          ? t('sweetSpot.qualified', 'Qualified')
          : t('sweetSpot.unqualified', 'Below sample floor'),
      })),
    [
      convertBandSpeed,
      convertDistance,
      convertEfficiency,
      formatBand,
      summary.points,
      t,
    ],
  );
  const winning = summary.sweetSpot;

  return (
    <section
      aria-label={t(
        'sweetSpot.sections.curve',
        'Consumption by average-speed band',
      )}
      data-testid="speed-sweet-spot-curve"
    >
      <ChartContainer
        title={t(
          'sweetSpot.curve.title',
          'Consumption vs whole-drive average speed',
        )}
        subtitle={t(
          'sweetSpot.curveHint',
          'Distance-weighted band consumption; distance bars show evidence volume and dashed points are below the sample floor.',
        )}
        ariaLabel={t(
          'sweetSpot.curve.aria',
          'Distance-weighted consumption across whole-drive average-speed bands with qualification and the best band identified',
        )}
        chartKey="speed-sweet-spot-curve"
        loading={state.isLoading}
        empty={false}
        height={390}
        exportable={!state.error && !state.isLoading && rows.length > 0}
        exportFilename="speed-sweet-spot-curve"
        exportData={rows}
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'band', label: t('sweetSpot.col.band', 'Speed band') },
          {
            key: 'qualifiedConsumption',
            label: `${qualifiedName} (${efficiencyUnit})`,
          },
          {
            key: 'unqualifiedConsumption',
            label: `${unqualifiedName} (${efficiencyUnit})`,
          },
          {
            key: 'distance',
            label: `${distanceName} (${distanceUnit})`,
          },
          { key: 'drives', label: t('sweetSpot.col.drives', 'Drives') },
          {
            key: 'qualification',
            label: t('sweetSpot.col.qualification', 'Qualification'),
          },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState /* no-action: vehicle and range controls are the recovery surfaces. */
              className="h-full"
              icon={<Activity className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'sweetSpot.curve.empty',
                'No eligible drives are available to form speed bands.',
              )}
            />
          ) : (
            <ConsumptionSpeedPlot
              rows={rows}
              winning={winning}
              qualifiedName={qualifiedName}
              unqualifiedName={unqualifiedName}
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
