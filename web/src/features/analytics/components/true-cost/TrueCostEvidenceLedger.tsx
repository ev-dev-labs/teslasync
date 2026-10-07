import {
  CalendarRange,
  Fuel,
  Gauge,
  Receipt,
  Route,
  TrendingUp,
  WalletCards,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import { TrueCostQueryStatus } from './TrueCostQueryStatus';
import type { TrueCostSectionProps } from './types';

export function TrueCostEvidenceLedger({
  analysis,
  state,
  display,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const m = analysis.metrics;
  const resolved = state.isResolved && state.hasData;
  const fuelColor = analysis.fuelDisposition === 'savings'
    ? 'green'
    : analysis.fuelDisposition === 'loss'
      ? 'red'
      : 'amber';
  const monthlyValue = m.monthlyFuelDelta.value;
  const monthlyColor = monthlyValue == null
    ? 'amber'
    : monthlyValue > 0
      ? 'green'
      : monthlyValue < 0
        ? 'red'
        : 'amber';

  return (
    <section
      data-testid="tco-evidence-kpis"
      aria-label={t('tco.kpis.aria', 'True Cost KPI and evidence ledger')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4">
          {t('tco.kpis.title', 'Evidence KPI ledger')}
        </PanelTitle>
        <Grid cols={{ default: 1, sm: 2, xl: 4 }} gap={3}>
          <MetricCard
            label={t('tco.kpis.recordedSpend', 'Recorded-cost spend')}
            value={resolved ? display.formatCurrency(m.totalChargingCost.value) : '—'}
            subtitle={t('tco.kpis.recordedSpendHint', 'Positive-cost sessions only')}
            icon={<WalletCards className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('tco.kpis.gasTotal', 'Modeled lifetime gas cost')}
            value={resolved
              && analysis.gates.positiveDistance
              && m.equivalentGasCost.value != null
              ? display.formatCurrency(m.equivalentGasCost.value)
              : '—'}
            subtitle={t('tco.kpis.gasTotalHint', 'Positive-drive distance × configured fuel assumptions')}
            icon={<Receipt className="h-5 w-5" />}
            color="red"
          />
          <MetricCard
            label={t('tco.kpis.fuelDelta', 'Fuel savings / loss')}
            value={resolved && analysis.gates.fuelComparison
              ? display.formatSignedCurrency(m.totalFuelDelta.value)
              : '—'}
            subtitle={analysis.fuelDisposition === 'loss'
              ? t('tco.kpis.lossHint', 'Modeled gasoline costs less than recorded charging')
              : t('tco.kpis.fuelDeltaHint', 'Gas equivalent less recorded charging')}
            icon={<Fuel className="h-5 w-5" />}
            color={fuelColor}
          />
          <MetricCard
            label={t('tco.kpis.monthlyFuelDelta', 'Monthly fuel savings / loss')}
            value={resolved && analysis.gates.monthlyFuelRate
              ? display.formatSignedCurrency(monthlyValue)
              : '—'}
            subtitle={t('tco.kpis.monthlyFuelDeltaHint', 'Fuel-only total ÷ modeled drive-span months; excludes maintenance')}
            icon={<TrendingUp className="h-5 w-5" />}
            color={monthlyColor}
          />
          <MetricCard
            label={t('tco.kpis.recordedEnergy', 'Recorded-cost energy')}
            value={resolved ? display.formatEnergy(m.totalWh.value) : '—'}
            subtitle={t('tco.kpis.recordedEnergyHint', 'Same positive-cost session filter')}
            icon={<Zap className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('tco.kpis.costedSessions', 'Costed sessions')}
            value={resolved && m.totalSessions.value != null
              ? fmtInt(m.totalSessions.value)
              : '—'}
            subtitle={t('tco.kpis.costedSessionsHint', 'Free or missing-cost rows are not counted')}
            icon={<Gauge className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('tco.kpis.driveDistance', 'Positive-drive distance')}
            value={resolved ? display.formatDistanceKm(m.totalKm.value) : '—'}
            subtitle={t('tco.kpis.driveDistanceHint', 'All drives with positive distance')}
            icon={<Route className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('tco.kpis.driveSpanMonths', 'Modeled drive-span months')}
            value={resolved && analysis.driveSpan.available
              ? display.formatNumber(m.monthsOfDriveSpan.value, 1)
              : '—'}
            subtitle={t('tco.kpis.driveSpanHint', 'First-to-last positive-drive span; not tenure')}
            icon={<CalendarRange className="h-5 w-5" />}
            color="amber"
          />
        </Grid>
        <TrueCostQueryStatus analysis={analysis} state={state} />
      </GlassPanel>
    </section>
  );
}
