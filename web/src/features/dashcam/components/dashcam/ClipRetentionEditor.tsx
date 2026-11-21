import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DateTime } from '@/components/data-display';
import { Button, ErrorText, Input, PanelTitle, Text, Toggle } from '@/components/ui';
import { isoUtcToLocalDatetimeInput } from '@/lib/dateConvert';
import { browserTimezone } from '@/lib/timezone';
import { retentionDeadline, retentionStatus, RETENTION_SNOOZE_MS, type ClipRetention } from '../../lib/clipRetention';
import type { RetentionAction } from '../../hooks/useClipRetention';

interface Props {
  name: string;
  plan: ClipRetention | null;
  now: number;
  checking: boolean;
  disabled: boolean;
  onAction: (action: RetentionAction | { deadline: string }) => Promise<boolean>;
}

export function ClipRetentionEditor({ name, plan, now, checking, disabled, onAction }: Props) {
  const { t } = useTranslation();
  const field = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [badDeadline, setBadDeadline] = useState(false);
  const status = plan ? retentionStatus(plan, now) : 'off';
  const zone = browserTimezone();
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);

  function closeEditor() {
    setEditing(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || disabled) return;
    const deadline = retentionDeadline(value, zone, Date.now());
    if (!deadline) { setBadDeadline(true); field.current?.focus(); return; }
    if (await onAction({ deadline })) closeEditor();
  }

  if (checking) return null;

  return <div className="space-y-2 border-t border-[var(--panel-border)] pt-3">
    <PanelTitle>{t('dashcam.retention.selected', 'Selected clip')}</PanelTitle>
    <Text as="p" variant="bodySm" className="break-all">{name}</Text>
    <Text as="p" variant="bodySm" role="status">
      {status === 'off' ? t('dashcam.retention.off', 'Off: no confirmed deadline.')
        : status === 'expired' ? t('dashcam.retention.expired', 'The recorded deadline has passed. This does not tell us whether the source clip still exists.')
        : status === 'paused' ? t('dashcam.retention.paused', 'Paused.')
        : status === 'copy_confirmed' ? t('dashcam.retention.copyConfirmed', 'You marked a copy as saved.')
        : status === 'snoozed' ? t('dashcam.retention.snoozed', 'Snoozed for one hour.')
        : status === 'due' ? t('dashcam.retention.due', 'Review now: the recorded deadline is within 24 hours.')
        : t('dashcam.retention.watching', 'Active: review will appear in the final 24 hours.')}
      {plan && <> <DateTime value={plan.deadline} /> ({zone})</>}
    </Text>
    {status === 'due' && <Text as="p" variant="bodySm">
      {t('dashcam.retention.downloadWarning', 'Download copies the original, unredacted video to this device. Review it before sharing; nothing is sent automatically.')}
    </Text>}
    {editing ? <form onSubmit={(event) => void submit(event)} className="space-y-3">
      <Input ref={field} type="datetime-local" value={value} required disabled={disabled}
        label={t('dashcam.retention.deadlineInput', 'Known retention deadline ({{zone}})', { zone })}
        onChange={(event) => { setValue(event.target.value); setBadDeadline(false); setConfirmed(false); }} />
      {badDeadline && <ErrorText role="alert">{t('dashcam.retention.invalidTime', 'Enter a future time that occurs once in the shown time zone. Skipped and repeated clock times are not valid.')}</ErrorText>}
      <Toggle checked={confirmed} onChange={setConfirmed} disabled={disabled}
        label={t('dashcam.retention.confirm', 'I know this is the source clip’s deadline. Keep a private reminder in this browser.')}/>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={disabled || !confirmed || !value}>
          {t('dashcam.retention.save', 'Save deadline')}
        </Button>
        <Button type="button" className="min-h-11" variant="ghost" disabled={disabled} onClick={closeEditor}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </form> : <div className="flex flex-wrap gap-2">
      <Button ref={trigger} type="button" variant="secondary" className="min-h-11" disabled={disabled}
        onClick={() => { setValue(isoUtcToLocalDatetimeInput(plan?.deadline)); setConfirmed(false); setBadDeadline(false); setEditing(true); }}>
        {plan ? t('dashcam.retention.edit', 'Edit deadline') : t('dashcam.retention.set', 'Record known deadline')}
      </Button>
      {plan && <>
        {status === 'due' && <>
          <Button type="button" className="min-h-11" wrapLabel disabled={disabled} onClick={() => void onAction('download')}>
            {t('dashcam.retention.download', 'Download original clip')}
          </Button>
          <Button type="button" variant="secondary" className="min-h-11" disabled={disabled} onClick={() => void onAction('copy_confirmed')}>
            {t('dashcam.retention.copied', 'I saved a copy')}
          </Button>
          {Date.parse(plan.deadline) > now + RETENTION_SNOOZE_MS &&
            <Button type="button" variant="secondary" className="min-h-11" disabled={disabled} onClick={() => void onAction('snooze')}>
              {t('dashcam.retention.snooze', 'Snooze one hour')}
            </Button>}
        </>}
        {(status === 'active' || status === 'due' || status === 'snoozed') &&
          <Button type="button" variant="secondary" className="min-h-11" disabled={disabled} onClick={() => void onAction('pause')}>
            {t('dashcam.retention.pause', 'Pause reminder')}
          </Button>}
        {(status === 'paused' || status === 'snoozed' || status === 'copy_confirmed') &&
          <Button type="button" variant="secondary" className="min-h-11" disabled={disabled} onClick={() => void onAction('resume')}>
            {t('dashcam.retention.resume', 'Resume reminder')}
          </Button>}
        <Button type="button" variant="ghost" className="min-h-11" disabled={disabled} onClick={() => void onAction('clear')}>
          {t('dashcam.retention.clear', 'Clear reminder')}
        </Button>
      </>}
    </div>}
  </div>;
}
