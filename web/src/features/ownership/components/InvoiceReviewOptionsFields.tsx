import { useTranslation } from 'react-i18next';
import { Toggle } from '@/components/ui';
import type { InvoiceVarianceOptions } from '@/types/ownership';
import { MoneyInput } from './MoneyInput';

interface Props {
  currency: string;
  locale?: string;
  options: InvoiceVarianceOptions;
  onChange: (options: InvoiceVarianceOptions) => void;
}

export function InvoiceReviewOptionsFields({ currency, locale, options, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <MoneyInput label={t('ownership.reconcile.review.threshold', 'Minimum material money difference')}
        required min={1} value={options.material_amount_minor || null}
        currency={currency} locale={locale}
        onChange={(value) => onChange({ ...options, material_amount_minor: value ?? 0 })} />
      <Toggle label={t('ownership.reconcile.review.complete', 'I entered every line and the statement has no unlisted adjustments or credits')}
        checked={options.complete_statement}
        onChange={(checked) => onChange({ ...options, complete_statement: checked })} />
    </div>
  );
}
