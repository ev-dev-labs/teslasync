import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCurrentPersonalDevice } from '@/api/hooks/usePersonalDelivery';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ErrorText, Input, Text, Toggle } from '@/components/ui';
import type { PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePersonalBrowser } from '@/hooks/usePersonalBrowser';
import { toZonedDatetimeStr, zonedWallTimeToUtc } from '@/lib/dateConvert';
import { refreshPersonalDeliveryWorker } from '@/lib/personalPush';
import type { ParkReservePlan, ParkReserveSetup } from '@/types/parkReserve';

interface Props {
  scope: PrivateVehicleReviewScope['scope'];
  plan: ParkReservePlan | null;
  pushAvailable: boolean;
  disabled: boolean;
  onSave: (setup: ParkReserveSetup) => Promise<void>;
  onCancel: () => void;
}

export function ParkReserveForm({ scope, plan, pushAvailable, disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  const { tz } = useDateFormat('user');
  const [returns, setReturns] = useState(plan && Date.parse(plan.return_at) - Date.now() >= 12 * 3_600_000
    ? toZonedDatetimeStr(new Date(plan.return_at), tz) : '');
  const [reserve, setReserve] = useState(String(plan?.reserve_pct ?? 25));
  const [confirmed, setConfirmed] = useState(false);
  const [push, setPush] = useState(pushAvailable && plan?.push_device_id != null);
  const [notice, setNotice] = useState<'invalid' | 'failed' | null>(null);
  const [saving, setSaving] = useState(false);
  const browser = usePersonalBrowser();
  const device = useCurrentPersonalDevice(scope, browser.subscription?.endpoint ?? null, browser.generation, push && pushAvailable);
  const deviceState = useDataState(device);
  const deviceId = browser.status === 'ready' && deviceState.status === 'ok' && !device.isFetching && device.data?.verified
    ? device.data.id : null;
  const locked = disabled || saving;
  const returnInput = useRef<HTMLInputElement>(null);

  useEffect(() => { returnInput.current?.focus(); }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed || locked || (push && (!pushAvailable || deviceId == null))) return;
    const instant = zonedWallTimeToUtc(returns, tz);
    const hours = instant ? (instant.getTime() - Date.now()) / 3_600_000 : 0;
    const percent = Number(reserve);
    if (!instant || hours < 12 || hours > 7 * 24 || !Number.isFinite(percent) || percent < 5 || percent > 90) {
      setNotice('invalid');
      return;
    }
    setNotice(null);
    setSaving(true);
    try {
      const setup: ParkReserveSetup = { return_at: instant.toISOString(), reserve_pct: percent };
      if (push && deviceId != null) {
        await refreshPersonalDeliveryWorker();
        setup.push_device_id = deviceId;
        setup.push_title = t('vampireDrain.parkReserve.pushTitle', 'Review your parked charge reserve');
        setup.push_body = t('vampireDrain.parkReserve.pushBody', 'Your estimated return charge could fall below your reserve. Review the range while you can still adjust your plans.');
      }
      await onSave(setup);
    } catch {
      setNotice('failed');
    } finally {
      setSaving(false);
    }
  };

  return <form className="space-y-3" onSubmit={(event) => void submit(event)}>
    <Text as="p" variant="bodySm">
      {t('vampireDrain.parkReserve.setupHelp', 'Choose a return 12 hours to 7 days away. TeslaSync checks while you can still act, for up to 90 minutes after saving.')}
    </Text>
    <div className="grid gap-3 sm:grid-cols-2">
      <Input ref={returnInput} type="datetime-local" value={returns} onChange={(event) => setReturns(event.target.value)}
        required disabled={locked} label={t('vampireDrain.parkReserve.returnInput', 'Planned return ({{zone}})', { zone: tz })} />
      <Input type="number" step="any" min={5} max={90} value={reserve} onChange={(event) => setReserve(event.target.value)}
        required disabled={locked} label={t('vampireDrain.parkReserve.reserveInput', 'Minimum return charge (%)')} />
    </div>
    <Toggle checked={confirmed} disabled={locked} onChange={setConfirmed}
      label={t('vampireDrain.parkReserve.confirm', 'The vehicle is parked and unplugged, and I can still adjust my plans. Check this vehicle’s local history.')} />
    {pushAvailable && <Toggle checked={push} disabled={locked} onChange={setPush}
      label={t('vampireDrain.parkReserve.electPush', 'Send one private reminder to this verified browser if the estimate crosses my reserve.')} />}
    {pushAvailable && push && <div className="space-y-2">
      <Text as="p" variant="bodySm">{t('vampireDrain.parkReserve.pushPrivacy', 'Only an opaque code goes through your browser’s push service. Your signed-in browser fetches the reminder from TeslaSync.')}</Text>
      {browser.status === 'error'
        ? <Button type="button" variant="secondary" onClick={browser.retry}>{t('vampireDrain.parkReserve.retryBrowser', 'Retry browser verification check')}</Button>
        : deviceState.fatalError ? <QueryError error={deviceState.fatalError} onRetry={() => void device.refetch()} />
          : browser.status === 'checking' || device.isLoading ? <Skeleton lines={2} />
            : <>
              <StaleRefreshWarning state={deviceState} />
              <Text as="p" variant="bodySm">{deviceId != null
                ? t('vampireDrain.parkReserve.browserReady', 'This browser is verified for personal delivery.')
                : <Link to="/settings/smart-charging" className="text-theme-accent underline underline-offset-2">
                  {t('vampireDrain.parkReserve.verifyBrowser', 'Verify this browser in personal delivery settings')}
                </Link>}
              </Text>
            </>}
    </div>}
    {notice && <ErrorText role="alert">{notice === 'invalid'
      ? t('vampireDrain.parkReserve.invalid', 'Choose a return 12 hours to 7 days away and a reserve from 5% to 90%.')
      : t('vampireDrain.parkReserve.saveFailed', 'The plan was not saved. Refresh and check your settings and browser selection.')}</ErrorText>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" className="min-h-11" wrapLabel disabled={locked || !confirmed || (push && deviceId == null)}>
        {t('vampireDrain.parkReserve.save', 'Save parked reserve plan')}
      </Button>
      <Button type="button" className="min-h-11" variant="ghost" onClick={onCancel} disabled={locked}>
        {t('common.cancel', 'Cancel')}
      </Button>
    </div>
  </form>;
}
