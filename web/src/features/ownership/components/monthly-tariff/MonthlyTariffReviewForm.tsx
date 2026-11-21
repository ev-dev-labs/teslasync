import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useGeofencesFull } from '@/api/hooks/useLocations';
import { useTariffs } from '@/api/hooks/useOwnership';
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { CurrencyInput } from '@/components/forms';
import { Button, Input, Select, Text, Toggle } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { currencyFractionDigits, microToValue, valueToMicro } from '@/lib/currencyFormat';
import type { MonthlyTariffSettings } from '@/types/monthlyTariff';
import type { Tariff } from '@/types/ownership';

interface Props {
  scope: Extract<PersonalScope, { mode: 'forward_auth' }>;
  initial?: MonthlyTariffSettings;
  defaultZone: string;
  initialCurrency?: string;
  disabled: boolean;
  onSave: (settings: MonthlyTariffSettings) => void;
  onReviewTariffs: () => void;
}

function isSupported(tariff: Tariff) {
  const rates = tariff.rates ?? [];
  return ['flat', 'tou'].includes(tariff.structure) && tariff.demand_charge_minor_per_w === 0 &&
    tariff.export_price_minor_per_wh === 0 && rates.length > 0 &&
    rates.every(band => band.tier_upper_wh == null);
}

function amountMinor(micro: number | null, scale: number) {
  const value = microToValue(micro);
  if (value == null) return null;
  const minor = Math.round(value * scale);
  return minor >= 0 && minor <= 1_000_000_000 && valueToMicro(minor / scale) === micro ? minor : null;
}

export function MonthlyTariffReviewForm({ scope, initial, initialCurrency, defaultZone, disabled, onReviewTariffs, onSave }: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const locale = unitPrefs.locale ?? 'en-US';
  const sitesQuery = useGeofencesFull();
  const tariffsQuery = useTariffs(100, 0, scope);
  const sites = useDataState(sitesQuery);
  const tariffs = useDataState(tariffsQuery);
  const [siteId, setSiteId] = useState(initial ? String(initial.site_id) : '');
  const [currentId, setCurrentId] = useState(initial ? String(initial.current_tariff_id) : '');
  const [alternativeId, setAlternativeId] = useState(initial ? String(initial.alternative_tariff_id) : '');
  const [zone, setZone] = useState(initial?.time_zone ?? defaultZone);
  const [confirmed, setConfirmed] = useState<string>();
  const initialScale = 10 ** currencyFractionDigits(initialCurrency ?? 'USD', locale);
  const [minimum, setMinimum] = useState(() => initialCurrency && initial
    ? valueToMicro(initial.minimum_savings_minor / initialScale) : null);
  const [fee, setFee] = useState(() => initialCurrency && initial ? valueToMicro(initial.switch_fee_minor / initialScale) : 0);
  const [minimumValid, setMinimumValid] = useState(true);
  const [feeValid, setFeeValid] = useState(true);
  const zoneField = useRef<HTMLInputElement>(null);
  const hasSetup = sites.hasData && tariffs.hasData;
  useEffect(() => { if (hasSetup) zoneField.current?.focus(); }, [hasSetup]);

  const choices = (tariffs.data?.items ?? []).filter(isSupported);
  const locations = (sites.data ?? []).filter(site => site.enabled && !site.needs_review && !site.archived_at && site.is_charging_location);
  const current = choices.find(plan => plan.is_current && String(plan.id) === currentId);
  const alternatives = choices.filter(plan => !plan.is_current && plan.currency === current?.currency);
  const alternative = alternatives.find(plan => String(plan.id) === alternativeId);
  const site = locations.find(location => String(location.id) === siteId);
  const currency = current?.currency;
  const digits = currencyFractionDigits(currency ?? 'USD', locale);
  const scale = 10 ** digits;
  const minimumMinor = minimumValid ? amountMinor(minimum, scale) : null;
  const feeMinor = feeValid ? amountMinor(fee, scale) : null;
  const draft: MonthlyTariffSettings | undefined = site && current && alternative && zone.trim() &&
    minimumMinor != null && minimumMinor > 0 && feeMinor != null ? {
      id: initial?.id ?? 0, site_id: site.id, site_revision: site.updated_at,
      current_tariff_id: current.id, current_version: current.version,
      alternative_tariff_id: alternative.id, alternative_version: alternative.version,
      time_zone: zone.trim(), minimum_savings_minor: minimumMinor, switch_fee_minor: feeMinor, paused: false,
    } : undefined;
  const signature = draft ? JSON.stringify(draft) : undefined;
  const blocked = disabled || sites.status !== 'ok' || tariffs.status !== 'ok' || sites.isRefreshing || tariffs.isRefreshing;
  const error = sites.fatalError ?? tariffs.fatalError;
  const identityError = tariffs.refreshError;
  const identityChanged = isApiError(identityError) && (identityError.code === 'IDENTITY_CHANGED' || [401, 403].includes(identityError.status));
  if (error || identityChanged) return <QueryError error={error ?? identityError}
    onRetry={() => { void sitesQuery.refetch(); void tariffsQuery.refetch(); }} />;
  if (!hasSetup) return sites.isRefreshBlocked || tariffs.isRefreshBlocked
    ? <Text as="p" variant="bodySm">{t('ownership.tariff.monthly.offline', 'Reconnect to view or change the monthly tariff review.')}</Text>
    : <Skeleton lines={3} />;

  const hasPair = choices.some(plan => plan.is_current && choices.some(other => !other.is_current && other.currency === plan.currency));
  if (locations.length === 0 || !hasPair) {
    const tariffsAction = { label: t('ownership.tariff.plans.title', 'Your rate plan library'), onClick: onReviewTariffs };
    return <EmptyState title={t('ownership.tariff.monthly.setupMissing', 'Saved charging place and two tariffs required')}
      message={t('ownership.tariff.monthly.setupDetail', 'Review a charging place and save one current and one alternative flat or time-of-use tariff in the same currency. Then reopen setup.')}
      actionTo={locations.length === 0 ? { label: t('routes.geofences', 'Geofences'), to: '/geofences' } : undefined}
      action={locations.length === 0 ? undefined : tariffsAction}
      secondaryAction={locations.length === 0 && !hasPair ? tariffsAction : undefined} />;
  }
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    if (!blocked && draft && signature === confirmed) onSave(draft);
  }}>
    <StaleRefreshWarning state={sites} />
    <StaleRefreshWarning state={tariffs} />
    <Input ref={zoneField} label={t('ownership.tariff.monthly.zone', 'Charging place time zone')} value={zone}
      required maxLength={80} disabled={blocked}
      hint={t('ownership.tariff.monthly.zoneHint', 'Use the place’s IANA time zone, such as America/New_York. Checks run at 9 AM on the second day of the month.')}
      onChange={event => { setZone(event.target.value); setConfirmed(undefined); }} />
    <Select label={t('ownership.tariff.monthly.site', 'Reviewed charging place')} value={siteId} required disabled={blocked}
      placeholder={t('ownership.tariff.monthly.choose', 'Choose an option')}
      options={locations.map(location => ({ value: String(location.id), label: location.name }))}
      onChange={event => { setSiteId(event.target.value); setConfirmed(undefined); }} />
    <Select label={t('ownership.tariff.monthly.current', 'Current saved tariff')} value={currentId} required disabled={blocked}
      placeholder={t('ownership.tariff.monthly.choose', 'Choose an option')}
      options={choices.filter(plan => plan.is_current).map(plan => ({ value: String(plan.id), label: plan.name }))}
      onChange={event => { setCurrentId(event.target.value); setAlternativeId(''); setMinimum(null); setFee(0); setConfirmed(undefined); }} />
    <Select label={t('ownership.tariff.monthly.alternative', 'Alternative saved tariff')} value={alternativeId}
      required disabled={blocked || !current} placeholder={t('ownership.tariff.monthly.choose', 'Choose an option')}
      options={alternatives.map(plan => ({ value: String(plan.id), label: plan.name }))}
      onChange={event => { setAlternativeId(event.target.value); setConfirmed(undefined); }} />
    {current && alternatives.length === 0 && <Text as="p" variant="caption">
      {t('ownership.tariff.monthly.sameCurrency', 'No supported alternative has the currency of this current plan.')}
    </Text>}
    <CurrencyInput ariaLabel={t('ownership.tariff.monthly.minimum', 'Minimum net monthly saving')} currency={currency ?? 'USD'}
      valueMicro={minimum} required disabled={blocked || !currency} locale={locale} precision={digits}
      error={minimum != null && (minimumMinor == null || minimumMinor <= 0)
        ? t('ownership.tariff.monthly.amountInvalid', 'Enter a valid amount in whole billing increments.') : undefined}
      onValidityChange={setMinimumValid} onChange={({ valueMicro }) => { setMinimum(valueMicro); setConfirmed(undefined); }} />
    <CurrencyInput ariaLabel={t('ownership.tariff.monthly.fee', 'One-time switch fee (zero if none)')} currency={currency ?? 'USD'}
      valueMicro={fee} required disabled={blocked || !currency} locale={locale} precision={digits}
      error={fee != null && feeMinor == null
        ? t('ownership.tariff.monthly.amountInvalid', 'Enter a valid amount in whole billing increments.') : undefined}
      onValidityChange={setFeeValid} onChange={({ valueMicro }) => { setFee(valueMicro); setConfirmed(undefined); }} />
    <Toggle label={t('ownership.tariff.monthly.consent', 'Both saved tariffs apply at this place without rescheduling. The prices and fees entered cover the comparison. Review my selected vehicle here each month.')}
      checked={signature != null && confirmed === signature} disabled={blocked || !draft}
      onChange={checked => setConfirmed(checked ? signature : undefined)} />
    <Button type="submit" className="min-h-11" wrapLabel disabled={blocked || !draft || signature !== confirmed}>
      {t('ownership.tariff.monthly.confirm', 'Confirm private tariff review')}
    </Button>
  </form>;
}
