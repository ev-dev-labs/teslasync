import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ErrorText, Select, Text, Toggle } from '@/components/ui';
import type { PrivateVehicleReviewScope } from '@/components/vehicles';
import { refreshPersonalDeliveryWorker } from '@/lib/personalPush';
import type { ParkedClosureSetup } from '@/types/parkedClosure';
import { ReminderBrowserStatus } from './ReminderBrowserStatus';
import { useReminderBrowser } from './useReminderBrowser';

interface Props {
  scope: PrivateVehicleReviewScope['scope'];
  initialGrace?: number;
  disabled: boolean;
  onSave: (setup: ParkedClosureSetup) => Promise<void>;
  onCancel: () => void;
}

export function ParkedClosureForm({ scope, initialGrace, disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  const [grace, setGrace] = useState(String(initialGrace ?? 600));
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const browser = useReminderBrowser(scope);
  const deviceId = browser.id;
  const locked = disabled || saving;
  const secondsField = useRef<HTMLSelectElement>(null);
  useEffect(() => { secondsField.current?.focus(); }, []);
  const canSave = !locked && confirmed && deviceId != null;
  const intervals = [300, 600, 900, 1200].map(seconds => ({
    value: String(seconds), label: t('admin.security.parkedClosure.minutes', '{{count}} minutes', { count: seconds / 60 }),
  }));
  const pushTitle = t('admin.security.parkedClosure.pushTitle', 'Check your parked vehicle');
  const pushBody = t('admin.security.parkedClosure.pushBody', 'A door or trunk was observed open. If safe, check it in person.');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave || deviceId == null) return;
    setSaving(true);
    setFailed(false);
    try {
      await refreshPersonalDeliveryWorker();
      await onSave({ grace_s: Number(grace), confirmed, device_id: deviceId, push_title: pushTitle, push_body: pushBody });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return <form className="space-y-3" onSubmit={(event) => void submit(event)}>
    <Select ref={secondsField} label={t('admin.security.parkedClosure.grace', 'Wait after observing an open door or trunk')}
      options={intervals} disabled={locked} value={grace} onChange={(event) => setGrace(event.target.value)} />
    <Toggle checked={confirmed} disabled={locked} onChange={setConfirmed}
      label={t('admin.security.parkedClosure.consent', 'Check this vehicle’s parking and closure telemetry and send reminders to this verified browser.')} />
    <Text as="p" variant="bodySm">
      {t('admin.security.parkedClosure.preview', 'Preview: “{{title}}.” Only an opaque code goes through your browser’s push service. Your signed-in browser fetches the reminder from TeslaSync.', { title: pushTitle })}
    </Text>
    <ReminderBrowserStatus {...browser} />
    {failed && <ErrorText role="alert">{t('admin.security.parkedClosure.saveFailed', 'The reminder was not saved. Check that this browser is verified and try again.')}</ErrorText>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" className="min-h-11" wrapLabel disabled={!canSave}>{t('admin.security.parkedClosure.enable', 'Enable private closure reminders')}</Button>
      <Button type="button" className="min-h-11" variant="ghost" onClick={onCancel} disabled={locked}>{t('common.cancel', 'Cancel')}</Button>
    </div>
  </form>;
}
