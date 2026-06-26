// Native parity port of web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx.
//
// Dashboard widget that surfaces a vehicle's Tesla warranty: expiry date +
// Active/Expired status, days remaining, mileage limit/current odometer (both
// SI-converted to the user's display distance unit) and a per-coverage-type
// list (Basic, Battery/Drive Unit, Corrosion, Emissions, Body). The compact
// (1-col) size shows only the colour-coded days-left number + status badge; the
// standard (2×2) size adds a time-remaining progress bar, a mileage-remaining
// progress bar and the detail rows. When no warranty data is present it falls
// back to an icon+message empty state. The web file pulls in browser-only or
// web-UI dependencies that are absent from the native parity manifest (contract
// rules 4, 5 & 7); each is replaced with a React Native-safe equivalent and
// documented here + in the sidecar:
//
//   - react-i18next useTranslation('dashboard') (web L2, L67) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.warranty.*','<English>') call keeps its English default +
//     translation-key intent (the established MonthlyMileage/BackupMonitor port).
//   - lucide-react ShieldCheck (web L3, L215, L232, L246, L287, L292) -> the
//     shared native SemanticIcon name 'securityCheck' (its shield-with-check
//     glyph 'SC', intrinsic success/emerald tone — matching the web emerald-400
//     tint). lucide SVG has no native renderer. The h-4/h-3.5 inline icons map
//     to size 'sm' and the h-5 empty-state icons to size 'md' (the MonthlyMileage
//     header-sm / empty-md convention).
//   - `@/components/ui` Badge (web L4, L222-228, L67-74 of WidgetDetailCard) ->
//     inlined native Badge: the success/warning/danger/neutral pill variants this
//     widget + the inlined WidgetDetailCard use, mapped to the theme
//     success/warning/danger/neutral surface+border+text tones (the BackupMonitor
//     Badge precedent). The compact `size="sm"` + `min-h-[44px] min-w-[44px]`
//     touch target collapses to the `small` + `minTouch` props.
//   - `@/components/data-display` MetricBar (web L5, L253-263, L268-280) -> the
//     ported native MetricBar (same value/max/color/label/sublabel contract; its
//     Animated width interpolation replaces the web framer animation, and the
//     `sublabel ?? fmt(value)` policy is preserved).
//   - `@/components/feedback` EmptyState (web L6, L231-235, L291-295, + the
//     WidgetDetailCard empty branch) -> inlined WarrantyEmptyState (icon +
//     centered muted message). The shared native EmptyState requires a title and
//     takes no icon, so the icon+message web shape is reproduced inline (the
//     BackupMonitor precedent). The web className py-2 / py-4 lighter padding
//     collapses to the `tight` boolean (8px vs 16px paddingVertical).
//   - `@/api/hooks/useVehicles` useWarrantyDetails (web L7, L74-82) -> the ported
//     native useWarrantyDetails hook (same '/tesla/warranty' query, same
//     VehicleInfoEnvelope<Record<string, unknown>> envelope + the full
//     UseQueryResult fields the shell reads).
//   - `@/hooks/useUnits` useUnits (web L8, L68, L72) -> an inlined useUnits()
//     bridge over the ported useFormatPrefs() exposing the same
//     { unitPrefs: { distance } } shape so the unitPrefs.distance call sites are
//     preserved (the MonthlyMileage precedent).
//   - `@/lib/numberFormat` fmtInt + fmtNumber (web L9, L142, L151, L161, L217,
//     L260, L279) -> component-local useCallback wrappers over the ported
//     fmtNumberRaw(value, decimals, locale) primitive (locale-aware,
//     fixed-precision), threaded the resolved settings locale so output respects
//     the user's locale the same way web numberFormat's global locale does.
//   - `@/hooks/useDateFormat` useDateFormat -> formatDate + locale (web L10, L70,
//     L134, L178) -> an inlined useDateFormat() bridge over useFormatPrefs():
//     formatDate mirrors @/lib/dateFormat formatDate (Intl toLocaleDateString
//     {year:'numeric',month:'short',day:'numeric'}, '—' for null/invalid) and
//     locale is the resolved settings locale used by the per-coverage
//     Intl.DateTimeFormat({month:'short',year:'numeric'}) call.
//   - `./WidgetShell` WidgetShell (web L11) -> inlined native WidgetShell (the
//     same skeleton/error/header/overlay-freshness/pulse subset already ported by
//     the MonthlyMileage/BackupMonitor widgets); the unused
//     query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./shared` WidgetDetailCard + type DetailEntry (web L12) -> inlined native
//     WidgetDetailCard (label/value/optional-badge/mono rows, compact slice(0,4),
//     border-between-rows, icon+message empty state) + the DetailEntry type. The
//     separate ./shared source is not yet ported, so it is inlined here.
//   - `./types` WidgetProps (web L13) -> inlined native WidgetSize/WidgetProps
//     (the size subset this widget reads).
//   - `@/lib/unitConversion` convertDistanceFromSI (web L14, L69) -> imported from
//     the ported native format _formatPrimitives (meters -> km|mi), the same
//     native-safe SI display-boundary converter used by the MonthlyMileage port.
//     SI stays on the wire; conversion happens only at render.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported -- only react, react-native
// primitives (Platform/ScrollView/StyleSheet/View), the shared native
// SemanticIcon / AppText / theme tokens, and the ported parity MetricBar /
// useWarrantyDetails / useFormatPrefs / convertDistanceFromSI / fmtNumberRaw /
// DataFreshness / QueryError.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {useWarrantyDetails} from '../../../api/hooks/useVehicles';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {MetricBar} from '../../../components/data-display/MetricBar';
import {
  convertDistanceFromSI,
  fmtNumberRaw,
  useFormatPrefs,
  type DistanceUnit,
} from '../../../components/data-display/format/_formatPrimitives';
import {QueryError} from '../../../components/feedback/QueryError';

const MONO = Platform.select({ios: 'Courier', default: 'monospace'});

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/hooks/useUnits replacement (native bridge over useFormatPrefs) ──
// Native has no useUnits hook; the distance display preference is derived from
// the shared useFormatPrefs bridge (settings -> unit prefs) and exposed under
// the same { unitPrefs: { distance } } shape the web useUnits returns so the
// unitPrefs.distance call sites are preserved.
interface UnitPrefs {
  distance: DistanceUnit;
}

function useUnits(): {unitPrefs: UnitPrefs} {
  const {distanceUnit} = useFormatPrefs();
  return {unitPrefs: {distance: distanceUnit}};
}

// ── @/hooks/useDateFormat replacement (native bridge over useFormatPrefs) ──
// Mirrors @/lib/dateFormat formatDate: '—' for null/invalid, otherwise a
// locale-aware "Apr 4, 2026"-style date string. `locale` is the resolved
// settings locale, threaded into the per-coverage Intl.DateTimeFormat call.
interface DateFormatBridge {
  formatDate: (value: string | Date | null | undefined) => string;
  locale: string;
}

function useDateFormat(): DateFormatBridge {
  const {locale} = useFormatPrefs();
  const formatDate = useCallback(
    (value: string | Date | null | undefined): string => {
      if (!value) return '—';
      const d = new Date(value);
      if (isNaN(d.getTime())) return '—';
      try {
        return d.toLocaleDateString(locale, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      } catch {
        return d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      }
    },
    [locale],
  );
  return {formatDate, locale};
}

// ── @/components/ui Badge (ported inline, native-safe subset) ──
type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

interface BadgeProps {
  variant: BadgeVariant;
  small?: boolean;
  /** Web's `min-h-[44px] min-w-[44px] flex items-center justify-center`. */
  minTouch?: boolean;
  children: string;
}

function Badge({variant, small = false, minTouch = false, children}: BadgeProps) {
  return (
    <View
      style={[
        styles.badge,
        minTouch && styles.badgeTouch,
        badgeSurfaceStyles[variant],
      ]}>
      <AppText
        style={[
          styles.badgeText,
          small && styles.badgeTextSmall,
          badgeTextColorStyles[variant],
        ]}
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// ── @/components/feedback EmptyState (ported inline; icon + message, no title) ──
function WarrantyEmptyState({
  icon,
  message,
  tight = false,
}: {
  icon: ReactNode;
  message: string;
  tight?: boolean;
}) {
  return (
    <View style={[styles.empty, tight && styles.emptyTight]}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

// ── ./shared WidgetDetailCard + DetailEntry (ported inline) ──
interface DetailEntry {
  label: string;
  value: string | number | null;
  badge?: {text: string; variant: 'success' | 'warning' | 'error' | 'neutral'};
  mono?: boolean;
}

interface WidgetDetailCardProps {
  entries: DetailEntry[];
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

const badgeVariantMap = {
  error: 'danger',
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
} as const;

function WidgetDetailCard({
  entries,
  compact = false,
  emptyMessage,
  emptyIcon,
}: WidgetDetailCardProps) {
  if (entries.length === 0) {
    // Transient empty state — surfaces when source data is missing; no specific
    // recovery action available (matches web EmptyState no-action comment).
    return (
      <WarrantyEmptyState
        icon={emptyIcon}
        message={emptyMessage ?? 'No details available'}
      />
    );
  }

  const visible = compact ? entries.slice(0, 4) : entries;

  return (
    <ScrollView nestedScrollEnabled style={styles.detailScroll}>
      {visible.map((entry, i) => (
        <View
          key={entry.label}
          style={[
            styles.detailRow,
            i < visible.length - 1 && styles.detailRowBorder,
          ]}>
          <AppText
            numberOfLines={1}
            style={styles.detailLabel}
            tone="muted"
            variant="caption">
            {entry.label}
          </AppText>
          <View style={styles.detailValueGroup}>
            <AppText
              numberOfLines={1}
              style={[styles.detailValue, entry.mono && styles.mono]}>
              {entry.value ?? '—'}
            </AppText>
            {entry.badge ? (
              <Badge small variant={badgeVariantMap[entry.badge.variant]}>
                {entry.badge.text}
              </Badge>
            ) : null}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// ── ./WidgetShell (ported inline, native-safe subset) ──
interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse-on-data-change glow (web WidgetShell L59-80).
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return (
      <View
        accessibilityLabel="Loading"
        accessibilityRole="progressbar"
        style={styles.skeleton}
      />
    );
  }

  if (error) {
    return (
      <View style={styles.errorWrap}>
        <QueryError error={new Error(error)} />
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when the widget has no title (typically 1×1 widgets).
  const freshnessCompact = !title;

  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated && styles.shellPulse]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            {icon}
            <AppText numberOfLines={1} style={styles.title}>
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.overlayFreshness}>{freshnessEl}</View>
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

// ── ./types WidgetSize / WidgetProps (ported inline subset) ──
interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/** Safely extract a string from an unknown value (ported verbatim from web). */
function asString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string' && val.length > 0) return val;
  if (typeof val === 'number') return String(val);
  return null;
}

/** Safely extract a number from an unknown value (ported verbatim from web). */
function asNumber(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === 'number' && isFinite(val)) return val;
  if (typeof val === 'string') {
    const n = Number(val);
    return isFinite(n) ? n : null;
  }
  return null;
}

/** Compute days remaining from an expiry date string (ISO or date). Ported. */
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const expiry = new Date(dateStr);
  if (isNaN(expiry.getTime())) return null;
  const now = new Date();
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Badge variant based on days remaining (ported verbatim from web). */
function statusVariant(days: number | null): 'success' | 'warning' | 'error' {
  if (days == null || days <= 0) return 'error';
  if (days <= 90) return 'warning';
  return 'success';
}

/** Status label based on days remaining (ported verbatim from web). */
function statusLabel(days: number | null, t: NativeTFunction): string {
  if (days == null || days <= 0) return t('widget.warranty.expired', 'Expired');
  return t('widget.warranty.active', 'Active');
}

/** Known warranty coverage types to extract from data (ported verbatim). */
const COVERAGE_TYPES = [
  {key: 'basic', labelKey: 'widget.warranty.basic', fallback: 'Basic'},
  {
    key: 'battery_drive_unit',
    labelKey: 'widget.warranty.batteryDrive',
    fallback: 'Battery/Drive Unit',
  },
  {key: 'corrosion', labelKey: 'widget.warranty.corrosion', fallback: 'Corrosion'},
  {key: 'emissions', labelKey: 'widget.warranty.emissions', fallback: 'Emissions'},
  {key: 'body', labelKey: 'widget.warranty.body', fallback: 'Body'},
] as const;

export default function WarrantyStatusWidget({size}: WidgetProps) {
  const t = useNativeTranslation();
  const {unitPrefs} = useUnits();
  // useCallback keeps the converter stable across renders so the entries useMemo
  // dependency list satisfies react-hooks/exhaustive-deps (the web file
  // recreated this inline each render; native lint is stricter).
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const {formatDate, locale} = useDateFormat();

  const distanceUnit = unitPrefs.distance;

  // @/lib/numberFormat fmtInt + fmtNumber -> locale-aware wrappers over the
  // ported fmtNumberRaw primitive (stable per resolved locale).
  const fmtInt = useCallback(
    (value: unknown) => fmtNumberRaw(value, 0, locale),
    [locale],
  );
  const fmtNumber = useCallback(
    (value: unknown, decimals: number) => fmtNumberRaw(value, decimals, locale),
    [locale],
  );

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
    warrantyData?.warranty_expiry_date ??
      warrantyData?.expiry_date ??
      warrantyData?.basic_expiry_date,
  );
  const daysRemaining = daysUntil(expiryDate);
  const variant = statusVariant(daysRemaining);

  const mileageLimitMi = asNumber(
    warrantyData?.mileage_limit_mi ??
      warrantyData?.mileage_limit ??
      warrantyData?.basic_mileage_limit_mi,
  );
  const currentMileageMi = asNumber(
    warrantyData?.current_mileage_mi ??
      warrantyData?.odometer_mi ??
      warrantyData?.current_odometer_mi,
  );

  // Total warranty period in days (for progress bar)
  const startDate = asString(
    warrantyData?.warranty_start_date ??
      warrantyData?.start_date ??
      warrantyData?.in_service_date,
  );
  const totalDays = useMemo(() => {
    if (!startDate || !expiryDate) return null;
    const start = new Date(startDate);
    const end = new Date(expiryDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }, [startDate, expiryDate]);

  const daysUsed =
    totalDays != null && daysRemaining != null
      ? Math.max(totalDays - daysRemaining, 0)
      : null;

  // Build detail entries for WidgetDetailCard
  const entries: DetailEntry[] = useMemo(() => {
    if (!warrantyData) return [];
    const items: DetailEntry[] = [];

    // Expiry date
    items.push({
      label: t('widget.warranty.expiryDate', 'Expiry Date'),
      value: expiryDate ? formatDate(expiryDate) : null,
      badge: {text: statusLabel(daysRemaining, t), variant},
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
        const covActive = covExpiry ? covDays != null && covDays > 0 : true;
        items.push({
          label: t(cov.labelKey, cov.fallback),
          value: covExpiry
            ? new Intl.DateTimeFormat(locale, {
                month: 'short',
                year: 'numeric',
              }).format(new Date(covExpiry))
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
  }, [
    warrantyData,
    expiryDate,
    daysRemaining,
    variant,
    mileageLimitMi,
    currentMileageMi,
    toDistanceDisplay,
    distanceUnit,
    t,
    formatDate,
    locale,
    fmtInt,
    fmtNumber,
  ]);

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
      <WidgetShell {...shellProps}>
        <View style={styles.compactRoot}>
          {warrantyData ? (
            <>
              <SemanticIcon decorative name="securityCheck" size="sm" />
              <AppText style={styles.compactNumber} weight="bold">
                {daysRemaining != null
                  ? fmtInt(Math.max(daysRemaining, 0))
                  : '—'}
              </AppText>
              <AppText
                style={styles.compactCaption}
                tone="muted"
                variant="caption">
                {t('widget.warranty.daysLeft', 'days left')}
              </AppText>
              <Badge
                minTouch
                small
                variant={variant === 'error' ? 'danger' : variant}>
                {statusLabel(daysRemaining, t)}
              </Badge>
            </>
          ) : (
            <WarrantyEmptyState
              icon={<SemanticIcon decorative name="securityCheck" size="md" />}
              message={t('widget.warranty.noData', 'No warranty data')}
              tight
            />
          )}
        </View>
      </WidgetShell>
    );
  }

  // ── Standard layout (2×2): progress bars + coverage badges ──
  return (
    <WidgetShell
      {...shellProps}
      icon={<SemanticIcon decorative name="securityCheck" size="sm" />}
      title={t('widget.warranty.title', 'Warranty Status')}>
      {warrantyData ? (
        <View style={styles.standardBody}>
          {/* Time remaining progress bar */}
          {totalDays != null && daysUsed != null ? (
            <MetricBar
              color={
                variant === 'success'
                  ? '#10b981'
                  : variant === 'warning'
                    ? '#f59e0b'
                    : '#ef4444'
              }
              label={t('widget.warranty.timeRemaining', 'Time Remaining')}
              max={totalDays}
              sublabel={
                daysRemaining != null
                  ? `${fmtInt(Math.max(daysRemaining, 0))} ${t(
                      'widget.warranty.daysUnit',
                      'days',
                    )}`
                  : '—'
              }
              value={daysUsed}
            />
          ) : null}

          {/* Mileage remaining progress bar */}
          {mileageLimitMi != null && currentMileageMi != null ? (
            <MetricBar
              color={
                currentMileageMi / mileageLimitMi > 0.9
                  ? '#ef4444'
                  : currentMileageMi / mileageLimitMi > 0.75
                    ? '#f59e0b'
                    : '#10b981'
              }
              label={t('widget.warranty.mileageRemaining', 'Mileage Remaining')}
              max={toDistanceDisplay(mileageLimitMi)}
              sublabel={`${fmtNumber(
                toDistanceDisplay(mileageLimitMi - currentMileageMi),
                0,
              )} ${distanceUnit}`}
              value={toDistanceDisplay(currentMileageMi)}
            />
          ) : null}

          {/* Detail rows via shared component */}
          <WidgetDetailCard
            emptyIcon={<SemanticIcon decorative name="securityCheck" size="md" />}
            emptyMessage={t('widget.warranty.noData', 'No warranty data')}
            entries={entries}
          />
        </View>
      ) : (
        <WarrantyEmptyState
          icon={<SemanticIcon decorative name="securityCheck" size="md" />}
          message={t('widget.warranty.noData', 'No warranty data')}
        />
      )}
    </WidgetShell>
  );
}

const badgeSurfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeTextColorStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  badgeTextSmall: {
    fontSize: 10,
    lineHeight: 14,
  },
  badgeTouch: {
    alignSelf: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  compactCaption: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  compactNumber: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 28,
  },
  compactRoot: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
    justifyContent: 'center',
    minHeight: 44,
  },
  content: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  detailLabel: {
    flexShrink: 1,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  detailRowBorder: {
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomWidth: 1,
  },
  detailScroll: {
    flex: 1,
  },
  detailValue: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
  },
  detailValueGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 8,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyTight: {
    paddingVertical: 8,
  },
  errorWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  mono: {
    fontFamily: MONO,
  },
  overlayFreshness: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  shell: {
    flex: 1,
  },
  shellPulse: {
    elevation: 6,
    shadowColor: '#22c55e',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flex: 1,
    minHeight: 120,
  },
  standardBody: {
    flex: 1,
    gap: 12,
  },
  title: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
});
