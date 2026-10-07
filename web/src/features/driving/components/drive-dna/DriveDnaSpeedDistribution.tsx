import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  ChartContainer,
  CHART_COLORS,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import type { UseUnitsResult } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { convertSpeedFromSI } from '@/lib/unitConversion';

import {
  SPEED_LOW_MAX_MPS,
  SPEED_MEDIUM_MAX_MPS,
  SPEED_STATIONARY_MAX_MPS,
  type DriveDnaModel,
  type SpeedBandId,
} from '../../lib/driveDNA';
import { DriveDnaSectionBody } from './DriveDnaSectionBody';
import { DriveDnaDistributionBarPlot } from './DriveDnaDistributionBarPlot';
import type { DriveDnaSectionState } from './types';

interface DriveDnaSpeedDistributionProps {
  model: DriveDnaModel;
  state: DriveDnaSectionState;
  units: UseUnitsResult;
}

export function DriveDnaSpeedDistribution({
  model,
  state,
  units,
}: DriveDnaSpeedDistributionProps) {
  const { t } = useTranslation();
  const stationary = convertSpeedFromSI(
    SPEED_STATIONARY_MAX_MPS,
    units.unitPrefs.speed,
  );
  const low = convertSpeedFromSI(
    SPEED_LOW_MAX_MPS,
    units.unitPrefs.speed,
  );
  const medium = convertSpeedFromSI(
    SPEED_MEDIUM_MAX_MPS,
    units.unitPrefs.speed,
  );
  const label = (id: SpeedBandId): string => {
    switch (id) {
      case 'stationary':
        return t('driveDna.speedBands.stationary', 'Below {{value}} {{unit}}', {
          value: fmtNumber(stationary, 1),
          unit: units.unitPrefs.speed,
        });
      case 'low':
        return t('driveDna.speedBands.low', '{{min}} to <{{max}} {{unit}}', {
          min: fmtNumber(stationary, 1),
          max: fmtNumber(low, 0),
          unit: units.unitPrefs.speed,
        });
      case 'medium':
        return t(
          'driveDna.speedBands.medium',
          '{{min}} to <{{max}} {{unit}}',
          {
            min: fmtNumber(low, 0),
            max: fmtNumber(medium, 0),
            unit: units.unitPrefs.speed,
          },
        );
      case 'high':
        return t('driveDna.speedBands.high', '{{value}}+ {{unit}}', {
          value: fmtNumber(medium, 0),
          unit: units.unitPrefs.speed,
        });
    }
  };
  const colors: Record<SpeedBandId, string> = {
    stationary: CHART_COLORS[4],
    low: CHART_COLORS[1],
    medium: CHART_COLORS[0],
    high: CHART_COLORS[3],
  };
  const rows = model.distributions.speed.bins.map((bin) => ({
    id: bin.id,
    label: label(bin.id),
    count: bin.count,
    sharePct: bin.share != null ? bin.share * 100 : null,
    color: colors[bin.id],
  }));
  const ready =
    state.telemetry.isResolved &&
    model.distributions.speed.measuredCount > 0;

  return (
    <section data-testid="drive-dna-speed-distribution">
      <ChartContainer
        title={t(
          'driveDna.speedBands.title',
          'Speed bands by telemetry-emission count',
        )}
        subtitle={t(
          'driveDna.speedBands.subtitle',
          'Every speed-available emission contributes one count; bands are not duration or time shares.',
        )}
        ariaLabel={t(
          'driveDna.speedBands.aria',
          'Speed-available telemetry emission counts grouped into display-unit speed bands',
        )}
        height={330}
        exportable={ready && !state.telemetry.error}
        exportFilename="drive-dna-speed-emission-counts"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'label',
            label: t('driveDna.speedBands.bandColumn', 'Speed band'),
          },
          {
            key: 'count',
            label: t('driveDna.speedBands.countColumn', 'Emission count'),
            format: (value) => fmtInt(value),
          },
          {
            key: 'sharePct',
            label: t(
              'driveDna.speedBands.shareColumn',
              'Share of speed-available emissions',
            ),
            format: (value) =>
              typeof value === 'number'
                ? `${fmtNumber(value, 1)}%`
                : '—',
          },
        ]}
      >
        <DriveDnaSectionBody
          state={state}
          validRows={model.sample.validRows}
          returnedRows={model.sample.returnedRows}
          className="h-full min-h-0"
          skeletonHeight={290}
        >
          {model.distributions.speed.measuredCount > 0 ? (
            <DriveDnaDistributionBarPlot
              rows={rows}
              seriesName={t(
                'driveDna.speedBands.countSeries',
                'Telemetry emissions',
              )}
              categoryWidth={136}
              maxBarSize={38}
            />
          ) : (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
              className="h-full"
              icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'driveDna.speedBands.empty',
                'No emissions contain available speed, so no speed band is inferred.',
              )}
            />
          )}
        </DriveDnaSectionBody>
      </ChartContainer>
    </section>
  );
}
