import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGeofencesFull } from '@/api/hooks/useLocations';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ErrorText, Select, Text, Toggle } from '@/components/ui';
import type { PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { refreshPersonalDeliveryWorker } from '@/lib/personalPush';
import type { ParkedUnlockPlan, ParkedUnlockSetup } from '@/types/parkedUnlock';
import { ReminderBrowserStatus } from './ReminderBrowserStatus';
import { useReminderBrowser } from './useReminderBrowser';

interface Props {
  scope: PrivateVehicleReviewScope['scope'];
  plan: ParkedUnlockPlan | null;
  disabled: boolean;
  onSave: (setup: ParkedUnlockSetup) => Promise<void>;
  onCancel: () => void;
}

export function ParkedUnlockForm({ scope, plan, disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  const places = useGeofencesFull();
  const state = useDataState(places);
  const candidates = (state.data ?? []).filter(place => place.enabled && !place.needs_review && !place.archived_at);
  const [picked, setPicked] = useState<{ id: number; revision: string } | null>(plan?.place_ready
    ? { id: plan.place_id, revision: plan.place_revision } : null);
  const selected = picked && candidates.find(place => place.id === picked.id && place.updated_at === picked.revision);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const browser = useReminderBrowser(scope);
  const locked = disabled || saving;
  const canSave = !locked && confirmed && selected && browser.id != null &&
    state.status === 'ok' && !places.isFetching;
  const field = useRef<HTMLSelectElement>(null);
  useEffect(() => { field.current?.focus(); }, [state.hasData]);
  const pushTitle = t('admin.security.parkedUnlock.pushTitle', 'Check your parked vehicle');
  const pushBody = t('admin.security.parkedUnlock.pushBody', 'The vehicle was observed unlocked while parked. If safe, check it in person.');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave || !selected || browser.id == null) return;
    setSaving(true);
    setFailed(false);
    try {
      await refreshPersonalDeliveryWorker();
      await onSave({ place_id: selected.id, place_revision: selected.updated_at, confirmed, device_id: browser.id,
        push_title: pushTitle, push_body: pushBody });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return <form className="space-y-3" onSubmit={(event) => void submit(event)}>
    {state.fatalError ? <QueryError error={state.fatalError} onRetry={() => void places.refetch()} />
      : !state.hasData ? <Skeleton lines={2} /> : <>
        <StaleRefreshWarning state={state} />
        {candidates.length === 0 ? <Text as="p" variant="bodySm">
          <Link to="/geofences" className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2">
            {t('admin.security.parkedUnlock.addPlace', 'Create or review a saved place first')}
          </Link>
        </Text> : <Select ref={field} label={t('admin.security.parkedUnlock.place', 'Saved place to monitor')}
          options={[{ value: '', label: t('admin.security.parkedUnlock.choosePlace', 'Choose a saved place') },
            ...candidates.map(place => ({ value: String(place.id), label: place.name }))]}
          value={selected ? String(selected.id) : ''} disabled={locked} onChange={(event) => {
            const place = candidates.find(row => String(row.id) === event.target.value);
            setPicked(place ? { id: place.id, revision: place.updated_at } : null);
            setConfirmed(false);
          }} />}
      </>}
    <Toggle checked={confirmed && !!selected} disabled={locked || !selected} onChange={setConfirmed}
      label={t('admin.security.parkedUnlock.consent', 'Monitor this vehicle at the selected saved place and send reminders to this verified browser. Location stays in TeslaSync.')} />
    <Text as="p" variant="bodySm">{t('admin.security.parkedClosure.preview', 'Preview: “{{title}}.” Only an opaque code goes through your browser’s push service. Your signed-in browser fetches the reminder from TeslaSync.', { title: pushTitle })}</Text>
    <ReminderBrowserStatus {...browser} />
    {failed && <ErrorText role="alert">{t('admin.security.parkedUnlock.saveFailed', 'The reminder was not saved. Check the saved place and verified browser, then try again.')}</ErrorText>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" className="min-h-11" wrapLabel disabled={!canSave}>{t('admin.security.parkedUnlock.enable', 'Enable private unlock reminders')}</Button>
      <Button type="button" className="min-h-11" variant="ghost" onClick={onCancel} disabled={locked}>{t('common.cancel', 'Cancel')}</Button>
    </div>
  </form>;
}
