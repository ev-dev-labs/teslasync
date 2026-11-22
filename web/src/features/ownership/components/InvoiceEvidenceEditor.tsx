import { useTranslation } from 'react-i18next';
import { Input, Select, Text, Toggle } from '@/components/ui';
import type { InvoiceLine, InvoiceLineInput, MeterBoundary } from '@/types/ownership';
import { MoneyInput } from './MoneyInput';

function boundaryOf(value: string): MeterBoundary | undefined {
  return value === 'station' || value === 'battery' ? value : undefined;
}

type EditableEvidence = Pick<InvoiceLineInput, 'billed_energy_minor' | 'billed_idle_minor' | 'billed_tax_minor' | 'variance_evidence'>;

type Props = {
  currency: string;
  locale?: string;
  enabled: boolean;
} & (
  | { reviewOnly: true; line: InvoiceLine; onChange: (patch: Pick<InvoiceLine, 'variance_evidence'>) => void }
  | { reviewOnly?: false; line: EditableEvidence; onChange: (patch: Partial<EditableEvidence>) => void }
);

export function InvoiceEvidenceEditor(props: Props) {
  const { t } = useTranslation();
  const { line, currency, locale, enabled, reviewOnly, onChange } = props;
  const evidence = line.variance_evidence ?? {};
  const { billed_boundary: billed, meter, rate } = evidence;
  const unknown = t('ownership.reconcile.review.unknown', 'Unknown or not comparable');
  const boundaries = [
    { value: '', label: unknown },
    { value: 'station', label: t('ownership.reconcile.review.station', 'Station or wall meter') },
    { value: 'battery', label: t('ownership.reconcile.review.battery', 'Vehicle battery') },
  ];
  return (
    <div className="space-y-3">
      {!reviewOnly && <div className="grid gap-3 md:grid-cols-3">
        <MoneyInput label={t('ownership.reconcile.review.billedCharge', 'Billed energy charge')}
          currency={currency} locale={locale} value={line.billed_energy_minor}
          onChange={(value) => props.onChange({ billed_energy_minor: value })} />
        <MoneyInput label={t('ownership.reconcile.review.billedIdle', 'Billed idle or occupancy fee')}
          currency={currency} locale={locale} value={line.billed_idle_minor}
          onChange={(value) => props.onChange({ billed_idle_minor: value })} />
        <MoneyInput label={t('ownership.reconcile.review.billedTax', 'Billed tax')}
          currency={currency} locale={locale} value={line.billed_tax_minor}
          onChange={(value) => props.onChange({ billed_tax_minor: value })} />
      </div>}
      {enabled && (
        <div className="space-y-3">
          <Text as="p" variant="caption">
            {t('ownership.reconcile.review.inputHint', 'Use the session start and the same site name recorded in Charging. Leave unknown amounts blank and enter zero only if documented. Use independent readings and rates only. Nothing is sent to the provider.')}
          </Text>
          <MoneyInput label={t('ownership.reconcile.review.otherFees', 'All other line fees (zero if fully itemized and none)')}
            currency={currency} locale={locale} value={evidence.other_fees_minor ?? null}
            onChange={(value) => onChange({ variance_evidence: { ...evidence, other_fees_minor: value ?? undefined } })} />
          <div className="grid gap-3 md:grid-cols-2">
            <Select label={t('ownership.reconcile.review.billedBoundary', 'Billed meter boundary')}
              value={billed ?? ''} options={boundaries}
              onChange={(event) => onChange({ variance_evidence: {
                other_fees_minor: evidence.other_fees_minor, billed_boundary: boundaryOf(event.target.value),
              } })} />
            <Select label={t('ownership.reconcile.review.observedBoundary', 'Independent meter boundary')}
              value={meter?.observed_boundary ?? ''} options={boundaries} disabled={!billed}
              onChange={(event) => {
                const boundary = boundaryOf(event.target.value);
                onChange({ variance_evidence: { ...evidence,
                  meter: boundary ? { observed_boundary: boundary, observed_energy_wh: 0 } : undefined,
                } });
              }} />
            {meter && (
              <Input type="number" step="any" min={0.01} max={1_000_000} required
                label={t('ownership.reconcile.review.meterEnergy', 'Independent meter reading (Wh)')}
                value={meter.observed_energy_wh || ''} onChange={(event) => onChange({
                  variance_evidence: { ...evidence, meter: { ...meter, observed_energy_wh: Number(event.target.value) } },
                })} />
            )}
            {meter && meter.observed_boundary !== billed && (
              <Input type="number" step="any" min={0} max={meter.observed_energy_wh * 0.30}
                label={t('ownership.reconcile.review.maxLoss', 'Documented upper loss bound (Wh)')}
                value={meter.max_loss_wh ?? ''} onChange={(event) => onChange({
                  variance_evidence: { ...evidence, meter: {
                    ...meter, max_loss_wh: event.target.value === '' ? undefined : Number(event.target.value),
                  } },
                })} />
            )}
          </div>
          <Toggle label={t('ownership.reconcile.review.addRate', 'Use an independently documented flat session rate in the same currency and at the billed boundary')}
            checked={rate != null} disabled={!billed}
            onChange={(checked) => onChange({ variance_evidence: { ...evidence,
              rate: checked && billed ? { boundary: billed, amount_minor: -1, energy_wh: 1000 } : undefined,
            } })} />
          {rate && (
            <div className="grid gap-3 md:grid-cols-2">
              <MoneyInput label={t('ownership.reconcile.review.rateAmount', 'Documented energy rate amount')}
                currency={currency} locale={locale} required value={rate.amount_minor < 0 ? null : rate.amount_minor}
                onChange={(value) => onChange({ variance_evidence: { ...evidence, rate: { ...rate, amount_minor: value ?? -1 } } })} />
              <Input type="number" step={1} min={1} max={1_000_000} required
                label={t('ownership.reconcile.review.rateEnergy', 'Energy covered by that rate amount (Wh)')}
                value={rate.energy_wh || ''} onChange={(event) => onChange({
                  variance_evidence: { ...evidence, rate: { ...rate, energy_wh: Number(event.target.value) } },
                })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
