import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UnitInput } from '@/components/forms';
import { Button, Input, Toggle } from '@/components/ui';
import type { MileageTermSettings } from '@/types/mileageTerm';

interface Props {
  initial?: MileageTermSettings | null;
  defaultZone: string;
  disabled: boolean;
  onSave: (settings: MileageTermSettings) => void;
}

export function MileageTermForm({ initial, defaultZone, disabled, onSave }: Props) {
  const { t } = useTranslation();
  const [zone, setZone] = useState(initial?.time_zone ?? defaultZone);
  const [first, setFirst] = useState(initial?.first_day ?? '');
  const [end, setEnd] = useState(initial?.end_day ?? '');
  const [opening, setOpening] = useState<number | null>(initial?.opening_odometer_m ?? null);
  const [allowance, setAllowance] = useState<number | null>(initial?.allowance_m ?? null);
  const [minimum, setMinimum] = useState<number | null>(initial?.minimum_overage_m ?? null);
  const [confirmed, setConfirmed] = useState<string>();
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => { firstField.current?.focus(); }, []);

  const draft: MileageTermSettings | null = zone.trim() && first && end > first && opening != null &&
    allowance != null && minimum != null && minimum <= allowance ? {
      id: initial?.id ?? 0, time_zone: zone.trim(), first_day: first, end_day: end, opening_odometer_m: opening,
      allowance_m: allowance, minimum_overage_m: minimum, paused: false,
    } : null;
  const signature = draft ? JSON.stringify(draft) : undefined;
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    if (!disabled && draft && signature === confirmed) onSave(draft);
  }}>
    <div className="grid gap-3 sm:grid-cols-2">
      <Input ref={firstField} type="date" label={t('mileageBudget.review.first', 'First day of the term')}
        value={first} required disabled={disabled} onChange={(event) => { setFirst(event.target.value); setConfirmed(undefined); }} />
      <Input type="date" label={t('mileageBudget.review.end', 'First day after the term')}
        value={end} required disabled={disabled} onChange={(event) => { setEnd(event.target.value); setConfirmed(undefined); }} />
      <Input label={t('mileageBudget.review.zone', 'Term time zone')}
        value={zone} required maxLength={80} disabled={disabled}
        hint={t('mileageBudget.review.zoneHint', 'Use the IANA time zone for the term dates, such as America/New_York.')}
        onChange={(event) => { setZone(event.target.value); setConfirmed(undefined); }} />
      <UnitInput unit="distance" label={t('mileageBudget.review.opening', 'Recorded odometer at term start')}
        value={opening} min={0} max={10_000_000_000} required disabled={disabled} commitOnChange
        onChange={value => { setOpening(value); setConfirmed(undefined); }} />
      <UnitInput unit="distance" label={t('mileageBudget.review.allowance', 'Distance allowed over the entire term')}
        value={allowance} min={1000} max={10_000_000} required disabled={disabled} commitOnChange
        onChange={value => { setAllowance(value); setConfirmed(undefined); }} />
      <UnitInput unit="distance" label={t('mileageBudget.review.minimum', 'Minimum projected overage to review')}
        value={minimum} min={100} max={allowance ?? 10_000_000} required disabled={disabled} commitOnChange
        onChange={value => { setMinimum(value); setConfirmed(undefined); }} />
    </div>
    <Toggle label={t('mileageBudget.review.consent', 'These are my recorded terms for this vehicle. Use its odometer history to check my allowance each month.')}
      checked={signature != null && signature === confirmed} disabled={disabled || !draft}
      onChange={checked => setConfirmed(checked ? signature : undefined)} />
    <Button type="submit" className="min-h-11" wrapLabel disabled={disabled || !draft || signature !== confirmed}>
      {t('mileageBudget.review.confirm', 'Confirm private mileage review')}
    </Button>
  </form>;
}
