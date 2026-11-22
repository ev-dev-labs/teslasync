import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useOvernightDrain, useOvernightDrainChange } from '@/api/hooks/useOvernightDrain';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ErrorText, Text } from '@/components/ui';
import { PrivateReviewTimeZoneForm, PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry';
import { OvernightDrainEvidence } from './OvernightDrainEvidence';

const ns = 'vampireDrain.overnight';

export function OvernightDrainPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return (
    <PrivateVehicleReviewPanel anchor="overnight-drain-review" vehicleId={vehicleId}
      title={t(`${ns}.title`, 'Private overnight drain review')}
      description={t(`${ns}.description`, 'Off by default. Compare similar parked nights using local vehicle history. No push, vehicle wake, or data sharing.')}
      openLabel={t(`${ns}.open`, 'Review overnight drain')}
      signInPrompt={t(`${ns}.signIn`, 'Sign in to set up or view your private overnight review.')}
      vehiclePrompt={t(`${ns}.vehicle`, 'Select the vehicle to review.')}>
      {props => <OvernightDrainDetails key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
    </PrivateVehicleReviewPanel>
  );
}

function OvernightDrainDetails({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const { tz } = useDateFormat();
  const query = useOvernightDrain(scope, vehicleId);
  const state = useDataState(query);
  const change = useOvernightDrainChange(scope, vehicleId);
  const [edit, setEdit] = useState(false);
  const [failed, setFailed] = useState(false);
  const invoker = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const writable = !identityPending && !query.isFetching && state.status === 'ok' && !change.isPending;
  const plan = state.data?.plan;
  const review = plan?.review;
  const { refetch } = query;
  const current = usePrivateReviewExpiry(review?.expires_at, refetch);
  const visible = current ? review : undefined;

  useEffect(() => {
    if (!edit && restore.current && writable) {
      invoker.current?.focus();
      restore.current = false;
    }
  }, [edit, writable]);

  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  if (denied || state.fatalError) return <QueryError error={state.fatalError ?? query.error} onRetry={() => void refetch()} />;
  if (!state.data) return <Skeleton lines={2} />;

  const closeForm = () => {
    restore.current = true;
    setEdit(false);
  };
  const apply = async (input: Parameters<typeof change.mutateAsync>[0]) => {
    setFailed(false);
    try {
      await change.mutateAsync(input);
      closeForm();
    } catch {
      setFailed(true);
    }
  };
  const begin = () => {
    setFailed(false);
    setEdit(true);
  };

  return (
    <div className="space-y-3">
      <StaleRefreshWarning state={state} />
      <Text as="p" variant="bodySm" role="status">{!plan
        ? t(`${ns}.off`, 'Off. No overnight checks are scheduled for this vehicle.')
        : plan.paused
          ? t(`${ns}.paused`, 'Paused. No overnight checks until you resume.')
          : visible
            ? t(`${ns}.available`, 'Active. A private morning review is available.')
            : t(`${ns}.quiet`, 'Active. No morning review is available. Ordinary nights and nights without enough evidence stay quiet.')}</Text>
      {plan && visible && <OvernightDrainEvidence review={visible} zone={plan.time_zone} writable={writable}
        dismiss={() => void apply({ kind: 'dismiss', id: plan.id, morning: visible.morning_at })} />}
      <div className="flex flex-wrap gap-2">
        <Button ref={invoker} type="button" className="min-h-11" variant="secondary" wrapLabel
          disabled={!writable} aria-expanded={edit} onClick={edit ? closeForm : begin}>
          {!plan ? t(`${ns}.setup`, 'Set up overnight review')
            : plan.paused ? t(`${ns}.resume`, 'Resume overnight review') : t(`${ns}.edit`, 'Change review time zone')}
        </Button>
        {plan && !edit && !plan.paused && <Button type="button" className="min-h-11" variant="ghost" wrapLabel
          disabled={!writable} onClick={() => void apply({ kind: 'pause', id: plan.id, zone: plan.time_zone })}>
          {t(`${ns}.pause`, 'Pause overnight review')}
        </Button>}
        {plan && !edit && <Button type="button" className="min-h-11" variant="ghost" wrapLabel
          disabled={!writable} onClick={() => void apply({ kind: 'clear', id: plan.id })}>
          {t(`${ns}.clear`, 'Turn off and clear overnight review')}
        </Button>}
      </div>
      {edit && <PrivateReviewTimeZoneForm initialZone={plan?.time_zone ?? tz} disabled={!writable}
        zoneLabel={t(`${ns}.zone`, 'Review time zone')}
        zoneHint={t(`${ns}.zoneHelp`, 'Use a time zone such as America/New_York or UTC. The review covers 10 PM to 6 AM in that time zone.')}
        consentLabel={t(`${ns}.consent`, 'I want a private morning review for this vehicle using local parked history.')}
        confirmLabel={t(`${ns}.confirm`, 'Confirm private overnight review')}
        onConfirm={(zone) => void apply({ kind: 'enable', id: plan?.id ?? 0, zone })} />}
      {failed && <ErrorText role="alert">{t(`${ns}.failed`, 'The review could not be changed. Check the time zone or refresh and try again.')}</ErrorText>}
    </div>
  );
}
