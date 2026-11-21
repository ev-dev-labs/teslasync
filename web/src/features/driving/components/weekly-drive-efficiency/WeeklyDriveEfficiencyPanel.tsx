import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { isApiError } from '@/api/client';
import { useWeeklyDriveEfficiency, useWeeklyDriveEfficiencyChange } from '@/api/hooks/useWeeklyDriveEfficiency';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, Input, Text, Toggle } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry';
import type { WeeklyDriveEfficiencyState } from '@/types/weeklyDriveEfficiency';
import { WeeklyDriveDigestEvidence } from './WeeklyDriveDigestEvidence';

export function WeeklyDriveEfficiencyPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return <PrivateVehicleReviewPanel vehicleId={vehicleId} anchor="private-weekly-efficiency"
    title={t('routeEfficiency.weekly.title', 'Private weekly drive efficiency')}
    description={t('routeEfficiency.weekly.description', 'Off by default. Review sustained consumption changes on comparable drives without a push or driver ranking.')}
    openLabel={t('routeEfficiency.weekly.open', 'Open weekly efficiency review')}
    vehiclePrompt={t('routeEfficiency.weekly.vehicle', 'Select a vehicle to set up a private weekly review.')}
    signInPrompt={t('routeEfficiency.weekly.signIn', 'Sign in to set up a private weekly review.')}>
    {props => <Details key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
  </PrivateVehicleReviewPanel>;
}

function Details({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tz, formatDateTime } = useDateFormat('user');
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useWeeklyDriveEfficiency(scope, vehicleId);
  const source = useDataState(query);
  const change = useWeeklyDriveEfficiencyChange(scope, vehicleId);
  const [draft, setDraft] = useState<{ revision: number; zone: string; confirmed: boolean }>();
  const [clear, setClear] = useState<number>();
  const field = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const active = useRef(false);
  const checkingPark = useRef(false);
  const state = source.data;
  const plan = state?.plan;
  const current = usePrivateReviewExpiry(state?.digest?.expires_at, query.refetch);
  const parked = usePrivateReviewExpiry(state?.review_allowed_until ?? undefined, query.refetch);
  const digest = current ? state?.digest : null;
  const blocked = !canWrite || identityPending || source.status !== 'ok' || query.isFetching || change.isPending;
  const editing = draft != null;
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);
  useEffect(() => {
    if (restore.current && !blocked && parked && !editing) {
      editor.current?.focus();
      restore.current = false;
    }
  }, [blocked, editing, parked]);
  const refreshError = source.refreshError;
  const error = source.fatalError ?? (isApiError(refreshError) &&
    (refreshError.code === 'IDENTITY_CHANGED' || [401, 403, 404].includes(refreshError.status)) ? refreshError : null);
  if (error) return <QueryError error={error} onRetry={() => void query.refetch()} />;
  if (!state) return source.isRefreshBlocked
    ? <Text variant="bodySm">{t('routeEfficiency.weekly.offline', 'Reconnect to view or change the weekly review.')}</Text>
    : <Skeleton lines={2} />;
  const revision = plan?.revision ?? 0;
  const finish = () => {
    restore.current = true;
    setDraft(undefined);
  };
  const withFreshPark = async (action: (latest: WeeklyDriveEfficiencyState) => void) => {
    if (blocked || !parked || checkingPark.current) return;
    checkingPark.current = true;
    try {
      const { data: latest, isSuccess } = await query.refetch();
      if (active.current && isSuccess && latest && (latest.plan?.revision ?? 0) === revision &&
        Date.parse(latest.review_allowed_until ?? '') > Date.now()) {
        action(latest);
      }
    } finally {
      checkingPark.current = false;
    }
  };
  const clearLabel = t('routeEfficiency.weekly.clear', 'Turn off and clear weekly review');
  return <div className="space-y-3">
    <StaleRefreshWarning state={source} />
    <Text as="p" role="status" variant="bodySm">{!plan
      ? t('routeEfficiency.weekly.off', 'Off. No drive history is checked for this digest.')
      : plan.paused ? t('routeEfficiency.weekly.paused', 'Paused. No weekly comparison will be prepared.')
        : digest ? t('routeEfficiency.weekly.ready', 'Active. A private weekly comparison is ready.')
          : state.dismissed ? t('routeEfficiency.weekly.dismissed', 'Dismissed for this week.')
            : t('routeEfficiency.weekly.quiet', 'Active. No qualifying weekly change is ready.')}</Text>
    {plan?.next_check_at && <Text variant="caption">{t('routeEfficiency.weekly.next', 'Next check: {{date}}.', {
      date: formatDateTime(plan.next_check_at, { tz: plan.time_zone }),
    })}</Text>}
    {change.error && <QueryError error={change.error} />}
    {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
    {!parked && <Text as="p" variant="caption">{t('routeEfficiency.weekly.parkToReview', 'Park and wait for fresh vehicle data to review or edit the digest. You can still pause or clear it.')}</Text>}
    <div className="flex flex-wrap gap-2">
      <Button ref={editor} type="button" className="min-h-11" variant="secondary" wrapLabel disabled={!editing && (blocked || !parked)}
        aria-expanded={editing}
        onClick={() => {
          if (draft) finish();
          else void withFreshPark(latest => setDraft({ revision, zone: latest.plan?.time_zone ?? tz, confirmed: false }));
        }}>
        {draft ? t('routeEfficiency.weekly.cancel', 'Cancel weekly review settings')
          : !plan ? t('routeEfficiency.weekly.setup', 'Set up weekly review')
            : plan.paused ? t('routeEfficiency.weekly.resume', 'Resume weekly review')
              : t('routeEfficiency.weekly.edit', 'Edit weekly review')}
      </Button>
      {plan && !draft && <>
        {!plan.paused && <Button type="button" className="min-h-11" variant="ghost" disabled={blocked}
          onClick={() => change.mutate({ kind: 'pause', revision }, { onSuccess: finish })}>
          {t('routeEfficiency.weekly.pause', 'Pause weekly review')}
        </Button>}
        <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={blocked}
          onClick={() => setClear(revision)}>{clearLabel}</Button>
      </>}
    </div>
    {draft && <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (!blocked && parked && draft.confirmed && draft.revision === revision && draft.zone.trim()) {
        change.mutate({ kind: 'save', revision, zone: draft.zone.trim() }, { onSuccess: finish });
      }
    }}>
      <Input ref={field} label={t('routeEfficiency.weekly.zone', 'Weekly comparison time zone')} required value={draft.zone}
        maxLength={80} disabled={blocked || !parked} onChange={event => setDraft({ ...draft, zone: event.target.value, confirmed: false })} />
      <Toggle label={t('routeEfficiency.weekly.consent', 'Compare this vehicle’s recorded routes, temperatures, speeds and pack energy locally for my private weekly digest.')}
        checked={draft.confirmed} disabled={blocked || !parked} onChange={confirmed => setDraft({ ...draft, confirmed })} />
      <Button type="submit" className="min-h-11" disabled={blocked || !parked || !draft.confirmed || draft.revision !== revision || !draft.zone.trim()}>
        {t('routeEfficiency.weekly.confirm', 'Confirm private weekly review')}
      </Button>
    </form>}
    {plan && digest && <>
      <WeeklyDriveDigestEvidence digest={digest} timeZone={plan.time_zone} canOpenDrive={!blocked && parked}
        onOpenDrive={() => void withFreshPark(latest => {
          if (latest.digest?.reference_drive_id === digest.reference_drive_id && Date.parse(latest.digest.expires_at) > Date.now()) {
            navigate(`/drives/${digest.reference_drive_id}?local_evidence=1`);
          }
        })} />
      <Button type="button" variant="ghost" className="min-h-11" disabled={blocked || !parked}
        onClick={() => change.mutate({ kind: 'dismiss', revision, until: digest.recent_until }, { onSuccess: finish })}>
        {t('routeEfficiency.weekly.dismiss', 'Dismiss this weekly digest')}
      </Button>
    </>}
    {clear != null && <ConfirmDialog open variant="danger" title={clearLabel} confirmLabel={clearLabel}
      message={t('routeEfficiency.weekly.clearDetail', 'Stop weekly checks and remove this private review? The original drives and telemetry will be kept.')}
      loading={change.isPending} confirmDisabled={blocked || clear !== revision}
      details={change.error && <QueryError error={change.error} />}
      onCancel={() => setClear(undefined)} onConfirm={() => {
        if (!blocked && clear === revision) change.mutate({ kind: 'clear', revision }, { onSuccess: () => { setClear(undefined); finish(); } });
      }} />}
  </div>;
}
