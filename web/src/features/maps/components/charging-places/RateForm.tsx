import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';

import { Button, Select, Input, HelperText, type SelectOption } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { CurrencyInput } from '@/components/forms';
import { AlertBanner, QueryError } from '@/components/feedback';
import { useSettings } from '@/hooks/useSettings';
import { useDateFormat } from '@/hooks/useDateFormat';
import { currencyCodeFromSymbol, microToValue } from '@/lib/currencyFormat';
import { formatTime } from '@/lib/dateFormat';
import { addCivilDays, civilDateInTimeZone, localMidnightToInstant } from '@/lib/dateRange';
import { useCreateGeofenceRate } from '@/api/hooks/useLocations';
import { currencyPerKwhToRatePerWh } from './helpers';
import type { GeofenceRate, GeofenceRateCreateRequest } from '@/api/types';

export interface RateFormProps {
  geofenceId: number;
  /** The rate active now (if any) — seeds the currency default. */
  currentRate?: GeofenceRate | null;
  firstSessionAt?: string | null;
}

/** A reasonably broad, curated set of ISO-4217 currencies for the picker. */
const CURRENCY_OPTIONS: SelectOption[] = [
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'CAD', label: 'CAD (C$)' },
  { value: 'AUD', label: 'AUD (A$)' },
  { value: 'JPY', label: 'JPY (¥)' },
  { value: 'CNY', label: 'CNY (元)' },
  { value: 'CHF', label: 'CHF' },
  { value: 'SEK', label: 'SEK (kr)' },
  { value: 'NOK', label: 'NOK (kr)' },
  { value: 'DKK', label: 'DKK (kr)' },
  { value: 'INR', label: 'INR (₹)' },
  { value: 'BRL', label: 'BRL (R$)' },
  { value: 'ZAR', label: 'ZAR (R)' },
  { value: 'NZD', label: 'NZD (NZ$)' },
  { value: 'MXN', label: 'MXN (Mex$)' },
];

function instantAsLocalInput(instant: Date, timezone: string): string {
  return `${civilDateInTimeZone(instant, timezone)}T${formatTime(instant, { locale: 'en-GB', tz: timezone })}`;
}

function localToIso(local: string, timezone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const wallTime = new Date(`${local}:00Z`);
  if (!Number.isFinite(wallTime.getTime()) || wallTime.toISOString().slice(0, 16) !== local) return null;
  try {
    const day = local.slice(0, 10);
    const start = localMidnightToInstant(day, timezone);
    const end = localMidnightToInstant(addCivilDays(day, 1), timezone);
    // UTC here is only a calendar-arithmetic anchor, not the business zone.
    // Test both day-boundary offsets: gaps are invalid; folds use the earlier
    // occurrence, matching the former datetime-local parser's disambiguation.
    const candidates = [start, end].map((anchor) => {
      const offset = new Date(`${instantAsLocalInput(anchor, timezone)}:00Z`).getTime() - anchor.getTime();
      return new Date(wallTime.getTime() - offset);
    }).filter((candidate) => instantAsLocalInput(candidate, timezone) === local);
    candidates.sort((a, b) => a.getTime() - b.getTime());
    return candidates[0]?.toISOString() ?? null;
  } catch {
    return null;
  }
}

function nowAsLocalInput(timezone: string): string {
  try {
    return instantAsLocalInput(new Date(), timezone);
  } catch {
    return '';
  }
}

function dayBeforeSessionAsLocalInput(startedAt: string, timezone: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return nowAsLocalInput(timezone);
  try {
    const priorDay = addCivilDays(civilDateInTimeZone(date, timezone), -1);
    return instantAsLocalInput(localMidnightToInstant(priorDay, timezone), timezone);
  } catch {
    return '';
  }
}

/**
 * Add-a-rate form — first-time setup, a future scheduled change, or a
 * correction (there is no separate "replace" endpoint: a correction is
 * just another submission with an `effective_from` at or after the point
 * the correction should take hold; an open-ended version closes the prior
 * unbounded interval). Accepts a user-friendly currency/kWh value
 * and converts to the canonical `rate_per_wh` strictly at the request
 * boundary — never sends a per-kWh value on the wire.
 */
export function RateForm({ geofenceId, currentRate, firstSessionAt }: RateFormProps) {
  const { t } = useTranslation();
  const { locale, settings } = useSettings();
  const { tz } = useDateFormat();
  const defaultCurrency = currentRate?.currency ?? currencyCodeFromSymbol(settings.currency_symbol);

  const [currency, setCurrency] = useState(defaultCurrency);
  const [rateMicro, setRateMicro] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(() => !currentRate && firstSessionAt ? dayBeforeSessionAsLocalInput(firstSessionAt, tz) : nowAsLocalInput(tz));
  const [effectiveTo, setEffectiveTo] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const createRate = useCreateGeofenceRate();

  useEffect(() => {
    setCurrency(defaultCurrency);
  }, [defaultCurrency, geofenceId]);

  const currencyOptions = useMemo(() => {
    if (CURRENCY_OPTIONS.some((o) => o.value === currency)) return CURRENCY_OPTIONS;
    // Preserve an already-selected currency outside the curated list
    // (e.g. inherited from an existing rate) rather than silently
    // swapping it out from under the user.
    return [{ value: currency, label: currency }, ...CURRENCY_OPTIONS];
  }, [currency]);

  const handleSubmit = () => {
    setFormError(null);
    const perKwh = microToValue(rateMicro);
    if (perKwh == null || perKwh < 0) {
      setFormError(t('chargingPlaces.rateForm.errors.rate', 'Enter a non-negative rate.'));
      return;
    }
    const fromIso = localToIso(effectiveFrom, tz);
    if (!fromIso) {
      setFormError(t('chargingPlaces.rateForm.errors.effectiveFrom', 'Enter a valid effective-from date/time.'));
      return;
    }
    const toIso = effectiveTo ? localToIso(effectiveTo, tz) : null;
    if (effectiveTo && !toIso) {
      setFormError(t('chargingPlaces.rateForm.errors.effectiveTo', 'Effective-to date/time is invalid.'));
      return;
    }
    if (toIso && new Date(toIso) <= new Date(fromIso)) {
      setFormError(t('chargingPlaces.rateForm.errors.order', 'Effective-to must be after effective-from.'));
      return;
    }

    const body: GeofenceRateCreateRequest = {
      rate_per_wh: currencyPerKwhToRatePerWh(perKwh),
      currency,
      effective_from: fromIso,
      ...(toIso ? { effective_to: toIso } : {}),
    };
    createRate.mutate(
      { geofenceId, ...body },
      {
        onSuccess: () => {
          setRateMicro(null);
          setEffectiveTo('');
        },
      },
    );
  };

  return (
    <LayoutCard title={t('chargingPlaces.rateForm.title', 'Add a rate')} actions={<Plus className="h-4 w-4 text-emerald-300" aria-hidden="true" />}>

      {formError && (
        <AlertBanner variant="warning" className="mb-3">
          {formError}
        </AlertBanner>
      )}
      {createRate.error && <QueryError error={createRate.error} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label={t('chargingPlaces.rateForm.currency', 'Currency')}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          options={currencyOptions}
        />
        <CurrencyInput
          label={t('chargingPlaces.rateForm.rate', 'Rate per kWh')}
          ariaLabel={t('chargingPlaces.rateForm.rate', 'Rate per kWh')}
          currency={currency}
          locale={locale}
          precision={3}
          valueMicro={rateMicro}
          onChange={({ valueMicro }) => setRateMicro(valueMicro)}
        />
        <Input
          type="datetime-local"
          label={t('chargingPlaces.rateForm.effectiveFrom', 'Effective from')}
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          hint={tz}
        />
        <Input
          type="datetime-local"
          label={t('chargingPlaces.rateForm.effectiveTo', 'Effective to (optional)')}
          value={effectiveTo}
          onChange={(e) => setEffectiveTo(e.target.value)}
          hint={`${t('chargingPlaces.rateForm.effectiveToHint', 'Leave blank for an open-ended rate.')} · ${tz}`}
        />
      </div>

      <HelperText className="mt-3">
        {t(
          'chargingPlaces.rateForm.legacyEstimateHint',
          'Starting before the first charge makes that session eligible. Preview and apply to price past sessions; existing actual costs stay unchanged.',
        )}
      </HelperText>

      <div className="mt-3 flex justify-end">
        <Button
          wrapLabel
          variant="primary"
          onClick={handleSubmit}
          loading={createRate.isPending}
          disabled={rateMicro == null}
        >
          {t('chargingPlaces.rateForm.submit', 'Save rate')}
        </Button>
      </div>
    </LayoutCard>
  );
}
