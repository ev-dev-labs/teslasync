import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencyInput } from '@/components/forms';
import { Button, Input, Toggle } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { currencyFractionDigits, microToValue, valueToMicro } from '@/lib/currencyFormat';
import type { ChargingCostDigestSettings } from '@/types/chargingCostDigest';

interface Props {
  initial: ChargingCostDigestSettings;
  disabled: boolean;
  onSave: (settings: ChargingCostDigestSettings) => void;
}

export function ChargingCostDigestForm({ initial, disabled, onSave }: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const locale = unitPrefs.locale ?? 'en-US';
  const [zone, setZone] = useState(initial.time_zone);
  const [currency, setCurrency] = useState(initial.currency);
  const [confirmed, setConfirmed] = useState(false);
  const [validAmount, setValidAmount] = useState(true);
  const scale = 10 ** currencyFractionDigits(currency, locale);
  const [micro, setMicro] = useState(() => initial.material_change_minor > 0
    ? valueToMicro(initial.material_change_minor / scale) : null);
  const zoneField = useRef<HTMLInputElement>(null);
  useEffect(() => { zoneField.current?.focus(); }, []);
  const hasCurrency = /^[A-Z]{3}$/.test(currency) && currency !== 'XXX';
  const enteredAmount = microToValue(micro);
  const minor = enteredAmount != null ? Math.round(enteredAmount * scale) : 0;
  const exactAmount = enteredAmount != null && valueToMicro(minor / scale) === micro;
  const canSave = !disabled && confirmed && hasCurrency && validAmount &&
    exactAmount && minor > 0 && minor <= 1_000_000_000 && zone.trim() !== '';
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      if (canSave) onSave({ id: initial.id, time_zone: zone.trim(), currency, material_change_minor: minor, paused: false });
    }}>
      <Input ref={zoneField} label={t('tco.costDigest.zone', 'Review time zone')} value={zone} maxLength={80}
        required disabled={disabled}
        hint={t('tco.costDigest.zoneHint', 'Use a time zone such as America/New_York or UTC. The review runs at 9 AM on the second day of each month.')}
        onChange={event => { setZone(event.target.value); setConfirmed(false); }} />
      <Input label={t('tco.costDigest.currency', 'Currency used on your charging bills')} value={currency}
        minLength={3} maxLength={3} required disabled={disabled} onChange={(event) => {
          setCurrency(event.target.value.toUpperCase());
          setMicro(null);
          setConfirmed(false);
        }} />
      <CurrencyInput ariaLabel={t('tco.costDigest.threshold', 'Minimum material cost change')}
        currency={hasCurrency ? currency : 'USD'} locale={locale} precision={currencyFractionDigits(currency, locale)}
        valueMicro={micro} required
        error={micro != null && (!exactAmount || minor <= 0 || minor > 1_000_000_000)
          ? t('tco.costDigest.amountInvalid', 'Enter a positive amount in whole billing increments within the allowed range.')
          : undefined}
        disabled={disabled || !hasCurrency}
        onValidityChange={valid => { setValidAmount(valid); setConfirmed(false); }}
        onChange={({ valueMicro }) => setMicro(valueMicro)} />
      <Toggle label={t('tco.costDigest.consent', 'Review local driving and charging bills for this vehicle each month.')}
        checked={confirmed} disabled={disabled} onChange={setConfirmed} />
      <Button type="submit" className="min-h-11" wrapLabel disabled={!canSave}>
        {t('tco.costDigest.confirm', 'Confirm private monthly review')}
      </Button>
    </form>
  );
}
