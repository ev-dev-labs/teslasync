import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useParkedUnlock, useParkedUnlockChange } from '@/api/hooks/useParkedUnlock';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ErrorText, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry';
import { ParkedUnlockForm } from './ParkedUnlockForm';

const anchor = 'parked-unlock';
const linkStyle = 'inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2';

export function ParkedUnlockReview({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const linked = hash === `#${anchor}` && ['unlock_vehicle_id', 'unlock_plan_id', 'unlock_park_id'].some(key => params.has(key));
  const activeVehicle = linked && params.get('unlock_vehicle_id') !== String(vehicleId) ? null : vehicleId;

  return <PrivateVehicleReviewPanel anchor={anchor} vehicleId={activeVehicle}
    title={t('admin.security.parkedUnlock.title', 'Private parked unlock reminders')}
    description={t('admin.security.parkedUnlock.description', 'Off by default. Choose one saved place and get a reminder only if fresh reports show the vehicle parked and unlocked there for five minutes. TeslaSync never wakes or locks it.')}
    openLabel={t('admin.security.parkedUnlock.open', 'Review parked unlock reminders')}
    signInPrompt={t('admin.security.parkedUnlock.signIn', 'Sign in to review or set private unlock reminders.')}
    vehiclePrompt={t('admin.security.parkedUnlock.vehicle', 'Select the vehicle for these reminders. The linked vehicle may no longer be available.')}>
    {props => <ParkedUnlockDetails key={`${props.scope.subject}:${props.vehicleId}`} {...props}
      linked={linked ? { plan: params.get('unlock_plan_id'), park: params.get('unlock_park_id') } : null} />}
  </PrivateVehicleReviewPanel>;
}

function ParkedUnlockDetails({ scope, vehicleId, identityPending, linked }: PrivateVehicleReviewScope & {
  linked: { plan: string | null; park: string | null } | null;
}) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const query = useParkedUnlock(scope, vehicleId);
  const state = useDataState(query);
  const change = useParkedUnlockChange(scope, vehicleId);
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const edit = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const canWrite = !identityPending && !query.isFetching && state.status === 'ok' && !change.isPending;
  const status = state.data;
  const plan = status?.plan ?? null;
  const { refetch } = query;
  const refresh = useCallback(() => { void refetch(); }, [refetch]);
  const withinRisk = usePrivateReviewExpiry(plan?.risk?.expires_at, refresh);
  const snoozed = usePrivateReviewExpiry(plan?.snoozed_until, refresh);

  useEffect(() => {
    if (returnFocus.current && !editing && canWrite && edit.current && !edit.current.disabled) {
      edit.current.focus();
      returnFocus.current = false;
    }
  }, [editing, canWrite]);

  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  if (denied || state.fatalError) return <QueryError error={state.fatalError ?? query.error} onRetry={refresh} />;
  if (!status || identityPending) return <Skeleton lines={2} />;
  const risk = status.available && !query.isError && withinRisk ? plan?.risk : null;
  const manage = `/security-access?vehicle_id=${vehicleId}#${anchor}`;
  const manageLabel = t('admin.security.parkedUnlock.manage', 'Manage unlock reminders');
  if (linked && (String(plan?.id) !== linked.plan || String(risk?.park_id) !== linked.park)) return <div className="space-y-2">
    <StaleRefreshWarning state={state} />
    <Text as="p" role="status">{t('admin.security.parkedUnlock.oldLink', 'This parked unlock review is no longer available. The vehicle may have locked, moved, or stopped reporting fresh state.')}</Text>
    <Link className={linkStyle} to={manage}>{manageLabel}</Link>
  </div>;

  let summary: string;
  if (!status.available) summary = t('admin.security.parkedUnlock.unavailable', 'Needs setup: distributed live telemetry and private browser push are required.');
  else if (!plan) summary = t('admin.security.parkedUnlock.off', 'Off. No unlock reminders are set for this vehicle.');
  else if (plan.paused) summary = t('admin.security.parkedUnlock.paused', 'Paused. Confirm to resume unlock reminders.');
  else if (!plan.place_ready) summary = t('admin.security.parkedUnlock.placeChanged', 'Stopped. The saved place changed or was disabled. Choose a place and confirm again.');
  else if (!plan.device_ready) summary = t('admin.security.parkedUnlock.deviceChanged', 'Stopped. The verified browser has changed or been removed.');
  else if (snoozed && plan.snoozed_until) summary = t('admin.security.parkedUnlock.snoozed', 'Snoozed until {{when}}.', { when: formatDateTime(plan.snoozed_until) });
  else if (risk) summary = t('admin.security.parkedUnlock.risk', 'The vehicle was observed unlocked while parked at the selected place.');
  else if (plan.reason === 'locked') summary = t('admin.security.parkedUnlock.locked', 'No alert at the last check: the vehicle was observed locked.');
  else if (plan.reason === 'outside_place') summary = t('admin.security.parkedUnlock.outside', 'No alert at the last check: the vehicle was outside the selected place.');
  else summary = t('admin.security.parkedUnlock.monitoring', 'Active. No current alert: repeated fresh reports after parking are required.');

  const finish = () => {
    setEditing(false);
    if (edit.current && !edit.current.disabled) edit.current.focus();
    else returnFocus.current = true;
  };
  const update = async (action: 'snooze' | 'pause' | 'clear') => {
    if (!plan) return;
    setFailed(false);
    try {
      await change.mutateAsync(action === 'clear' ? { id: plan.id, method: 'DELETE' } : { id: plan.id, method: 'PATCH', action });
      finish();
    } catch {
      setFailed(true);
    }
  };

  return <div className="space-y-3">
    <StaleRefreshWarning state={state} />
    <Text as="p" variant="bodySm" role="status">{summary}</Text>
    {plan?.place_name && <Text as="p" variant="bodySm">
      {t('admin.security.parkedUnlock.monitoredPlace', 'Selected place: {{place}}', { place: plan.place_name })}
    </Text>}
    {risk && <div className="space-y-1">
      <Text as="p" variant="bodySm">{t('admin.security.parkedUnlock.evidence', 'Unlocked was observed from {{first}} through {{last}}, after parking at {{parked}}.', {
        first: formatDateTime(risk.unlocked_since), last: formatDateTime(risk.last_observed_at), parked: formatDateTime(risk.parked_at),
      })}</Text>
      <Text as="p" variant="bodySm">{t('admin.security.parkedUnlock.check', 'This is not evidence of theft or a live safety check. If safe, check the vehicle in person. This review expires at {{when}}.', { when: formatDateTime(risk.expires_at) })}</Text>
    </div>}
    {linked ? <Link className={linkStyle} to={manage}>{manageLabel}</Link> : <>
      <div className="flex flex-wrap gap-2">
        <Button ref={edit} type="button" className="min-h-11" wrapLabel variant="secondary" aria-expanded={editing}
          disabled={!canWrite || !status.available} onClick={() => { setFailed(false); setEditing(!editing); }}>
          {plan ? t('admin.security.parkedUnlock.change', 'Change place or resume reminders') : t('admin.security.parkedUnlock.setup', 'Set up unlock reminders')}
        </Button>
        {plan && !plan.paused && <>
          <Button type="button" variant="secondary" className="min-h-11" wrapLabel disabled={!canWrite || snoozed || !status.available || !plan.place_ready}
            onClick={() => void update('snooze')}>{t('admin.security.parkedUnlock.snooze', 'Snooze unlock reminders for 15 minutes')}</Button>
          <Button type="button" variant="secondary" className="min-h-11" wrapLabel disabled={!canWrite}
            onClick={() => void update('pause')}>{t('admin.security.parkedUnlock.pause', 'Pause unlock reminders')}</Button>
        </>}
        {plan && <Button type="button" variant="ghost" className="min-h-11" wrapLabel disabled={!canWrite}
          onClick={() => void update('clear')}>{t('admin.security.parkedUnlock.clear', 'Turn off and clear unlock reminders')}</Button>}
      </div>
      {editing && status.available && <ParkedUnlockForm key={plan?.id} scope={scope} plan={plan}
        disabled={!canWrite} onCancel={finish} onSave={async (setup) => {
          await change.mutateAsync({ id: plan?.id ?? 0, method: 'PUT', setup });
          finish();
        }} />}
      {failed && <ErrorText role="alert">{t('admin.security.parkedUnlock.updateFailed', 'The unlock reminders were not changed. Refresh and try again.')}</ErrorText>}
    </>}
  </div>;
}
