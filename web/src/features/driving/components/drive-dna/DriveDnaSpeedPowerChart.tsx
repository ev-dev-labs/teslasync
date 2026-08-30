import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { UseUnitsResult } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import {
  convertDurationFromSI,
  convertPowerFromSI,
  convertSpeedFromSI,
} from '@/lib/unitConversion';

import type { DriveDnaModel } from '../../lib/driveDNA';
import { DriveDnaSectionBody } from './DriveDnaSectionBody';
import { DriveDnaSpeedPowerPlot } from './DriveDnaSpeedPowerPlot';
import type { DriveDnaSectionState } from './types';

interface DriveDnaSpeedPowerChartProps {
  model: DriveDnaModel;
  state: DriveDnaSectionState;
  units: UseUnitsResult;
}

export function DriveDnaSpeedPowerChart({
  model,
  state,
  units,
}: DriveDnaSpeedPowerChartProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      model.chartPoints.map((point) => ({
        elapsed: convertDurationFromSI(
          point.elapsedS,
          units.unitPrefs.duration,
        ),
        speed:
          point.speedMps != null
            ? convertSpeedFromSI(point.speedMps, units.unitPrefs.speed)
            : null,
        power:
          point.powerW != null
            ? convertPowerFromSI(point.powerW, units.unitPrefs.power)
            : null,
      })),
    [
      model.chartPoints,
      units.unitPrefs.duration,
      units.unitPrefs.power,
      units.unitPrefs.speed,
    ],
  );
  const hasSpeed = model.coverage.speed.availableCount > 0;
  const hasPower = model.coverage.power.availableCount > 0;
  const hasProfile = hasSpeed || hasPower;
  const speedName = t('driveDna.profile.speedSeries', 'Speed');
  const powerName = t(
    'driveDna.profile.powerSeries',
    'Pack power (+ propulsion / − regen)',
  );
  const elapsedLabel = t(
    'driveDna.profile.elapsedAxis',
    'Elapsed ({{unit}})',
    { unit: units.unitPrefs.duration },
  );
  const speedLabel = t(
    'driveDna.profile.speedAxis',
    'Speed ({{unit}})',
    { unit: units.unitPrefs.speed },
  );
  const powerLabel = t(
    'driveDna.profile.powerAxis',
    'Power ({{unit}})',
    { unit: units.unitPrefs.power },
  );
  const ready =
    state.telemetry.isResolved &&
    model.sample.validRows >= 2 &&
    hasProfile;

  return (
    <section data-testid="drive-dna-speed-power">
      <ChartContainer
        title={t('driveDna.profile.title', 'Speed & power emission profile')}
        subtitle={t(
          'driveDna.profile.subtitle',
          'Chronological emissions at their actual elapsed positions; gaps are not interpolated into uniform samples.',
        )}
        ariaLabel={t(
          'driveDna.profile.aria',
          'Speed and signed pack power across elapsed selected-drive telemetry emissions',
        )}
        height={340}
        chartKey="drive-dna-speed-power"
        exportable={ready && !state.telemetry.error}
        exportFilename="drive-dna-speed-power"
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
            key: 'speed',
            label: speedName,
            format: (value) =>
              typeof value === 'number'
                ? `${fmtNumber(value, 1)} ${units.unitPrefs.speed}`
                : '—',
          },
          {
            key: 'power',
            label: powerName,
            format: (value) =>
              typeof value === 'number'
                ? `${fmtNumber(value, 1)} ${units.unitPrefs.power}`
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
            {hasProfile ? (
              <div className="flex h-full flex-col">
                {!hasSpeed || !hasPower ? (
                  <AlertBanner className="mb-3" variant="info">
                    <Text as="p" variant="caption">
                      {!hasSpeed
                        ? t(
                            'driveDna.profile.speedUnavailable',
                            'Speed is unavailable; only measured power emissions are shown.',
                          )
                        : t(
                            'driveDna.profile.powerUnavailable',
                            'Power is unavailable; only measured speed emissions are shown.',
                          )}
                    </Text>
                  </AlertBanner>
                ) : null}
                <DriveDnaSpeedPowerPlot
                  rows={rows}
                  elapsedLabel={elapsedLabel}
                  speedLabel={speedLabel}
                  powerLabel={powerLabel}
                  speedName={speedName}
                  powerName={powerName}
                  durationUnit={units.unitPrefs.duration}
                  speedUnit={units.unitPrefs.speed}
                  powerUnit={units.unitPrefs.power}
                  showSpeed={hasSpeed}
                  showPower={hasPower}
                  speedHidden={hiddenSeries?.isHidden('speed') ?? false}
                  powerHidden={hiddenSeries?.isHidden('power') ?? false}
                />
              </div>
            ) : (
              <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
                className="h-full"
                icon={<Activity className="h-8 w-8" aria-hidden="true" />}
                message={t(
                  'driveDna.profile.noChannels',
                  'Speed and power channels are unavailable for these emissions.',
                )}
              />
            )}
          </DriveDnaSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
