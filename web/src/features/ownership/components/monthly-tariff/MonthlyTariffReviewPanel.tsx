import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useMonthlyTariffReview, useMonthlyTariffReviewChange } from '@/api/hooks/useMonthlyTariffReview';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry';
import { MonthlyTariffReviewForm } from './MonthlyTariffReviewForm';
import { MonthlyTariffReviewEvidence } from './MonthlyTariffReviewEvidence';

interface TariffReviewActions {
  onReviewTariffs: () => void;
}

export function MonthlyTariffReviewPanel({ vehicleId, onReviewTariffs }: { vehicleId: number | null } & TariffReviewActions) {
  const { t } = useTranslation();
  return <PrivateVehicleReviewPanel vehicleId={vehicleId} anchor="monthly-tariff-review"
    title={t('ownership.tariff.monthly.title', 'Monthly tariff review')}
    description={t('ownership.tariff.monthly.description', 'Check whether a saved alternative would have cost less at one charging place without changing when you charge. Off by default. This private review does not send notifications outside TeslaSync, contact a provider, or change plans.')}
    openLabel={t('ownership.tariff.monthly.open', 'Open monthly tariff review')}
    signInPrompt={t('ownership.tariff.monthly.signIn', 'Sign in to review tariffs privately.')}
    vehiclePrompt={t('ownership.tariff.monthly.vehicle', 'Select a vehicle to review its charging tariff.')}>
    {props => <Details key={`${props.scope.subject}:${props.vehicleId}`} {...props} onReviewTariffs={onReviewTariffs} />}
  </PrivateVehicleReviewPanel>;
}

function Details({ scope, vehicleId, identityPending, onReviewTariffs }: PrivateVehicleReviewScope & TariffReviewActions) {
  const { t } = useTranslation();
  const { formatDateTime, tz } = useDateFormat('user');
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useMonthlyTariffReview(scope, vehicleId);
  const source = useDataState(query);
  const change = useMonthlyTariffReviewChange(scope, vehicleId);
  const [editPlan, setEditPlan] = useState<number>();
  const [clearPlan, setClearPlan] = useState<number>();
  const setupButton = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const review = source.data;
  const settings = review?.settings;
  const live = usePrivateReviewExpiry(review?.digest?.expires_at, query.refetch);
  const digest = live && !review?.needs_review ? review?.digest : undefined;
  const fresh = !identityPending && source.status === 'ok' && !query.isFetching && !change.isPending;
  const blocked = !fresh || !canWrite;
  useEffect(() => {
    if (restore.current && editPlan == null && !blocked) {
      setupButton.current?.focus();
      restore.current = false;
    }
  }, [blocked, editPlan]);

  const refreshError = source.refreshError;
  const denied = isApiError(refreshError) &&
    (refreshError.code === 'IDENTITY_CHANGED' || [401, 403, 404].includes(refreshError.status));
  const unavailable = source.fatalError ?? (denied ? refreshError : null);
  if (unavailable) return <QueryError error={unavailable} onRetry={() => void query.refetch()} />;
  if (!review) return query.fetchStatus === 'paused'
    ? <Text as="p" variant="bodySm">{t('ownership.tariff.monthly.offline', 'Reconnect to view or change the monthly tariff review.')}</Text>
    : <Skeleton lines={2} />;

  const closeSetup = () => {
    restore.current = true;
    setEditPlan(undefined);
  };
  const apply = (input: Parameters<typeof change.mutate>[0]) => change.mutate(input, { onSuccess: () => {
    closeSetup();
    setClearPlan(undefined);
  } });
  const clearLabel = t('ownership.tariff.monthly.clear', 'Turn off and clear tariff review');
  let status: string;
  if (!settings) status = t('ownership.tariff.monthly.off', 'Off. No monthly tariff check is scheduled.');
  else if (settings.paused) status = t('ownership.tariff.monthly.paused', 'Paused. No new charging history is checked.');
  else if (review.needs_review) status = t('ownership.tariff.monthly.changed', 'Needs setup. The selected place or tariff terms changed. Review them before resuming.');
  else if (digest) status = t('ownership.tariff.monthly.active', 'Active. A private tariff comparison is ready.');
  else if (review.last_checked_at) status = t('ownership.tariff.monthly.quiet', 'Active. Insufficient evidence, small savings and dismissed comparisons stay quiet.');
  else status = t('ownership.tariff.monthly.waiting', 'Learning. Waiting for the first scheduled check.');

  return <div className="space-y-3">
    <StaleRefreshWarning state={source} />
    <Text as="p" role="status" variant="bodySm">{status}</Text>
    {settings && review.last_checked_at && <Text as="p" variant="caption">
      {t('ownership.tariff.monthly.lastChecked', 'Last checked: {{date}}.', {
        date: formatDateTime(review.last_checked_at, { tz: settings.time_zone }),
      })}
    </Text>}
    {digest && settings && !settings.paused && <div className="space-y-3">
      <MonthlyTariffReviewEvidence digest={digest} zone={settings.time_zone} currency={review.currency}
        site={review.site_name} current={review.current_name} alternative={review.alternative_name} />
      <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={blocked}
        onClick={() => apply({ kind: 'dismiss', planID: settings.id, through: digest.through })}>
        {t('ownership.tariff.monthly.dismiss', 'Dismiss this tariff comparison')}
      </Button>
    </div>}
    <Text as="p" variant="caption">
      {t('ownership.tariff.monthly.receipts', 'Add itemized energy-only bills with the charging place and station-meter evidence. Unmatched, disputed or extra-fee bills do not qualify.')}
    </Text>
    {fresh && <Link to={`/ownership/charging-reconciliation?vehicle_id=${vehicleId}`} className="inline-flex min-h-11 items-center underline">
      {t('ownership.tariff.monthly.bills', 'Review charging invoices')}
    </Link>}
    {change.error && <QueryError error={change.error} />}
    {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
    <div className="flex flex-wrap gap-2">
      <Button ref={setupButton} type="button" className="min-h-11" variant="secondary" wrapLabel aria-expanded={editPlan != null}
        disabled={blocked} onClick={() => {
          change.reset();
          if (editPlan != null) closeSetup();
          else setEditPlan(settings?.id ?? 0);
        }}>
        {editPlan != null ? t('ownership.tariff.monthly.cancelSetup', 'Cancel tariff review changes')
          : !settings ? t('ownership.tariff.monthly.setup', 'Set up monthly tariff review')
          : settings.paused ? t('ownership.tariff.monthly.resume', 'Resume tariff review')
            : t('ownership.tariff.monthly.edit', 'Edit tariff review')}
      </Button>
      {settings && editPlan == null && <>
        {!settings.paused && <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={blocked}
          onClick={() => apply({ kind: 'save', settings: { ...settings, paused: true } })}>
          {t('ownership.tariff.monthly.pause', 'Pause tariff review')}
        </Button>}
        <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={blocked}
          onClick={() => setClearPlan(settings.id)}>{clearLabel}</Button>
      </>}
    </div>
    {editPlan != null && <MonthlyTariffReviewForm scope={scope} initial={settings} initialCurrency={review.currency}
      defaultZone={tz} disabled={blocked || editPlan !== (settings?.id ?? 0)}
      onReviewTariffs={onReviewTariffs}
      onSave={value => apply({ kind: 'save', settings: value })} />}
    {clearPlan != null && <ConfirmDialog open variant="danger" title={clearLabel} confirmLabel={clearLabel}
      message={t('ownership.tariff.monthly.clearDetail', 'Stop checks and clear the consent and comparison? Saved tariffs, charging records and bills will be kept.')}
      loading={change.isPending} confirmDisabled={blocked || clearPlan !== settings?.id} onCancel={() => setClearPlan(undefined)}
      onConfirm={() => { if (!blocked && clearPlan === settings?.id) apply({ kind: 'clear', planID: clearPlan }); }} />}
  </div>;
}
