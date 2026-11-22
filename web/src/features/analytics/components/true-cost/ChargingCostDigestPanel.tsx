import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useChargingCostDigest, useChargingCostDigestChange } from '@/api/hooks/useChargingCostDigest';
import { KVList } from '@/components/data-display';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, PanelTitle, Text } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry';
import { useUnits } from '@/hooks/useUnits';
import { currencyFractionDigits, formatCurrencyValue } from '@/lib/currencyFormat';
import type { ChargingCostCoverage, ChargingCostDigest, ChargingCostDigestSettings } from '@/types/chargingCostDigest';
import { ChargingCostDigestForm } from './ChargingCostDigestForm';

export function ChargingCostDigestPanel({ vehicleId }: { vehicleId: number | null }) {
  const { t } = useTranslation();
  return <PrivateVehicleReviewPanel vehicleId={vehicleId} anchor="charging-cost-digest"
    title={t('tco.costDigest.title', 'Monthly charging cost change')}
    description={t('tco.costDigest.description', 'Compare recorded bills from two completed months in one currency. This private review is off by default and never sends a push or contacts a provider.')}
    openLabel={t('tco.costDigest.open', 'Review monthly charging costs')}
    signInPrompt={t('tco.costDigest.signIn', 'Sign in to review charging costs privately.')}
    vehiclePrompt={t('tco.costDigest.vehicle', 'Select a vehicle to review its monthly charging costs.')}>
    {props => <Details key={`${props.scope.subject}:${props.vehicleId}`} {...props} />}
  </PrivateVehicleReviewPanel>;
}

function Details({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const { formatDateTime, tz } = useDateFormat('user');
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useChargingCostDigest(scope, vehicleId);
  const source = useDataState(query);
  const change = useChargingCostDigestChange(scope, vehicleId);
  const [edit, setEdit] = useState<ChargingCostDigestSettings>();
  const [clear, setClear] = useState<number>();
  const settingsButton = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const review = source.data;
  const settings = review?.settings;
  const { refetch } = query;
  const current = usePrivateReviewExpiry(review?.digest?.expires_at, refetch);
  const digest = current ? review?.digest : undefined;
  const fresh = !identityPending && source.status === 'ok' && !query.isFetching && !change.isPending;
  const busy = !fresh || !canWrite;

  useEffect(() => {
    if (restore.current && !edit && !busy) {
      settingsButton.current?.focus();
      restore.current = false;
    }
  }, [busy, edit]);

  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  const unavailable = source.fatalError ?? (denied ? source.refreshError : null);
  if (unavailable) return <QueryError error={unavailable} onRetry={() => void refetch()} />;
  if (!review) return query.fetchStatus === 'paused'
    ? <Text as="p" variant="bodySm">{t('tco.costDigest.offline', 'Reconnect to view or change the charging cost review.')}</Text>
    : <Skeleton lines={2} />;

  const apply = (input: Parameters<typeof change.mutate>[0]) => change.mutate(input, { onSuccess: () => {
    restore.current = true;
    setEdit(undefined);
    setClear(undefined);
  } });
  const closeEdit = () => {
    setEdit(undefined);
    restore.current = true;
  };
  const deleteLabel = t('tco.costDigest.clear', 'Turn off and clear monthly review');

  return <div className="space-y-3">
    <StaleRefreshWarning state={source} />
    <Text as="p" variant="bodySm" role="status">{!settings
      ? t('tco.costDigest.off', 'Off. No monthly cost check is scheduled.')
      : settings.paused
        ? t('tco.costDigest.paused', 'Paused. No new history is checked.')
        : digest
          ? t('tco.costDigest.active', 'Active. A private monthly comparison is ready.')
          : t('tco.costDigest.waiting', 'Active. There is no current comparison. Insufficient coverage, small changes and dismissed reviews stay quiet.')}</Text>
    {settings && review.last_checked_at && <Text as="p" variant="caption">
      {t('tco.costDigest.checked', 'Last checked: {{date}}.', { date: formatDateTime(review.last_checked_at, { tz: settings.time_zone }) })}
    </Text>}
    {digest && settings && !settings.paused && <div className="space-y-3">
      <DigestEvidence digest={digest} zone={settings.time_zone} />
      <div className="flex flex-wrap gap-2">
        {fresh && <Link to={`/charging?vehicle_id=${vehicleId}`} className="inline-flex min-h-11 items-center underline">
          {t('tco.costDigest.openSessions', 'Review charging sessions')}
        </Link>}
        <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy}
          onClick={() => apply({ kind: 'dismiss', planID: settings.id, through: digest.through })}>
          {t('tco.costDigest.dismiss', 'Dismiss this monthly comparison')}
        </Button>
      </div>
    </div>}
    {change.error && <QueryError error={change.error} />}
    {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
    <div className="flex flex-wrap gap-2">
      <Button ref={settingsButton} type="button" className="min-h-11" variant="secondary" wrapLabel aria-expanded={edit != null}
        disabled={busy} onClick={() => {
          change.reset();
          if (edit) closeEdit();
          else setEdit(settings ?? { id: 0, time_zone: tz, currency: '', material_change_minor: 0, paused: false });
        }}>
        {edit ? t('tco.costDigest.cancel', 'Cancel monthly review changes')
          : !settings ? t('tco.costDigest.setup', 'Set up monthly review')
          : settings.paused ? t('tco.costDigest.resume', 'Resume monthly review')
            : t('tco.costDigest.edit', 'Edit monthly review')}
      </Button>
      {settings && !edit && <>
        {!settings.paused && <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy}
          onClick={() => apply({ kind: 'save', settings: { ...settings, paused: true } })}>
          {t('tco.costDigest.pause', 'Pause monthly review')}
        </Button>}
        <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={busy}
          onClick={() => setClear(settings.id)}>{deleteLabel}</Button>
      </>}
    </div>
    {edit && <ChargingCostDigestForm initial={edit} disabled={busy || (settings?.id ?? 0) !== edit.id}
      onSave={value => apply({ kind: 'save', settings: value })} />}
    {clear != null && <ConfirmDialog open variant="danger" title={deleteLabel} confirmLabel={deleteLabel}
      message={t('tco.costDigest.clearDetail', 'Stop monthly checks and remove the settings and comparison? Original charging bills and driving records will not be changed.')}
      loading={change.isPending} confirmDisabled={busy || clear !== settings?.id} onCancel={() => setClear(undefined)}
      onConfirm={() => { if (!busy && clear === settings?.id) apply({ kind: 'clear', planID: clear }); }} />}
  </div>;
}

function DigestEvidence({ digest, zone }: { digest: ChargingCostDigest; zone: string }) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat('user');
  const { unitPrefs, formatDistance } = useUnits();
  const data = digest.attribution;
  const locale = unitPrefs.locale ?? 'en-US';
  const digits = currencyFractionDigits(data.currency, locale);
  const money = (minor: number) => formatCurrencyValue(minor / 10 ** digits, data.currency, locale, digits, { useGrouping: true });
  const coverage = (period: ChargingCostCoverage) => t('tco.costDigest.coverage', '{{priced}} of {{all}} observed sessions had a usable bill. {{compared}} were compared; {{spend}} known spend, {{comparableSpend}} in the comparison. Recorded distance: {{distance}}.', {
    priced: period.recorded_costs, all: period.sessions, compared: period.compared_sessions,
    spend: money(period.recorded_spend_minor), comparableSpend: money(period.compared_spend_minor),
    distance: formatDistance(period.recorded_distance_m),
  });
  return <div className="space-y-2">
    <PanelTitle>{t('tco.costDigest.findings', 'What changed across the two months?')}</PanelTitle>
    <Text as="p" variant="caption">{t('tco.costDigest.periods', 'Prior month: {{from}} up to {{recent}}. Recent month: {{recent}} up to {{through}}. Time zone: {{zone}}. Amounts in {{currency}}. Expires {{expires}}.', {
      from: formatDateTime(digest.prior_from, { tz: zone }),
      recent: formatDateTime(digest.current_from, { tz: zone }),
      through: formatDateTime(digest.through, { tz: zone }),
      expires: formatDateTime(digest.expires_at, { tz: zone }), zone, currency: data.currency,
    })}</Text>
    <KVList layout="responsive" items={[
      { id: 'prior', label: t('tco.costDigest.priorCoverage', 'Prior month coverage'), value: coverage(data.prior) },
      { id: 'current', label: t('tco.costDigest.currentCoverage', 'Recent month coverage'), value: coverage(data.current) },
      { id: 'change', label: t('tco.costDigest.knownChange', 'Change in known spend'), value: money(data.current.recorded_spend_minor - data.prior.recorded_spend_minor) },
      { id: 'distance', label: t('tco.costDigest.distance', 'Recorded distance'), value: money(data.distance_minor) },
      { id: 'intensity', label: t('tco.costDigest.intensity', 'Billed energy per recorded distance'), value: money(data.purchase_intensity_minor) },
      { id: 'mix', label: t('tco.costDigest.mix', 'Charging-site mix'), value: money(data.site_mix_minor) },
      { id: 'price', label: t('tco.costDigest.price', 'Effective billed price, including known fees'), value: money(data.effective_price_minor) },
      { id: 'residual', label: t('tco.costDigest.residual', 'Unattributed known spend and rounding'), value: money(data.unattributed_minor) },
    ]} />
    <Text as="p" variant="bodySm">{t('tco.costDigest.why', 'Why this? Bills at {{sites}} comparable sites changed materially. The breakdown is an estimate on those bills, not proof of cause or driving efficiency. Unknown costs and other currencies are not included.', {
      sites: data.comparable_sites,
    })}</Text>
  </div>;
}
