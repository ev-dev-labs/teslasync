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
import { chartTokens } from '@/lib/tokens';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { convertDistanceToSI } from '@/lib/unitConversion';

import type { UtilizationSummary } from '../../lib/utilization';
import type { UtilizationSectionState } from './types';
import { useUtilizationDisplay } from './useUtilizationDisplay';
import { UtilizationSectionBody } from './UtilizationSectionBody';

interface TimeCostOverviewProps {
  summary: UtilizationSummary;
  state: UtilizationSectionState;
}

export function TimeCostOverview({
  summary,
  state,
}: TimeCostOverviewProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const {
    distanceUnit,
    formatDistance,
    formatEnergy,
  } = useUtilizationDisplay();
  const observedHours = summary.window.observedDurationS / 3_600;
  const noRecordedDriveHours = Math.max(
    0,
    observedHours - summary.drivingHours,
  );
  const distanceUnitKm =
    convertDistanceToSI(1, distanceUnit) / 1_000;
  const costPerDisplayDistance =
    summary.costPerKm != null
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
          summary.totalEnergyCost != null
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
                3,
              )} / ${distanceUnit}`
            : '—',
      },
      {
        label: t(
          'utilization.costPerHour',
          'Energy cost per driving hour',
        ),
        value:
          summary.costPerDrivingHour != null
            ? formatCurrency(summary.costPerDrivingHour)
            : '—',
      },
      {
        label: t('utilization.energy', 'Energy used'),
        value:
          summary.accounting.usableEnergyRows > 0
            ? formatEnergy(summary.energyWh, { precision: 1 })
            : '—',
      },
      {
        label: t(
          'utilization.energyRate',
          'Settings electricity rate',
        ),
        value:
          summary.ratePerKwh != null
            ? t(
                'utilization.energyRateValue',
                '{{rate}} / kWh',
                {
                  rate: formatCurrency(summary.ratePerKwh, 3),
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
            measured: fmtInt(
              summary.accounting.usableEnergyRows,
            ),
            eligible: fmtInt(summary.accounting.eligibleRows),
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
      t,
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
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t('utilization.timeSplit', 'Where the Hours Go')}
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
          {summary.accounting.eligibleRows === 0 ? (
            <EmptyState
              icon={
                <Activity className="h-8 w-8" aria-hidden="true" />
              }
              message={t(
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
                value={summary.drivingHours}
                max={Math.max(observedHours, 1)}
                color={chartTokens.series[5]}
                sublabel={t(
                  'utilization.hours',
                  '{{h}} h',
                  { h: fmtNumber(summary.drivingHours, 1) },
                )}
              />
              <MetricBar
                label={t(
                  'utilization.unrecordedDriveHours',
                  'Time without a recorded drive',
                )}
                value={noRecordedDriveHours}
                max={Math.max(observedHours, 1)}
                color={chartTokens.series[4]}
                sublabel={t(
                  'utilization.hours',
                  '{{h}} h',
                  { h: fmtNumber(noRecordedDriveHours, 1) },
                )}
              />
              <Text variant="bodySm" as="p" className="pt-1">
                {t(
                  'utilization.takeaway',
                  'Over this window the car was in motion {{pct}}% of the time and covered {{dist}}.',
                  {
                    pct:
                      summary.drivingShare != null
                        ? fmtNumber(
                            summary.drivingShare * 100,
                            1,
                          )
                        : '—',
                    dist: formatDistance(summary.distanceM, {
                      precision: 0,
                    }),
                  },
                )}
              </Text>
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
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t('utilization.ledger', 'Cost of Motion')}
        </PanelTitle>
        <UtilizationSectionBody state={state} className="min-h-56">
          {summary.accounting.eligibleRows === 0 ? (
            <EmptyState
              icon={<Wallet className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'utilization.noData',
                'No drives in this period yet.',
              )}
            />
          ) : summary.accounting.usableEnergyRows === 0 ? (
            <EmptyState
              icon={<Wallet className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'utilization.costNoEnergy',
                'No eligible drives include usable energy measurements for this period.',
              )}
            />
          ) : (
            <>
              <KVList items={costItems} />
              <Text variant="caption" as="p" className="mt-3">
                {t(
                  'utilization.costAssumption',
                  'Energy-only estimate using the Settings electricity rate. It excludes insurance, depreciation, financing, maintenance, and charging losses.',
                )}
              </Text>
            </>
          )}
        </UtilizationSectionBody>
      </GlassPanel>
    </section>
  );
}
