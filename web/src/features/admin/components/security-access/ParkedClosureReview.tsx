import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useParkedClosure, useParkedClosureChange } from '@/api/hooks/useParkedClosure';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ErrorText, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry';
import { ParkedClosureForm } from './ParkedClosureForm';

const anchor = 'parked-closure';

export function ParkedClosureReview({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const linked = hash === `#${anchor}` && ['closure_vehicle_id', 'closure_plan_id', 'closure_park_id'].some(key => params.has(key));
  const activeVehicle = linked && params.get('closure_vehicle_id') !== String(vehicleId) ? null : vehicleId;

  return <PrivateVehicleReviewPanel anchor={anchor} vehicleId={activeVehicle}
    title={t('admin.security.parkedClosure.title', 'Private parked door and trunk reminders')}
    description={t('admin.security.parkedClosure.description', 'Off by default. Get a reminder when fresh telemetry keeps showing an open door or trunk after parking. TeslaSync never wakes the vehicle or closes anything.')}
    openLabel={t('admin.security.parkedClosure.open', 'Review parked closure reminders')}
    signInPrompt={t('admin.security.parkedClosure.signIn', 'Sign in to review or set private closure reminders.')}
    vehiclePrompt={t('admin.security.parkedClosure.vehicle', 'Select the vehicle for these reminders. The linked vehicle may no longer be available.')}>
    {props => <ParkedClosureDetails key={`${props.scope.subject}:${props.vehicleId}`} {...props}
      linked={linked ? { plan: params.get('closure_plan_id'), park: params.get('closure_park_id') } : null} />}
  </PrivateVehicleReviewPanel>;
}

function ParkedClosureDetails({ scope, vehicleId, identityPending, linked }: PrivateVehicleReviewScope & {
  linked: { plan: string | null; park: string | null } | null;
}) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const query = useParkedClosure(scope, vehicleId);
  const state = useDataState(query);
  const change = useParkedClosureChange(scope, vehicleId);
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
  if (linked && (String(plan?.id) !== linked.plan || String(risk?.park_id) !== linked.park)) return <div className="space-y-2">
    <StaleRefreshWarning state={state} />
    <Text as="p" role="status">{t('admin.security.parkedClosure.oldLink', 'This parked closure review is no longer available. The observation may have expired or the vehicle state or settings may have changed.')}</Text>
    <Link className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2" to={manage}>
      {t('admin.security.parkedClosure.manage', 'Manage closure reminders')}
    </Link>
  </div>;
  const positions = {
    driver_front_door: t('admin.security.parkedClosure.driverFront', 'Front driver’s door'),
    passenger_front_door: t('admin.security.parkedClosure.passengerFront', 'Front passenger’s door'),
    driver_rear_door: t('admin.security.parkedClosure.driverRear', 'Rear driver-side door'),
    passenger_rear_door: t('admin.security.parkedClosure.passengerRear', 'Rear passenger-side door'),
    front_trunk: t('admin.security.parkedClosure.frontTrunk', 'Front trunk'),
    rear_trunk: t('admin.security.parkedClosure.rearTrunk', 'Rear trunk'),
  };
  let summary: string;
  if (!status.available) summary = t('admin.security.parkedClosure.unavailable', 'Needs setup: distributed live telemetry and private browser push are required.');
  else if (!plan) summary = t('admin.security.parkedClosure.off', 'Off. No closure reminders are set for this vehicle.');
  else if (plan.paused) summary = t('admin.security.parkedClosure.paused', 'Paused. Confirm to resume reminders.');
  else if (!plan.device_ready) summary = t('admin.security.parkedClosure.deviceChanged', 'Stopped. The verified browser has changed or been removed.');
  else if (snoozed && plan.snoozed_until) summary = t('admin.security.parkedClosure.snoozed', 'Snoozed for loading until {{when}}.', { when: formatDateTime(plan.snoozed_until) });
  else if (risk) summary = t('admin.security.parkedClosure.risk', 'An open door or trunk was still observed after the wait.');
  else if (plan.reason === 'active_use') summary = t('admin.security.parkedClosure.activeUse', 'No alert at the last check: service or active use was observed.');
  else if (plan.reason === 'all_closed') summary = t('admin.security.parkedClosure.closed', 'No alert at the last check: all doors and trunks were observed closed.');
  else if (plan.reason === 'grace_period') summary = t('admin.security.parkedClosure.waiting', 'Waiting for consistent observations throughout the grace period.');
  else summary = t('admin.security.parkedClosure.monitoring', 'Active. No current alert: repeated fresh observations after parking are required.');

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
    {risk && <div className="space-y-1">
      <Text as="p" variant="bodySm">{t('admin.security.parkedClosure.evidence', '{{closure}} was observed open from {{first}} through {{last}}, after parking at {{parked}}.', {
        closure: positions[risk.position], first: formatDateTime(risk.open_since),
        last: formatDateTime(risk.last_observed_at), parked: formatDateTime(risk.parked_at),
      })}</Text>
      <Text as="p" variant="bodySm">{t('admin.security.parkedClosure.check', 'This is not a live safety check. If safe, check in person. This review expires at {{when}}.', { when: formatDateTime(risk.expires_at) })}</Text>
    </div>}
    {linked ? <Link className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2" to={manage}>
      {t('admin.security.parkedClosure.manage', 'Manage closure reminders')}
    </Link> : <>
      <div className="flex flex-wrap gap-2">
        <Button ref={edit} type="button" className="min-h-11" wrapLabel variant="secondary" aria-expanded={editing}
          disabled={!canWrite || !status.available} onClick={() => { setFailed(false); setEditing(!editing); }}>
          {plan ? t('admin.security.parkedClosure.change', 'Change or resume reminders') : t('admin.security.parkedClosure.setup', 'Set up closure reminders')}
        </Button>
        {plan && !plan.paused && <>
          <Button type="button" variant="secondary" className="min-h-11" wrapLabel disabled={!canWrite || snoozed || !status.available}
            onClick={() => void update('snooze')}>{t('admin.security.parkedClosure.snooze', 'Snooze 15 minutes for loading')}</Button>
          <Button type="button" variant="secondary" className="min-h-11" wrapLabel disabled={!canWrite}
            onClick={() => void update('pause')}>{t('admin.security.parkedClosure.pause', 'Pause closure reminders')}</Button>
        </>}
        {plan && <Button type="button" variant="ghost" className="min-h-11" wrapLabel disabled={!canWrite}
          onClick={() => void update('clear')}>{t('admin.security.parkedClosure.clear', 'Turn off and clear reminders')}</Button>}
      </div>
      {editing && status.available && <ParkedClosureForm key={plan?.id} scope={scope} initialGrace={plan?.grace_s}
        disabled={!canWrite} onCancel={finish} onSave={async (setup) => {
          await change.mutateAsync({ id: plan?.id ?? 0, method: 'PUT', setup });
          finish();
        }} />}
      {failed && <ErrorText role="alert">{t('admin.security.parkedClosure.updateFailed', 'The reminders were not changed. Refresh and try again.')}</ErrorText>}
    </>}
  </div>;
}
