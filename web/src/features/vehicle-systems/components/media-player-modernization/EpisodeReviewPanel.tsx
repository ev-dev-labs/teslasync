import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useEpisodeReview, useEpisodeReviewChange } from '@/api/hooks/useEpisodeReview';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { BUTTON_BASE, BUTTON_VARIANTS, Button, ConfirmDialog, ErrorText, Input, Select, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useUnits } from '@/hooks/useUnits';
import { cn } from '@/lib/cn';
import { spotifyAuthorizationTarget } from '@/lib/spotifyAuthorization';
import { SpotifyEpisodePlayer } from './SpotifyEpisodePlayer';

function bounded(value: string, low: number, high: number): number | undefined {
  const n = Number(value);
  return value.trim() !== '' && Number.isInteger(n) && n >= low && n <= high ? n : undefined;
}

export function EpisodeReviewPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return <PrivateVehicleReviewPanel anchor="episode-review" vehicleId={vehicleId}
    title={t('media.episode.title', 'Episode for your next drive')}
    description={t('media.episode.description', 'Check whether the known time remaining in one episode fits your estimated drive. Nothing is sent as a notification.')}
    openLabel={t('media.episode.open', 'Open private episode review')}
    vehiclePrompt={t('media.episode.vehicle', 'Select a vehicle to review an upcoming drive.')}
    signInPrompt={t('media.episode.signIn', 'Sign in to review an episode privately.')}>
    {props => <EpisodeReview key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
  </PrivateVehicleReviewPanel>;
}

function EpisodeReview({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const { search } = useLocation();
  const { formatDuration } = useUnits();
  const { formatDateTime } = useDateFormat();
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useEpisodeReview(scope, vehicleId);
  const source = useDataState(query);
  const change = useEpisodeReviewChange(scope, vehicleId);
  const review = source.data?.vehicle_id === vehicleId ? source.data : null;
  const [mode, setMode] = useState('manual');
  const [lead, setLead] = useState('');
  const [drive, setDrive] = useState('');
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('');
  const [position, setPosition] = useState('');
  const [link, setLink] = useState('');
  const [clear, setClear] = useState<number>();
  const [redirectFailed, setRedirectFailed] = useState(false);
  const [boundary, setBoundary] = useState(0);
  const expiry = Date.parse(review?.expires_at ?? '');
  const expired = expiry <= Math.max(boundary, Date.now());
  const { refetch } = query;

  useEffect(() => {
    const now = Date.now();
    if (!Number.isFinite(expiry) || expiry <= now) return;
    const timer = window.setTimeout(() => { setBoundary(expiry); void refetch(); }, expiry - now + 1);
    return () => window.clearTimeout(timer);
  }, [expiry, refetch]);

  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  if (denied) return <ErrorText>{t('media.episode.denied', 'This private episode review is no longer available for the current sign-in or vehicle.')}</ErrorText>;
  if (source.fatalError) return <QueryError error={source.fatalError} onRetry={() => void refetch()} />;
  if (!review) return query.fetchStatus === 'paused'
    ? <Text as="p" variant="bodySm">{t('media.episode.offline', 'Reconnect to view or change this episode review.')}</Text>
    : <Skeleton lines={2} />;

  const leadMinutes = bounded(lead, 1, 1440);
  const driveMinutes = bounded(drive, 5, 360);
  const durationS = bounded(duration, 1, 86400);
  const positionS = bounded(position, 0, durationS ?? 0);
  const busy = identityPending || source.status !== 'ok' || query.isFetching || change.isPending || !canWrite;
  const manualValid = Boolean(title.trim()) && durationS != null && (position.trim() === '' || positionS != null);
  const valid = leadMinutes != null && driveMinutes != null &&
    (mode === 'manual' ? manualValid : review.spotify_available && Boolean(link.trim()));
  const reason = expired ? 'expired' : review.reason;
  const spotifyId = reason === 'fits'
    ? /^https:\/\/open\.spotify\.com\/episode\/([A-Za-z0-9]{22})$/.exec(review.spotify_episode ?? '')?.[1]
    : undefined;
  const startS = review.spotify_start_s;
  const canShowEvidence = source.status === 'ok' && !identityPending && !change.isPending;
  const spotifyFailure = new URLSearchParams(search).get('spotify_episode') === 'not-reviewed' && reason === 'awaiting_progress';
  const reasonText = {
    off: t('media.episode.off', 'Off. Confirm a drive and one episode to check the fit.'),
    expired: t('media.episode.expired', 'This review expired. Confirm a new drive to check again.'),
    awaiting_progress: t('media.episode.awaiting', 'No authorized progress has been received.'),
    held: t('settings.smartFeatures.reviewPaused', 'This review is paused in Smart Features.'),
    drive_unmatched: t('media.episode.unmatched', 'This upcoming drive estimate is not usable.'),
    unknown_progress: t('media.episode.unknown', 'Playback progress is unknown. A fit was not assumed.'),
    completed: t('media.episode.completed', 'This episode is already complete.'),
    not_fit: t('media.episode.notFit', 'The remaining episode is longer than this drive estimate.'),
    fits: t('media.episode.fits', 'The remaining episode fits the estimated drive.'),
  };
  const clearLabel = t('media.episode.clear', 'Turn off and clear episode review');

  async function verifyPlayerLoad() {
    if (busy || !review || review.id <= 0 || !spotifyId || startS == null) return false;
    const { data: current, isSuccess } = await refetch();
    return isSuccess && current?.vehicle_id === vehicleId && current.id === review.id && current.reason === 'fits' &&
      current.spotify_episode === review.spotify_episode && current.spotify_start_s === startS &&
      Date.parse(current.expires_at ?? '') > Date.now();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!review || busy || !valid || leadMinutes == null || driveMinutes == null) return;
    setRedirectFailed(false);
    change.mutate({ action: 'confirm', payload: {
      expected_review_id: review.id, confirmed: true, departure_at: new Date(Date.now() + leadMinutes * 60_000).toISOString(),
      drive_duration_s: driveMinutes * 60, spotify_episode: mode === 'spotify' ? link : '',
      manual: mode === 'manual' && durationS != null ? { title, duration_s: durationS, position_s: positionS ?? null } : null,
    } }, { onSuccess: target => {
      if (mode !== 'spotify') return;
      const safe = spotifyAuthorizationTarget(target ?? undefined, 'user-read-playback-position');
      if (safe) window.location.assign(safe);
      else setRedirectFailed(true);
    } });
  }

  return <div className="space-y-3">
    <StaleRefreshWarning state={source} message={t('media.privateReview.refreshRequired', 'Private playback details are hidden until the current review is verified.')} />
    {canShowEvidence && <Text as="p" variant="bodySm" role="status">{reasonText[reason]}</Text>}
    {canShowEvidence && reason !== 'expired' && review.title && <Text as="p" variant="label" className="[overflow-wrap:anywhere]">{review.title}</Text>}
    {reason !== 'expired' && review.departure_at && review.drive_duration_s != null && <Text as="p" variant="caption">
      {t('media.episode.driveTiming', 'Estimated departure {{departure}}; drive length {{length}}.', {
        departure: formatDateTime(review.departure_at), length: formatDuration(review.drive_duration_s),
      })}
    </Text>}
    {canShowEvidence && reason !== 'expired' && review.remaining_s != null && <Text as="p" variant="bodySm">
      {t('media.episode.remaining', '{{length}} remaining as reported during this review.', { length: formatDuration(review.remaining_s) })}
    </Text>}
    {spotifyId && !busy &&
      <a href={review.spotify_episode} target="_blank" rel="noopener noreferrer"
        className={cn(BUTTON_BASE, BUTTON_VARIANTS.secondary, 'min-h-11 px-4 py-2')}>
        {t('media.episode.spotifyLink', 'Open episode in Spotify')}
      </a>}
    {spotifyId && startS != null && Number.isInteger(startS) && startS >= 0 && startS < 86400 &&
      canShowEvidence && canWrite &&
      <SpotifyEpisodePlayer key={`${review.id}:${spotifyId}:${startS}`} uri={`spotify:episode:${spotifyId}`}
        positionS={startS} disabled={busy} verifyLoad={verifyPlayerLoad} />}
    {(spotifyFailure || redirectFailed) && <ErrorText>{t('media.episode.authFailed', 'Spotify did not return authorized episode progress. No playback was started.')}</ErrorText>}
    {change.error && <QueryError error={change.error} />}
    {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
    <form className="space-y-2" onSubmit={submit}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input required type="number" min={1} max={1440} step={1} value={lead} onChange={e => setLead(e.target.value)}
          label={t('media.episode.lead', 'Minutes until departure')} />
        <Input required type="number" min={5} max={360} step={1} value={drive} onChange={e => setDrive(e.target.value)}
          label={t('media.episode.drive', 'Estimated drive length (minutes)')} />
      </div>
      <Select label={t('media.episode.source', 'Episode progress source')} value={mode} onChange={event => setMode(event.target.value)} options={[
        { value: 'manual', label: t('media.episode.manual', 'Enter known progress manually') },
        { value: 'spotify', label: t('media.episode.provider', 'Read progress from Spotify'), disabled: !review.spotify_available },
      ]} />
      {mode === 'manual' ? <>
        <Input required maxLength={256} value={title} onChange={e => setTitle(e.target.value)}
          label={t('media.episode.name', 'Episode title')} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input required type="number" min={1} max={86400} step={1} value={duration} onChange={e => setDuration(e.target.value)}
            label={t('media.episode.length', 'Episode duration (seconds)')} />
          <Input type="number" min={0} step={1} max={durationS} value={position} onChange={e => setPosition(e.target.value)}
            label={t('media.episode.position', 'Known position (seconds)')}
            hint={t('media.episode.positionHint', 'Leave blank if unknown. Enter 0 only for a known unplayed episode.')} />
        </div>
      </> : <Input required type="url" maxLength={512} value={link} onChange={e => setLink(e.target.value)}
        label={t('media.episode.link', 'Exact Spotify episode link')}
        hint={t('media.episode.providerHint', 'Authorize one read for this episode. TeslaSync sends its ID, not your drive details, and does not start playback.')} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" variant="secondary" wrapLabel disabled={!valid || busy}>
          {mode === 'manual' ? t('media.episode.confirm', 'Confirm drive and check fit') : t('media.episode.authorize', 'Confirm drive and authorize progress read')}
        </Button>
        {review.id > 0 && <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy}
          onClick={() => setClear(review.id)}>{clearLabel}</Button>}
      </div>
    </form>
    {clear != null && <ConfirmDialog open variant="danger" title={clearLabel} confirmLabel={clearLabel} confirmDisabled={busy || clear !== review.id}
      message={t('media.episode.clearDetail', 'Clear the local progress snapshot and cancel pending authorization? Spotify history does not change.')}
      onCancel={() => setClear(undefined)} onConfirm={() => {
        if (busy || clear !== review.id) return;
        setClear(undefined);
        change.mutate({ action: 'clear', id: clear });
      }} />}
  </div>;
}
