import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useRenewalSubscriptions, useSubscriptionRenewal, useSubscriptionRenewalChange } from '@/api/hooks/useSubscriptionRenewal';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, Input, Select, Text, Toggle } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry';
import type { Subscription } from '@/types/ownership';
import { formatCurrencyMinor } from '../../formatters';
import { SubscriptionRenewalEvidence } from './SubscriptionRenewalEvidence';

function privateError(error: unknown) {
  return isApiError(error) && (error.code === 'IDENTITY_CHANGED' || [401, 403, 404].includes(error.status));
}

export function SubscriptionRenewalPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return <PrivateVehicleReviewPanel vehicleId={vehicleId} anchor="private-renewal"
    title={t('ownership.subscription.renewal.title', 'Private subscription renewal review')}
    description={t('ownership.subscription.renewal.description', 'Off by default. Record a renewal date to review the saved price and observed activity before deciding.')}
    openLabel={t('ownership.subscription.renewal.open', 'Open private renewal review')}
    vehiclePrompt={t('ownership.subscription.renewal.vehicle', 'Select a vehicle to set up a private renewal review.')}
    signInPrompt={t('ownership.subscription.renewal.signIn', 'Sign in to set up a private renewal review.')}>
    {props => <Details key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
  </PrivateVehicleReviewPanel>;
}

function Details(props: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const query = useRenewalSubscriptions(props.scope, props.vehicleId);
  const source = useDataState(query);
  const options = (source.data?.items ?? []).filter(row => row.kind === 'subscription' && row.vehicle_id === props.vehicleId);
  const selected = options.find(row => String(row.id) === params.get('subscription_id'));
  const error = source.fatalError ?? (privateError(source.refreshError) ? source.refreshError : null);
  if (error) return <QueryError error={error} onRetry={() => void query.refetch()} />;
  if (!source.hasData) return source.isRefreshBlocked
    ? <Text variant="bodySm">{t('ownership.subscription.renewal.offline', 'Reconnect to view or change a private renewal review.')}</Text>
    : <Skeleton lines={2} />;
  return <div className="space-y-3">
    <StaleRefreshWarning state={source} />
    {options.length === 0 ? <Text variant="bodySm">
      {t('ownership.subscription.renewal.none', 'Add a recurring subscription on this page before setting a renewal date.')}
    </Text> : <Select label={t('ownership.subscription.renewal.select', 'Recurring subscription')} value={selected ? String(selected.id) : ''}
      disabled={props.identityPending || source.status !== 'ok' || query.isFetching}
      options={[{ value: '', label: t('ownership.subscription.renewal.choose', 'Choose a recurring subscription') },
        ...options.map(r => ({ value: String(r.id), label: r.name }))]}
      onChange={event => {
        const next = new URLSearchParams(params);
        if (event.target.value) next.set('subscription_id', event.target.value);
        else next.delete('subscription_id');
        setParams(next, { replace: true });
      }} />}
    {!selected && params.has('subscription_id') && <Text as="p" variant="caption">
      {t('ownership.subscription.renewal.unavailable', 'This subscription is not available for the selected vehicle and sign-in.')}
    </Text>}
    {selected && <Review key={`${selected.id}:${selected.version}`} {...props} subscription={selected}
      identityPending={props.identityPending || source.status !== 'ok' || query.isFetching} />}
  </div>;
}

function Review({ scope, vehicleId, identityPending, subscription }: PrivateVehicleReviewScope & { subscription: Subscription }) {
  const { t } = useTranslation();
  const { formatDateTime, tz, locale } = useDateFormat('user');
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useSubscriptionRenewal(scope, vehicleId, subscription.id);
  const source = useDataState(query);
  const change = useSubscriptionRenewalChange(scope, vehicleId, subscription.id);
  const [draft, setDraft] = useState<{ revision: string; day: string; zone: string; lead: string; confirmed: boolean }>();
  const [clear, setClear] = useState<string>();
  const dayField = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const state = source.data;
  const plan = state?.plan;
  const current = usePrivateReviewExpiry(state?.review?.expires_at, query.refetch);
  const review = current ? state?.review : null;
  const blocked = !canWrite || identityPending || source.status !== 'ok' || query.isFetching || change.isPending;
  const editing = draft != null;
  useEffect(() => { if (editing) dayField.current?.focus(); }, [editing]);
  useEffect(() => {
    if (restore.current && !blocked && !editing) {
      editor.current?.focus();
      restore.current = false;
    }
  }, [blocked, editing]);
  const error = source.fatalError ?? (privateError(source.refreshError) ? source.refreshError : null);
  if (error) return <QueryError error={error} onRetry={() => void query.refetch()} />;
  if (!state) return source.isRefreshBlocked
    ? <Text variant="bodySm">{t('ownership.subscription.renewal.offline', 'Reconnect to view or change a private renewal review.')}</Text>
    : <Skeleton lines={2} />;
  const revision = plan?.revision ?? '';
  const finish = () => {
    restore.current = true;
    setDraft(undefined);
  };
  const clearLabel = t('ownership.subscription.renewal.clear', 'Turn off and clear renewal review');
  const lead = Number(draft?.lead);
  const ready = draft != null && draft.revision === revision && draft.day !== '' && draft.zone.trim() !== '' &&
    Number.isInteger(lead) && lead >= 1 && lead <= 30 && draft.confirmed;
  return <div className="space-y-3">
    <StaleRefreshWarning state={source} />
    <Text as="p" role="status" variant="bodySm">{!plan
      ? t('ownership.subscription.renewal.off', 'Off. No renewal is scheduled.')
      : plan.paused ? t('ownership.subscription.renewal.paused', 'Paused. No review will be prepared.')
        : state.needs_review ? t('ownership.subscription.renewal.changed', 'Needs setup. Check and confirm the current subscription terms.')
          : state.dismissed ? t('ownership.subscription.renewal.dismissed', 'Dismissed for this renewal date.')
            : review ? t('ownership.subscription.renewal.active', 'Active. A private review is ready.')
              : plan.next_check_at ? t('ownership.subscription.renewal.waiting', 'Active. Waiting for the recorded review window.')
                : t('ownership.subscription.renewal.finished', 'No current review. Record the next renewal date to schedule another check.')}</Text>
    {plan?.next_check_at && <Text variant="caption">{t('ownership.subscription.renewal.next', 'Next check: {{date}}.', {
      date: formatDateTime(plan.next_check_at, { tz: plan.time_zone }),
    })}</Text>}
    {change.error && <QueryError error={change.error} />}
    {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
    <div className="flex flex-wrap gap-2">
      <Button ref={editor} type="button" className="min-h-11" variant="secondary" wrapLabel disabled={blocked}
        aria-expanded={editing}
        onClick={() => draft ? finish() : setDraft({ revision, day: plan?.renewal_day ?? '', zone: plan?.time_zone ?? tz,
          lead: String(plan?.lead_days ?? 7), confirmed: false })}>
        {draft ? t('ownership.subscription.renewal.cancel', 'Cancel renewal settings')
          : !plan ? t('ownership.subscription.renewal.setup', 'Set up renewal review')
            : plan.paused ? t('ownership.subscription.renewal.resume', 'Resume review')
              : t('ownership.subscription.renewal.edit', 'Edit renewal settings')}
      </Button>
      {plan && !draft && <>
        {!plan.paused && <Button type="button" className="min-h-11" variant="ghost" disabled={blocked}
          onClick={() => change.mutate({ kind: 'pause', revision, subscriptionVersion: subscription.version }, { onSuccess: finish })}>
          {t('ownership.subscription.renewal.pause', 'Pause renewal review')}
        </Button>}
        <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={blocked} onClick={() => setClear(revision)}>{clearLabel}</Button>
      </>}
    </div>
    {draft && <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (!blocked && ready) {
        change.mutate({ kind: 'save', revision, subscriptionVersion: subscription.version,
          terms: { renewal_day: draft.day, time_zone: draft.zone.trim(), lead_days: lead } }, { onSuccess: finish });
      }
    }}>
      <Input ref={dayField} type="date" label={t('ownership.subscription.renewal.date', 'Recorded renewal date')}
        required value={draft.day} disabled={blocked} onChange={event => setDraft({ ...draft, day: event.target.value, confirmed: false })} />
      <Input label={t('ownership.subscription.renewal.zone', 'Renewal time zone')} required value={draft.zone} maxLength={80}
        disabled={blocked} onChange={event => setDraft({ ...draft, zone: event.target.value, confirmed: false })} />
      <Input type="number" label={t('ownership.subscription.renewal.lead', 'Days before renewal to review')} min={1} max={30}
        required value={draft.lead} disabled={blocked} onChange={event => setDraft({ ...draft, lead: event.target.value, confirmed: false })} />
      <Toggle label={t('ownership.subscription.renewal.consent', 'Use my recorded renewal date and price of {{price}} and this vehicle’s recorded activity for a private review.', {
        price: `${formatCurrencyMinor(subscription.price_minor, subscription.currency, locale)} ${subscription.currency}`,
      })} checked={draft.confirmed} disabled={blocked} onChange={confirmed => setDraft({ ...draft, confirmed })} />
      <Button type="submit" className="min-h-11" wrapLabel disabled={blocked || !ready}>
        {t('ownership.subscription.renewal.confirm', 'Confirm private renewal review')}
      </Button>
    </form>}
    {plan && review && <>
      <SubscriptionRenewalEvidence review={review} timeZone={plan.time_zone} />
      <Button type="button" variant="ghost" className="min-h-11" disabled={blocked}
        onClick={() => change.mutate({ kind: 'dismiss', revision }, { onSuccess: finish })}>
        {t('ownership.subscription.renewal.dismiss', 'Dismiss this renewal review')}
      </Button>
    </>}
    {clear != null && <ConfirmDialog open variant="danger" title={clearLabel} confirmLabel={clearLabel}
      message={t('ownership.subscription.renewal.clearDetail', 'Remove this private review and stop its checks? The subscription record and vehicle history will be kept.')}
      loading={change.isPending} confirmDisabled={blocked || clear !== revision}
      details={change.error && <QueryError error={change.error} />}
      onCancel={() => setClear(undefined)} onConfirm={() => {
        if (!blocked && clear === revision) change.mutate({ kind: 'clear', revision }, { onSuccess: () => { setClear(undefined); finish(); } });
      }} />}
  </div>;
}
