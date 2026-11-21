import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useWindowRain, useWindowRainChange } from '@/api/hooks/useWindowRain';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ErrorText, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry';
import { WindowRainForm } from './WindowRainForm';

const anchor = 'window-rain';

export function WindowRainReview({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const linked = hash === `#${anchor}` && (params.has('rain_vehicle_id') || params.has('rain_plan_id'));
  const linkedPlan = linked ? params.get('rain_plan_id') ?? '' : null;
  const activeVehicle = linked && params.get('rain_vehicle_id') !== String(vehicleId) ? null : vehicleId;

  return <PrivateVehicleReviewPanel anchor={anchor} vehicleId={activeVehicle}
    title={t('admin.security.windowRain.title', 'Private window rain watch')}
    description={t('admin.security.windowRain.description', 'Off by default. Check for nearby rain while an observed window is open during this outdoor park. Never wakes the vehicle or moves a window.')}
    openLabel={t('admin.security.windowRain.open', 'Review window rain watch')}
    signInPrompt={t('admin.security.windowRain.signIn', 'Sign in to review or set a private window rain watch.')}
    vehiclePrompt={t('admin.security.windowRain.vehicle', 'Select the vehicle for this watch. The linked vehicle may no longer be available.')}>
    {props => <WindowRainDetails key={`${props.scope.subject}:${props.vehicleId}`} {...props} linkedPlan={linkedPlan} />}
  </PrivateVehicleReviewPanel>;
}

function WindowRainDetails({ scope, vehicleId, identityPending, linkedPlan }: PrivateVehicleReviewScope & {
  linkedPlan: string | null;
}) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const query = useWindowRain(scope, vehicleId);
  const state = useDataState(query);
  const change = useWindowRainChange(scope, vehicleId);
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const edit = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const canWrite = !identityPending && !query.isFetching && state.status === 'ok' && !change.isPending;
  const status = state.data;
  const plan = status?.plan ?? null;
  const { refetch } = query;
  const refresh = useCallback(() => { void refetch(); }, [refetch]);
  const withinWatch = usePrivateReviewExpiry(plan?.watch_until, refresh);
  const withinRisk = usePrivateReviewExpiry(plan?.risk?.expires_at, refresh);

  useEffect(() => {
    if (returnFocus.current && !editing && canWrite && edit.current) {
      edit.current.focus();
      returnFocus.current = false;
    }
  }, [editing, canWrite]);

  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  if (denied || state.fatalError) return <QueryError error={state.fatalError ?? query.error} onRetry={refresh} />;
  if (!status || identityPending) return <Skeleton lines={2} />;
  const manage = `/security-access?vehicle_id=${vehicleId}#${anchor}`;
  if (linkedPlan != null && String(plan?.id) !== linkedPlan) return <div className="space-y-2">
    <Text as="p" role="status">{t('admin.security.windowRain.oldLink', 'This private watch is no longer available. It may have been cleared or replaced.')}</Text>
    <Link className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2" to={manage}>
      {t('admin.security.windowRain.current', 'Review the current watch')}
    </Link>
  </div>;

  const risk = status.available && !query.isError && withinWatch && withinRisk ? plan?.risk : null;
  const positions = {
    front_driver: t('admin.security.windowRain.frontDriver', 'Front driver’s window'),
    front_passenger: t('admin.security.windowRain.frontPassenger', 'Front passenger’s window'),
    rear_driver: t('admin.security.windowRain.rearDriver', 'Rear driver-side window'),
    rear_passenger: t('admin.security.windowRain.rearPassenger', 'Rear passenger-side window'),
  };
  let summary: string;
  if (!status.available) summary = t('admin.security.windowRain.unavailable', 'Needs setup: distributed live telemetry and private browser push are required.');
  else if (!plan) summary = t('admin.security.windowRain.off', 'Off. No window rain watch is set for this vehicle.');
  else if (!withinWatch || plan.reason === 'expired' || (plan.risk != null && !withinRisk))
    summary = t('admin.security.windowRain.expired', 'Expired. There is no current rain alert.');
  else if (plan.paused) summary = t('admin.security.windowRain.paused', 'Paused. No forecasts or pushes will run unless you confirm a new watch.');
  else if (!plan.device_ready) summary = t('admin.security.windowRain.deviceChanged', 'Stopped. The verified browser has changed or been removed.');
  else if (plan.reason === 'park_changed') summary = t('admin.security.windowRain.moved', 'Stopped. This is no longer the same confirmed outdoor park.');
  else if (plan.reason === 'weather_unavailable') summary = t('admin.security.windowRain.weatherUnknown', 'No alert. A current rain forecast is unavailable.');
  else if (plan.reason === 'no_rain_risk') summary = t('admin.security.windowRain.dry', 'No alert. The current forecast does not meet the rain threshold.');
  else if (plan.reason === 'unknown_state' || plan.reason === 'no_fresh_open_window')
    summary = t('admin.security.windowRain.noObservation', 'No alert. Fresh parked and open-window observations are required.');
  else if (risk) summary = t('admin.security.windowRain.risk', 'An observed open window and a timely local rain forecast coincided.');
  else summary = t('admin.security.windowRain.monitoring', 'Watching this confirmed park for fresh open-window observations and nearby rain.');

  const finish = () => {
    setEditing(false);
    if (edit.current && !edit.current.disabled) edit.current.focus();
    else returnFocus.current = true;
  };
  const update = async (id: number, method: 'PATCH' | 'DELETE') => {
    setFailed(false);
    try {
      await change.mutateAsync({ id, method });
      finish();
    } catch {
      setFailed(true);
    }
  };

  return <div className="space-y-3">
    <StaleRefreshWarning state={state} />
    <Text as="p" variant="bodySm" role="status">{summary}</Text>
    {plan && withinWatch && !plan.paused && plan.reason !== 'park_changed' && <Text as="p" variant="bodySm">
      {t('admin.security.windowRain.watchUntil', 'Watch ends by {{when}} or when this park ends.', { when: formatDateTime(plan.watch_until) })}
    </Text>}
    {risk && <div className="space-y-1">
      <Text as="p" variant="bodySm">{t('admin.security.windowRain.observed', '{{window}} was observed open at {{when}}.', {
        window: positions[risk.window.position], when: formatDateTime(risk.window.observed_at),
      })}</Text>
      <Text as="p" variant="bodySm">{t('admin.security.windowRain.forecast', 'Open-Meteo forecast received at {{forecast}} indicates possible rain from {{from}} to {{to}} near the parked location. This is an estimate, not observed rainfall.', {
        forecast: formatDateTime(risk.forecast_at), from: formatDateTime(risk.risk_start_at), to: formatDateTime(risk.risk_end_at),
      })}</Text>
      <Text as="p" variant="bodySm">{t('admin.security.windowRain.nextStep', 'If safe, check the window in person. This alert expires at {{when}}; no vehicle action is performed here.', {
        when: formatDateTime(risk.expires_at),
      })}</Text>
    </div>}
    {linkedPlan != null ? <Link className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2" to={manage}>
      {t('admin.security.windowRain.manage', 'Manage this watch')}
    </Link> : <>
      <div className="flex flex-wrap gap-2">
        <Button ref={edit} type="button" className="min-h-11" wrapLabel variant="secondary" aria-expanded={editing}
          disabled={!canWrite || !status.available} onClick={() => { setFailed(false); setEditing(!editing); }}>
          {plan ? t('admin.security.windowRain.replace', 'Confirm a new outdoor watch') : t('admin.security.windowRain.setup', 'Set up an outdoor watch')}
        </Button>
        {plan && !plan.paused && withinWatch && <Button type="button" variant="secondary" className="min-h-11" wrapLabel
          disabled={!canWrite} onClick={() => void update(plan.id, 'PATCH')}>{t('admin.security.windowRain.pause', 'Pause watch')}</Button>}
        {plan && <Button type="button" variant="ghost" className="min-h-11" wrapLabel
          disabled={!canWrite} onClick={() => void update(plan.id, 'DELETE')}>{t('admin.security.windowRain.clear', 'Turn off and clear watch')}</Button>}
      </div>
      {editing && status.available && <WindowRainForm key={plan?.id} scope={scope} disabled={!canWrite}
        onCancel={finish} onSave={async (setup) => {
          await change.mutateAsync({ id: plan?.id ?? 0, method: 'PUT', setup });
          finish();
        }} />}
      {failed && <ErrorText role="alert">{t('admin.security.windowRain.updateFailed', 'The watch was not changed. Refresh and try again.')}</ErrorText>}
    </>}
  </div>;
}
