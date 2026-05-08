import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useWarrantyDetails } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetDetailCard, type DetailEntry } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

/** Safely extract a string from an unknown value */
function asString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string' && val.length > 0) return val;
  if (typeof val === 'number') return String(val);
  return null;
}

/** Safely extract a number from an unknown value */
function asNumber(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === 'number' && isFinite(val)) return val;
  if (typeof val === 'string') {
    const n = Number(val);
    return isFinite(n) ? n : null;
  }
  return null;
}

/** Compute days remaining from an expiry date string (ISO or date) */
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const expiry = new Date(dateStr);
  if (isNaN(expiry.getTime())) return null;
  const now = new Date();
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Badge variant based on days remaining */
function statusVariant(days: number | null): 'success' | 'warning' | 'error' {
  if (days == null || days <= 0) return 'error';
  if (days <= 90) return 'warning';
  return 'success';
}

/** Status label based on days remaining */
function statusLabel(days: number | null, t: (k: string, f: string) => string): string {
  if (days == null || days <= 0) return t('widget.warranty.expired', 'Expired');
  return t('widget.warranty.active', 'Active');
}

/** Known warranty coverage types to extract from data */
const COVERAGE_TYPES = [
  { key: 'basic', labelKey: 'widget.warranty.basic', fallback: 'Basic' },
  { key: 'battery_drive_unit', labelKey: 'widget.warranty.batteryDrive', fallback: 'Battery/Drive Unit' },
  { key: 'corrosion', labelKey: 'widget.warranty.corrosion', fallback: 'Corrosion' },
  { key: 'emissions', labelKey: 'widget.warranty.emissions', fallback: 'Emissions' },
  { key: 'body', labelKey: 'widget.warranty.body', fallback: 'Body' },
] as const;

export default function WarrantyStatusWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;

  const {
    data: envelope,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useWarrantyDetails();

  const warrantyData = envelope?.data ?? null;
  const isCompact = size.cols <= 1;

  // Extract key warranty fields from the untyped data
  const expiryDate = asString(
    warrantyData?.warranty_expiry_date
    ?? warrantyData?.expiry_date
    ?? warrantyData?.basic_expiry_date,
  );
  const daysRemaining = daysUntil(expiryDate);
  const variant = statusVariant(daysRemaining);

  const mileageLimitMi = asNumber(
    warrantyData?.mileage_limit_mi
    ?? warrantyData?.mileage_limit
    ?? warrantyData?.basic_mileage_limit_mi,
  );
  const currentMileageMi = asNumber(
    warrantyData?.current_mileage_mi
    ?? warrantyData?.odometer_mi
    ?? warrantyData?.current_odometer_mi,
  );

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
    if (!warrantyData) return [];
    const items: DetailEntry[] = [];

    // Expiry date
    items.push({
      label: t('widget.warranty.expiryDate', 'Expiry Date'),
      value: expiryDate
        ? new Date(expiryDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : null,
      badge: { text: statusLabel(daysRemaining, t), variant },
    });

    // Days remaining
    items.push({
      label: t('widget.warranty.daysRemaining', 'Days Remaining'),
      value: daysRemaining != null ? fmtInt(Math.max(daysRemaining, 0)) : null,
      mono: true,
    });

    // Mileage limit (converted)
    if (mileageLimitMi != null) {
      const converted = toDistanceDisplay(mileageLimitMi);
      items.push({
        label: t('widget.warranty.mileageLimit', 'Mileage Limit'),
        value: `${fmtNumber(converted, 0)} ${distanceUnit}`,
        mono: true,
      });
    }

    // Current mileage (converted)
    if (currentMileageMi != null) {
      const converted = toDistanceDisplay(currentMileageMi);
      items.push({
        label: t('widget.warranty.currentMileage', 'Current Mileage'),
        value: `${fmtNumber(converted, 0)} ${distanceUnit}`,
        mono: true,
      });
    }

    // Coverage type badges
    for (const cov of COVERAGE_TYPES) {
      const covVal = warrantyData[cov.key];
      if (covVal != null && covVal !== false && covVal !== '') {
        const covExpiry = asString(
          (warrantyData as Record<string, unknown>)[`${cov.key}_expiry_date`],
        );
        const covDays = daysUntil(covExpiry);
        const covActive = covExpiry ? (covDays != null && covDays > 0) : true;
        items.push({
          label: t(cov.labelKey, cov.fallback),
          value: covExpiry
            ? new Date(covExpiry).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
            : t('widget.warranty.included', 'Included'),
          badge: {
            text: covActive
              ? t('widget.warranty.covered', 'Covered')
              : t('widget.warranty.expired', 'Expired'),
            variant: covActive ? 'success' : 'error',
          },
        });
      }
    }

    return items;
  }, [warrantyData, expiryDate, daysRemaining, variant, mileageLimitMi, currentMileageMi, toDistanceDisplay, distanceUnit, t]);

  const shellProps = {
    loading: isLoading,
    updatedAt: dataUpdatedAt ?? 0,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  // ── Compact layout (1×2): days remaining + Active/Expired badge ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
        <div className="h-full flex flex-col items-center justify-center gap-1.5 min-h-[44px]">
          {warrantyData ? (
            <>
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span className="text-2xl font-bold text-[var(--text-primary)]">
                {daysRemaining != null ? fmtInt(Math.max(daysRemaining, 0)) : '—'}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                {t('widget.warranty.daysLeft', 'days left')}
              </span>
              <Badge
                variant={variant === 'error' ? 'danger' : variant}
                size="sm"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                {statusLabel(daysRemaining, t)}
              </Badge>
            </>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<ShieldCheck className="h-5 w-5" />}
              message={t('widget.warranty.noData', 'No warranty data')}
              className="py-2"
            />
          )}
        </div>
      </WidgetShell>
    );
  }

  // ── Standard layout (2×2): progress bars + coverage badges ──
  return (
    <WidgetShell
      title={t('widget.warranty.title', 'Warranty Status')}
      icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
      {warrantyData ? (
        <div className="h-full flex flex-col gap-3 overflow-y-auto">
          {/* Time remaining progress bar */}
          {totalDays != null && daysUsed != null && (
            <MetricBar
              value={daysUsed}
              max={totalDays}
              color={variant === 'success' ? '#10b981' : variant === 'warning' ? '#f59e0b' : '#ef4444'}
              label={t('widget.warranty.timeRemaining', 'Time Remaining')}
              sublabel={
                daysRemaining != null
                  ? `${fmtInt(Math.max(daysRemaining, 0))} ${t('widget.warranty.daysUnit', 'days')}`
                  : '—'
              }
            />
          )}

          {/* Mileage remaining progress bar */}
          {mileageLimitMi != null && currentMileageMi != null && (
            <MetricBar
              value={toDistanceDisplay(currentMileageMi)}
              max={toDistanceDisplay(mileageLimitMi)}
              color={
                currentMileageMi / mileageLimitMi > 0.9
                  ? '#ef4444'
                  : currentMileageMi / mileageLimitMi > 0.75
                    ? '#f59e0b'
                    : '#10b981'
              }
              label={t('widget.warranty.mileageRemaining', 'Mileage Remaining')}
              sublabel={`${fmtNumber(toDistanceDisplay(mileageLimitMi - currentMileageMi), 0)} ${distanceUnit}`}
            />
          )}

          {/* Detail rows via shared component */}
          <WidgetDetailCard
            entries={entries}
            emptyMessage={t('widget.warranty.noData', 'No warranty data')}
            emptyIcon={<ShieldCheck className="h-5 w-5" />}
          />
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<ShieldCheck className="h-5 w-5" />}
          message={t('widget.warranty.noData', 'No warranty data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
