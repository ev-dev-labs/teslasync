import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import { ThresholdBar } from '@/components/charts';
import { MetricTile } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useFormatting } from '@/hooks/useFormatting';
import type { ChargingStats } from './helpers';

interface HeroGaugesProps {
  stats: ChargingStats | null;
}

/**
 * Peak DC rate a Tesla Supercharger delivers, and the scale an average-power
 * reading is actually judged against. Unlike the totals beside it this IS a
 * real ceiling, so it earns a scale where they do not.
 */
const PEAK_CHARGE_KW = 250;
/** Typical ceiling for home / destination AC charging. */
const AC_CHARGE_KW = 22;
/** Boundary between early-generation and V3+ Supercharging rates. */
const DC_FAST_KW = 150;

/**
 * Summary strip for the currently filtered charging sessions.
 *
 * These were radial gauges whose ceilings were derived from the readings —
 * `max={Math.max(count, 50)}` renders a full ring for every count above 50,
 * and the energy and cost gauges did the same. Session count, energy and cost
 * are unbounded totals with no meaningful 100%, so they are shown as the
 * numbers they are. Average power keeps a scale because it has a real one:
 * the 250 kW Supercharger peak.
 */
export function HeroGauges({ stats }: HeroGaugesProps) {
  const { t } = useTranslation();
  const { currencySymbol } = useFormatting();

  // Null-safe reads. `ChargingStats` types every metric as `number`, but the
  // wire shape can omit individual fields; coercing here keeps NaN out of the
  // readouts.
  const count = stats?.count ?? 0;
  const totalEnergy = stats?.totalEnergy ?? 0;
  const totalCost = stats?.totalCost ?? 0;
  const avgPower = stats?.avgPower ?? 0;
  const avgCostPerKwh = stats?.avgCostPerKwh ?? 0;

  const powerBands = [
    {
      from: 0,
      to: AC_CHARGE_KW,
      color: '#38bdf88c',
      label: t('charging.gauges.band.ac', 'AC'),
    },
    {
      from: AC_CHARGE_KW,
      to: DC_FAST_KW,
      color: '#a855f78c',
      label: t('charging.gauges.band.dcFast', 'DC fast'),
    },
    {
      from: DC_FAST_KW,
      to: PEAK_CHARGE_KW,
      color: '#10b9818c',
      label: t('charging.gauges.band.supercharge', 'Supercharge'),
    },
  ];

  return (
    <GlassPanel className="p-4 sm:p-6">
      {stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 sm:gap-6 items-center">
          <MetricTile
            value={count}
            label={t('charging.gauges.sessions', 'Sessions')}
            accentClass="text-cyan-300"
          />
          <MetricTile
            value={totalEnergy}
            unit="kWh"
            decimals={0}
            label={t('charging.gauges.energy', 'Energy')}
            accentClass="text-emerald-300"
          />
          <MetricTile
            value={totalCost}
            unit={currencySymbol}
            decimals={0}
            label={t('charging.gauges.totalCost', 'Total Cost')}
            accentClass="text-amber-300"
          />
          <ThresholdBar
            value={avgPower}
            min={0}
            max={PEAK_CHARGE_KW}
            bands={powerBands}
            label={t('charging.gauges.avgPower', 'Avg Power')}
            unit="kW"
            decimals={0}
            className="col-span-2 sm:col-span-1"
          />
          <MetricTile
            value={avgCostPerKwh}
            unit={t('charging.gauges.perKwh', '/kWh')}
            decimals={3}
            label={t('charging.gauges.avgCostPerKwh', 'Avg cost')}
            accentClass="text-emerald-300"
          />
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('charging.noStats', 'No charging statistics available yet')} />
      )}
    </GlassPanel>
  );
}
