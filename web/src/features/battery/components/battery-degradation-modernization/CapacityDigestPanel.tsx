import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useCapacityDigest, useCapacityDigestChange } from '@/api/hooks/useCapacityDigest';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ErrorText, Text } from '@/components/ui';
import { PrivateReviewTimeZoneForm, PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry';
import { CapacityDigestEvidence } from './CapacityDigestEvidence';

const ns = 'battery.degradation.capacityDigest';

export function CapacityDigestPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return (
    <PrivateVehicleReviewPanel anchor="battery-capacity-digest" vehicleId={vehicleId}
      title={t(`${ns}.title`, 'Private monthly battery digest')}
      description={t(`${ns}.description`, 'Off by default. Compare usable-energy estimates across similar charge sessions using only your local vehicle history. No push or sharing.')}
      openLabel={t(`${ns}.open`, 'Review monthly battery digest')}
      signInPrompt={t(`${ns}.signIn`, 'Sign in to set up or view your private battery digest.')}
      vehiclePrompt={t(`${ns}.vehicle`, 'Select the vehicle to review.')}>
      {props => <CapacityDigestDetails key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
    </PrivateVehicleReviewPanel>
  );
}

function CapacityDigestDetails({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const { tz } = useDateFormat();
  const query = useCapacityDigest(scope, vehicleId);
  const state = useDataState(query);
  const change = useCapacityDigestChange(scope, vehicleId);
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const invoker = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const writable = !identityPending && !query.isFetching && state.status === 'ok' && !change.isPending;
  const plan = state.data?.plan;
  const { refetch } = query;
  const current = usePrivateReviewExpiry(plan?.digest?.expires_at, refetch);
  const digest = current ? plan?.digest : undefined;

  useEffect(() => {
    if (!editing && restore.current && writable) {
      invoker.current?.focus();
      restore.current = false;
    }
  }, [editing, writable]);

  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  if (denied || state.fatalError) return <QueryError error={state.fatalError ?? query.error} onRetry={() => void refetch()} />;
  if (!state.data) return <Skeleton lines={2} />;

  const finish = () => {
    restore.current = true;
    setEditing(false);
  };
  const apply = async (input: Parameters<typeof change.mutateAsync>[0]) => {
    setFailed(false);
    try {
      await change.mutateAsync(input);
      finish();
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="space-y-3">
      <StaleRefreshWarning state={state} />
      <Text as="p" variant="bodySm" role="status">{!plan
        ? t(`${ns}.off`, 'Off. No monthly battery review is scheduled for this vehicle.')
        : plan.paused
          ? t(`${ns}.paused`, 'Paused. No monthly checks until you resume.')
          : digest
            ? t(`${ns}.available`, 'Active. A private monthly digest is available.')
            : t(`${ns}.quiet`, 'Active. No digest is available. The feature stays quiet without enough comparable data or a lasting change.')}</Text>
      {plan && digest && <CapacityDigestEvidence digest={digest} zone={plan.time_zone} writable={writable}
        dismiss={() => void apply({ kind: 'dismiss', id: plan.id, periodEnd: digest.recent_to })} />}
      <div className="flex flex-wrap gap-2">
        <Button ref={invoker} type="button" className="min-h-11" variant="secondary" wrapLabel
          disabled={!writable} aria-expanded={editing} onClick={() => {
            if (editing) { finish(); return; }
            setFailed(false);
            setEditing(true);
          }}>
          {!plan ? t(`${ns}.setup`, 'Set up monthly battery review')
            : plan.paused ? t(`${ns}.resume`, 'Resume monthly battery review') : t(`${ns}.edit`, 'Change digest time zone')}
        </Button>
        {plan && !editing && !plan.paused && <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={!writable}
          onClick={() => void apply({ kind: 'pause', id: plan.id, zone: plan.time_zone })}>
          {t(`${ns}.pause`, 'Pause monthly review')}
        </Button>}
        {plan && !editing && <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={!writable}
          onClick={() => void apply({ kind: 'clear', id: plan.id })}>
          {t(`${ns}.clear`, 'Turn off and clear monthly digest')}
        </Button>}
      </div>
      {editing && <PrivateReviewTimeZoneForm initialZone={plan?.time_zone ?? tz} disabled={!writable}
        zoneLabel={t(`${ns}.zone`, 'Digest time zone')}
        zoneHint={t(`${ns}.zoneHelp`, 'Use a time zone such as America/New_York or UTC. The monthly check begins at 5 AM on the second day in that time zone.')}
        consentLabel={t(`${ns}.consent`, 'I want a private monthly digest for this vehicle using local charging history.')}
        confirmLabel={t(`${ns}.confirm`, 'Confirm private monthly digest')}
        onConfirm={(zone) => void apply({ kind: 'enable', id: plan?.id ?? 0, zone })} />}
      {failed && <ErrorText role="alert">{t(`${ns}.failed`, 'The digest settings could not be changed. Check the time zone or refresh and try again.')}</ErrorText>}
    </div>
  );
}
