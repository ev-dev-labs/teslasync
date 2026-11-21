import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useParkReserve, useParkReserveChange } from '@/api/hooks/useParkReserve';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ErrorText, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { ParkReserveForm } from './ParkReserveForm';

const anchor = 'park-reserve';

export function ParkReserveReview({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const linkedVehicle = hash === `#${anchor}` ? params.get('park_vehicle_id') : null;
  const linkedPlan = linkedVehicle != null ? params.get('park_plan_id') : null;
  const activeVehicle = linkedVehicle != null && linkedVehicle !== String(vehicleId) ? null : vehicleId;

  return <PrivateVehicleReviewPanel anchor={anchor} vehicleId={activeVehicle}
    title={t('vampireDrain.parkReserve.title', 'Private parked charge reserve')}
    description={t('vampireDrain.parkReserve.description', 'Off by default. Estimate return charge for one long park using comparable local history. No vehicle wake, command, or charging change is automatic.')}
    openLabel={t('vampireDrain.parkReserve.open', 'Review parked reserve')}
    signInPrompt={t('vampireDrain.parkReserve.signIn', 'Sign in to review or set a private parked reserve plan.')}
    vehiclePrompt={t('vampireDrain.parkReserve.vehicle', 'Select the vehicle for this plan. The linked vehicle may no longer be available.')}>
    {props => <ParkReserveDetails key={`${props.scope.subject}:${props.vehicleId}`} {...props} linkedPlan={linkedPlan} />}
  </PrivateVehicleReviewPanel>;
}

function ParkReserveDetails({ scope, vehicleId, identityPending, linkedPlan }: PrivateVehicleReviewScope & {
  linkedPlan: string | null;
}) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { fmtPercent } = useNumberFormatting();
  const query = useParkReserve(scope, vehicleId);
  const state = useDataState(query);
  const change = useParkReserveChange(scope, vehicleId);
  const [editing, setEditing] = useState(false);
  const [clearError, setClearError] = useState(false);
  const edit = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const trusted = !identityPending && !query.isFetching && state.status === 'ok';
  const canWrite = trusted && !change.isPending;
  const status = state.data;
  const plan = status?.plan ?? null;
  const actionUntil = plan ? Date.parse(plan.action_until) : 0;
  const { refetch } = query;

  useEffect(() => {
    const remaining = actionUntil - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = window.setTimeout(() => { void refetch(); }, remaining);
    return () => window.clearTimeout(timer);
  }, [actionUntil, refetch]);

  useEffect(() => {
    if (returnFocus.current && !editing && canWrite && edit.current) {
      edit.current.focus();
      returnFocus.current = false;
    }
  }, [editing, canWrite]);

  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  if (denied || state.fatalError) return <QueryError error={state.fatalError ?? query.error} onRetry={() => void query.refetch()} />;
  if (!status || identityPending) return <Skeleton lines={2} />;
  if (linkedPlan != null && String(plan?.id) !== linkedPlan) return <div className="space-y-2">
    <Text as="p" role="status">{t('vampireDrain.parkReserve.oldLink', 'This private plan is no longer available. It may have been cleared or replaced.')}</Text>
    <Link className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2"
      to={`/vampire-drain?vehicle_id=${vehicleId}#${anchor}`}>{t('vampireDrain.parkReserve.current', 'Review the current plan')}</Link>
  </div>;

  const expired = plan?.reason === 'expired' || (plan != null && actionUntil <= Date.now());
  const actionable = trusted && status.setup_available && !expired &&
    plan?.estimate?.reserve_risk === true;
  const estimate = !expired && status.setup_available ? plan?.estimate : null;
  const finish = () => {
    returnFocus.current = true;
    setEditing(false);
    if (edit.current && !edit.current.disabled) {
      edit.current.focus();
      returnFocus.current = false;
    }
  };
  const clear = async (id: number) => {
    setClearError(false);
    try {
      await change.mutateAsync({ id });
      finish();
    } catch {
      setClearError(true);
    }
  };
  let summary: string;
  if (!status.setup_available) summary = t('vampireDrain.parkReserve.unavailable', 'Needs setup: distributed live telemetry is required.');
  else if (!plan) summary = t('vampireDrain.parkReserve.off', 'Off. No parked reserve plan is set for this vehicle.');
  else if (expired) summary = t('vampireDrain.parkReserve.expired', 'Expired. This plan no longer has a current estimate.');
  else if (plan.reason === 'estimated_reserve_crossing') summary = t('vampireDrain.parkReserve.risk', 'The estimated return range could fall below your reserve.');
  else if (plan.reason === 'already_below_reserve') summary = t('vampireDrain.parkReserve.alreadyLow', 'The observed charge is already at or below your reserve. This is not a forecast of a new crossing.');
  else if (plan.reason === 'reserve_not_crossed') summary = t('vampireDrain.parkReserve.above', 'Comparable parks do not support a material reserve crossing.');
  else if (!plan.reason) summary = t('vampireDrain.parkReserve.waiting', 'Active. Waiting for trustworthy parked and unplugged observations.');
  else if (plan.reason === 'insufficient_comparable_parks') summary = t('vampireDrain.parkReserve.insufficient', 'No estimate. At least three comparable unplugged parks with measured charge are needed.');
  else summary = t('vampireDrain.parkReserve.changed', 'No current estimate. Parked, unplugged conditions changed or could not be verified.');

  return <div className="space-y-3">
    <StaleRefreshWarning state={state} />
    {plan && <Text as="p" variant="bodySm">{t('vampireDrain.parkReserve.planned', 'Planned return: {{when}}. Your reserve: {{reserve}}.', {
      when: formatDateTime(plan.return_at), reserve: fmtPercent(plan.reserve_pct),
    })}</Text>}
    <Text as="p" variant="bodySm" role="status">{summary}</Text>
    {plan?.push_device_id != null && (!plan.push_device_ready || !status.push_available) &&
      <Text as="p" variant="bodySm">{t('vampireDrain.parkReserve.pushPaused', 'Private push is unavailable. You can still review the plan here.')}</Text>}
    {estimate && <Text as="p" variant="bodySm">{t('vampireDrain.parkReserve.estimate', 'Estimated return charge: {{low}} to {{high}}. Starting charge was {{start}} at {{when}}. Based on {{count}} parks with comparable duration, temperature and Sentry state; not a guarantee.', {
      low: fmtPercent(estimate.return_low_pct, 0), high: fmtPercent(estimate.return_high_pct, 0),
      start: fmtPercent(estimate.start_battery_pct), when: formatDateTime(estimate.observed_at), count: estimate.comparable_episodes,
    })}</Text>}
    {actionable && <div className="space-y-1">
      <Text as="p" variant="bodySm">{t('vampireDrain.parkReserve.actBy', 'If you can, plug in or review charging options by {{when}}.', { when: formatDateTime(plan.action_until) })}</Text>
      <Link className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2"
        to={`/charging?vehicle_id=${vehicleId}`}>{t('vampireDrain.parkReserve.charging', 'Review charging for this vehicle')}</Link>
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button ref={edit} type="button" className="min-h-11" wrapLabel variant="secondary" aria-expanded={editing}
        disabled={!canWrite || !status.setup_available} onClick={() => { setClearError(false); setEditing(!editing); }}>
        {plan ? t('vampireDrain.parkReserve.edit', 'Change parked reserve plan') : t('vampireDrain.parkReserve.set', 'Plan a long park')}
      </Button>
      {plan && <Button type="button" variant="ghost" className="min-h-11" wrapLabel
        disabled={!canWrite} onClick={() => void clear(plan.id)}>
        {t('vampireDrain.parkReserve.clear', 'Turn off and clear plan')}
      </Button>}
    </div>
    {editing && status.setup_available && <ParkReserveForm key={plan?.id} scope={scope} plan={plan}
      pushAvailable={status.push_available} disabled={!canWrite} onCancel={finish} onSave={async (setup) => {
        await change.mutateAsync({ id: plan?.id ?? 0, setup });
        finish();
      }} />}
    {clearError && <ErrorText role="alert">{t('vampireDrain.parkReserve.clearFailed', 'The plan was not cleared. Refresh and try again.')}</ErrorText>}
  </div>;
}
