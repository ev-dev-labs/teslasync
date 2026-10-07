import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { TrueCostSectionBody } from './TrueCostSectionBody';
import type { TrueCostSectionProps } from './types';

export function TrueCostAssumptionsLedger({
  analysis,
  state,
  display,
  gasUnit,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const unitLabel = gasUnit === 'liter'
    ? t('tco.units.liter', 'L')
    : t('tco.units.gallon', 'gal');
  const m = analysis.metrics;
  const rows = [
    {
      label: t('tco.assumptions.gasPrice', 'Configured gasoline price'),
      value: m.gasPrice.value != null
        ? t('tco.assumptions.perUnit', '{{price}}/{{unit}}', {
          price: display.formatCurrency(m.gasPrice.value),
          unit: unitLabel,
        })
        : '—',
      detail: t('tco.assumptions.gasPriceHint', 'Lifetime gas total scales from positive-drive distance and this configured unit price.'),
    },
    {
      label: t('tco.assumptions.mpg', 'Comparison efficiency'),
      value: m.gasEfficiencyMpg.value != null
        ? t('tco.assumptions.mpgValue', '{{value}} MPG', {
          value: display.formatNumber(m.gasEfficiencyMpg.value, 1),
        })
        : '—',
      detail: t('tco.assumptions.mpgHint', 'Configured comparison vehicle efficiency; not observed fuel economy.'),
    },
    {
      label: t('tco.assumptions.baseRate', 'Base electricity rate context'),
      value: m.baseCostPerKwh.value != null
        ? t('tco.assumptions.kwhValue', '{{value}}/kWh', {
          value: display.formatCurrency(m.baseCostPerKwh.value),
        })
        : '—',
      detail: t('tco.assumptions.baseRateHint', 'Returned for context only; aggregate charging spend does not impute missing costs with this rate.'),
    },
    {
      label: t('tco.assumptions.monthlyGas', 'Monthly gas method'),
      value: t('tco.assumptions.energyDerived', 'Energy-derived distance estimate'),
      detail: t('tco.assumptions.energyDerivedHint', 'Uses lifetime km/kWh, or 5 km/kWh when lifetime distance or energy is unavailable.'),
    },
    {
      label: t('tco.assumptions.maintenance', 'Maintenance method'),
      value: t('tco.assumptions.maintenanceValue', '$50 per modeled month'),
      detail: t('tco.assumptions.maintenanceHint', 'Flat heuristic only; no actual service records are queried.'),
    },
    {
      label: t('tco.assumptions.monthModel', 'Month-span method'),
      value: t('tco.assumptions.monthModelValue', 'Drive span ÷ 30.44, floored at one'),
      detail: t('tco.assumptions.monthModelHint', 'This is not verified ownership tenure.'),
    },
  ];

  return (
    <section
      data-testid="tco-assumptions"
      aria-label={t('tco.assumptions.aria', 'True Cost assumptions and settings ledger')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('tco.assumptions.title', 'Assumption and settings ledger')}
        </PanelTitle>
        <TrueCostSectionBody state={state}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <div
                key={row.label}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <Text as="p" variant="metricLabel">{row.label}</Text>
                <Text as="p" variant="body" mono className="mt-1">{row.value}</Text>
                <Text as="p" variant="caption" className="mt-1">{row.detail}</Text>
              </div>
            ))}
          </div>
        </TrueCostSectionBody>
      </GlassPanel>
    </section>
  );
}
