import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { type FavoriteRecording, useFavoriteDigest, useFavoriteDigestChange } from '@/api/hooks/useFavoriteDigest';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, PanelTitle, Text } from '@/components/ui';
import { PrivateReviewTimeZoneForm, PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry';
import { useUnits } from '@/hooks/useUnits';

export function FavoriteDigestPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return <PrivateVehicleReviewPanel anchor="favorite-digest" vehicleId={vehicleId}
    title={t('media.favorites.title', 'Weekly favorites shortlist')}
    description={t('media.favorites.description', 'Opt in to a private weekly shortlist based on repeated playback in this vehicle. Nothing is sent to music services or delivered as a push.')}
    openLabel={t('media.favorites.open', 'Review weekly favorites')}
    vehiclePrompt={t('media.favorites.vehicle', 'Select a vehicle for the weekly shortlist.')}
    signInPrompt={t('media.favorites.signIn', 'Sign in to review music favorites privately.')}>
    {props => <FavoriteDigestDetails key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
  </PrivateVehicleReviewPanel>;
}

function FavoriteDigestDetails({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const { formatDateTime, tz } = useDateFormat('user');
  const { formatDuration } = useUnits();
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useFavoriteDigest(scope, vehicleId);
  const source = useDataState(query);
  const change = useFavoriteDigestChange(scope, vehicleId);
  const [editing, setEditing] = useState(false);
  const [clearRevision, setClearRevision] = useState<number>();
  const [choice, setChoice] = useState<{ recording: FavoriteRecording; until: string; revision: number }>();
  const setupButton = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const review = source.data?.vehicle_id === vehicleId ? source.data : null;
  const { refetch } = query;
  const current = usePrivateReviewExpiry(review?.digest?.expires_at, refetch);
  const digest = current ? review?.digest : undefined;
  const busy = identityPending || source.status !== 'ok' || query.isFetching || change.isPending || !canWrite;

  useEffect(() => {
    if (restore.current && !editing && !busy) {
      setupButton.current?.focus();
      restore.current = false;
    }
  }, [busy, editing]);

  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  if (denied || source.fatalError) return <QueryError error={source.fatalError ?? query.error} onRetry={() => void refetch()} />;
  if (!review) return query.fetchStatus === 'paused'
    ? <Text as="p" variant="bodySm">{t('media.favorites.offline', 'Reconnect to view or change the favorites shortlist.')}</Text> : <Skeleton lines={2} />;

  const active = review.revision > 0;
  const zone = review.time_zone || tz;
  const favorites = review.favorites ?? [];
  const clearLabel = t('media.favorites.clear', 'Turn off and delete local favorites');
  const confirmLabel = t('media.favorites.confirmFavorite', 'Confirm local favorite');
  const sourceNames = {
    spotify: t('media.favorites.spotify', 'Spotify'), youtube_music: t('media.favorites.youtubeMusic', 'YouTube Music'),
    apple_music: t('media.favorites.appleMusic', 'Apple Music'), tidal: t('media.favorites.tidal', 'Tidal'),
    bluetooth: t('media.favorites.bluetooth', 'Bluetooth'), usb: t('media.favorites.usb', 'USB'),
  };
  const describe = (recording: FavoriteRecording) => t('media.favorites.recording', '{{title}} by {{artist}} · {{length}} · {{source}}', {
    title: recording.title, artist: recording.artist, length: formatDuration(recording.duration_s), source: sourceNames[recording.source],
  });
  const apply = (input: Parameters<typeof change.mutate>[0]) => change.mutate(input, { onSuccess: () => {
    if (editing || input.kind === 'confirm' || input.kind === 'remove' || input.kind === 'clear' || input.kind === 'dismiss') {
      restore.current = true;
    }
    setEditing(false);
    setChoice(undefined);
    setClearRevision(undefined);
  } });

  return <div className="space-y-3">
    <StaleRefreshWarning state={source} />
    <Text as="p" role="status" variant="bodySm">{!active
      ? t('media.favorites.off', 'Off. No weekly playback review is scheduled.')
      : !review.next_at
        ? t('media.favorites.paused', 'Paused. Confirmed local favorites are kept, but history is not checked.')
        : digest
          ? t('media.favorites.available', 'Active. A private shortlist is ready to review.')
          : t('media.favorites.waiting', 'Active. No shortlist is available; weak or missing playback evidence stays quiet.')}</Text>
    {review.next_at && <Text as="p" variant="caption">{t('media.favorites.next', 'Next weekly check: {{next}} ({{zone}}).', {
      next: formatDateTime(review.next_at, { tz: zone }), zone,
    })}</Text>}
    {digest && <div className="space-y-2">
      <PanelTitle>{t('media.favorites.candidates', 'Possible favorites')}</PanelTitle>
      <Text as="p" variant="bodySm">{t('media.favorites.why', 'Why this? Repeated playback was observed on separate completed drives. The vehicle cannot identify who chose or heard it. Only confirm recordings you want to keep.')}</Text>
      <Text as="p" variant="caption">{t('media.favorites.coverage', 'Playback observations from {{from}} up to {{until}}. This shortlist expires {{expiry}}.', {
        from: formatDateTime(digest.from, { tz: zone }), until: formatDateTime(digest.until, { tz: zone }),
        expiry: formatDateTime(digest.expires_at, { tz: zone }),
      })}</Text>
      <ul className="space-y-2">
        {(digest.candidates ?? []).map(recording => <li key={recording.key} className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <Text as="p" variant="label">{describe(recording)}</Text>
            <Text as="p" variant="caption">{t('media.favorites.samples', 'Observed in {{drives}} separate drives across {{dates}} dates.', {
              drives: recording.observed_drives, dates: recording.observed_dates,
            })}</Text>
          </div>
          <Button type="button" className="min-h-11" variant="secondary" wrapLabel disabled={busy || favorites.length >= 50}
            aria-label={t('media.favorites.chooseRecording', 'Choose {{title}} as a local favorite', { title: recording.title })}
            onClick={() => setChoice({ recording, until: digest.until, revision: review.revision })}>{confirmLabel}</Button>
        </li>)}
      </ul>
      {favorites.length >= 50 && <Text as="p" variant="caption">{t('media.favorites.full', 'Remove one of the 50 saved favorites before adding another.')}</Text>}
      <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy}
        onClick={() => apply({ kind: 'dismiss', revision: review.revision, digestUntil: digest.until })}>
        {t('media.favorites.dismiss', 'Dismiss this shortlist')}
      </Button>
    </div>}
    {favorites.length > 0 && <div className="space-y-2">
      <PanelTitle>{t('media.favorites.saved', 'Confirmed local favorites')}</PanelTitle>
      <ul className="space-y-2">
        {favorites.map(recording => <li key={recording.key} className="flex flex-wrap items-center justify-between gap-2">
          <Text variant="label" className="min-w-0 [overflow-wrap:anywhere]">{describe(recording)}</Text>
          <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy}
            onClick={() => apply({ kind: 'remove', revision: review.revision, key: recording.key })}>
            {t('media.favorites.remove', 'Remove {{title}}', { title: recording.title })}
          </Button>
        </li>)}
      </ul>
    </div>}
    {change.error && <QueryError error={change.error} />}
    {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
    <div className="flex flex-wrap gap-2">
      <Button ref={setupButton} type="button" className="min-h-11" variant="secondary" wrapLabel disabled={busy}
        aria-expanded={editing} onClick={() => { change.reset(); setEditing(!editing); }}>
        {!active ? t('media.favorites.setup', 'Set up weekly shortlist')
          : !review.next_at ? t('media.favorites.resume', 'Resume weekly shortlist') : t('media.favorites.edit', 'Change shortlist time zone')}
      </Button>
      {review.next_at && !editing && <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy}
        onClick={() => apply({ kind: 'pause', revision: review.revision, zone })}>{t('media.favorites.pause', 'Pause weekly shortlist')}</Button>}
      {active && !editing && <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy}
        onClick={() => setClearRevision(review.revision)}>{clearLabel}</Button>}
    </div>
    {editing && <PrivateReviewTimeZoneForm initialZone={zone} disabled={busy}
      zoneLabel={t('media.favorites.zone', 'Shortlist time zone')}
      zoneHint={t('media.favorites.zoneHelp', 'Use a time zone such as America/New_York or UTC. The previous week is reviewed at 9 AM Monday in that time zone.')}
      consentLabel={t('media.favorites.consent', 'Review local playback from completed drives for this vehicle each week.')}
      confirmLabel={t('media.favorites.enroll', 'Confirm private weekly shortlist')}
      onConfirm={timeZone => apply({ kind: 'enable', revision: review.revision, zone: timeZone })} />}
    {clearRevision != null && <ConfirmDialog open variant="danger" title={clearLabel} confirmLabel={clearLabel}
      message={t('media.favorites.clearDetail', 'Stop weekly checks and delete the shortlist and confirmed local favorites? Source playback history stays unchanged.')}
      loading={change.isPending} confirmDisabled={busy || review.revision !== clearRevision} onCancel={() => setClearRevision(undefined)}
      onConfirm={() => { if (!busy && review.revision === clearRevision) apply({ kind: 'clear', revision: clearRevision }); }} />}
    {choice && <ConfirmDialog open variant="warning" title={confirmLabel} confirmLabel={confirmLabel}
      message={t('media.favorites.chooseDetail', 'Save this recording as your local favorite? TeslaSync does not update a streaming account.')}
      details={<Text as="p" variant="bodySm" className="[overflow-wrap:anywhere]">{describe(choice.recording)}</Text>}
      loading={change.isPending} confirmDisabled={busy || digest?.until !== choice.until || review.revision !== choice.revision}
      onCancel={() => setChoice(undefined)} onConfirm={() => {
        if (!busy && digest?.until === choice.until && review.revision === choice.revision) {
          apply({ kind: 'confirm', revision: choice.revision, key: choice.recording.key, digestUntil: choice.until });
        }
      }} />}
  </div>;
}
