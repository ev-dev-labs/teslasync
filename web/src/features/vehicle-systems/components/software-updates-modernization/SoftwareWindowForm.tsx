import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ErrorText, Input, Text, Toggle } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { toZonedDatetimeStr, uniqueZonedMinuteToUtc } from '@/lib/dateConvert';
import type { SoftwareWindowPlan, SoftwareWindowSetup } from '@/types/softwareWindow';

interface Props {
  plan: SoftwareWindowPlan | null;
  disabled: boolean;
  onCancel: () => void;
  onSave: (setup: SoftwareWindowSetup) => void;
}

export function SoftwareWindowForm({ plan, disabled, onCancel, onSave }: Props) {
  const { t } = useTranslation();
  const { tz } = useDateFormat('user');
  const first = useRef<HTMLInputElement>(null);
  const [departure, setDeparture] = useState(plan && Date.parse(plan.departure_at) > Date.now()
    ? toZonedDatetimeStr(new Date(plan.departure_at), tz) : '');
  const [version, setVersion] = useState(plan?.version ?? '');
  const [estimate, setEstimate] = useState(plan ? String(plan.estimated_duration_s / 60) : '');
  const [confirmed, setConfirmed] = useState(false);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { first.current?.focus(); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !confirmed) return;
    const instant = uniqueZonedMinuteToUtc(departure, tz);
    const now = Date.now();
    const seconds = Number(estimate) * 60;
    if (!instant ||
      instant.getTime() <= now + 1_800_000 || instant.getTime() > now + 86_400_000 ||
      !/^\d{4}\.\d{1,3}\.\d{1,4}(\.\d{1,4}){0,3}$/.test(version.trim()) ||
      !Number.isInteger(seconds) || seconds < 60 || seconds > 43_200) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSave({ departure_at: instant.toISOString(), version: version.trim(), estimated_duration_s: seconds, checked_ready_unscheduled: confirmed });
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Text as="p" variant="bodySm">{t('softwareUpdates.window.setupHelp', 'Check Controls > Software while parked. Use the update version and a known installation estimate, not the current firmware version or a guess.')}</Text>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input ref={first} type="datetime-local" value={departure} onChange={event => {
          setDeparture(event.target.value);
          setConfirmed(false);
        }}
          required disabled={disabled} label={t('softwareUpdates.window.departure', 'Confirmed departure ({{zone}})', { zone: tz })} />
        <Input value={version} maxLength={29} onChange={event => {
          setVersion(event.target.value);
          setConfirmed(false);
        }} required disabled={disabled} label={t('softwareUpdates.window.version', 'Ready update version')} />
        <Input type="number" step={1} min={1} max={720} value={estimate} onChange={event => {
          setEstimate(event.target.value);
          setConfirmed(false);
        }} required disabled={disabled} label={t('softwareUpdates.window.estimate', 'Known installation estimate (minutes)')} />
      </div>
      <Toggle label={t('softwareUpdates.window.confirm', 'I checked that this update is ready to install, is not already scheduled or installing, and confirmed when I next need the vehicle.')}
        checked={confirmed} disabled={disabled} onChange={setConfirmed} />
      {invalid && <ErrorText role="alert">{t('softwareUpdates.window.invalid', 'Enter a valid software version, a known estimate from 1 to 720 minutes, and a local departure more than 30 minutes and within 24 hours from now. Skipped and repeated clock times are not valid.')}</ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" wrapLabel disabled={disabled || !confirmed}>{t('softwareUpdates.window.save', 'Check this window')}</Button>
        <Button type="button" className="min-h-11" variant="ghost" onClick={onCancel} disabled={disabled}>{t('common.cancel', 'Cancel')}</Button>
      </div>
    </form>
  );
}
