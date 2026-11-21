import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity';
import { useCurrentPersonalDevice } from '@/api/hooks/usePersonalDelivery';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ErrorText, Input, Text, Toggle } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePersonalBrowser } from '@/hooks/usePersonalBrowser';
import { useUnits } from '@/hooks/useUnits';
import { toZonedDatetimeStr, zonedWallTimeToUtc } from '@/lib/dateConvert';
import { refreshPersonalDeliveryWorker } from '@/lib/personalPush';
import { convertTempFromSI, convertTempToSI } from '@/lib/unitConversion';
import type { CabinPrepPlan, CabinPrepSetup } from '@/types/cabinPrep';

interface Props {
  scope: Extract<PersonalScope, { mode: 'forward_auth' }>;
  plan: CabinPrepPlan;
  disabled: boolean;
  onSave: (setup: CabinPrepSetup) => Promise<void>;
  onCancel: () => void;
}

export function CabinPrepPlanForm({ scope, plan, disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  const { tz } = useDateFormat('user');
  const { unitPrefs } = useUnits();
  const unit = unitPrefs.temperature;
  const browser = usePersonalBrowser();
  const device = useCurrentPersonalDevice(scope, browser.subscription?.endpoint ?? null, browser.generation, true);
  const deviceState = useDataState(device);
  const [departure, setDeparture] = useState(plan.id && plan.reason !== 'expired'
    ? toZonedDatetimeStr(new Date(plan.departure_at), tz) : '');
  const [target, setTarget] = useState(convertTempFromSI(plan.id ? plan.target_c : 21, unit).toFixed(1));
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState<'invalid' | 'failed' | null>(null);
  const [saving, setSaving] = useState(false);
  const deviceId = deviceState.status === 'ok' && !device.isFetching && device.data?.verified ? device.data.id : null;
  const locked = disabled || saving;
  const departureInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    departureInput.current?.focus();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed || deviceId == null || locked) return;
    const instant = zonedWallTimeToUtc(departure, tz);
    const targetC = convertTempToSI(Number(target), unit);
    const minutes = instant ? (instant.getTime() - Date.now()) / 60_000 : 0;
    if (!instant || minutes <= 3 || minutes > 14 * 24 * 60 ||
      Number(departure.slice(11, 13)) < 5 || Number(departure.slice(11, 13)) >= 12 ||
      !target.trim() || !Number.isFinite(targetC) || targetC < 16 || targetC > 29) {
      setNotice('invalid');
      return;
    }
    setNotice(null);
    setSaving(true);
    try {
      await refreshPersonalDeliveryWorker();
      await onSave({
        departure_at: instant.toISOString(), time_zone: tz, target_c: targetC, push_device_id: deviceId,
        push_title: t('preconditioningEffectiveness.cabinPrep.pushTitle', 'Review cabin preparation'),
        push_body: t('preconditioningEffectiveness.cabinPrep.pushBody', 'Comparable mornings suggest it is time to review cabin preparation for your planned drive.'),
      });
    } catch {
      setNotice('failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      {browser.status === 'error' ? (
        <Button type="button" variant="secondary" onClick={browser.retry}>
          {t('preconditioningEffectiveness.cabinPrep.retryBrowser', 'Retry browser verification check')}
        </Button>
      ) : deviceState.fatalError ? <QueryError error={deviceState.fatalError} onRetry={() => void device.refetch()} />
        : browser.status === 'checking' || device.isLoading ? <Skeleton lines={2} /> : <>
          <StaleRefreshWarning state={deviceState} />
          {deviceId != null ? <Text as="p" variant="bodySm">
            {t('preconditioningEffectiveness.cabinPrep.browserReady', 'This browser is verified for personal delivery.')}
          </Text> : <Text as="p" variant="bodySm">
            <Link to="/settings/smart-charging" className="text-theme-accent underline underline-offset-2">
              {t('preconditioningEffectiveness.cabinPrep.verifyBrowser', 'Verify a browser in personal delivery settings')}
            </Link>
          </Text>}
        </>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input ref={departureInput} type="datetime-local" value={departure} onChange={(event) => setDeparture(event.target.value)}
          required disabled={locked} label={t('preconditioningEffectiveness.cabinPrep.departure', 'Morning departure ({{zone}})', { zone: tz })} />
        <Input type="number" step="any" value={target} onChange={(event) => setTarget(event.target.value)}
          required disabled={locked} label={t('preconditioningEffectiveness.cabinPrep.target', 'Comfort target ({{unit}})', { unit })} />
      </div>
      <Toggle label={t('preconditioningEffectiveness.cabinPrep.confirm', 'I confirm this one departure and want a private reminder on this verified browser.')}
        checked={confirmed} disabled={locked} onChange={setConfirmed} />
      {notice && <ErrorText role="alert">{notice === 'invalid'
        ? t('preconditioningEffectiveness.cabinPrep.invalid', 'Choose a departure from 05:00 to before noon in the next 14 days and a supported comfort target.')
        : t('preconditioningEffectiveness.cabinPrep.failed', 'The reminder was not saved. Refresh and check your browser selection.')}</ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" wrapLabel disabled={locked || !confirmed || deviceId == null}>
          {t('preconditioningEffectiveness.cabinPrep.save', 'Confirm cabin reminder')}
        </Button>
        <Button type="button" className="min-h-11" variant="ghost" onClick={onCancel} disabled={locked}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  );
}
