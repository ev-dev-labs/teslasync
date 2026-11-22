import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ErrorText, Input, Toggle } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { toZonedDatetimeStr, zonedWallTimeToUtc } from '@/lib/dateConvert';
import type { PlaylistDraft, PlaylistSetup } from '@/types/privatePlaylist';

interface Props {
  draft: PlaylistDraft | null;
  disabled: boolean;
  onCancel: () => void;
  onPreview: (setup: PlaylistSetup) => void;
}

export function PlaylistSetupForm({ draft, disabled, onCancel, onPreview }: Props) {
  const { t } = useTranslation();
  const { tz } = useDateFormat('user');
  const first = useRef<HTMLInputElement>(null);
  const [departure, setDeparture] = useState(draft && Date.parse(draft.departure_at) > Date.now()
    ? toZonedDatetimeStr(new Date(draft.departure_at), tz) : '');
  const [length, setLength] = useState(draft ? String(draft.target_duration_s / 60) : '');
  const [confirmed, setConfirmed] = useState(false);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { first.current?.focus(); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || disabled) return;
    const instant = zonedWallTimeToUtc(departure, tz);
    const now = Date.now();
    const seconds = Number(length) * 60;
    if (!instant || toZonedDatetimeStr(instant, tz) !== departure || instant.getTime() <= now ||
      instant.getTime() > now + 86_400_000 || !Number.isInteger(seconds) || seconds < 300 || seconds > 21_600) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onPreview({ departure_at: instant.toISOString(), target_duration_s: seconds, confirmed });
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input ref={first} type="datetime-local" value={departure} required disabled={disabled}
          label={t('media.playlist.departure', 'Confirmed departure ({{zone}})', { zone: tz })}
          onChange={event => { setDeparture(event.target.value); setConfirmed(false); }} />
        <Input type="number" step={1} min={5} max={360} value={length} required disabled={disabled}
          label={t('media.playlist.driveLength', 'Estimated drive length (minutes)')}
          onChange={event => { setLength(event.target.value); setConfirmed(false); }} />
      </div>
      <Toggle label={t('media.playlist.confirmDrive', 'I confirmed this drive and allow TeslaSync to use this vehicle’s last seven days of observed Spotify playback. This can include other listeners.')}
        checked={confirmed} disabled={disabled} onChange={setConfirmed} />
      {invalid && <ErrorText role="alert">{t('media.playlist.invalidDrive', 'Choose an existing local departure time in the next 24 hours and a drive length from 5 to 360 minutes.')}</ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={disabled || !confirmed}>{t('media.playlist.build', 'Build local preview')}</Button>
        <Button type="button" className="min-h-11" variant="ghost" disabled={disabled} onClick={onCancel}>{t('common.cancel', 'Cancel')}</Button>
      </div>
    </form>
  );
}
