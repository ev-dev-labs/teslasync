import { Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, Text } from '@/components/ui';
import { DataProvenanceBadge, type StatMetric } from '@/components/data-display';
import { ChargingSummaryBrief } from './operationalbrief-all/ChargingSummaryBrief';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { convertEnergyFromSI } from '@/lib/unitConversion';

import type { ChargingSession } from '@/api/types';

import {
  deriveChargeBillTruth,
  type ChargeBillReasonId,
} from '../lib/chargeBillTruth';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtNumber } = useNumberFormatting();
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
      : `${fmtNumber(convertEnergyFromSI(wh, unitPrefs.energy))} ${unitPrefs.energy}`;
  const money = (value: number | null) =>
    value == null
      ? '—'
      : `${truth.currency ?? session.cost_currency ?? '$'}${fmtNumber(value)}`;
  const metrics: StatMetric[] = [
    { metricId: 'energy', occurrenceId: 'billed', rawValue: truth.billedEnergyWh,
      label: t('charging.billTruth.billed', 'Billed'),
      display: { formatter: raw => ({ value: energy(raw), unit: '' }) }, context: money(truth.billedCost) },
    { metricId: 'energy', occurrenceId: 'pack', rawValue: truth.measuredEnergyWh,
      label: t('charging.billTruth.pack', 'Pack added'),
      display: { formatter: raw => ({ value: energy(raw), unit: '' }) }, context: money(truth.measuredCost) },
    { metricId: 'energy', occurrenceId: 'delta', rawValue: truth.energyDeltaWh,
      label: t('charging.billTruth.delta', 'Cabinet − pack'),
      display: { formatter: raw => ({ value: energy(raw), unit: '' }) },
      context: truth.energyDeltaPct == null ? '—' : t('charging.billTruth.deltaPct', '{{pct}}% of invoice', {
        pct: fmtNumber(truth.energyDeltaPct),
      }) },
    { metricId: 'currency', occurrenceId: 'fees', rawValue: truth.unexplainedCost,
      label: t('charging.billTruth.fees', 'Idle / tax remainder'),
      display: { formatter: raw => ({ value: money(raw), unit: '' }) },
      context: truth.impliedEnergyCost == null ? t('charging.billTruth.feesUnknown', 'Need invoice rate')
        : t('charging.billTruth.energyPortion', 'Energy portion {{amount}}', { amount: money(truth.impliedEnergyCost) }) },
  ];

  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5" data-testid="charge-bill-truth">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Receipt className="h-4 w-4 text-amber-300" aria-hidden="true" />
        <DataProvenanceBadge provenance={truth.honesty === 'live' ? 'historical' : truth.honesty === 'guessed' ? 'inferred' : 'unknown'} />
      </div>
      {truth.site && (
        <Badge variant="neutral" size="sm">{truth.site}</Badge>
      )}
      <ChargingSummaryBrief metrics={metrics}
        title={t('charging.billTruth.title', 'Bill vs pack')}
        description={t('charging.billTruth.subtitle', 'Invoice, pack, and why they differ. Dashboards do not pay the Supercharger bill.')}
        period={{ kind: 'event', eventId: String(session.id), start: session.started_at,
          end: session.ended_at ?? null, label: `${t('charging.detail.title', 'Charge Session')} #${session.id}`,
          provenance: t('charging.detail.billedEnergyHelp',
            'Tesla Supercharger invoices meter energy at the cabinet. Vehicle telemetry is energy into the pack and is often a few percent lower.') }} />
      {truth.reasons.length === 0 ? (
        <EmptyState /* no-action: informational empty — no CTA */
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
