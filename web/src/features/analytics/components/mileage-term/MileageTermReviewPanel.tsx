import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useMileageTermReview, useMileageTermReviewChange } from '@/api/hooks/useMileageTermReview';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry';
import { MileageTermEvidence } from './MileageTermEvidence';
import { MileageTermForm } from './MileageTermForm';

export function MileageTermReviewPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return <PrivateVehicleReviewPanel vehicleId={vehicleId} anchor="monthly-mileage-review"
    title={t('mileageBudget.review.title', 'Monthly mileage review')}
    description={t('mileageBudget.review.description', 'Check your actual lease or total-distance reimbursement allowance each month. Off by default. This private review does not send push notifications or contact a provider.')}
    openLabel={t('mileageBudget.review.open', 'Open monthly mileage review')}
    signInPrompt={t('mileageBudget.review.signIn', 'Sign in to review an allowance privately.')}
    vehiclePrompt={t('mileageBudget.review.vehicle', 'Select a vehicle to review its allowance.')}>
    {props => <Details key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
  </PrivateVehicleReviewPanel>;
}

function Details({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { tz } = useDateFormat('user');
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useMileageTermReview(scope, vehicleId);
  const source = useDataState(query);
  const change = useMileageTermReviewChange(scope, vehicleId);
  const [editing, setEditing] = useState<number>();
  const [clearing, setClearing] = useState<number>();
  const mainButton = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const review = source.data;
  const settings = review?.settings;
  const live = usePrivateReviewExpiry(review?.digest?.expires_at, query.refetch);
  const digest = live ? review?.digest : null;
  const blocked = !canWrite || identityPending || source.status !== 'ok' || query.isFetching || change.isPending;
  useEffect(() => {
    if (restore.current && editing == null && !blocked) {
      mainButton.current?.focus();
      restore.current = false;
    }
  }, [blocked, editing]);

  const refreshError = source.refreshError;
  const denied = isApiError(refreshError) &&
    (refreshError.code === 'IDENTITY_CHANGED' || [401, 403, 404].includes(refreshError.status));
  const unavailable = source.fatalError ?? (denied ? refreshError : null);
  if (unavailable) return <QueryError error={unavailable} onRetry={() => void query.refetch()} />;
  if (!review) return source.isRefreshBlocked
    ? <Text as="p" variant="bodySm">{t('mileageBudget.review.offline', 'Reconnect to view or change the monthly mileage review.')}</Text>
    : <Skeleton lines={2} />;

  const closeSetup = () => {
    restore.current = true;
    setEditing(undefined);
  };
  const apply = (input: Parameters<typeof change.mutate>[0]) => change.mutate(input, { onSuccess: () => {
    closeSetup();
    setClearing(undefined);
  } });
  const clearLabel = t('mileageBudget.review.clear', 'Turn off and clear mileage review');
  let status: string;
  if (!settings) status = t('mileageBudget.review.off', 'Off. No monthly allowance check is scheduled.');
  else if (settings.paused) status = t('mileageBudget.review.paused', 'Paused. No new odometer history is checked.');
  else if (digest) status = t('mileageBudget.review.active', 'Active. A private mileage review is ready.');
  else if (!review.next_check_at) status = t('mileageBudget.review.ended', 'No further monthly check fits within these term dates.');
  else if (review.last_checked_at) status = t('mileageBudget.review.quiet', 'Active. On-budget, dismissed and insufficient-evidence results stay quiet.');
  else status = t('mileageBudget.review.waiting', 'Learning. Waiting for the first scheduled check.');

  return <div className="space-y-3">
    <StaleRefreshWarning state={source} />
    <Text as="p" role="status" variant="bodySm">{status}</Text>
    {settings && review.next_check_at && <Text as="p" variant="caption">
      {t('mileageBudget.review.next', 'Next check: {{date}}.', {
        date: formatDateTime(review.next_check_at),
      })}
    </Text>}
    {digest && settings && !settings.paused && <div className="space-y-3">
      <MileageTermEvidence digest={digest} settings={settings} />
      <div className="flex flex-wrap gap-2">
        <Link to={`/drives?vehicle_id=${vehicleId}`} className="inline-flex min-h-11 items-center underline">
          {t('mileageBudget.review.drives', 'Review recorded drives')}
        </Link>
        <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={blocked}
          onClick={() => apply({ kind: 'dismiss', planID: settings.id, through: digest.through })}>
          {t('mileageBudget.review.dismiss', 'Dismiss this mileage estimate')}
        </Button>
      </div>
    </div>}
    {change.error && <QueryError error={change.error} />}
    {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
    <div className="flex flex-wrap gap-2">
      <Button ref={mainButton} type="button" className="min-h-11" variant="secondary" wrapLabel aria-expanded={editing != null}
        disabled={blocked} onClick={() => {
          change.reset();
          if (editing != null) closeSetup();
          else setEditing(settings?.id ?? 0);
        }}>
        {editing != null ? t('mileageBudget.review.cancel', 'Cancel mileage review changes')
          : !settings ? t('mileageBudget.review.setup', 'Set up monthly mileage review')
          : settings.paused ? t('mileageBudget.review.resume', 'Resume mileage review')
            : t('mileageBudget.review.edit', 'Edit allowance terms')}
      </Button>
      {settings && editing == null && <>
        {!settings.paused && <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={blocked}
          onClick={() => apply({ kind: 'save', settings: { ...settings, paused: true } })}>
          {t('mileageBudget.review.pause', 'Pause mileage review')}
        </Button>}
        <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={blocked}
          onClick={() => setClearing(settings.id)}>{clearLabel}</Button>
      </>}
    </div>
    {editing != null && <MileageTermForm initial={settings} defaultZone={tz} disabled={blocked || editing !== (settings?.id ?? 0)}
      onSave={value => apply({ kind: 'save', settings: value })} />}
    {clearing != null && <ConfirmDialog open variant="danger" title={clearLabel} confirmLabel={clearLabel}
      message={t('mileageBudget.review.clearDetail', 'Stop checks and clear these private terms and estimates? Your drives and browser-local budget will be kept.')}
      loading={change.isPending} confirmDisabled={blocked || clearing !== settings?.id} onCancel={() => setClearing(undefined)}
      onConfirm={() => { if (!blocked && clearing === settings?.id) apply({ kind: 'clear', planID: clearing }); }} />}
  </div>;
}
