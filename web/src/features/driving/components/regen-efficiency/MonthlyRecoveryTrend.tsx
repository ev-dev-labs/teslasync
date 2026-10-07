import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import { Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { fmtInt, fmtNumber, fmtPercent } from '@/lib/numberFormat';

import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import { DetailScopeNotice } from './DetailScopeNotice';
import { MonthlyRecoveryChart } from './MonthlyRecoveryChart';
import type {
  MonthlyRecoveryChartRow,
  RegenSectionState,
} from './types';

interface MonthlyRecoveryTrendProps {
  model: RegenEfficiencyModel;
  state: RegenSectionState;
}

export function MonthlyRecoveryTrend({
  model,
  state,
}: MonthlyRecoveryTrendProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const energySeries = t(
    'regen.monthly.energySeries',
    'Measured recovered energy',
  );
  const ratioSeries = t(
    'regen.monthly.ratioSeries',
    'Energy-weighted recovery share',
  );
  const monthLabel = t('regen.monthly.month', 'Month');
  const recoveredEnergyLabel = t(
    'regen.monthly.recoveredEnergyUnit',
    'Recovered energy ({{unit}})',
    { unit: unitPrefs.energy },
  );
  const driveEnergyLabel = t(
    'regen.monthly.driveEnergyUnit',
    'Drive energy ({{unit}})',
    { unit: unitPrefs.energy },
  );
  const weightedRatioLabel = t(
    'regen.monthly.weightedRatio',
    'Weighted recovery share',
  );
  const eligibleLabel = t('regen.monthly.eligible', 'Eligible drives');
  const returnedLabel = t('regen.monthly.returned', 'Returned drives');
  const rows = useMemo<MonthlyRecoveryChartRow[]>(
    () =>
      model.displayMonths.map((month) => ({
        month: month.month,
        recoveredEnergy:
          month.totalRegenWh != null
            ? convertEnergyFromSI(month.totalRegenWh, unitPrefs.energy)
            : null,
        driveEnergy:
          month.totalDriveEnergyWh != null
            ? convertEnergyFromSI(
                month.totalDriveEnergyWh,
                unitPrefs.energy,
              )
            : null,
        recoveryRatio: month.energyWeightedRatioPct,
        eligible: month.eligibleCount,
        returned: month.returnedCount,
      })),
    [model.displayMonths, unitPrefs.energy],
  );
  const exportRows = useMemo<Array<Record<string, string | number>>>(
    () =>
      rows.map((row) => ({
        [monthLabel]: row.month,
        [recoveredEnergyLabel]: row.recoveredEnergy ?? '—',
        [driveEnergyLabel]: row.driveEnergy ?? '—',
        [weightedRatioLabel]: row.recoveryRatio ?? '—',
        [eligibleLabel]: row.eligible,
        [returnedLabel]: row.returned,
      })),
    [
      driveEnergyLabel,
      eligibleLabel,
      monthLabel,
      recoveredEnergyLabel,
      returnedLabel,
      rows,
      weightedRatioLabel,
    ],
  );
  const hasData =
    state.isResolved && rows.some((row) => row.eligible > 0);
  const ariaDescription = state.isLoading
    ? t('regen.states.detailLoading', 'Detailed query loading.')
    : state.error
      ? t('regen.states.detailUnavailable', 'Detailed query unavailable.')
      : !state.isResolved
        ? t(
            'regen.states.detailPending',
            'Detailed data availability has not resolved.',
          )
        : model.monthsTruncated
          ? t(
              'regen.monthly.ariaTruncated',
              'The chart displays the latest {{displayed}} of {{total}} observed months.',
              {
                displayed: model.displayMonths.length,
                total: model.totalMonthCount,
              },
            )
          : t(
              'regen.monthly.ariaComplete',
              'The chart displays all {{total}} observed months in the returned detail window.',
              { total: model.totalMonthCount },
            );

  return (
    <section
      aria-label={t('regen.monthly.sectionAria', 'Monthly recovery evidence')}
      data-testid="regen-monthly"
    >
      <ChartContainer
        title={t('regen.monthly.title', 'Monthly recovery trend')}
        subtitle={t(
          'regen.monthly.subtitle',
          'Detailed returned drives grouped by calendar month; ratios use summed energies.',
        )}
        ariaLabel={t(
          'regen.monthly.aria',
          'Monthly measured recovered energy bars with an energy-weighted recovery-share line',
        )}
        ariaDescription={ariaDescription}
        loading={state.isLoading}
        height={340}
        chartKey="regen-monthly-recovery"
        exportable={state.isResolved && hasData}
        exportFilename="regen-monthly-recovery"
        exportData={state.isResolved ? exportRows : []}
        data={state.isResolved ? rows : []}
        dataColumns={[
          { key: 'month', label: monthLabel },
          {
            key: 'recoveredEnergy',
            label: recoveredEnergyLabel,
            format: (value) =>
              typeof value === 'number'
                ? `${fmtNumber(value, 1)} ${unitPrefs.energy}`
                : '—',
          },
          {
            key: 'driveEnergy',
            label: driveEnergyLabel,
            format: (value) =>
              typeof value === 'number'
                ? `${fmtNumber(value, 1)} ${unitPrefs.energy}`
                : '—',
          },
          {
            key: 'recoveryRatio',
            label: weightedRatioLabel,
            format: (value) =>
              typeof value === 'number' ? fmtPercent(value, 1) : '—',
          },
          {
            key: 'eligible',
            label: eligibleLabel,
            format: (value) => fmtInt(value),
          },
          {
            key: 'returned',
            label: returnedLabel,
            format: (value) => fmtInt(value),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <MonthlyRecoveryChart
            rows={rows}
            hasData={hasData}
            state={state}
            energySeries={energySeries}
            ratioSeries={ratioSeries}
            energyUnit={unitPrefs.energy}
            isEnergyHidden={
              hiddenSeries?.isHidden('recoveredEnergy') ?? false
            }
            isRatioHidden={
              hiddenSeries?.isHidden('recoveryRatio') ?? false
            }
          />
        )}
      </ChartContainer>
      {state.isResolved && model.monthsTruncated ? (
        <Text as="p" variant="caption" className="mt-2">
          {t(
            'regen.monthly.truncated',
            'Showing the latest {{displayed}} of {{total}} observed months; all observed months remain included in coverage accounting.',
            {
              displayed: model.displayMonths.length,
              total: model.totalMonthCount,
            },
          )}
        </Text>
      ) : null}
      {state.isResolved ? (
        <DetailScopeNotice
          className="mt-3"
          capReached={model.accounting.historyCapReached}
          historyLimit={model.accounting.historyLimit}
        />
      ) : null}
    </section>
  );
}
