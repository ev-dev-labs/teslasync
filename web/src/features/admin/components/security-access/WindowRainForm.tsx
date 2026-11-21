import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCurrentPersonalDevice } from '@/api/hooks/usePersonalDelivery';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ErrorText, Select, Text, Toggle } from '@/components/ui';
import type { PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { usePersonalBrowser } from '@/hooks/usePersonalBrowser';
import { refreshPersonalDeliveryWorker } from '@/lib/personalPush';
import type { WindowRainSetup } from '@/types/windowRain';

interface Props {
  scope: PrivateVehicleReviewScope['scope'];
  disabled: boolean;
  onSave: (setup: WindowRainSetup) => Promise<void>;
  onCancel: () => void;
}

export function WindowRainForm({ scope, disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  const [duration, setDuration] = useState('3600');
  const [outdoor, setOutdoor] = useState(false);
  const [share, setShare] = useState(false);
  const [terms, setTerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const browser = usePersonalBrowser();
  const device = useCurrentPersonalDevice(scope, browser.subscription?.endpoint ?? null, browser.generation, true);
  const deviceState = useDataState(device);
  const deviceId = browser.status === 'ready' && deviceState.status === 'ok' && !device.isFetching && device.data?.verified
    ? device.data.id : null;
  const locked = disabled || saving;
  const durationField = useRef<HTMLSelectElement>(null);
  useEffect(() => { durationField.current?.focus(); }, []);
  const canSave = !locked && outdoor && share && terms && deviceId != null;
  const durations = [
    { value: '1800', label: t('admin.security.windowRain.halfHour', '30 minutes') },
    { value: '3600', label: t('admin.security.windowRain.oneHour', '1 hour') },
    { value: '7200', label: t('admin.security.windowRain.twoHours', '2 hours') },
    { value: '14400', label: t('admin.security.windowRain.fourHours', '4 hours') },
  ];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave || deviceId == null) return;
    setSaving(true);
    setFailed(false);
    try {
      await refreshPersonalDeliveryWorker();
      await onSave({
        duration_s: Number(duration), device_id: deviceId, outdoor_confirmed: outdoor,
        forecast_consent: share, free_terms_apply: terms,
        push_title: t('admin.security.windowRain.pushTitle', 'Check your parked vehicle’s window'),
        push_body: t('admin.security.windowRain.pushBody', 'A window was open and rain was forecast nearby. If safe, check the window in person.'),
      });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return <form className="space-y-3" onSubmit={(event) => void submit(event)}>
    <Select ref={durationField} label={t('admin.security.windowRain.duration', 'Maximum watch duration')} options={durations}
      disabled={locked} value={duration} onChange={(event) => setDuration(event.target.value)} />
    <Toggle checked={outdoor} disabled={locked} onChange={setOutdoor}
      label={t('admin.security.windowRain.outdoor', 'This vehicle is parked outdoors now, not in a garage or under cover.')} />
    <Toggle checked={share} disabled={locked} onChange={setShare}
      label={t('admin.security.windowRain.share', 'Allow Open-Meteo to receive this parked location rounded to two decimal places. No vehicle ID or trip history is sent.')} />
    <Toggle checked={terms} disabled={locked} onChange={setTerms}
      label={t('admin.security.windowRain.terms', 'This watch is for personal, non-commercial use under Open-Meteo’s free API terms.')} />
    <a className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2"
      href="https://open-meteo.com/en/terms" rel="noreferrer" target="_blank">
      {t('admin.security.windowRain.providerTerms', 'Open-Meteo terms and attribution')}
    </a>
    <Text as="p" variant="bodySm">
      {t('admin.security.windowRain.preview', 'Preview: “Check your parked vehicle’s window.” Only an opaque code goes through your browser’s push service. Your signed-in browser fetches the reminder from TeslaSync.')}
    </Text>
    {browser.status === 'error'
      ? <Button type="button" variant="secondary" onClick={browser.retry}>{t('admin.security.windowRain.retryBrowser', 'Retry browser verification check')}</Button>
      : deviceState.fatalError ? <QueryError error={deviceState.fatalError} onRetry={() => void device.refetch()} />
        : browser.status === 'checking' || device.isLoading ? <Skeleton lines={2} />
          : <div className="space-y-1">
            <StaleRefreshWarning state={deviceState} />
            <Text as="p" variant="bodySm">{deviceId != null
              ? t('admin.security.windowRain.browserReady', 'This browser is verified for personal delivery.')
              : <Link to="/settings/smart-charging" className="text-theme-accent underline underline-offset-2">
                {t('admin.security.windowRain.verifyBrowser', 'Verify this browser in personal delivery settings')}
              </Link>}
            </Text>
          </div>}
    {failed && <ErrorText role="alert">{t('admin.security.windowRain.saveFailed', 'The watch was not saved. Check that the selected vehicle is still parked outdoors and this browser is verified, then try again.')}</ErrorText>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" className="min-h-11" wrapLabel disabled={!canSave}>{t('admin.security.windowRain.start', 'Confirm watch and enable push')}</Button>
      <Button type="button" className="min-h-11" variant="ghost" onClick={onCancel} disabled={locked}>{t('common.cancel', 'Cancel')}</Button>
    </div>
  </form>;
}
