import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useWarrantyDetails } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { useDateFormat } from '@/hooks/useDateFormat';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertDistanceToSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/** Safely extract a string from an unknown value */
export function asString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  return null;
}

/** Safely extract a number from an unknown value */
export function asNumber(val: unknown): number | null {
  return knownNumber(val);
}

/** Compute days remaining from an expiry date string (ISO or date) */
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  const datePrefix = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(trimmed);
  if (datePrefix) {
    const year = Number(datePrefix[1]);
    const month = Number(datePrefix[2]);
    const day = Number(datePrefix[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
      check.getUTCFullYear() !== year
      || check.getUTCMonth() !== month - 1
      || check.getUTCDate() !== day
    ) return null;
  } else if (!/^\d{4}$/.test(trimmed)) {
    // Keep accepting RFC-style ISO strings, but reject arbitrary strings.
    const parsedFallback = new Date(trimmed);
    if (Number.isNaN(parsedFallback.getTime())) return null;
  } else {
    return null;
  }

  const expiry = new Date(trimmed);
  if (isNaN(expiry.getTime())) return null;
  const now = new Date();
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((expiryUtc - todayUtc) / (1000 * 60 * 60 * 24));
}

/** Keep coverage date strings tied to a real calendar date. */
function validWarrantyDate(value: string | null): string | null {
  return value != null && daysUntil(value) != null ? value : null;
}

/** Badge variant based on days remaining */
export function statusVariant(days: number | null): 'success' | 'warning' | 'error' | 'neutral' {
  if (days == null) return 'neutral';
  if (days <= 0) return 'error';
  if (days <= 90) return 'warning';
  return 'success';
}

/** Status label based on days remaining */
export function statusLabel(days: number | null, t: (k: string, f: string) => string): string {
  if (days == null) return t('widget.status.unknown', 'Unknown');
  if (days <= 0) return t('widget.warranty.expired', 'Expired');
  return t('widget.warranty.active', 'Active');
}

/** Known warranty coverage types to extract from data */
export default function WarrantyStatusWidget({ size, vehicleId }: WidgetProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const dateFormat = useDateFormat();
  const { formatDate } = dateFormat;
  const formatMonthYear = (dateFormat as unknown as { formatMonthYear?: (value: unknown) => string }).formatMonthYear;

  const distanceUnit = unitPrefs.distance;
  const toDistanceDisplay = useCallback(
    (meters: number) => convertDistanceFromSI(meters, distanceUnit),
    [distanceUnit],
  );

  const query = useWarrantyDetails(vehicleId ? String(vehicleId) : undefined);
  const {
    data: envelope,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const trust = useDataState({
    ...query,
    data: envelope ?? (isLoading || isError ? undefined : null),
  }, { provenance: 'cached', unavailable: envelope?.data == null });

  const warrantyData = envelope?.data ?? null;
  const isCompact = size.cols <= 1;

  // Extract key warranty fields from the untyped data
  const expiryDate = validWarrantyDate(asString(
    warrantyData?.warranty_expiry_date
    ?? warrantyData?.expiry_date
    ?? warrantyData?.basic_expiry_date,
  ));
  const daysRemaining = daysUntil(expiryDate);

  const mileageLimitM = asNumber(
    warrantyData?.mileage_limit_m
    ?? warrantyData?.basic_mileage_limit_m
    ?? null,
  )
    ?? (asNumber(warrantyData?.mileage_limit_mi ?? warrantyData?.basic_mileage_limit_mi) != null
      ? convertDistanceToSI(
          asNumber(warrantyData?.mileage_limit_mi ?? warrantyData?.basic_mileage_limit_mi)!,
          'mi',
        )
      : null);
  const currentMileageM = asNumber(
    warrantyData?.current_mileage_m
    ?? warrantyData?.odometer_m
    ?? null,
  )
    ?? (asNumber(
      warrantyData?.current_mileage_mi
      ?? warrantyData?.odometer_mi
      ?? warrantyData?.current_odometer_mi,
    ) != null
      ? convertDistanceToSI(
          asNumber(
            warrantyData?.current_mileage_mi
            ?? warrantyData?.odometer_mi
            ?? warrantyData?.current_odometer_mi,
          )!,
          'mi',
        )
      : null);
  const mileageExceeded = mileageLimitM != null && currentMileageM != null && currentMileageM >= mileageLimitM;
  const mileageUnknown = mileageLimitM != null && currentMileageM == null;
  const effectiveDays = mileageExceeded ? 0 : mileageUnknown ? null : daysRemaining;
  const variant = statusVariant(effectiveDays);

  const startDate = validWarrantyDate(asString(
    warrantyData?.warranty_start_date
    ?? warrantyData?.start_date
    ?? warrantyData?.in_service_date,
  ));

  const formatYearsMonths = useCallback((days: number | null): string | null => {
    if (days == null) return null;
    const remaining = Math.max(days, 0);
    const years = Math.floor(remaining / 365);
    const months = Math.max(0, Math.floor((remaining % 365) / 30));
    if (years > 0) {
      return months > 0
        ? `${fmtInt(years)} yr ${fmtInt(months)} mo left`
        : `${fmtInt(years)} yr left`;
    }
    if (months > 0) return `${fmtInt(months)} mo left`;
    return `${fmtInt(remaining)} ${t('widget.warranty.daysUnit', 'days')} left`;
  }, [fmtInt, t]);

  const shellProps = {
    title: t('widget.warranty.title', 'Warranty status'),
    loading: isLoading,
    dataState: trust,
    loadingContent: <div className="flex flex-col gap-3"><Skeleton className="h-16" /><Skeleton className="h-24" /></div>,
    updatedAt: dataUpdatedAt ?? 0,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  // ── Compact layout (1×2): days remaining + Active/Expired badge ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <div className="h-full flex flex-col items-center justify-center gap-1.5 min-h-[44px]">
            <>
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <WidgetBigNumber
                value={effectiveDays != null ? fmtInt(Math.max(effectiveDays, 0)) : null}
                label={t('widget.warranty.daysLeft', 'days left')}
                align="center"
              />
              <Badge
                variant={variant === 'error' ? 'danger' : variant}
                size="sm"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                {statusLabel(effectiveDays, t)}
              </Badge>
            </>
          {!warrantyData && <p className={dashboardTokens.metricLabel}>{t('widget.warranty.noData', 'No warranty data')}</p>}
        </div>
      </WidgetShell>
    );
  }

  // ── Standard layout (2×2): progress bars + coverage badges ──
  const basicCoverage = warrantyData?.basic;
  const batteryCoverage = warrantyData?.battery_drive_unit;
  const basicExpiry = validWarrantyDate(asString(
    (typeof basicCoverage === 'object' && basicCoverage !== null ? (basicCoverage as Record<string, unknown>).expiry_date : null)
    ?? warrantyData?.basic_expiry_date
    ?? expiryDate,
  ));
  const batteryExpiry = validWarrantyDate(asString(
    (typeof batteryCoverage === 'object' && batteryCoverage !== null ? (batteryCoverage as Record<string, unknown>).expiry_date : null)
    ?? warrantyData?.battery_drive_unit_expiry_date
    ?? (expiryDate !== basicExpiry ? expiryDate : null),
  ));
  const basicDays = daysUntil(basicExpiry);
  const batteryDays = daysUntil(batteryExpiry);
  const basicDaysEffective = mileageExceeded ? 0 : basicDays;
  const batteryDaysEffective = mileageExceeded ? 0 : batteryDays;
  const basicStart = validWarrantyDate(asString(
    (typeof basicCoverage === 'object' && basicCoverage !== null ? (basicCoverage as Record<string, unknown>).start_date : null)
    ?? startDate,
  ));
  const batteryStart = validWarrantyDate(asString(
    (typeof batteryCoverage === 'object' && batteryCoverage !== null ? (batteryCoverage as Record<string, unknown>).start_date : null)
    ?? startDate,
  ));
  const batteryLimitM = (() => {
    const coverage = typeof batteryCoverage === 'object' && batteryCoverage !== null
      ? batteryCoverage as Record<string, unknown>
      : null;
    const siLimit = asNumber(coverage?.mileage_limit_m ?? warrantyData?.battery_mileage_limit_m);
    if (siLimit != null) return siLimit;
    const legacyLimit = asNumber(coverage?.mileage_limit_mi ?? warrantyData?.battery_mileage_limit_mi);
    return legacyLimit != null ? convertDistanceToSI(legacyLimit, 'mi') : null;
  })();
  const basicLimitM = (() => {
    const coverage = typeof basicCoverage === 'object' && basicCoverage !== null
      ? basicCoverage as Record<string, unknown>
      : null;
    const siLimit = asNumber(coverage?.mileage_limit_m ?? warrantyData?.basic_mileage_limit_m ?? mileageLimitM);
    if (siLimit != null) return siLimit;
    const legacyLimit = asNumber(coverage?.mileage_limit_mi ?? warrantyData?.basic_mileage_limit_mi);
    return legacyLimit != null ? convertDistanceToSI(legacyLimit, 'mi') : null;
  })();
  const corrosionExpiryRaw = asString(warrantyData?.corrosion_expiry_date ?? warrantyData?.corrosion_expiry);
  const corrosionExpiry = validWarrantyDate(corrosionExpiryRaw);
  const coverageRows = [
    {
      key: 'battery',
      title: t('widget.warranty.batteryDrive', 'Battery/drive unit'),
      expiry: batteryExpiry,
      days: batteryDaysEffective,
      start: batteryStart,
      limitM: batteryLimitM,
      covered: batteryCoverage != null && batteryCoverage !== false,
      useMonthYear: batteryCoverage != null || warrantyData?.battery_drive_unit_expiry_date != null,
    },
    {
      key: 'basic',
      title: t('widget.warranty.basic', 'Basic'),
      expiry: basicExpiry,
      days: basicDaysEffective,
      start: basicStart,
      limitM: basicLimitM,
      covered: basicCoverage != null && basicCoverage !== false,
      useMonthYear: basicCoverage != null || warrantyData?.basic_expiry_date != null,
    },
    ...((warrantyData != null && (
      (warrantyData.corrosion === true && corrosionExpiryRaw == null)
      || corrosionExpiry != null
    ))
      ? [{
          key: 'corrosion',
          title: t('widget.warranty.corrosion', 'Corrosion'),
          expiry: corrosionExpiry,
          days: daysUntil(corrosionExpiry),
          start: null,
          limitM: null,
          included: asString(warrantyData?.corrosion_expiry_date ?? warrantyData?.corrosion_expiry) == null,
          covered: true,
        }]
      : []),
  ].filter((row) => {
    const source = row.key === 'battery' ? batteryCoverage
      : row.key === 'basic' ? basicCoverage : null;
    if (row.key === 'corrosion') return row.expiry != null || 'included' in row && row.included;
    if (row.key === 'basic') return warrantyData != null;
    return source != null || row.expiry != null || row.limitM != null;
  });

  return (
    <WidgetShell
      icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
        <div className="h-full flex min-w-0 flex-col justify-center gap-3 overflow-y-auto">
          {!warrantyData ? (
            <>
              <EmptyState
                variant="informational"
                icon={<ShieldCheck className="h-5 w-5" />}
                message={t('widget.warranty.noData', 'No warranty data')}
              />
              <p className={dashboardTokens.metricLabel}>
                {t('widget.warranty.mileageLimit', 'Mileage limit')}
              </p>
              <Badge variant="neutral" size="sm">
                {t('widget.status.unknown', 'Unknown')}
              </Badge>
            </>
          ) : coverageRows.map((row) => {
            const limitM = row.limitM;
            const remainingM = limitM != null && currentMileageM != null
              ? Math.max(limitM - currentMileageM, 0)
              : null;
            const limitDisplay = limitM == null ? null : toDistanceDisplay(limitM);
            const remainingDisplay = remainingM == null ? null : toDistanceDisplay(remainingM);
            const currentDisplay = currentMileageM == null ? null : toDistanceDisplay(currentMileageM);

            let periodDays: number | null = null;
            if (row.start && row.expiry) {
              const startMs = new Date(row.start).getTime();
              const expiryMs = new Date(row.expiry).getTime();
              if (Number.isFinite(startMs) && Number.isFinite(expiryMs) && expiryMs > startMs) {
                periodDays = Math.ceil((expiryMs - startMs) / 86_400_000);
              }
            }
            const rowVariant = statusVariant(row.days);
            const barColor = rowVariant === 'success'
              ? '#10b981'
              : rowVariant === 'warning'
                ? '#f59e0b'
                : rowVariant === 'error'
                  ? '#ef4444'
                  : 'var(--text-muted)';

            return (
              <section key={row.key} className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{row.title}</p>
                    <p className={dashboardTokens.metricLabel}>
                      {'included' in row && row.included && !row.expiry
                        ? t('widget.status.unknown', 'Unknown')
                        : row.expiry && Number.isFinite(new Date(row.expiry).getTime())
                        ? ('useMonthYear' in row && row.useMonthYear
                            ? (formatMonthYear?.(row.expiry) ?? formatDate(row.expiry))
                            : formatDate(row.expiry))
                        : t('widget.status.unknown', 'Unknown')}
                    </p>
                    {row.days != null && (
                      <p className={dashboardTokens.metricLabel}>{fmtInt(Math.max(row.days, 0))}</p>
                    )}
                  </div>
                  <Badge
                    variant={rowVariant === 'error' ? 'danger' : rowVariant}
                    size="sm"
                  >
                    {row.key === 'basic' && basicCoverage === true
                      ? t('widget.warranty.covered', 'Covered')
                      : 'included' in row && row.included
                      ? t('widget.warranty.included', 'Included')
                      : statusLabel(row.days, t)}
                  </Badge>
                </div>
                {periodDays != null && row.days != null ? (
                  <MetricBar
                    value={Math.max(row.days, 0)}
                    max={periodDays}
                    color={barColor}
                    label={`${fmtInt(Math.max(row.days, 0))}`}
                    sublabel={
                      remainingDisplay != null
                        ? t('widget.warranty.distanceLeft', '{{distance}} {{unit}} left', {
                            distance: fmtNumber(remainingDisplay, 2),
                            unit: distanceUnit,
                          })
                        : ''
                    }
                    ariaLabel={`${row.title}: ${formatYearsMonths(row.days) ?? statusLabel(row.days, t)}`}
                  />
                ) : (
                  <p className={dashboardTokens.metricLabel}>
                    {row.key === 'corrosion' && row.expiry == null
                        ? null
                      : remainingDisplay != null
                        ? t('widget.warranty.distanceLeft', '{{distance}} {{unit}} left', {
                            distance: fmtNumber(remainingDisplay, 2),
                            unit: distanceUnit,
                          })
                        : row.days != null
                          ? formatYearsMonths(row.days)
                          : null}
                  </p>
                )}
                {limitDisplay != null && (
                  <>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      <span>{fmtNumber(limitDisplay, 2)} {distanceUnit}</span>
                    </p>
                  </>
                )}
                {currentDisplay != null && (
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {fmtNumber(currentDisplay, 2)} {distanceUnit}
                  </p>
                )}
                {remainingDisplay != null && (
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {fmtNumber(remainingDisplay, 2)} {distanceUnit}
                  </p>
                )}
              </section>
            );
          })}
        </div>
    </WidgetShell>
  );
}
