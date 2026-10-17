import { Activity, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  KVList,
  MetricBar,
  type KVItem,
} from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import {
  GlassPanel,
  HelpTooltip,
  PanelTitle,
  Text,
} from '@/components/ui';
import { useFormatting } from '@/hooks/useFormatting';
import { chartTokens, typography } from '@/lib/tokens';

import { convertDistanceToSI } from '@/lib/unitConversion';

import type { UtilizationSummary } from '../../lib/utilization';
import type { UtilizationSectionState } from './types';
import { useUtilizationDisplay } from './useUtilizationDisplay';
import { UtilizationSectionBody } from './UtilizationSectionBody';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface TimeCostOverviewProps {
  summary: UtilizationSummary;
  state: UtilizationSectionState;
  hasSource?: boolean;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function TimeCostOverview({
  summary,
  state,
  hasSource = true,
}: TimeCostOverviewProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const {
    distanceUnit,
    formatDistance,
    formatEnergy,
  } = useUtilizationDisplay();
  const observedHours = finite(summary.window.observedDurationS) &&
    summary.window.observedDurationS > 0
    ? summary.window.observedDurationS / 3_600 : null;
  const drivingHours = summary.accounting.usableDurationRows > 0 &&
    finite(summary.drivingHours) ? summary.drivingHours : null;
  const completeDuration = summary.accounting.excludedDurationRows === 0;
  const noRecordedDriveHours = observedHours != null &&
    drivingHours != null && completeDuration
    ? Math.max(0, observedHours - drivingHours) : null;
  const partial = summary.accounting.excludedDurationRows > 0 ||
    summary.accounting.excludedDistanceRows > 0 ||
    summary.accounting.excludedEnergyRows > 0 ||
    summary.accounting.truncatedDurationRows > 0;
  const distanceUnitKm =
    convertDistanceToSI(1, distanceUnit) / 1_000;
  const costPerDisplayDistance =
    summary.accounting.usableEnergyRows > 0 &&
    finite(summary.pricedDistanceM) && summary.pricedDistanceM > 0 &&
    finite(summary.costPerKm) && finite(distanceUnitKm) &&
    finite(summary.costPerKm * distanceUnitKm)
      ? summary.costPerKm * distanceUnitKm
      : null;

  const costItems = useMemo<KVItem[]>(
    () => [
      {
        label: t(
          'utilization.totalCost',
          'Energy cost in period',
        ),
        value:
          summary.accounting.usableEnergyRows > 0 &&
          finite(summary.totalEnergyCost)
            ? formatCurrency(summary.totalEnergyCost)
            : '—',
      },
      {
        label: t(
          'utilization.costPerDistance',
          'Energy cost per distance',
        ),
        value:
          costPerDisplayDistance != null
            ? `${formatCurrency(
                costPerDisplayDistance,
              )} / ${distanceUnit}`
            : '—',
      },
      {
        label: t(
          'utilization.costPerHour',
          'Energy cost per driving hour',
        ),
        value:
          summary.accounting.usableEnergyRows > 0 &&
          finite(summary.pricedDrivingS) && summary.pricedDrivingS > 0 &&
          finite(summary.costPerDrivingHour)
            ? formatCurrency(summary.costPerDrivingHour)
            : '—',
      },
      {
        label: t('utilization.energy', 'Energy used'),
        value:
          summary.accounting.usableEnergyRows > 0 && finite(summary.energyWh)
            ? formatEnergy(summary.energyWh)
            : '—',
      },
      {
        label: t(
          'utilization.energyRate',
          'Settings electricity rate',
        ),
        value:
          finite(summary.ratePerKwh)
            ? t(
                'utilization.energyRateValue',
                '{{rate}} / kWh',
                {
                  rate: formatCurrency(summary.ratePerKwh),
                },
              )
            : '—',
      },
      {
        label: t(
          'utilization.costCoverage',
          'Energy coverage',
        ),
        value: t(
          'utilization.costCoverageValue',
          '{{measured}} of {{eligible}} eligible drives',
          {
            measured: finite(summary.accounting.usableEnergyRows) ? fmtInt(
              summary.accounting.usableEnergyRows,
            ) : '—',
            eligible: finite(summary.accounting.eligibleRows) ? fmtInt(summary.accounting.eligibleRows) : '—',
          },
        ),
      },
    ],
    [
      costPerDisplayDistance,
      distanceUnit,
      formatCurrency,
      formatEnergy,
      summary,
      t, fmtInt,
    ],
  );

  return (
    <section
      className="grid grid-cols-1 gap-4 xl:grid-cols-2"
      aria-label={t(
        'utilization.sections.timeCost',
        'Observed time split and energy-only cost ledger',
      )}
      data-testid="utilization-time-cost"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Activity
            className={`h-4 w-4 ${typography.color.secondary}`}
            aria-hidden="true"
          />
          {t('utilization.timeSplit', 'Where the hours go')}
          <HelpTooltip
            size="sm"
            i18nKey="help.utilization.body"
            defaultValue="The observed window begins with the first eligible drive and ends at the selected period boundary or the frozen page clock. Time without a recorded drive is descriptive and is not assigned a cause."
            ariaLabel={t(
              'help.utilization.iconLabel',
              'More info about utilization',
            )}
          />
        </PanelTitle>
        <UtilizationSectionBody state={state} className="min-h-56">
          {!hasSource || summary.accounting.eligibleRows === 0 ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
              icon={
                <Activity className="h-8 w-8" aria-hidden="true" />
              }
              message={!hasSource ? t('vehicles.evidenceBrief.status.unavailable', 'No source data') : t(
                'utilization.noData',
                'No drives in this period yet.',
              )}
            />
          ) : (
            <div className="space-y-4">
              <MetricBar
                label={t(
                  'utilization.drivingHours',
                  'Driving hours',
                )}
                value={drivingHours}
                max={observedHours ?? 0}
                fill="solid"
                color={chartTokens.series[5]}
                sublabel={drivingHours == null ? '—' : t(
                  'utilization.hours',
                  '{{h}} h',
                  { h: fmtNumber(drivingHours) },
                )}
              />
              <MetricBar
                label={t(
                  'utilization.unrecordedDriveHours',
                  'Time without a recorded drive',
                )}
                value={noRecordedDriveHours}
                max={observedHours ?? 0}
                fill="solid"
                color={chartTokens.series[4]}
                sublabel={noRecordedDriveHours == null ? '—' : t(
                  'utilization.hours',
                  '{{h}} h',
                  { h: fmtNumber(noRecordedDriveHours) },
                )}
              />
              <Text variant="bodySm" as="p" className="pt-1">
                {t(
                  'utilization.takeaway',
                  'Over this window the car was in motion {{pct}}% of the time and covered {{dist}}.',
                  {
                    pct:
                      drivingHours != null && finite(summary.drivingShare)
                        ? fmtNumber(
                            summary.drivingShare * 100,
                          )
                        : '—',
                    dist: summary.accounting.usableDistanceRows > 0 &&
                      finite(summary.distanceM) ? formatDistance(summary.distanceM) : '—',
                  },
                )}
              </Text>
              {partial && (
                <Text variant="caption" as="p">
                  {t('vehicles.evidenceBrief.status.partial', 'Partial source coverage')}
                </Text>
              )}
              <Text variant="caption" as="p">
                {t(
                  'utilization.timeSplitCaution',
                  'Time without a recorded drive is not labelled as waste, avoidable idle time, or any other cause.',
                )}
              </Text>
            </div>
          )}
        </UtilizationSectionBody>
      </GlassPanel>

      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-3 flex items-center gap-2">
          <Wallet
            className={`h-4 w-4 ${typography.color.secondary}`}
            aria-hidden="true"
          />
          {t('utilization.ledger', 'Cost of motion')}
        </PanelTitle>
        <UtilizationSectionBody state={state} className="min-h-56">
          {!hasSource || summary.accounting.eligibleRows === 0 ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
              icon={<Wallet className="h-8 w-8" aria-hidden="true" />}
              message={!hasSource ? t('vehicles.evidenceBrief.status.unavailable', 'No source data') : t(
                'utilization.noData',
                'No drives in this period yet.',
              )}
            />
          ) : (
            <>
              <KVList items={costItems} />
              {summary.accounting.usableEnergyRows === 0 && (
                <EmptyState /* no-action: field availability follows recorded telemetry */
                  icon={<Wallet className="h-8 w-8" aria-hidden="true" />}
                  message={t(
                    'utilization.costNoEnergy',
                    'No eligible drives include usable energy measurements for this period.',
                  )}
                />
              )}
              {partial && (
                <Text variant="caption" as="p">
                  {t('vehicles.evidenceBrief.status.partial', 'Partial source coverage')}
                </Text>
              )}
              <Text variant="caption" as="p" className="mt-3">
                {t(
                  'utilization.costAssumption',
                  'Energy-only estimate using the settings electricity rate. It excludes insurance, depreciation, financing, maintenance, and charging losses.',
                )}
              </Text>
            </>
          )}
        </UtilizationSectionBody>
      </GlassPanel>
    </section>
  );
}
