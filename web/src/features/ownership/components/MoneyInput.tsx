import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui';
import { formatCurrencyMinor } from '../formatters';

interface MoneyInputProps {
  id?: string;
  label: string;
  /** Amount in ISO-4217 minor units — the only representation ever stored. */
  value: number | null;
  onChange: (value: number | null) => void;
  currency: string;
  locale?: string;
  min?: number;
  required?: boolean;
}

/**
 * Money is stored and transported exclusively in ISO-4217 minor units so no
 * floating-point rounding can silently lose a cent. This input keeps that
 * contract while showing the major-unit equivalent as a hint.
 */
export function MoneyInput({
  id,
  label,
  value,
  onChange,
  currency,
  locale,
  min = 0,
  required,
}: MoneyInputProps) {
  const { t } = useTranslation();
  return (
    <Input
      id={id}
      type="number"
      label={label}
      value={value ?? ''}
      min={min}
      step={1}
      required={required}
      hint={t('ownership.form.moneyHint', 'Display equivalent: {{value}}', {
        value: formatCurrencyMinor(value, currency, locale),
      })}
      suffix={<span className="text-xs text-[var(--text-muted)]">{currency || '—'}</span>}
      onChange={(event) => {
        const next = event.target.value === '' ? null : Number(event.target.value);
        onChange(next != null && Number.isFinite(next) ? Math.round(next) : null);
      }}
    />
  );
}
