import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';

import { GlassPanel, PanelTitle, Button, Select, Input, HelperText, type SelectOption } from '@/components/ui';
import { CurrencyInput } from '@/components/forms';
import { AlertBanner } from '@/components/feedback';
import { useSettings } from '@/hooks/useSettings';
import { currencyCodeFromSymbol, microToValue } from '@/lib/currencyFormat';
import { useCreateGeofenceRate } from '@/api/hooks/useLocations';
import { currencyPerKwhToRatePerWh } from './helpers';
import type { GeofenceRate, GeofenceRateCreateRequest } from '@/api/types';

export interface RateFormProps {
  geofenceId: number;
  /** The rate active now (if any) — seeds the currency default. */
  currentRate?: GeofenceRate | null;
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

/**
 * Convert a `datetime-local` input value (`YYYY-MM-DDTHH:mm`, local time)
 * to an ISO-8601 UTC string. Returns `null` for empty/unparseable input so
 * a malformed value never throws mid-render — mirrors
 * `AuditLogPage.tsx`'s `toIsoOrUndefined`.
 */
function localToIso(local: string): string | null {
  if (!local) return null;
  const ms = Date.parse(local);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** `YYYY-MM-DDTHH:mm` for the current instant, seeding the effective-from field. */
function nowAsLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
export function RateForm({ geofenceId, currentRate }: RateFormProps) {
  const { t } = useTranslation();
  const { locale, settings } = useSettings();
  const defaultCurrency = currentRate?.currency ?? currencyCodeFromSymbol(settings.currency_symbol);

  const [currency, setCurrency] = useState(defaultCurrency);
  const [rateMicro, setRateMicro] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(nowAsLocalInput());
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
    const fromIso = localToIso(effectiveFrom);
    if (!fromIso) {
      setFormError(t('chargingPlaces.rateForm.errors.effectiveFrom', 'Enter a valid effective-from date/time.'));
      return;
    }
    const toIso = effectiveTo ? localToIso(effectiveTo) : null;
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
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Plus className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        {t('chargingPlaces.rateForm.title', 'Add a Rate')}
      </PanelTitle>

      {formError && (
        <AlertBanner variant="warning" className="mb-3">
          {formError}
        </AlertBanner>
      )}

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
        />
        <Input
          type="datetime-local"
          label={t('chargingPlaces.rateForm.effectiveTo', 'Effective to (optional)')}
          value={effectiveTo}
          onChange={(e) => setEffectiveTo(e.target.value)}
          hint={t('chargingPlaces.rateForm.effectiveToHint', 'Leave blank for an open-ended rate.')}
        />
      </div>

      <HelperText className="mt-3">
        {t(
          'chargingPlaces.rateForm.legacyEstimateHint',
          'If this rate is active today, it also estimates older unpriced sessions at this place. Existing actual costs stay unchanged.',
        )}
      </HelperText>

      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={createRate.isPending}
          disabled={rateMicro == null}
        >
          {t('chargingPlaces.rateForm.submit', 'Save Rate')}
        </Button>
      </div>
    </GlassPanel>
  );
}
