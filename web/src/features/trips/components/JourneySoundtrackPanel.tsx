import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useJourneySoundtrack, useJourneySoundtrackChange } from '@/api/hooks/useJourneySoundtrack';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { safeArray } from '@/lib/safeArray';

type SoundtrackConfirmation = { action: 'confirm'; id: number; startedAt: string; endedAt: string }
  | { action: 'clear'; id: number };

export function JourneySoundtrackPanel({ journeyId, vehicleId }: { journeyId: number; vehicleId: number | null }) {
  const { t } = useTranslation();
  return (
    <PrivateVehicleReviewPanel anchor="journey-soundtrack" vehicleId={vehicleId}
      title={t('journey.soundtrack.title', 'Journey soundtrack')}
      description={t('journey.soundtrack.description', 'Review what actually played on this completed journey. This does not identify a listener, contact a music service or send a notification.')}
      openLabel={t('journey.soundtrack.open', 'Open private soundtrack review')}
      vehiclePrompt={t('journey.soundtrack.vehicle', 'Select this journey’s vehicle to review its soundtrack.')}
      signInPrompt={t('journey.soundtrack.signIn', 'Sign in to review this soundtrack privately.')}>
      {props => <SoundtrackReview key={`${props.scope.subject}:${props.vehicleId}:${journeyId}`} {...props} journeyId={journeyId} />}
    </PrivateVehicleReviewPanel>
  );
}

function SoundtrackReview({ scope, vehicleId, identityPending, journeyId }: PrivateVehicleReviewScope & { journeyId: number }) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat('user');
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useJourneySoundtrack(scope, vehicleId, journeyId);
  const change = useJourneySoundtrackChange(scope, vehicleId, journeyId);
  const source = useDataState(query);
  const review = source.data?.vehicle_id === vehicleId && source.data.journey_id === journeyId ? source.data : null;
  const [dialog, setDialog] = useState<SoundtrackConfirmation | null>(null);
  const [boundary, setBoundary] = useState(0);
  const { refetch } = query;
  const expiry = Date.parse(review?.expires_at ?? '');
  const snooze = Date.parse(review?.snoozed_until ?? '');
  const expired = expiry <= Math.max(boundary, Date.now());
  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  const busy = identityPending || source.status !== 'ok' || query.isFetching || change.isPending || !canWrite;

  useEffect(() => {
    const now = Date.now();
    const next = Math.min(...[expiry, snooze].filter(value => value > now));
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => {
      setBoundary(next);
      void refetch();
    }, next - now + 1);
    return () => window.clearTimeout(timer);
  }, [expiry, snooze, boundary, refetch]);

  if (denied || source.fatalError) return <QueryError error={source.fatalError ?? query.error} onRetry={() => void refetch()} />;
  if (!review) return query.fetchStatus === 'paused'
    ? <Text as="p" variant="bodySm">{t('journey.soundtrack.offline', 'Reconnect to view or change this soundtrack review.')}</Text>
    : <Skeleton lines={2} />;

  const reason = expired ? 'expired' : review.reason;
  const labels = {
    off: t('journey.soundtrack.off', 'Off. Confirm to read playback evidence for this journey.'),
    journey_unmatched: t('journey.soundtrack.unmatched', 'This journey does not have a supported completed time window.'),
    journey_changed: t('journey.soundtrack.changed', 'The journey time window changed. Confirm it again before reviewing playback.'),
    expired: t('journey.soundtrack.expired', 'This review expired. Only recent completed journeys can be reviewed.'),
    held: review.paused ? t('journey.soundtrack.paused', 'Review paused.')
      : t('journey.soundtrack.snoozed', 'Review snoozed until {{time}}.', { time: formatDateTime(review.snoozed_until ?? '') }),
    missing_evidence: t('journey.soundtrack.missing', 'No track could be confirmed inside a matched completed drive. Nothing was substituted.'),
    evidence_limit: t('journey.soundtrack.limit', 'This journey has too much playback data to review safely. No partial track list is shown.'),
    observed: t('journey.soundtrack.coverage', 'Confirmed playback in {{observed}} of {{matched}} matched drives. Tracks are shown in observed order; gaps may remain.', {
      observed: review.observed_drives, matched: review.matched_drives,
    }),
  };
  const confirm = review.id === 0 ? t('journey.soundtrack.enable', 'Enable private review') : t('journey.soundtrack.reconfirm', 'Confirm review again');
  const clear = t('journey.soundtrack.clear', 'Turn off and clear review');
  const canConfirm = reason === 'off' || reason === 'held' || reason === 'journey_changed' ||
    (reason === 'expired' && review.ended_at != null && Date.parse(review.ended_at) + 30 * 24 * 60 * 60 * 1000 > Date.now());
  const dialogUnavailable = busy || dialog?.id !== review.id || (dialog?.action === 'confirm' &&
    (!canConfirm || dialog.startedAt !== review.started_at || dialog.endedAt !== review.ended_at));
  const active = !review.paused && ['observed', 'missing_evidence', 'evidence_limit'].includes(reason);
  const canShowEvidence = source.status === 'ok' && !identityPending && !change.isPending;
  const showPlays = reason === 'observed' && canShowEvidence;
  const hidden = t('media.privateReview.refreshRequired', 'Private playback details are hidden until the current review is verified.');

  return (
    <div className="space-y-3">
      <StaleRefreshWarning state={source} message={hidden} />
      {canShowEvidence && <Text as="p" variant="bodySm" role="status">{labels[reason]}</Text>}
      {reason !== 'journey_unmatched' && review.started_at && review.ended_at && <Text as="p" variant="bodySm">{t('journey.soundtrack.window', 'Completed journey: {{start}} to {{end}}.', {
        start: formatDateTime(review.started_at), end: formatDateTime(review.ended_at),
      })}</Text>}
      {active && review.expires_at && <Text as="p" variant="caption">{t('journey.soundtrack.expires', 'Review ends {{time}}.', { time: formatDateTime(review.expires_at) })}</Text>}
      {showPlays && <ol className="space-y-2" aria-label={t('journey.soundtrack.tracks', 'Observed soundtrack')}>
        {safeArray(review.plays).map(play => (
          <li key={play.identity_at} data-app-part="list-row" className="min-w-0 [overflow-wrap:anywhere]">
            <Text as="p" variant="label">{play.title} · {play.artist}</Text>
            <Text as="p" variant="caption">{t('journey.soundtrack.played', 'Playback observed from {{start}} to {{end}}.', {
              start: formatDateTime(play.observed_from), end: formatDateTime(play.last_observed_at),
            })}</Text>
          </li>
        ))}
      </ol>}
      {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
      {change.error && <QueryError error={change.error} />}
      <div className="flex flex-wrap gap-2">
        {canConfirm && <Button type="button" className="min-h-11" variant="secondary" wrapLabel disabled={busy} onClick={() => {
          if (review.started_at && review.ended_at) {
            setDialog({ action: 'confirm', id: review.id, startedAt: review.started_at, endedAt: review.ended_at });
          }
        }}>{confirm}</Button>}
        {active && <>
          <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy} onClick={() => change.mutate({ action: 'pause', id: review.id })}>
            {t('journey.soundtrack.pause', 'Pause review')}
          </Button>
          <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy} onClick={() => change.mutate({ action: 'snooze', id: review.id })}>
            {t('journey.soundtrack.snooze', 'Snooze review for one day')}
          </Button>
        </>}
        {review.id > 0 && <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy} onClick={() => setDialog({ action: 'clear', id: review.id })}>{clear}</Button>}
      </div>
      <ConfirmDialog open={dialog != null} title={dialog?.action === 'clear' ? clear : confirm}
        variant={dialog?.action === 'clear' ? 'danger' : 'warning'}
        message={dialog?.action === 'clear'
          ? t('journey.soundtrack.clearDetail', 'Delete your review preference? The underlying drive and media history stays unchanged.')
          : t('journey.soundtrack.enableDetail', 'Read recorded media from matched drives in this exact journey and display supported tracks privately? Nothing leaves TeslaSync.')}
        details={dialog?.action === 'confirm' ? <Text as="p" variant="bodySm">{t('journey.soundtrack.window', 'Completed journey: {{start}} to {{end}}.', {
          start: formatDateTime(dialog.startedAt), end: formatDateTime(dialog.endedAt),
        })}</Text> : undefined}
        confirmLabel={dialog?.action === 'clear' ? clear : confirm}
        confirmDisabled={dialogUnavailable}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialogUnavailable || dialog == null) return;
          change.mutate(dialog);
          setDialog(null);
        }} />
    </div>
  );
}
