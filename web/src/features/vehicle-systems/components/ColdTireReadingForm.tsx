import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ErrorText, Input } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useSettings } from '@/hooks/useSettings';
import { useColdTireLabels } from '@/lib/coldTireDisplay';
import { zonedWallTimeToUtc } from '@/lib/dateConvert';
import { PASCALS_PER_KPA } from '@/lib/unitConversion';
import { parseForUnit, unitSymbol } from '@/lib/unitInput';
import type { ColdTireReading } from '@/types/coldTireReview';

const wheels = ['front_left', 'front_right', 'rear_left', 'rear_right'] as const;

interface Props {
  disabled: boolean;
  onSave: (reading: ColdTireReading) => void;
  onCancel: () => void;
}

export function ColdTireReadingForm({ disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  const labels = useColdTireLabels();
  const { settings } = useSettings();
  const { tz } = useDateFormat('user');
  const [values, setValues] = useState({ front_left: '', front_right: '', rear_left: '', rear_right: '' });
  const [observed, setObserved] = useState('');
  const [ambient, setAmbient] = useState('');
  const [consent, setConsent] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !consent) return;
    const when = zonedWallTimeToUtc(observed, tz);
    const temperature = parseForUnit(ambient, 'temperature', settings);
    const [fl, fr, rl, rr] = wheels.map(wheel => {
      const value = parseForUnit(values[wheel], 'pressure', settings);
      return value != null && value >= 50 && value <= 700 ? value * PASCALS_PER_KPA : null;
    });
    const now = Date.now();
    if (!when || when.getTime() > now || when.getTime() < now - 30 * 86400_000 || temperature == null ||
      temperature < -45 || temperature > 50 || fl == null || fr == null || rl == null || rr == null) {
      setInvalid(true);
      first.current?.focus();
      return;
    }
    setInvalid(false);
    onSave({
      observed_at: when.toISOString(), ambient_c: temperature, front_left_pa: fl, front_right_pa: fr, rear_left_pa: rl,
      rear_right_pa: rr, cold_gauge_confirmed: true,
    });
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Input ref={first} type="datetime-local" value={observed} required disabled={disabled}
          label={t('tireDifferentialDrift.coldReview.observed', 'Reading time ({{zone}})', { zone: tz })}
          onChange={event => setObserved(event.target.value)} />
        <Input value={ambient} inputMode="decimal" required disabled={disabled}
          label={t('tireDifferentialDrift.coldReview.ambient', 'Ambient temperature ({{unit}})', { unit: unitSymbol('temperature', settings) })}
          onChange={event => setAmbient(event.target.value)} />
        {wheels.map(wheel => (
          <Input key={wheel} value={values[wheel]} inputMode="decimal" required disabled={disabled}
            label={t('tireDifferentialDrift.coldReview.wheel', '{{wheel}} ({{unit}})', { wheel: labels[wheel], unit: unitSymbol('pressure', settings) })}
            onChange={event => setValues({ ...values, [wheel]: event.target.value })} />
        ))}
      </div>
      <Checkbox checked={consent} onChange={setConsent} disabled={disabled}
        label={t('tireDifferentialDrift.coldReview.consent', 'I used the same gauge on all four tires before driving, with the tires cold and no wheel rotation or pressure adjustment since the previous check. Compare these readings on this server.')} />
      {invalid && <ErrorText role="alert">
        {t('tireDifferentialDrift.coldReview.invalid', 'Enter a reading time in the past 30 days, an ambient temperature and four valid gauge readings.')}
      </ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" wrapLabel disabled={disabled || !consent}>
          {t('tireDifferentialDrift.coldReview.save', 'Save cold check')}
        </Button>
        <Button type="button" className="min-h-11" variant="secondary" onClick={onCancel} disabled={disabled}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  );
}
