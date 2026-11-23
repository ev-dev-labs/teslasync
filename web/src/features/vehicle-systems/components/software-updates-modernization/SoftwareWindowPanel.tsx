import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useSoftwareWindow, useSoftwareWindowChange } from '@/api/hooks/useSoftwareWindow';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, ErrorText, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import type { SoftwareWindowReason } from '@/types/softwareWindow';
import { SoftwareWindowForm } from './SoftwareWindowForm';

export function SoftwareWindowPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return (
    <PrivateVehicleReviewPanel anchor="software-window-review" vehicleId={vehicleId}
      title={t('softwareUpdates.window.title', 'Private software update window')}
      description={t('softwareUpdates.window.privateOnly', 'Private in-app review. TeslaSync does not send an alert, wake the vehicle, schedule, or start an installation.')}
      openLabel={t('softwareUpdates.window.open', 'Review software update window')}
      vehiclePrompt={t('softwareUpdates.window.select', 'Select a vehicle to check a private update window.')}
      signInPrompt={t('softwareUpdates.window.signIn', 'Sign in to save or read your private update window.')}>
      {props => <SoftwareWindowReview key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
    </PrivateVehicleReviewPanel>
  );
}

function SoftwareWindowReview({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useSoftwareWindow(scope, vehicleId);
  const change = useSoftwareWindowChange(scope, vehicleId);
  const source = useDataState(query);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expired, setExpired] = useState('');
  const edit = useRef<HTMLButtonElement>(null);
  const plan = source.data?.plan;
  const review = plan?.review;
  const until = review?.action_until ?? '';
  const end = Date.parse(until);
  const current = source.status === 'ok' && !identityPending && until !== expired && end > Date.now();
  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  const busy = identityPending || source.status !== 'ok' || query.isFetching || change.isPending || !canWrite;

  useEffect(() => {
    if (!Number.isFinite(end) || end <= Date.now()) return;
    const timer = window.setTimeout(() => setExpired(until), end - Date.now() + 1);
    return () => window.clearTimeout(timer);
  }, [end, until]);

  function closeForm() {
    setEditing(false);
    edit.current?.focus();
  }

  if (denied || source.fatalError) return <QueryError error={source.fatalError ?? query.error} onRetry={() => void query.refetch()} />;
  if (!source.data) return query.fetchStatus === 'paused'
    ? <Text as="p" variant="bodySm">{t('softwareUpdates.window.offline', 'Reconnect to check or edit your private update window.')}</Text>
    : <Skeleton lines={2} />;
  const available = source.data.available;
  const reason = (review && !current ? 'missing_evidence' : plan?.reason) ?? 'off';
  const message: Record<SoftwareWindowReason | 'off', string> = {
    off: t('softwareUpdates.window.off', 'Off. Confirm an update and departure to check a window.'),
    missing_evidence: t('softwareUpdates.window.noEvidence', 'No current recommendation. Recheck the update and confirm your departure again if the details are old.'),
    update_not_ready: t('softwareUpdates.window.conflict', 'Recent vehicle data may conflict with your update check. Review the vehicle’s Software screen.'),
    not_observed_idle: t('softwareUpdates.window.notIdle', 'No current recommendation. Recent observations do not confirm this vehicle is parked, unoccupied, unplugged and out of service mode.'),
    insufficient_margin: t('softwareUpdates.window.short', 'The recorded estimate plus the 30-minute margin does not fit before this departure.'),
    held: plan?.paused ? t('softwareUpdates.window.paused', 'Paused. Confirm the current update and departure to resume.')
      : t('softwareUpdates.window.snoozed', 'Snoozed until {{time}}.', { time: formatDateTime(plan?.snoozed_until ?? '') }),
    expired: t('softwareUpdates.window.expired', 'The confirmed departure has passed.'),
    fits: t('softwareUpdates.window.fits', 'The estimated update fits before your confirmed departure.'),
  };
  const clear = t('softwareUpdates.window.clear', 'Turn off and clear');

  return (
    <div className="space-y-3">
      <StaleRefreshWarning state={source} />
      <Text as="p" variant="bodySm" role="status">{available ? message[reason]
        : t('softwareUpdates.window.unavailable', 'Fresh distributed vehicle telemetry is not available for this review.')}</Text>
      {plan && !editing && <Text as="p" variant="bodySm">{t('softwareUpdates.window.saved', 'Your confirmed departure: {{departure}}. Update {{version}}; estimate {{minutes}} min.', {
        departure: formatDateTime(plan.departure_at), version: plan.version, minutes: plan.estimated_duration_s / 60,
      })}</Text>}
      {review && current && available && <div className="space-y-2">
        <Text as="p" variant="bodySm" weight="semibold">{t('softwareUpdates.window.why', 'Why this window?')}</Text>
        <Text as="p" variant="bodySm">{t('softwareUpdates.window.evidence', 'Observed parked and idle at {{observed}}. You checked the ready update at {{checked}}. This review includes a {{margin}}-minute margin and expires at {{expires}}.', {
          observed: formatDateTime(review.last_idle_observed_at), checked: formatDateTime(review.update_observed_at), margin: review.margin_s / 60, expires: formatDateTime(review.action_until),
        })}</Text>
        <Text as="p" variant="bodySm">{t('softwareUpdates.window.action', 'Recheck Controls > Software in the parked vehicle before deciding. Installation may run longer, prevent driving, and interrupt charging.')}</Text>
      </div>}
      {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
      <div className="flex flex-wrap gap-2">
        {available && <Button ref={edit} type="button" className="min-h-11" variant="secondary" wrapLabel
          aria-expanded={editing} aria-disabled={busy} onClick={() => {
            if (busy) return;
            change.reset();
            setEditing(!editing);
          }}>{plan ? t('softwareUpdates.window.edit', 'Recheck or edit update details') : t('softwareUpdates.window.start', 'Confirm update and departure')}</Button>}
        {plan && !editing && <>
          {available && !plan.paused && plan.reason !== 'expired' && <Button type="button" className="min-h-11"
            variant="ghost" aria-disabled={busy} onClick={() => {
              if (!busy) change.mutate({ id: plan.id, method: 'PATCH', action: 'pause' });
            }}>{t('softwareUpdates.window.pause', 'Pause review')}</Button>}
          {available && current && <Button type="button" className="min-h-11" variant="ghost" aria-disabled={busy}
            onClick={() => {
              if (!busy) change.mutate({ id: plan.id, method: 'PATCH', action: 'snooze' });
            }}>{t('softwareUpdates.window.snooze', 'Snooze 2 minutes')}</Button>}
          <Button type="button" variant="ghost" className="min-h-11" wrapLabel aria-disabled={busy}
            onClick={event => {
              if (busy) return;
              event.currentTarget.focus();
              change.reset();
              setDeleting(true);
            }}>{clear}</Button>
        </>}
      </div>
      {editing && available && <SoftwareWindowForm plan={plan ?? null} disabled={busy} onCancel={closeForm} onSave={setup => {
        if (!busy) change.mutate({ id: plan?.id ?? 0, method: 'PUT', setup }, { onSuccess: closeForm });
      }} />}
      {change.isError && <ErrorText role="alert">{t('softwareUpdates.window.saveFailed', 'The review could not be changed. Verify your sign-in, selected vehicle and current settings before trying again.')}</ErrorText>}
      <ConfirmDialog open={deleting} title={clear} confirmLabel={clear} cancelLabel={t('common.cancel', 'Cancel')}
        message={t('softwareUpdates.window.clearDetail', 'Delete your private update and departure record? This does not change anything on the vehicle.')}
        confirmDisabled={busy} onCancel={() => setDeleting(false)} onConfirm={() => {
          if (busy || !plan) return;
          setDeleting(false);
          change.mutate({ id: plan.id, method: 'DELETE' }, { onSuccess: () => edit.current?.focus() });
        }} />
    </div>
  );
}
