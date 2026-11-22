import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useCabinPrep, useCabinPrepChange } from '@/api/hooks/useCabinPrep';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ErrorText, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { formatDuration } from '@/lib/unitConversion';
import { CabinPrepPlanForm } from './CabinPrepPlanForm';

const anchor = 'cabin-prep-reminder';

export function CabinPrepReminder({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const deepLinkVehicle = params.get('cabin_vehicle_id') ?? (hash === `#${anchor}` ? params.get('vehicle_id') : null);
  const activeVehicle = deepLinkVehicle != null && deepLinkVehicle !== String(vehicleId) ? null : vehicleId;

  return <PrivateVehicleReviewPanel anchor={anchor} vehicleId={activeVehicle}
    title={t('preconditioningEffectiveness.cabinPrep.title', 'Private cabin prep reminder')}
    description={t('preconditioningEffectiveness.cabinPrep.description', 'Off by default. Confirm one morning departure. TeslaSync checks comparable local warm-ups or cool-downs and may send one private reminder. No vehicle wake, command, or climate change is automatic.')}
    openLabel={t('preconditioningEffectiveness.cabinPrep.open', 'Review cabin reminder')}
    signInPrompt={t('preconditioningEffectiveness.cabinPrep.signIn', 'Sign in to review or set a private reminder.')}
    vehiclePrompt={t('preconditioningEffectiveness.cabinPrep.selectVehicle', 'Select the vehicle for this reminder. The linked vehicle may no longer be available.')}>
    {props => <CabinPrepDetails key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
  </PrivateVehicleReviewPanel>;
}

function CabinPrepDetails({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const { unitPrefs, formatTemperature } = useUnits();
  const { formatDateTime } = useDateFormat();
  const query = useCabinPrep(scope, vehicleId);
  const state = useDataState(query);
  const change = useCabinPrepChange(scope, vehicleId);
  const [editing, setEditing] = useState(false);
  const [clearError, setClearError] = useState(false);
  const edit = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const plan = state.data;
  const trusted = !identityPending && !query.isFetching && state.status === 'ok';
  const canWrite = trusted && !change.isPending;
  useEffect(() => {
    if (restoreFocus.current && !editing && canWrite && edit.current) {
      edit.current.focus();
      restoreFocus.current = false;
    }
  }, [editing, canWrite]);
  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  if (denied || state.fatalError) {
    return <QueryError error={state.fatalError ?? query.error} onRetry={() => void query.refetch()} />;
  }
  if (plan == null) return <Skeleton lines={2} />;
  const expired = plan.reason === 'expired' || (plan.id > 0 && Date.parse(plan.departure_at) <= Date.now()) ||
    (plan.expires_at != null && Date.parse(plan.expires_at) <= Date.now());
  const offer = !expired && !identityPending && state.status === 'ok' && plan.setup_available && plan.push_device_ready
    ? plan.estimate : null;
  const leadTimeUnits = { ...unitPrefs, duration: 'min' as const };

  const done = () => {
    restoreFocus.current = true;
    setEditing(false);
    if (canWrite && edit.current && !edit.current.disabled) {
      edit.current.focus();
      restoreFocus.current = false;
    }
  };
  const clear = async () => {
    setClearError(false);
    try {
      await change.mutateAsync({ id: plan.id });
      done();
    } catch {
      setClearError(true);
    }
  };

  return <div className="space-y-3">
    <StaleRefreshWarning state={state} />
    {plan.id > 0 && <Text as="p" variant="bodySm">
      {t('preconditioningEffectiveness.cabinPrep.planned', 'Confirmed departure: {{when}} (scheduled in {{zone}}).', {
        when: formatDateTime(plan.departure_at), zone: plan.time_zone,
      })}
    </Text>}
    <Text as="p" variant="bodySm" role="status">{!plan.setup_available
      ? t('preconditioningEffectiveness.cabinPrep.unavailable', 'Needs setup: verified web push and distributed live telemetry must be enabled.')
      : plan.id === 0 ? t('preconditioningEffectiveness.cabinPrep.off', 'Off. No cabin reminder is scheduled for this vehicle.')
        : expired ? t('preconditioningEffectiveness.cabinPrep.expired', 'Expired. This departure no longer has an actionable reminder.')
          : !plan.push_device_ready ? t('preconditioningEffectiveness.cabinPrep.deviceChanged', 'Paused. Verify this browser again before confirming another reminder.')
            : offer ? t('preconditioningEffectiveness.cabinPrep.ready', 'Active. Review climate controls while there is still time.')
              : !plan.reason ? t('preconditioningEffectiveness.cabinPrep.waiting', 'Active. Waiting for the departure window and enough trustworthy observations.')
                : t('preconditioningEffectiveness.cabinPrep.silent', 'No reminder: conditions changed, the cabin is already preparing or comfortable, or comparable evidence is insufficient.')}
    </Text>
    {offer && <div className="space-y-2">
      <Text as="p" variant="bodySm">{t('preconditioningEffectiveness.cabinPrep.estimate', 'Estimate: {{low}} to {{high}} for {{target}}, based on {{count}} comparable mornings. Fresh conditions observed at {{when}}. This is not a measurement for today.', {
        low: formatDuration(offer.lead_low_s, leadTimeUnits, { precision: 1 }),
        high: formatDuration(offer.lead_high_s, leadTimeUnits, { precision: 1 }), target: formatTemperature(offer.target_c),
        count: offer.comparable_mornings, when: formatDateTime(offer.observed_at),
      })}</Text>
      {plan.expires_at && <Text as="p" variant="bodySm">
        {t('preconditioningEffectiveness.cabinPrep.window', 'Act by {{when}} if you choose to prepare the cabin.', {
          when: formatDateTime(plan.expires_at),
        })}
      </Text>}
      {trusted && <Link className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2"
        to={`/commands?vehicle_id=${vehicleId}&cabin_vehicle_id=${vehicleId}#climate-controls`}>
        {t('preconditioningEffectiveness.cabinPrep.reviewClimate', 'Review this vehicle’s climate controls')}
      </Link>}
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button ref={edit} type="button" className="min-h-11" wrapLabel variant="secondary"
        disabled={!canWrite || !plan.setup_available} aria-expanded={editing}
        onClick={() => { setClearError(false); setEditing(!editing); }}>
        {plan.id === 0 ? t('preconditioningEffectiveness.cabinPrep.set', 'Set one morning reminder')
          : t('preconditioningEffectiveness.cabinPrep.edit', 'Review or change departure')}
      </Button>
      {plan.id > 0 && <Button type="button" className="min-h-11" wrapLabel variant="ghost"
        disabled={!canWrite} onClick={() => void clear()}>
        {t('preconditioningEffectiveness.cabinPrep.clear', 'Turn off and clear reminder')}
      </Button>}
    </div>
    {editing && plan.setup_available && <CabinPrepPlanForm key={plan.id} scope={scope} plan={plan}
      disabled={!canWrite} onCancel={done} onSave={async (setup) => {
        await change.mutateAsync({ id: plan.id, setup });
        done();
      }} />}
    {clearError && <ErrorText role="alert">{t('preconditioningEffectiveness.cabinPrep.clearFailed', 'The reminder was not cleared. Refresh and try again.')}</ErrorText>}
  </div>;
}
