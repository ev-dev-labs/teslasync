import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useDriveTrackChange, useDriveTrackReview } from '@/api/hooks/useDriveTrackReview';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, ErrorText, Input, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { spotifyAuthorizationTarget } from '@/lib/spotifyAuthorization';

type ConfirmAction = { action: 'connect' | 'disconnect' | 'clear'; id: number }
  | { action: 'save'; id: number; link: string; evidence: string };

export function DriveTrackPanel({ driveId, vehicleId }: { driveId: number; vehicleId: number }) {
  const { t } = useTranslation();
  return (
    <PrivateVehicleReviewPanel anchor="drive-track-review" vehicleId={vehicleId}
      title={t('driveDetail.trackReview.title', 'What was playing?')}
      description={t('driveDetail.trackReview.description', 'Look up one moment in this drive using locally recorded playback. No listening history is shared or sent as a notification.')}
      openLabel={t('driveDetail.trackReview.open', 'Open private track lookup')}
      vehiclePrompt={t('driveDetail.trackReview.vehicle', 'Open a completed drive to look up a track.')}
      signInPrompt={t('driveDetail.trackReview.signIn', 'Sign in to look up this track privately.')}>
      {props => <DriveTrackReview key={`${props.scope.subject}:${props.vehicleId}:${driveId}`} {...props} driveId={driveId} />}
    </PrivateVehicleReviewPanel>
  );
}

function DriveTrackReview({ scope, vehicleId, identityPending, driveId }: PrivateVehicleReviewScope & { driveId: number }) {
  const { t } = useTranslation();
  const { search } = useLocation();
  const { formatDateTime } = useDateFormat('user');
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useDriveTrackReview(scope, vehicleId, driveId);
  const change = useDriveTrackChange(scope, vehicleId, driveId);
  const source = useDataState(query);
  const review = source.data?.vehicle_id === vehicleId && source.data.drive_id === driveId ? source.data : null;
  const [offset, setOffset] = useState('');
  const [link, setLink] = useState('');
  const [dialog, setDialog] = useState<ConfirmAction | null>(null);
  const [redirectFailed, setRedirectFailed] = useState(false);
  const [boundary, setBoundary] = useState(0);
  const expires = Date.parse(review?.expires_at ?? '');
  const { refetch } = query;
  const expired = expires <= Math.max(boundary, Date.now());
  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  const busy = identityPending || source.status !== 'ok' || query.isFetching || change.isPending || !canWrite;

  useEffect(() => {
    const now = Date.now();
    if (!Number.isFinite(expires) || expires <= now) return;
    const timer = window.setTimeout(() => {
      setBoundary(expires);
      void refetch();
    }, expires - now + 1);
    return () => window.clearTimeout(timer);
  }, [expires, refetch]);

  if (denied) return <ErrorText>{t('driveDetail.trackReview.denied', 'This private lookup is no longer available for the current sign-in or vehicle.')}</ErrorText>;
  if (source.fatalError) return <QueryError error={source.fatalError} onRetry={() => void refetch()} />;
  if (!review) return query.fetchStatus === 'paused'
    ? <Text as="p" variant="bodySm">{t('driveDetail.trackReview.offline', 'Reconnect to view or change this track lookup.')}</Text>
    : <Skeleton lines={2} />;

  const reason = expired ? 'expired' : review.reason;
  const canShowEvidence = source.status === 'ok' && !identityPending && !change.isPending;
  const track = reason === 'observed' && canShowEvidence ? review.track : null;
  const hidden = t('media.privateReview.refreshRequired', 'Private playback details are hidden until the current review is verified.');
  const maximum = Math.ceil((Date.parse(review.ended_at ?? '') - Date.parse(review.started_at)) / 1000) - 1;
  const position = Number(offset);
  const validOffset = offset.trim() !== '' && Number.isInteger(position) && position >= 0 && position <= maximum;
  const connectionFailed = new URLSearchParams(search).get('spotify_library') === 'not-connected';
  const stillSaving = review.save_status === 'saving';
  const canSave = track?.source === 'spotify' && typeof track.duration_s === 'number' && review.library_available &&
    review.save_status === 'review' && Boolean(review.evidence_key);
  const labels = {
    off: t('driveDetail.trackReview.off', 'Off. Choose a moment to look up a track.'),
    drive_unmatched: t('driveDetail.trackReview.unmatched', 'This time cannot be attributed to one supported completed drive.'),
    held: t('settings.smartFeatures.reviewPaused', 'This review is paused in Smart Features.'),
    drive_changed: t('driveDetail.trackReview.changed', 'The drive timestamps changed. Choose the time again.'),
    expired: t('driveDetail.trackReview.expired', 'This private lookup expired. Select a time to look it up again.'),
    missing_evidence: t('driveDetail.trackReview.missing', 'No track could be confirmed at that time. Nearby tracks were not substituted.'),
    evidence_limit: t('driveDetail.trackReview.limit', 'There was too much playback data to verify this moment.'),
    observed: t('driveDetail.trackReview.observed', 'Recorded playback matched this time.'),
  };
  const status = review.save_status && {
    review: null,
    saving: t('driveDetail.trackReview.saving', 'Spotify save is in progress. Do not retry.'),
    saved: t('driveDetail.trackReview.saved', 'Spotify confirmed the track was saved to your library.'),
    rejected: t('driveDetail.trackReview.rejected', 'Spotify rejected the save.'),
    unknown: t('driveDetail.trackReview.unknown', 'Spotify did not confirm the save. Check your library before trying again; TeslaSync will not retry.'),
  }[review.save_status];
  const actions = {
    connect: [t('driveDetail.trackReview.connect', 'Authorize Spotify library'),
      t('driveDetail.trackReview.connectDetail', 'Authorize saving one matching track to your personal Spotify library. This permission is separate from playlists and does not start playback.')],
    disconnect: [t('driveDetail.trackReview.disconnect', 'Disconnect Spotify library'),
      t('driveDetail.trackReview.disconnectDetail', 'Remove the library authorization for this review. A track already saved stays in Spotify.')],
    clear: [t('driveDetail.trackReview.clear', 'Turn off and clear lookup'),
      t('driveDetail.trackReview.clearDetail', 'Clear the private lookup, save outcome and authorization without deleting source history or any saved track?')],
    save: [t('driveDetail.trackReview.save', 'Save track to Spotify library'),
      t('driveDetail.trackReview.saveDetail', 'Send the selected track ID to Spotify, verify the recording, and add it to your personal library if it matches? This will not play music.')],
  } as const;
  const selectedAction = dialog && actions[dialog.action];
  const dialogUnavailable = busy || dialog?.id !== review.id ||
    (dialog?.action === 'connect' && !canSave) || (dialog?.action === 'save' &&
      (!canSave || !review.library_connected || dialog.evidence !== review.evidence_key));
  const trackMismatch = isApiError(change.error) && change.error.code === 'SPOTIFY_TRACK_UNVERIFIED';

  function submitPosition(event: FormEvent) {
    event.preventDefault();
    if (!review?.ended_at || busy || stillSaving || !validOffset) return;
    setLink('');
    setRedirectFailed(false);
    change.mutate({ action: 'look-up', id: review.id, offset: position, startedAt: review.started_at, endedAt: review.ended_at });
  }

  return (
    <div className="space-y-3">
      <StaleRefreshWarning state={source} message={hidden} />
      {canShowEvidence && <Text as="p" variant="bodySm" role="status">{labels[reason]}</Text>}
      {review.ended_at && Number.isFinite(maximum) && maximum >= 0 && maximum < 86400 && (
        <form className="space-y-2" onSubmit={submitPosition}>
          <Text as="p" variant="caption">{t('driveDetail.trackReview.window', 'Drive from {{start}} to {{end}}.', {
            start: formatDateTime(review.started_at), end: formatDateTime(review.ended_at),
          })}</Text>
          <Input type="number" min={0} max={maximum} step={1} required value={offset}
            label={t('driveDetail.trackReview.offset', 'Seconds after the start of this drive')}
            onChange={event => setOffset(event.target.value)} />
          <Button type="submit" className="min-h-11" variant="secondary" wrapLabel disabled={!validOffset || busy || stillSaving}>
            {t('driveDetail.trackReview.lookup', 'Look up this time')}
          </Button>
        </form>
      )}
      {track && <div className="space-y-1">
        <Text as="p" variant="label" className="[overflow-wrap:anywhere]">{track.title} · {track.artist}</Text>
        <Text as="p" variant="caption">{t('driveDetail.trackReview.evidence', 'Selected time {{selected}}. Playback observed from {{start}} to {{end}}.', {
          selected: formatDateTime(review.selected_at ?? ''), start: formatDateTime(track.observed_from), end: formatDateTime(track.last_observed_at),
        })}</Text>
      </div>}
      {canShowEvidence && status && <Text as="p" variant="bodySm" role="status">{status}</Text>}
      {track && review.save_status === 'review' && !canSave && <Text as="p" variant="bodySm">
        {t('driveDetail.trackReview.localOnly', 'Library save needs a supported Spotify recording with known duration and a configured connector. The lookup stays local.')}
      </Text>}
      {track && review.library_connected && <Text as="p" variant="bodySm">
        {t('driveDetail.trackReview.connected', 'Spotify library authorization is active for this lookup.')}
      </Text>}
      {canSave && review.library_connected && <Input label={t('driveDetail.trackReview.link', 'Exact Spotify track link')}
        type="url" maxLength={512} value={link} onChange={event => setLink(event.target.value)} />}
      {(redirectFailed || (connectionFailed && !review.library_connected)) && <ErrorText>
        {t('driveDetail.trackReview.connectionFailed', 'Spotify library authorization was not completed. No track was saved.')}
      </ErrorText>}
      {trackMismatch ? <ErrorText>{t('driveDetail.trackReview.mismatch', 'The Spotify link could not be matched to the observed recording. Nothing was saved.')}</ErrorText>
        : change.error ? <QueryError error={change.error} /> : null}
      {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
      <div className="flex flex-wrap gap-2">
        {canSave && !review.library_connected && <Button type="button" className="min-h-11" variant="secondary" wrapLabel disabled={busy}
          onClick={() => setDialog({ action: 'connect', id: review.id })}>{actions.connect[0]}</Button>}
        {canSave && review.library_connected && <Button type="button" className="min-h-11" variant="secondary" wrapLabel disabled={busy || !link.trim()}
          onClick={() => { if (review.evidence_key) setDialog({ action: 'save', id: review.id, link, evidence: review.evidence_key }); }}>
          {actions.save[0]}
        </Button>}
        {canShowEvidence && review.library_connected && <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy}
          onClick={() => setDialog({ action: 'disconnect', id: review.id })}>{actions.disconnect[0]}</Button>}
        {review.id > 0 && <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy || stillSaving}
          onClick={() => setDialog({ action: 'clear', id: review.id })}>{actions.clear[0]}</Button>}
      </div>
      {selectedAction && <ConfirmDialog open title={selectedAction[0]} message={selectedAction[1]}
        variant={dialog?.action === 'clear' ? 'danger' : 'warning'} confirmLabel={selectedAction[0]} confirmDisabled={dialogUnavailable}
        onCancel={() => setDialog(null)} onConfirm={() => {
          if (dialogUnavailable || dialog == null) return;
          setDialog(null);
          setRedirectFailed(false);
          change.mutate(dialog, { onSuccess: reply => {
            if (dialog.action !== 'connect') return;
            const target = spotifyAuthorizationTarget(reply?.authorization_url, 'user-library-modify');
            if (target) window.location.assign(target);
            else setRedirectFailed(true);
          } });
        }} />}
    </div>
  );
}
