import { Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { DataProvenanceBadge, MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import type { ChargingSession } from '@/api/types';

import {
  deriveChargeBillTruth,
  type ChargeBillReasonId,
} from '../lib/chargeBillTruth';

const REASON_COPY: Record<ChargeBillReasonId, { key: string; fallback: string }> = {
  no_invoice: {
    key: 'charging.billTruth.reason.noInvoice',
    fallback: 'No Tesla Supercharger invoice matched this session. Pack energy is measured; the bill is missing.',
  },
  cabinet_vs_pack: {
    key: 'charging.billTruth.reason.cabinet',
    fallback: 'Tesla bills cabinet (meter) energy. Pack added is exclusive of thermal, HVAC, and conversion loss.',
  },
  pack_exceeds_bill: {
    key: 'charging.billTruth.reason.packHigh',
    fallback: 'Pack energy is higher than the invoice. The bill match may be the wrong session.',
  },
  idle_or_tax: {
    key: 'charging.billTruth.reason.idle',
    fallback: 'Invoice total is more than energy × rate. The remainder is idle, congestion, or tax — not pack kWh.',
  },
  fee_type_idle: {
    key: 'charging.billTruth.reason.feeType',
    fallback: 'Tesla marked this line as idle, congestion, or tax.',
  },
  ac_session: {
    key: 'charging.billTruth.reason.ac',
    fallback: 'AC sessions rarely have a Supercharger invoice. Home/work energy is pack truth only.',
  },
};

export function ChargeBillTruthPanel({ session }: { session: ChargingSession }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const truth = deriveChargeBillTruth({
    chargerType: session.charger_type,
    measuredEnergyWh: session.total_energy_added_wh,
    measuredCost: session.cost_decimal ?? session.cost,
    billedEnergyWh: session.billed_energy_wh,
    billedCost: session.billed_cost_decimal,
    billedRatePerKwh: session.billed_rate_per_kwh,
    billedCurrency: session.billed_currency,
    billedSource: session.billed_source,
    billedSite: session.billed_site,
    billedFeeType: session.billed_fee_type,
  });

  const energy = (wh: number | null) =>
    wh == null
      ? '—'
      : `${fmtNumber(convertEnergyFromSI(wh, unitPrefs.energy), 2)} ${unitPrefs.energy}`;
  const money = (value: number | null) =>
    value == null
      ? '—'
      : `${truth.currency ?? session.cost_currency ?? '$'}${fmtNumber(value, 2)}`;

  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5" data-testid="charge-bill-truth">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="mb-0 flex items-center gap-2">
          <Receipt className="h-4 w-4 text-amber-300" aria-hidden="true" />
          {t('charging.billTruth.title', 'Bill vs pack')}
        </PanelTitle>
        <DataProvenanceBadge provenance={truth.honesty === 'live' ? 'historical' : truth.honesty === 'guessed' ? 'inferred' : 'unknown'} />
      </div>
      <Text as="p" variant="caption">
        {t(
          'charging.billTruth.subtitle',
          'Invoice, pack, and why they differ. Dashboards do not pay the Supercharger bill.',
        )}
      </Text>
      {truth.site && (
        <Badge variant="neutral" size="sm">{truth.site}</Badge>
      )}
      <Grid cols={{ default: 2, lg: 4 }} gap={3}>
        <MetricCard
          label={t('charging.billTruth.billed', 'Billed')}
          value={energy(truth.billedEnergyWh)}
          subtitle={money(truth.billedCost)}
          color="amber"
        />
        <MetricCard
          label={t('charging.billTruth.pack', 'Pack added')}
          value={energy(truth.measuredEnergyWh)}
          subtitle={money(truth.measuredCost)}
          color="cyan"
        />
        <MetricCard
          label={t('charging.billTruth.delta', 'Cabinet − pack')}
          value={energy(truth.energyDeltaWh)}
          subtitle={
            truth.energyDeltaPct == null
              ? '—'
              : t('charging.billTruth.deltaPct', '{{pct}}% of invoice', {
                  pct: fmtNumber(truth.energyDeltaPct, 1),
                })
          }
          color="purple"
        />
        <MetricCard
          label={t('charging.billTruth.fees', 'Idle / tax remainder')}
          value={money(truth.unexplainedCost)}
          subtitle={
            truth.impliedEnergyCost == null
              ? t('charging.billTruth.feesUnknown', 'Need invoice rate')
              : t('charging.billTruth.energyPortion', 'Energy portion {{amount}}', {
                  amount: money(truth.impliedEnergyCost),
                })
          }
          color="red"
        />
      </Grid>
      {truth.reasons.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-8 w-8" aria-hidden="true" />}
          message={t('charging.billTruth.empty', 'Invoice and pack already agree.')}
        />
      ) : (
        <ul className="space-y-2">
          {truth.reasons.map((reason) => (
            <li key={reason}>
              <Text as="p" variant="bodySm">
                {t(REASON_COPY[reason].key, REASON_COPY[reason].fallback)}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}
