import { Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  ChartContainer,
  CHART_COLORS,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import type { UseUnitsResult } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { convertPowerFromSI } from '@/lib/unitConversion';

import {
  POWER_COAST_THRESHOLD_W,
  type DriveDnaModel,
  type PowerStateId,
} from '../../lib/driveDNA';
import { DriveDnaSectionBody } from './DriveDnaSectionBody';
import { DriveDnaDistributionBarPlot } from './DriveDnaDistributionBarPlot';
import type { DriveDnaSectionState } from './types';

interface DriveDnaPowerDistributionProps {
  model: DriveDnaModel;
  state: DriveDnaSectionState;
  units: UseUnitsResult;
}

export function DriveDnaPowerDistribution({
  model,
  state,
  units,
}: DriveDnaPowerDistributionProps) {
  const { t } = useTranslation();
  const label = (id: PowerStateId): string => {
    switch (id) {
      case 'regen':
        return t('driveDna.powerStates.regen', 'Regen observed');
      case 'coast':
        return t('driveDna.powerStates.coast', 'Coast / near zero');
      case 'propulsion':
        return t('driveDna.powerStates.propulsion', 'Propulsion');
    }
  };
  const colors: Record<PowerStateId, string> = {
    regen: CHART_COLORS[1],
    coast: CHART_COLORS[4],
    propulsion: CHART_COLORS[3],
  };
  const rows = model.distributions.power.bins.map((bin) => ({
    id: bin.id,
    label: label(bin.id),
    count: bin.count,
    sharePct: bin.share != null ? bin.share * 100 : null,
    color: colors[bin.id],
  }));
  const threshold = convertPowerFromSI(
    POWER_COAST_THRESHOLD_W,
    units.unitPrefs.power,
  );
  const ready =
    state.telemetry.isResolved &&
    model.distributions.power.measuredCount > 0;

  return (
    <section data-testid="drive-dna-power-distribution">
      <ChartContainer
        title={t(
          'driveDna.powerStates.title',
          'Power states by telemetry-emission count',
        )}
        subtitle={t(
          'driveDna.powerStates.subtitle',
          'Counts use a ±{{threshold}} {{unit}} coast band and are not duration or time shares.',
          {
            threshold: fmtNumber(threshold, 1),
            unit: units.unitPrefs.power,
          },
        )}
        ariaLabel={t(
          'driveDna.powerStates.aria',
          'Power-available telemetry emission counts classified as propulsion, coast, or regen observed',
        )}
        height={310}
        exportable={ready && !state.telemetry.error}
        exportFilename="drive-dna-power-emission-counts"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'label',
            label: t('driveDna.powerStates.stateColumn', 'Power state'),
          },
          {
            key: 'count',
            label: t('driveDna.powerStates.countColumn', 'Emission count'),
            format: (value) => fmtInt(value),
          },
          {
            key: 'sharePct',
            label: t(
              'driveDna.powerStates.shareColumn',
              'Share of power-available emissions',
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
          skeletonHeight={270}
        >
          {model.distributions.power.measuredCount > 0 ? (
            <DriveDnaDistributionBarPlot
              rows={rows}
              seriesName={t(
                'driveDna.powerStates.countSeries',
                'Telemetry emissions',
              )}
              categoryWidth={116}
              maxBarSize={42}
            />
          ) : (
            <EmptyState
              className="h-full"
              icon={<Zap className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'driveDna.powerStates.empty',
                'No emissions contain available power, so no power state is inferred.',
              )}
            />
          )}
        </DriveDnaSectionBody>
      </ChartContainer>
    </section>
  );
}
