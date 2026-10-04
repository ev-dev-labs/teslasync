import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { useWarrantyDetails } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';

import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetDetailCard, WidgetStatGrid, type DetailEntry } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertDistanceToSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/** Safely extract a string from an unknown value */
export function asString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string' && val.length > 0) return val;
  if (typeof val === 'number') return String(val);
  return null;
}

/** Safely extract a number from an unknown value */
export function asNumber(val: unknown): number | null {
  return knownNumber(val);
}

/** Compute days remaining from an expiry date string (ISO or date) */
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const expiry = new Date(dateStr);
  if (isNaN(expiry.getTime())) return null;
  const now = new Date();
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
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
const COVERAGE_TYPES = [
  { key: 'basic', labelKey: 'widget.warranty.basic', fallback: 'Basic' },
  { key: 'battery_drive_unit', labelKey: 'widget.warranty.batteryDrive', fallback: 'Battery/drive unit' },
  { key: 'corrosion', labelKey: 'widget.warranty.corrosion', fallback: 'Corrosion' },
  { key: 'emissions', labelKey: 'widget.warranty.emissions', fallback: 'Emissions' },
  { key: 'body', labelKey: 'widget.warranty.body', fallback: 'Body' },
] as const;

export default function WarrantyStatusWidget({ size, vehicleId }: WidgetProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const { formatDate, locale } = useDateFormat();

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
  const expiryDate = asString(
    warrantyData?.warranty_expiry_date
    ?? warrantyData?.expiry_date
    ?? warrantyData?.basic_expiry_date,
  );
  const daysRemaining = daysUntil(expiryDate);

  const mileageLimitMi = asNumber(
    warrantyData?.mileage_limit_mi
    ?? warrantyData?.basic_mileage_limit_mi,
  );
  const currentMileageMi = asNumber(
    warrantyData?.current_mileage_mi
    ?? warrantyData?.odometer_mi
    ?? warrantyData?.current_odometer_mi,
  );

  // The warranty API delivers mileage in MILES (`*_mi` fields), but
  // `convertDistanceFromSI` (and thus `toDistanceDisplay`) expects SI meters.
  // Convert miles→meters up front so a 50,000 mi limit renders as "50,000 mi"
  // (or "80,467 km"), not the ~31 mi / ~50 km the raw-value path produced.
  const mileageLimitM = mileageLimitMi != null ? convertDistanceToSI(mileageLimitMi, 'mi') : null;
  const currentMileageM = currentMileageMi != null ? convertDistanceToSI(currentMileageMi, 'mi') : null;
  const mileageExceeded = mileageLimitM != null && currentMileageM != null && currentMileageM >= mileageLimitM;
  const mileageUnknown = mileageLimitM != null && currentMileageM == null;
  const effectiveDays = mileageExceeded ? 0 : mileageUnknown ? null : daysRemaining;
  const variant = statusVariant(effectiveDays);

  // Total warranty period in days (for progress bar)
  const startDate = asString(
    warrantyData?.warranty_start_date
    ?? warrantyData?.start_date
    ?? warrantyData?.in_service_date,
  );
  const totalDays = useMemo(() => {
    if (!startDate || !expiryDate) return null;
    const start = new Date(startDate);
    const end = new Date(expiryDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }, [startDate, expiryDate]);

  const daysUsed = totalDays != null && daysRemaining != null
    ? Math.max(totalDays - daysRemaining, 0)
    : null;

  // Build detail entries for WidgetDetailCard
  const entries: DetailEntry[] = useMemo(() => {
    const items: DetailEntry[] = [];

    // Expiry date
    items.push({
      label: t('widget.warranty.expiryDate', 'Expiry date'),
      value: expiryDate && daysRemaining != null
        ? formatDate(expiryDate)
        : null,
      badge: { text: statusLabel(effectiveDays, t), variant },
    });

    // Days remaining
    items.push({
      label: t('widget.warranty.daysRemaining', 'Days remaining'),
      value: daysRemaining != null ? fmtInt(Math.max(daysRemaining, 0)) : null,
      mono: true,
    });

    // Mileage limit (converted)
    {
      const converted = mileageLimitM == null ? null : toDistanceDisplay(mileageLimitM);
      items.push({
        label: t('widget.warranty.mileageLimit', 'Mileage limit'),
        value: converted == null ? null : `${fmtNumber(converted)} ${distanceUnit}`,
        mono: true,
      });
    }

    // Current mileage (converted)
    {
      const converted = currentMileageM == null ? null : toDistanceDisplay(currentMileageM);
      items.push({
        label: t('widget.warranty.currentMileage', 'Current mileage'),
        value: converted == null ? null : `${fmtNumber(converted)} ${distanceUnit}`,
        mono: true,
      });
    }

    // Coverage type badges
    for (const cov of COVERAGE_TYPES) {
      const covVal = warrantyData?.[cov.key];
      if (covVal != null && covVal !== false && covVal !== '') {
        const covExpiry = asString(
          warrantyData?.[`${cov.key}_expiry_date`],
        );
        const covDays = daysUntil(covExpiry);
        const covActive = covDays != null && covDays > 0;
        items.push({
          label: t(cov.labelKey, cov.fallback),
          value: covExpiry && covDays != null
            ? new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(new Date(covExpiry))
            : t('widget.warranty.included', 'Included'),
          badge: {
            text: covDays == null ? t('widget.status.unknown', 'Unknown') : covActive
              ? t('widget.warranty.covered', 'Covered')
              : t('widget.warranty.expired', 'Expired'),
            variant: covDays == null ? 'neutral' : covActive ? 'success' : 'error',
          },
        });
      }
    }

    return items;
  }, [warrantyData, expiryDate, daysRemaining, effectiveDays, variant, mileageLimitM, currentMileageM, toDistanceDisplay, distanceUnit, t, formatDate, locale, fmtInt, fmtNumber]);

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
                value={daysRemaining != null ? fmtInt(Math.max(daysRemaining, 0)) : null}
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
  return (
    <WidgetShell
      icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
        <div className="h-full flex flex-col gap-3 overflow-y-auto">
          <WidgetStatGrid cols={2} stats={[
            { label: t('widget.warranty.daysRemaining', 'Days remaining'), value: daysRemaining == null ? null : fmtInt(Math.max(daysRemaining, 0)) },
            { label: t('widget.warranty.mileageRemaining', 'Mileage remaining'), value: mileageLimitM == null || currentMileageM == null ? null : fmtNumber(toDistanceDisplay(Math.max(mileageLimitM - currentMileageM, 0))), unit: mileageLimitM == null || currentMileageM == null ? undefined : distanceUnit },
          ]} />
          {/* Time remaining progress bar */}
          {totalDays != null && totalDays > 0 && daysUsed != null && (
            <MetricBar
              value={daysUsed}
              max={totalDays}
              color={variant === 'success' ? '#10b981' : variant === 'warning' ? '#f59e0b' : '#ef4444'}
              label={t('widget.warranty.timeRemaining', 'Time remaining')}
              sublabel={
                daysRemaining != null
                  ? `${fmtInt(Math.max(daysRemaining, 0))} ${t('widget.warranty.daysUnit', 'days')}`
                  : '—'
              }
            />
          )}

          {/* Mileage remaining progress bar */}
          {mileageLimitM != null && mileageLimitM > 0 && currentMileageM != null && (
            <MetricBar
              value={toDistanceDisplay(currentMileageM)}
              max={toDistanceDisplay(mileageLimitM)}
              color={
                currentMileageM / mileageLimitM > 0.9
                  ? '#ef4444'
                  : currentMileageM / mileageLimitM > 0.75
                    ? '#f59e0b'
                    : '#10b981'
              }
              label={t('widget.warranty.mileageRemaining', 'Mileage remaining')}
              sublabel={`${fmtNumber(toDistanceDisplay(Math.max(mileageLimitM - currentMileageM, 0)))} ${distanceUnit}`}
            />
          )}

          {/* Detail rows via shared component */}
          <WidgetDetailCard
            entries={entries}
            emptyMessage={t('widget.warranty.noData', 'No warranty data')}
            emptyIcon={<ShieldCheck className="h-5 w-5" />}
          />
          <p className={dashboardTokens.metricLabel}>
            {t('widget.warranty.coverageCaveat', 'Cached warranty information; coverage ends at the first time or mileage limit. Confirm terms with Tesla.')}
          </p>
          {!warrantyData && <p className={dashboardTokens.metricLabel}>{t('widget.warranty.noData', 'No warranty data')}</p>}
        </div>
    </WidgetShell>
  );
}
