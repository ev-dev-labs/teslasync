import { useMemo } from 'react';
import { BatteryMedium } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { UseUnitsResult } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDurationFromSI } from '@/lib/unitConversion';

import type { DriveDnaModel } from '../../lib/driveDNA';
import { DriveDnaSectionBody } from './DriveDnaSectionBody';
import { DriveDnaSocElevationPlot } from './DriveDnaSocElevationPlot';
import type { DriveDnaSectionState } from './types';

interface DriveDnaSocElevationChartProps {
  model: DriveDnaModel;
  state: DriveDnaSectionState;
  units: UseUnitsResult;
}

export function DriveDnaSocElevationChart({
  model,
  state,
  units,
}: DriveDnaSocElevationChartProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      model.chartPoints.map((point) => ({
        elapsed: convertDurationFromSI(
          point.elapsedS,
          units.unitPrefs.duration,
        ),
        soc: point.socPct,
        elevation: point.elevationM,
      })),
    [model.chartPoints, units.unitPrefs.duration],
  );
  const hasSoc = model.coverage.soc.availableCount > 0;
  const hasElevation = model.coverage.elevation.availableCount > 0;
  const hasContext = hasSoc || hasElevation;
  const socName = t('driveDna.context.socSeries', 'State of charge');
  const elevationName = t(
    'driveDna.context.elevationSeries',
    'Elevation (measured metres)',
  );
  const elapsedLabel = t(
    'driveDna.context.elapsedAxis',
    'Elapsed ({{unit}})',
    { unit: units.unitPrefs.duration },
  );
  const ready =
    state.telemetry.isResolved &&
    model.sample.validRows >= 2 &&
    hasContext;

  return (
    <section data-testid="drive-dna-soc-elevation">
      <ChartContainer
        title={t('driveDna.context.title', 'SoC & elevation context')}
        subtitle={t(
          'driveDna.context.subtitle',
          'Optional context at irregular emission timestamps; elevation is shown in metres because no elevation display preference exists.',
        )}
        ariaLabel={t(
          'driveDna.context.aria',
          'State of charge percentage and measured elevation across elapsed selected-drive emissions',
        )}
        height={340}
        chartKey="drive-dna-soc-elevation"
        exportable={ready && !state.telemetry.error}
        exportFilename="drive-dna-soc-elevation"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'elapsed',
            label: elapsedLabel,
            format: (value) =>
              typeof value === 'number'
                ? `${fmtNumber(value, 2)} ${units.unitPrefs.duration}`
                : '—',
          },
          {
            key: 'soc',
            label: socName,
            format: (value) =>
              typeof value === 'number'
                ? `${fmtNumber(value, 1)}%`
                : '—',
          },
          {
            key: 'elevation',
            label: elevationName,
            format: (value) =>
              typeof value === 'number'
                ? t('driveDna.context.metresValue', '{{value}} m', {
                    value: fmtNumber(value, 0),
                  })
                : '—',
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <DriveDnaSectionBody
            state={state}
            validRows={model.sample.validRows}
            returnedRows={model.sample.returnedRows}
            minimumRows={2}
            className="h-full min-h-0"
            skeletonHeight={300}
          >
            {hasContext ? (
              <div className="flex h-full flex-col">
                {!hasSoc || !hasElevation ? (
                  <AlertBanner className="mb-3" variant="info">
                    <Text as="p" variant="caption">
                      {!hasSoc
                        ? t(
                            'driveDna.context.socUnavailable',
                            'SoC is unavailable; only measured elevation context is shown.',
                          )
                        : t(
                            'driveDna.context.elevationUnavailable',
                            'Elevation is unavailable for this drive; available SoC context remains visible.',
                          )}
                    </Text>
                  </AlertBanner>
                ) : null}
                <DriveDnaSocElevationPlot
                  rows={rows}
                  elapsedLabel={elapsedLabel}
                  socName={socName}
                  elevationName={elevationName}
                  durationUnit={units.unitPrefs.duration}
                  showSoc={hasSoc}
                  showElevation={hasElevation}
                  socHidden={hiddenSeries?.isHidden('soc') ?? false}
                  elevationHidden={
                    hiddenSeries?.isHidden('elevation') ?? false
                  }
                />
              </div>
            ) : (
              <EmptyState
                className="h-full"
                icon={<BatteryMedium className="h-8 w-8" aria-hidden="true" />}
                message={t(
                  'driveDna.context.noChannels',
                  'SoC and elevation channels are unavailable for these emissions.',
                )}
              />
            )}
          </DriveDnaSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
