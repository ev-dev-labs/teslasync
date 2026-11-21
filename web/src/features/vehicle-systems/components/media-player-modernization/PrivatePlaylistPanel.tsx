import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { isApiError } from '@/api/client';
import { usePrivatePlaylist, usePrivatePlaylistChange } from '@/api/hooks/usePrivatePlaylist';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, ErrorText, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { spotifyAuthorizationTarget } from '@/lib/spotifyAuthorization';
import { PlaylistEditor, type PlaylistInputs } from './PlaylistEditor';
import { forgetPlaylistReturnOrder, keepPlaylistReturnOrder, restorePlaylistReturnOrder, selectionForPositions } from './playlistReturnOrder';
import { PlaylistSetupForm } from './PlaylistSetupForm';

type ConfirmAction = 'connect' | 'disconnect' | 'clear';
const EMPTY_INPUTS: PlaylistInputs = { links: {}, name: '' };

export function PrivatePlaylistPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return (
    <PrivateVehicleReviewPanel anchor="playlist-review" vehicleId={vehicleId}
      title={t('media.playlist.title', 'Private drive playlist')}
      description={t('media.playlist.description', 'Preview a drive-length playlist locally. No listening history or track selections leave TeslaSync during preview.')}
      openLabel={t('media.playlist.open', 'Review drive playlist')}
      vehiclePrompt={t('media.playlist.selectVehicle', 'Select a vehicle to review a playlist for your next drive.')}
      signInPrompt={t('media.playlist.signIn', 'Sign in to use your private drive playlist review.')}>
      {props => <PlaylistReview key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
    </PrivateVehicleReviewPanel>
  );
}

function PlaylistReview({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const { search } = useLocation();
  const { formatDateTime } = useDateFormat('user');
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = usePrivatePlaylist(scope, vehicleId);
  const change = usePrivatePlaylistChange(scope, vehicleId);
  const source = useDataState(query);
  const draft = source.data?.draft?.vehicle_id === vehicleId ? source.data.draft : null;
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const [redirectFailed, setRedirectFailed] = useState(false);
  const [clock, markBoundary] = useState<number>();
  const edit = useRef<HTMLButtonElement>(null);
  const [editedOrder, setEditedOrder] = useState<{ draftId: number; revision: string; positions: number[] } | null>(null);
  const [pendingInputs, setPendingInputs] = useState<{ draftKey: string; values: PlaylistInputs } | null>(null);
  const draftKey = draft ? `${draft.id}:${draft.created_at}` : '';
  const expiration = Date.parse(draft?.expires_at ?? '');
  const snooze = Date.parse(draft?.snoozed_until ?? '');
  const time = Math.max(Date.now(), clock ?? 0);
  const expired = !Number.isFinite(expiration) || expiration <= time;
  const snoozed = snooze > time;
  const connected = source.data?.spotify_connected === true;
  const available = source.data?.spotify_available === true;
  const preview = draft?.status === 'preview';
  const active = preview && !draft?.paused && !expired && !snoozed;
  const hasTracks = (draft?.candidates?.length ?? 0) > 0;
  const returning = new URLSearchParams(search).get('spotify');
  const changingReview = change.isPending && (change.variables?.action === 'clear' ||
    change.variables?.action === 'pause' || change.variables?.action === 'snooze' || change.variables?.action === 'preview' ||
    change.variables?.action === 'disconnect');
  const canShowEvidence = source.status === 'ok' && !identityPending && !changingReview;
  const busy = identityPending || source.status !== 'ok' || query.isFetching || change.isPending || !canWrite;
  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');

  useEffect(() => {
    const now = Date.now();
    const next = Math.min(...[expiration, snooze].filter(value => value > now));
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => markBoundary(next), next - now + 1);
    return () => window.clearTimeout(timer);
  }, [expiration, snooze, clock]);

  useEffect(() => {
    if (returning && canShowEvidence && !query.isFetching) forgetPlaylistReturnOrder();
  }, [returning, canShowEvidence, query.isFetching]);

  useEffect(() => {
    if (denied || (canShowEvidence && (!active || !connected || pendingInputs?.draftKey !== draftKey))) {
      setPendingInputs(null);
    }
  }, [active, canShowEvidence, connected, denied, draftKey, pendingInputs?.draftKey]);

  const captureOrder = useCallback((draftId: number, revision: string, positions: number[]) => {
    setEditedOrder({ draftId, revision, positions });
  }, []);

  function closeForm() {
    setEditing(false);
    edit.current?.focus();
  }

  function ask(action: ConfirmAction) {
    if (busy) return;
    setRedirectFailed(false);
    change.reset();
    setConfirmation(action);
  }

  function confirm() {
    if (busy || confirmation == null) return;
    setConfirmation(null);
    if (confirmation === 'clear' && draft) {
      setEditedOrder(null);
      setPendingInputs(null);
      forgetPlaylistReturnOrder();
      change.mutate({ action: 'clear', id: draft.id }, { onSuccess: () => edit.current?.focus() });
    } else if (confirmation === 'disconnect') {
      setEditedOrder(null);
      setPendingInputs(null);
      forgetPlaylistReturnOrder();
      change.mutate({ action: 'disconnect' });
    } else if (confirmation === 'connect') {
      change.mutate({ action: 'connect' }, { onSuccess: reply => {
        const target = spotifyAuthorizationTarget(reply?.authorization_url, 'playlist-modify-private');
        if (target) {
          forgetPlaylistReturnOrder();
          if (draft && editedOrder?.draftId === draft.id && editedOrder.revision === draft.created_at) {
            keepPlaylistReturnOrder(draft, editedOrder.positions);
          }
          window.location.assign(target);
          return;
        }
        setRedirectFailed(true);
      } });
    }
  }

  if (denied || source.fatalError) return <QueryError error={source.fatalError ?? query.error} onRetry={() => void query.refetch()} />;
  if (!source.data) return query.fetchStatus === 'paused'
    ? <Text as="p" variant="bodySm">{t('media.playlist.offline', 'Reconnect to view or change this playlist review.')}</Text>
    : <Skeleton lines={2} />;

  const connect = t('media.playlist.connect', 'Connect Spotify for private playlists');
  const disconnect = t('media.playlist.disconnect', 'Disconnect Spotify');
  const clear = t('media.playlist.clear', 'Turn off and clear preview');
  const confirmations = {
    connect: {
      label: connect,
      detail: t('media.playlist.connectDetail', 'Authorize Spotify to create private playlists on your account. The connection expires within an hour. Authorization alone does not save tracks or start playback.'),
    },
    disconnect: {
      label: disconnect,
      detail: t('media.playlist.disconnectDetail', 'Remove TeslaSync’s saved permission and any pending sign-in. This does not remove any playlists from Spotify. You can also remove app access in your Spotify account.'),
    },
    clear: {
      label: clear,
      detail: t('media.playlist.clearDetail', 'Delete this local preview and save outcome? This does not delete vehicle history, disconnect Spotify or remove a playlist there.'),
    },
  };
  const statusText = draft == null ? t('media.playlist.off', 'Off. Confirm a drive to build a private preview.') : {
    preview: draft.paused ? t('media.playlist.paused', 'Paused. Confirm a drive to resume.')
      : expired ? t('media.playlist.expired', 'The confirmed departure has passed. No playlist can be saved from this preview.')
      : snoozed ? t('media.playlist.snoozed', 'Snoozed until {{time}}.', { time: formatDateTime(draft.snoozed_until ?? '') })
      : hasTracks ? t('media.playlist.ready', 'Local preview ready. Edit the tracks before saving.')
      : t('media.playlist.noEvidence', 'No supported tracks with enough observed playback and known duration fit this drive. No suggestions were invented.'),
    saving: t('media.playlist.saving', 'Spotify save is in progress. Do not retry.'),
    saved: t('media.playlist.saved', 'Spotify confirmed creation of your private playlist and its tracks.'),
    rejected: t('media.playlist.rejected', 'Spotify rejected creation of the playlist. No tracks were sent.'),
    created_only: t('media.playlist.createdOnly', 'Spotify created a private playlist, but its tracks were not added. Check your Spotify library before making another playlist.'),
    unknown: draft.playlist_id
      ? t('media.playlist.itemsUnknown', 'Spotify confirmed creation of your private playlist but did not confirm adding the tracks. Check the playlist before trying again. TeslaSync will not retry it.')
      : t('media.playlist.unknown', 'Spotify did not confirm creating the playlist. No tracks were sent. Check your Spotify library before trying again. TeslaSync will not retry it.'),
  }[draft.status];
  const matchError = isApiError(change.error) && change.error.code === 'SPOTIFY_TRACK_UNVERIFIED';
  const connectError = isApiError(change.error) && change.error.code === 'SPOTIFY_CONNECT';
  const selectedConfirmation = confirmation == null ? null : confirmations[confirmation];
  const hidden = t('media.privateReview.refreshRequired', 'Private playback details are hidden until the current review is verified.');
  const selection = draft && canShowEvidence && active && hasTracks && !editing
    ? editedOrder?.draftId === draft.id && editedOrder.revision === draft.created_at
      ? selectionForPositions(draft, editedOrder.positions)
      : returning === 'connected' && connected ? restorePlaylistReturnOrder(draft) : undefined
    : undefined;

  return (
    <div className="space-y-3">
      <StaleRefreshWarning state={source} message={hidden} />
      {canShowEvidence && <Text as="p" variant="bodySm" role="status">{statusText}</Text>}
      {canShowEvidence && draft && <Text as="p" variant="bodySm">{t('media.playlist.savedDeparture', 'Confirmed departure: {{time}}. This review is only for the selected vehicle.', {
        time: formatDateTime(draft.departure_at),
      })}</Text>}
      {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
      {!available && <Text as="p" variant="bodySm">{t('media.playlist.unavailable', 'You can preview locally. A Spotify connector with secure storage is not configured.')}</Text>}
      {connected && canShowEvidence && <Text as="p" variant="bodySm">{t('media.playlist.connected', 'Spotify private playlist authorization is active.')}</Text>}
      <div className="flex flex-wrap gap-2">
        {(!draft || preview) && <Button ref={edit} type="button" className="min-h-11" variant="secondary" wrapLabel
          aria-expanded={editing} aria-disabled={busy} onClick={() => {
            if (busy) return;
            change.reset();
            setEditing(!editing);
          }}>{draft ? t('media.playlist.editDrive', 'Confirm or edit drive details') : t('media.playlist.setup', 'Confirm an upcoming drive')}</Button>}
        {active && draft && !editing && <>
          <Button type="button" className="min-h-11" variant="ghost" disabled={busy}
            onClick={() => change.mutate({ action: 'pause', id: draft.id })}>{t('media.playlist.pause', 'Pause review')}</Button>
          <Button type="button" className="min-h-11" variant="ghost" disabled={busy}
            onClick={() => change.mutate({ action: 'snooze', id: draft.id })}>{t('media.playlist.snooze', 'Snooze 15 minutes')}</Button>
        </>}
        {draft && draft.status !== 'saving' && !editing && <Button type="button" className="min-h-11" variant="ghost" wrapLabel
          disabled={busy} onClick={() => ask('clear')}>{clear}</Button>}
        {canShowEvidence && (connected
          ? <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy} onClick={() => ask('disconnect')}>{disconnect}</Button>
          : available && active && hasTracks && !editing && <Button type="button" className="min-h-11" variant="secondary" wrapLabel
            disabled={busy} onClick={() => ask('connect')}>{connect}</Button>)}
      </div>
      {editing && <PlaylistSetupForm draft={draft ?? null} disabled={busy} onCancel={closeForm} onPreview={setup => {
        if (!busy) change.mutate({ action: 'preview', id: draft?.id ?? 0, setup }, { onSuccess: closeForm });
      }} />}
      {draft && canShowEvidence && active && hasTracks && !editing && <PlaylistEditor key={draftKey} draft={draft} disabled={busy}
        connected={connected} onOrderChange={captureOrder}
        initialSelection={selection}
        inputs={connected && pendingInputs?.draftKey === draftKey ? pendingInputs.values : EMPTY_INPUTS}
        onInputsChange={values => { if (!busy && connected) setPendingInputs({ draftKey, values }); }}
        onSave={selection => {
          if (!busy) change.mutate({ action: 'save', id: draft.id, selection });
        }} />}
      {(change.isError || redirectFailed) && <ErrorText role="alert">{matchError
        ? t('media.playlist.matchError', 'At least one link could not be matched to the observed recording. Check the links and your Spotify access. No playlist was created.')
        : connectError || redirectFailed ? t('media.playlist.connectError', 'Spotify authorization is unavailable or expired. Check your connection before saving.')
        : t('media.playlist.changeError', 'The action was not confirmed. Refresh this review and check the recorded outcome before trying again.')}</ErrorText>}
      {selectedConfirmation && <ConfirmDialog open title={selectedConfirmation.label} confirmLabel={selectedConfirmation.label}
        message={selectedConfirmation.detail} cancelLabel={t('common.cancel', 'Cancel')} confirmDisabled={busy}
        onCancel={() => setConfirmation(null)} onConfirm={confirm} />}
    </div>
  );
}
