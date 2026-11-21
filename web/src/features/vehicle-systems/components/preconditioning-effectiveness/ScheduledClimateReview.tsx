import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useClimateScheduleReview, useClimateScheduleReviewChange } from '@/api/hooks/useClimateScheduleReview';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ErrorText, Select, Text, Toggle } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';

const anchor = 'scheduled-climate-review';
const ns = 'preconditioningEffectiveness.scheduledClimate';

export function ScheduledClimateReview({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const linkedId = hash === `#${anchor}` ? params.get('climate_review_vehicle_id') : null;
  const activeVehicle = linkedId != null && linkedId !== String(vehicleId) ? null : vehicleId;
  return <PrivateVehicleReviewPanel anchor={anchor} vehicleId={activeVehicle}
    title={t(`${ns}.title`, 'Private scheduled climate review')}
    description={t(`${ns}.description`, 'Off by default. Review repeated scheduled cabin starts from local history. Nothing is sent outside TeslaSync and no automation is changed.')}
    openLabel={t(`${ns}.open`, 'Review scheduled climate')}
    signInPrompt={t(`${ns}.signIn`, 'Sign in to set up or view your private schedule review.')}
    vehiclePrompt={t(`${ns}.selectVehicle`, 'Select the vehicle for this review. A linked vehicle may no longer be available.')}>
    {props => <ScheduleDetails key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
  </PrivateVehicleReviewPanel>;
}

function ScheduleDetails({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const query = useClimateScheduleReview(scope, vehicleId);
  const state = useDataState(query);
  const change = useClimateScheduleReviewChange(scope, vehicleId);
  const [edit, setEdit] = useState(false);
  const [selected, setSelected] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const invoker = useRef<HTMLButtonElement>(null);
  const choice = useRef<HTMLSelectElement>(null);
  const restore = useRef(false);
  const trusted = !identityPending && !query.isFetching && state.status === 'ok';
  const writable = trusted && !change.isPending;
  useEffect(() => {
    if (edit) choice.current?.focus();
    else if (restore.current && writable) {
      invoker.current?.focus();
      restore.current = false;
    }
  }, [edit, writable]);

  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  if (denied || state.fatalError) return <QueryError error={state.fatalError ?? query.error} onRetry={() => void query.refetch()} />;
  if (!state.data) return <Skeleton lines={2} />;

  const { plan } = state.data;
  const schedules = state.data.options ?? [];
  const option = schedules.find(schedule => String(schedule.id) === selected);
  const active = schedules.find(schedule => schedule.id === plan?.automation_id);
  const evidence = plan?.current && plan.evidence && Date.parse(plan.evidence.expires_at) > Date.now() ? plan.evidence : null;
  const formatRun = (time: string) => formatDateTime(time, active?.time_zone ? { tz: active.time_zone } : undefined);
  const done = () => {
    restore.current = true;
    setEdit(false);
    setConfirmed(false);
  };
  const save = async (enable: boolean) => {
    if (enable ? !confirmed || !option : !plan) return;
    setFailed(false);
    try {
      await change.mutateAsync({ id: plan?.id ?? 0, schedule: enable ? option : undefined });
      done();
    } catch {
      setFailed(true);
    }
  };

  return <div className="space-y-3">
    <StaleRefreshWarning state={state} />
    <Text as="p" variant="bodySm" role="status">{!plan
      ? schedules.length === 0
        ? t(`${ns}.needsSetup`, 'Needs setup. Create an enabled automation for this vehicle with one schedule and one Start climate action.')
        : t(`${ns}.off`, 'Off. No scheduled climate review is active for this vehicle.')
      : !plan.current
        ? t(`${ns}.changed`, 'Paused. This automation changed; review its current version before resuming.')
        : evidence
          ? t(`${ns}.ready`, 'Active. A weekly review is available.')
          : t(`${ns}.learning`, 'Learning. Waiting for three matching weekdays with enough parked telemetry.')}</Text>
    {plan?.current && active && <Text as="p" variant="bodySm">
      {t(`${ns}.selectedSchedule`, 'Selected schedule: {{name}} ({{zone}}).', { name: active.name, zone: active.time_zone })}
    </Text>}
    {evidence && <div className="space-y-2">
      <Text as="p" variant="bodySm">{t(`${ns}.summary`, 'Climate started near {{count}} matching scheduled runs with no observed drive in the next 90 minutes.', {
        count: (evidence.run_times ?? []).length,
      })}</Text>
      <ul className="list-disc space-y-1 pl-5">
        {(evidence.run_times ?? []).map(time => <li key={time}><Text variant="bodySm">{formatRun(time)}</Text></li>)}
      </ul>
      <Text as="p" variant="bodySm">{t(`${ns}.coverage`, 'Latest parked evidence: {{last}}. Review expires {{expiry}}.', {
        last: formatRun(evidence.observed_through), expiry: formatRun(evidence.expires_at),
      })}</Text>
      {trusted && active && <Link className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2"
        to={`/automations/history?automation_id=${active.id}`}>
        {t(`${ns}.history`, 'View the schedule’s run history')}
      </Link>}
    </div>}
    {schedules.length > 0 && <Button ref={invoker} type="button" className="min-h-11" wrapLabel
      variant="secondary" disabled={!writable} aria-expanded={edit}
      onClick={() => {
        if (edit) { done(); return; }
        setSelected(active ? String(active.id) : '');
        setFailed(false);
        setEdit(true);
      }}>
      {plan ? t(`${ns}.change`, 'Change reviewed schedule') : t(`${ns}.start`, 'Set up schedule review')}
    </Button>}
    {plan && !edit && <Button type="button" className="min-h-11" wrapLabel variant="ghost"
      disabled={!writable} onClick={() => void save(false)}>
      {t(`${ns}.clear`, 'Turn off and clear review')}
    </Button>}
    {edit && <div className="space-y-3">
      <Select ref={choice} value={selected} label={t(`${ns}.schedule`, 'Scheduled climate automation')}
        placeholder={t(`${ns}.choose`, 'Choose a schedule')} disabled={!writable}
        options={schedules.map(schedule => ({
          value: String(schedule.id),
          label: t(`${ns}.option`, '{{name}} ({{zone}})', { name: schedule.name, zone: schedule.time_zone }),
        }))}
        onChange={event => { setSelected(event.target.value); setConfirmed(false); }} />
      <Toggle label={t(`${ns}.consent`, 'I want a private weekly review of this schedule using local vehicle history.')}
        checked={confirmed} onChange={setConfirmed} disabled={!writable} />
      <Button type="button" className="min-h-11" wrapLabel disabled={!writable || !confirmed || !option}
        onClick={() => void save(true)}>{t(`${ns}.confirm`, 'Confirm private review')}</Button>
    </div>}
    {failed && <ErrorText role="alert">{t(`${ns}.failed`, 'The review could not be changed. Refresh and try again.')}</ErrorText>}
  </div>;
}
