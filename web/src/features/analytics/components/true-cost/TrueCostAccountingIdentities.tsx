import { Binary } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { TcoIdentity } from '../../lib/trueCost';
import { TrueCostSectionBody } from './TrueCostSectionBody';
import type { TrueCostSectionProps } from './types';

function identityLabel(
  id: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const labels: Record<string, string> = {
    fuel_total: t('tco.accounting.fuelTotal', 'Gas total − EV total vs API fuel delta'),
    maintenance_heuristic: t('tco.accounting.maintenance', 'Modeled months × $50 vs maintenance heuristic'),
    monthly_ev_total: t('tco.accounting.monthlyEv', 'Monthly EV-cost sum vs charging total'),
    monthly_energy_total: t('tco.accounting.monthlyEnergy', 'Monthly energy sum vs energy total'),
    monthly_gas_total: t('tco.accounting.monthlyGas', 'Monthly gas-equivalent sum vs lifetime gas total'),
    monthly_final_cumulative: t('tco.accounting.cumulative', 'Final API cumulative vs derived monthly sum'),
    cost_per_km_ev: t('tco.accounting.evPerKm', 'EV total ÷ distance vs API cost/km'),
    cost_per_km_ice: t('tco.accounting.gasPerKm', 'Gas total ÷ distance vs API cost/km'),
  };
  return labels[id] ?? id;
}

function value(
  amount: number | null,
  check: TcoIdentity,
  display: TrueCostSectionProps['display'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (amount == null) return '—';
  if (check.unit === 'Wh') return display.formatEnergy(amount);
  if (check.unit === 'currency_per_km') {
    return t('tco.accounting.perKmValue', '{{value}}/km', {
      value: display.formatCurrency(amount, 4),
    });
  }
  return display.formatSignedCurrency(amount, 4);
}

export function TrueCostAccountingIdentities({
  analysis,
  state,
  display,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  return (
    <section
      data-testid="tco-accounting"
      aria-label={t('tco.accounting.aria', 'Exact True Cost accounting identities and tolerances')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-2 flex items-center gap-2">
          <Binary className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('tco.accounting.title', 'Exact accounting identities')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t('tco.accounting.subtitle', 'Every check states a wire-rounding tolerance. Missing or malformed operands remain unavailable rather than passing as zero.')}
        </Text>
        <TrueCostSectionBody state={state}>
          <ul className="grid gap-3 lg:grid-cols-2">
            {analysis.identities.map((check) => {
              const status = check.status === 'balances'
                ? { label: t('tco.accounting.balances', 'Balances'), variant: 'success' as const }
                : check.status === 'outside_tolerance'
                  ? { label: t('tco.accounting.outside', 'Outside tolerance'), variant: 'danger' as const }
                  : { label: t('tco.accounting.unavailable', 'Unavailable'), variant: 'neutral' as const };
              return (
                <li
                  key={check.id}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Text as="p" variant="label">{identityLabel(check.id, t)}</Text>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    <Text variant="caption">{t('tco.accounting.expected', 'Expected')}</Text>
                    <Text variant="caption" mono>{value(check.expected, check, display, t)}</Text>
                    <Text variant="caption">{t('tco.accounting.observed', 'Observed')}</Text>
                    <Text variant="caption" mono>{value(check.observed, check, display, t)}</Text>
                    <Text variant="caption">{t('tco.accounting.residual', 'Residual')}</Text>
                    <Text variant="caption" mono>{value(check.residual, check, display, t)}</Text>
                    <Text variant="caption">{t('tco.accounting.tolerance', 'Tolerance')}</Text>
                    <Text variant="caption" mono>{value(check.tolerance, check, display, t)}</Text>
                  </div>
                </li>
              );
            })}
          </ul>
        </TrueCostSectionBody>
      </GlassPanel>
    </section>
  );
}
