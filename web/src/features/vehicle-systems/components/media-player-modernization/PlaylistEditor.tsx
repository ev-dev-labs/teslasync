import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, Input, Select, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import type { PlaylistCandidate, PlaylistDraft, SavePrivatePlaylist } from '@/types/privatePlaylist';

export interface PlaylistInputs {
  links: Record<number, string>;
  name: string;
}

interface Props {
  draft: PlaylistDraft;
  disabled: boolean;
  connected: boolean;
  initialSelection: PlaylistCandidate[] | undefined;
  onOrderChange: (draftId: number, revision: string, positions: number[]) => void;
  inputs: PlaylistInputs;
  onInputsChange: (inputs: PlaylistInputs) => void;
  onSave: (selection: SavePrivatePlaylist) => void;
}

export function PlaylistEditor({ draft, disabled, connected, initialSelection, onOrderChange, inputs, onInputsChange, onSave }: Props) {
  const { t } = useTranslation();
  const { formatDuration } = useUnits();
  const { formatDateTime } = useDateFormat('user');
  const options = draft.candidates ?? [];
  const [selected, setSelected] = useState(() => initialSelection ?? options.filter(option => option.suggested));
  const { links, name } = inputs;
  const [add, setAdd] = useState('');
  const [confirming, setConfirming] = useState(false);
  const addedTrack = useRef<HTMLSelectElement>(null);
  const selectedLength = selected.reduce((total, option) => total + option.duration_s, 0);
  const tolerance = Math.max(120, Math.floor(draft.target_duration_s / 10));
  const fits = selected.length > 0 && Math.abs(selectedLength - draft.target_duration_s) <= tolerance;
  const alternatives = options.filter(option => !selected.some(current => current.position === option.position));
  const linksComplete = selected.every(option => /^https:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]{22}(?:\?[^#]*)?$/.test(links[option.position]?.trim() ?? ''));
  const ready = connected && fits && linksComplete && name.trim() !== '' && !disabled;
  const saveLabel = t('media.playlist.save', 'Save private playlist');
  const trackLabel = (track: PlaylistCandidate) => t('media.playlist.track', '{{title}} by {{artist}}', { title: track.title, artist: track.artist });

  useEffect(() => onOrderChange(draft.id, draft.created_at, selected.map(track => track.position)),
    [draft.id, draft.created_at, onOrderChange, selected]);

  function move(index: number, offset: number) {
    const next = index + offset;
    if (disabled || next < 0 || next >= selected.length) return;
    setSelected(current => {
      const updated = [...current];
      [updated[index], updated[next]] = [updated[next]!, updated[index]!];
      return updated;
    });
  }

  function addTrack() {
    const option = alternatives.find(candidate => String(candidate.position) === add);
    if (!option || disabled) return;
    setSelected(current => [...current, option]);
    setAdd('');
  }

  function removeTrack(option: PlaylistCandidate) {
    if (disabled) return;
    setSelected(current => current.filter(track => track.position !== option.position));
    requestAnimationFrame(() => addedTrack.current?.focus());
  }

  function openConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ready) setConfirming(true);
  }

  return (
    <form className="space-y-3" onSubmit={openConfirmation}>
      <Text as="p" variant="bodySm" weight="semibold">{t('media.playlist.why', 'Why this playlist?')}</Text>
      <Text as="p" variant="bodySm">{t('media.playlist.whyDetail', 'The selected tracks were observed playing on this vehicle. Their reported lengths approximate your drive; they do not prove anyone’s preferences.')}</Text>
      <Text as="p" variant="bodySm" role="status">{t('media.playlist.total', 'Edited length: {{total}}. Drive estimate: {{target}}. Allowed difference: {{margin}}.', {
        total: formatDuration(selectedLength), target: formatDuration(draft.target_duration_s), margin: formatDuration(tolerance),
      })}</Text>
      {!fits && <Text as="p" variant="bodySm">{t('media.playlist.notFit', 'Adjust the selected tracks to fit the drive length before saving.')}</Text>}
      <ol className="list-decimal space-y-3 ps-6">
        {selected.map((track, index) => <li key={track.position} className="min-w-0 space-y-2 break-words">
          <Text as="p" variant="bodySm" weight="semibold">{trackLabel(track)}</Text>
          <Text as="p" variant="bodySm">{t('media.playlist.trackObserved', 'Reported length: {{duration}}. Observed playing at {{time}}.', {
            duration: formatDuration(track.duration_s), time: formatDateTime(track.observed_at),
          })}</Text>
          {connected && <Input type="url" maxLength={512} value={links[track.position] ?? ''} disabled={disabled} required
            label={t('media.playlist.link', 'Spotify track link for {{title}}', { title: track.title })}
            onChange={event => onInputsChange({ name, links: { ...links, [track.position]: event.target.value } })} />}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" className="min-h-11" disabled={disabled || index === 0}
              onClick={() => move(index, -1)} aria-label={t('media.playlist.moveUpTrack', 'Move {{title}} up', { title: track.title })}>
              {t('media.playlist.moveUp', 'Move up')}
            </Button>
            <Button type="button" variant="ghost" className="min-h-11" disabled={disabled || index === selected.length - 1}
              onClick={() => move(index, 1)} aria-label={t('media.playlist.moveDownTrack', 'Move {{title}} down', { title: track.title })}>
              {t('media.playlist.moveDown', 'Move down')}
            </Button>
            <Button type="button" variant="ghost" className="min-h-11" disabled={disabled} onClick={() => removeTrack(track)}
              aria-label={t('media.playlist.removeTrack', 'Remove {{title}}', { title: track.title })}>{t('common.remove', 'Remove')}</Button>
          </div>
        </li>)}
      </ol>
      {alternatives.length > 0 && <div className="flex flex-wrap items-end gap-2">
        <Select ref={addedTrack} label={t('media.playlist.alternative', 'Observed tracks to add')}
          placeholder={t('media.playlist.chooseTrack', 'Choose a track')} options={alternatives.map(track => ({
            value: String(track.position), label: trackLabel(track),
          }))} value={add} onChange={event => setAdd(event.target.value)} disabled={disabled} className="max-w-full" />
        <Button type="button" variant="secondary" className="min-h-11" onClick={addTrack} disabled={disabled || add === ''}>
          {t('media.playlist.add', 'Add track')}
        </Button>
      </div>}
      {connected && <>
        <Text as="p" variant="bodySm">{t('media.playlist.linkHelp', 'Paste each exact track’s open.spotify.com link. TeslaSync checks the title, artist and duration before saving. Keep locations and other sensitive details out of the playlist name.')}</Text>
        <Input value={name} onChange={event => onInputsChange({ links, name: event.target.value })} maxLength={100} required
          disabled={disabled} label={t('media.playlist.name', 'Playlist name')} />
        <Button type="submit" className="min-h-11" disabled={!ready}>{saveLabel}</Button>
      </>}
      <ConfirmDialog open={confirming} title={saveLabel} confirmLabel={saveLabel} cancelLabel={t('common.cancel', 'Cancel')}
        message={t('media.playlist.saveConfirm', 'Send the playlist name and selected track IDs to Spotify and create a private playlist? This will not play music or send anything to the car.')}
        confirmDisabled={!ready} onCancel={() => setConfirming(false)} onConfirm={() => {
          if (!ready) return;
          setConfirming(false);
          onSave({
            name: name.trim(), confirmed: true,
            selection: selected.map(track => ({ position: track.position, spotify_track_link: links[track.position]?.trim() ?? '' })),
          });
        }} />
    </form>
  );
}
