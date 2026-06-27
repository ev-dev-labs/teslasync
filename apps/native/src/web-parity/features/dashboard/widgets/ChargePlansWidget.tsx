// Native parity port of web/src/features/dashboard/widgets/ChargePlansWidget.tsx.
//
// The web module is the dashboard "Charge Plans" widget. It reads the smart
// charge-plan history for the selected (or first) vehicle
// (GET /api/v1/charge-planner/history?vehicle_id=…) plus the available TOU rate
// plans (GET /api/v1/charge-planner/rate-plans) and renders, driven by the grid
// `size.cols`:
//   • Compact (cols <= 1): a centred Target-SOC hero (clock glyph, big SOC%, an
//     uppercase "Target SOC" caption, and the depart-by time when present), or an
//     EmptyState when there is no active plan.
//   • Standard (cols >= 2): the active plan's status Badge + rate-plan name, a
//     2-up Target SOC / Departure StatCard grid, a WidgetDetailCard of the
//     remaining plan fields (scheduled start/end, est. energy, est. cost,
//     savings, rate plan), and — when rate plans exist — a "Rate Plans" section
//     listing each utility/name/id. An EmptyState shows when neither plans nor
//     rates are available; an inner EmptyState shows when rates exist but no plan.
// The "active" plan is the first plan whose status is active|scheduled, else the
// first plan. Loading/fetching/stale/error freshness is merged across both
// queries exactly as in the source (max updatedAt, OR-ed flags).
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation('dashboard') -> a local English-fallback
//     useTranslation(ns?) whose t(key, fallback?) returns the fallback (or key),
//     preserving every translation key verbatim.
//   • lucide-react Clock -> the app SemanticIcon 'clock' glyph rendered as a
//     colour-tinted AppText (GlyphIcon): accent (text-cyan-400) in the header /
//     compact hero, muted in the EmptyState slots (the web `h-5 w-5` icons carry
//     no colour class).
//   • @/components/ui Badge -> a local native pill Badge (success/warning/danger/
//     neutral surface+text tints, optional leading dot) covering the `size="sm"`
//     usage at both call sites.
//   • @/components/data-display StatCard -> a local native StatCard (muted label +
//     bold value) mirroring the web data-display Card layout.
//   • ./shared WidgetDetailCard + the DetailEntry type -> a local native
//     WidgetDetailCard (label/value rows, optional trailing Badge, optional mono
//     value, compact slice-to-4, EmptyState fallback) with the DetailEntry type
//     and the 'error'->'danger' badgeVariantMap ported verbatim.
//   • ./WidgetShell WidgetShell -> a local native WidgetShell covering exactly the
//     props this call site uses (title/icon/loading/updatedAt/isFetching/isStale/
//     isError/onRefresh/children): Skeleton while loading, a header row (icon +
//     uppercase title + freshness/refresh affordance) when titled, else an overlay
//     freshness chip. (The source never passes `error`, so no inline error block
//     renders — error surfaces through the freshness "Error" state, as in web.)
//   • ./types WidgetProps/WidgetSize/WidgetConfig -> ported verbatim as local
//     types (the shared registry types module is not yet in the parity tree).
//   • @/hooks/useFormatting (formatCurrency) + @/hooks/useDateFormat (formatTime,
//     formatDateShort) -> derived from the native useSettings() query exactly like
//     the web hooks: formatCurrency = `${symbol}${fmtNumber(amount, decimals ??
//     precision)}`; the date helpers inline @/lib/dateFormat's formatTime
//     ("2:30 AM"/"02:30") and formatDateShort ("Apr 4") option objects with the
//     settings locale threaded in (RN ships no ported useTimezone, so the device
//     zone is used — the KioskOverlay/ChargingCurvePage precedent).
//   • @/lib/numberFormat fmtNumber/fmtInt -> inlined locale-aware fixed-decimal
//     helpers; the source's global-locale singleton is replaced by the
//     settings-derived locale (RN has no global-locale singleton).
//   • @/api/hooks/useCharging useChargePlans/useRatePlans + @/api/hooks/useVehicles
//     useVehicles -> the already-ported native parity hooks (same names / return
//     shapes / API paths). @/components/feedback EmptyState -> the native parity
//     EmptyState.
//   • DOM <div>/<span>/<h4> + Tailwind classes + overflow-y-auto -> React Native
//     View/ScrollView/AppText with StyleSheet tokens; text-[var(--text-*)] -> the
//     AppText tones; the white/[0.06] hairline divider is preserved as a literal.
//     The DataFreshness header indicator is computed once at render (no interval)
//     to avoid a dangling timer under --detectOpenHandles.
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {useChargePlans, useRatePlans} from '../../../api/hooks/useCharging';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';

const DEFAULT_LOCALE = 'en-US';
// web Tailwind white/[0.06] hairline used by WidgetDetailCard rows + the rate
// plans section border-top.
const HAIRLINE = 'rgba(255, 255, 255, 0.06)';

/* ─── ./types (dashboard widget registry types, ported verbatim) ─────────── */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

/* ─── ./shared WidgetDetailCard DetailEntry (ported verbatim) ────────────── */

export interface DetailEntry {
  label: string;
  value: string | number | null;
  badge?: {text: string; variant: 'success' | 'warning' | 'error' | 'neutral'};
  mono?: boolean;
}

/* ─── i18n fallback (web react-i18next useTranslation/TFunction) ─────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation('dashboard'): the parity
// bundle ships no i18n runtime, so `t` returns the English fallback (or the key)
// while preserving every key at the call site.
function useTranslation(_namespace?: string): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat fmtNumber + fmtInt ──────────────────────── */

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web @/lib/numberFormat fmtNumber: locale-aware separators with a fixed
// fraction-digit count (min === max), falling back to en-US for bad locales.
function fmtNumber(value: unknown, decimals: number, locale: string): string {
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
}

// web @/lib/numberFormat fmtInt(v) === fmtNumber(v, 0).
function fmtInt(value: unknown, locale: string): string {
  return fmtNumber(value, 0, locale);
}

/* ─── inlined @/lib/dateFormat formatTime + formatDateShort ──────────────── */

type DateInput = string | Date | null | undefined;

// web @/lib/dateFormat formatTime: "2:30 AM"/"02:30" (locale-driven); "—" for
// missing/invalid. The web useDateFormat also binds an IANA timezone; RN ships
// no ported useTimezone, so the device zone is used (KioskOverlay/
// ChargingCurvePage precedent) while the locale is threaded from settings.
function libFormatTime(value: DateInput, locale: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(locale, {hour: '2-digit', minute: '2-digit'});
}

// web @/lib/dateFormat formatDateShort: "Apr 4" (month short + day numeric);
// "—" for missing/invalid.
function libFormatDateShort(value: DateInput, locale: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, {month: 'short', day: 'numeric'});
}

/* ─── settings-derived @/hooks/useFormatting + @/hooks/useDateFormat ──────── */

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

function derivePrecision(decimalPrecision: unknown): number {
  if (
    typeof decimalPrecision === 'number' &&
    Number.isFinite(decimalPrecision) &&
    decimalPrecision >= 0
  ) {
    return Math.floor(decimalPrecision);
  }
  return 2;
}

interface DisplayFormatting {
  locale: string;
  formatCurrency: (amount: number, decimals?: number) => string;
}

// Native bridge mirroring the web useFormatting() subset this widget uses
// (currencySymbol + formatCurrency), derived from the native useSettings() query.
function useDisplayFormatting(): DisplayFormatting {
  const {data: settings} = useSettings();
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';

  // web useFormatting.formatCurrency: `${symbol}${fmtNumber(amount, decimals ?? precision)}`.
  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? precision, locale)}`,
    [currencySymbol, precision, locale],
  );

  return {locale, formatCurrency};
}

interface DateFormatting {
  formatTime: (value: DateInput) => string;
  formatDateShort: (value: DateInput) => string;
}

// Native bridge mirroring the web useDateFormat() subset this widget uses
// (formatTime + formatDateShort), with the locale threaded from useSettings().
function useDateFormat(): DateFormatting {
  const {data: settings} = useSettings();
  const locale = deriveLocale(settings?.locale);
  const formatTime = useCallback(
    (value: DateInput) => libFormatTime(value, locale),
    [locale],
  );
  const formatDateShort = useCallback(
    (value: DateInput) => libFormatDateShort(value, locale),
    [locale],
  );
  return {formatTime, formatDateShort};
}

/* ─── status -> badge variant (ported verbatim) ──────────────────────────── */

/** Variant for DetailEntry badges (WidgetDetailCard maps 'error' → 'danger' internally) */
function detailBadgeVariant(
  status: string,
): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'active':
    case 'scheduled':
      return 'warning';
    case 'failed':
    case 'cancelled':
      return 'error';
    default:
      return 'neutral';
  }
}

/** Variant for direct Badge component usage */
function badgeVariant(
  status: string,
): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'active':
    case 'scheduled':
      return 'warning';
    case 'failed':
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

/* ─── lucide-react Clock -> SemanticIcon 'clock' glyph ───────────────────── */

function GlyphIcon({color, size}: {color: string; size: number}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {color, fontSize: size, lineHeight: size + 2}]}>
      {getSemanticIconDefinition('clock').glyph}
    </AppText>
  );
}

/* ─── DataFreshness chip (web @/components/data-display) ──────────────────── */

// web DataFreshness: a small relative-time + refresh affordance. Computed once
// at render (no interval) to avoid a dangling timer under --detectOpenHandles.
function relativeTime(updatedAt: number): string {
  if (!updatedAt || updatedAt <= 0) {
    return 'never';
  }
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}) {
  let label: string;
  let dotColor: string;
  if (isError) {
    label = 'Error';
    dotColor = colors.danger;
  } else if (isFetching) {
    label = 'Updating…';
    dotColor = colors.accent;
  } else if (isStale) {
    label = 'Stale';
    dotColor = colors.warning;
  } else {
    label = relativeTime(updatedAt);
    dotColor = colors.success;
  }

  return (
    <Pressable
      accessibilityLabel={`Data ${label}. Refresh.`}
      accessibilityRole="button"
      disabled={!onRefresh}
      onPress={onRefresh}
      style={styles.freshness}
      testID="widget-freshness">
      <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />
      {compact ? null : (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

/* ─── WidgetShell (web ./WidgetShell, subset used by this widget) ─────────── */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: WidgetShellProps) {
  if (loading) {
    return <Skeleton height={120} rounded style={styles.shellSkeleton} />;
  }

  if (error) {
    return (
      <View style={styles.shellError} testID="widget-error">
        <AppText style={styles.shellErrorText} tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when the widget has no title (typically 1-col widgets).
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
      updatedAt={updatedAt ?? 0}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellTitleRow}>
            {icon}
            <AppText
              numberOfLines={1}
              style={styles.shellTitle}
              tone="muted"
              variant="caption">
              {title.toUpperCase()}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : (
        freshnessEl && (
          <View pointerEvents="box-none" style={styles.shellFreshnessOverlay}>
            {freshnessEl}
          </View>
        )
      )}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── @/components/ui Badge (pill) ───────────────────────────────────────── */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

const BADGE_PALETTE: Record<BadgeVariant, {bg: string; fg: string}> = {
  success: {bg: colors.successSurface, fg: colors.success},
  warning: {bg: colors.warningSurface, fg: colors.warning},
  danger: {bg: colors.dangerSurface, fg: colors.danger},
  neutral: {bg: colors.surfaceRaised, fg: colors.textMuted},
};

function Badge({
  variant = 'neutral',
  dot,
  children,
  testID,
}: {
  variant?: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
  testID?: string;
}) {
  const palette = BADGE_PALETTE[variant];
  return (
    <View style={[styles.badge, {backgroundColor: palette.bg}]} testID={testID}>
      {dot ? (
        <View style={[styles.badgeDot, {backgroundColor: palette.fg}]} />
      ) : null}
      <AppText numberOfLines={1} style={[styles.badgeText, {color: palette.fg}]}>
        {children}
      </AppText>
    </View>
  );
}

/* ─── @/components/data-display StatCard ─────────────────────────────────── */

function StatCard({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.statCard}>
      <AppText numberOfLines={1} style={styles.statLabel} tone="muted">
        {label}
      </AppText>
      <AppText numberOfLines={1} style={styles.statValue} weight="bold">
        {value}
      </AppText>
    </View>
  );
}

/* ─── ./shared WidgetDetailCard ──────────────────────────────────────────── */

// web WidgetDetailCard maps the DetailEntry 'error' variant onto the Badge
// 'danger' variant (ported verbatim).
const badgeVariantMap = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
} as const;

function WidgetDetailCard({
  entries,
  compact = false,
  emptyMessage,
  emptyIcon,
  testID,
}: {
  entries: DetailEntry[];
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  testID?: string;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage ?? 'No details available'}
        style={styles.emptyPad}
        testID={testID}
      />
    );
  }

  const visible = compact ? entries.slice(0, 4) : entries;

  return (
    <View style={styles.detailList} testID={testID}>
      {visible.map((entry, i) => (
        <View
          key={entry.label}
          style={[
            styles.detailRow,
            i < visible.length - 1 ? styles.detailRowBorder : null,
          ]}>
          <AppText numberOfLines={1} style={styles.detailLabel} tone="muted">
            {entry.label}
          </AppText>
          <View style={styles.detailValueGroup}>
            <AppText
              numberOfLines={1}
              style={[styles.detailValue, entry.mono ? styles.detailMono : null]}>
              {entry.value ?? '—'}
            </AppText>
            {entry.badge ? (
              <Badge variant={badgeVariantMap[entry.badge.variant]}>
                {entry.badge.text}
              </Badge>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ─── ChargePlansWidget ──────────────────────────────────────────────────── */

export default function ChargePlansWidget({vehicleId, size}: WidgetProps) {
  const {t} = useTranslation('dashboard');
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {locale, formatCurrency} = useDisplayFormatting();
  const {formatTime, formatDateShort: formatDate} = useDateFormat();

  const {
    data: plans,
    isLoading: plansLoading,
    isFetching: plansFetching,
    isStale: plansStale,
    isError: plansError,
    dataUpdatedAt: plansUpdatedAt,
    refetch: refetchPlans,
  } = useChargePlans(id > 0 ? id : undefined);

  const {
    data: ratePlans,
    isLoading: ratesLoading,
    isFetching: ratesFetching,
    isStale: ratesStale,
    isError: ratesError,
    dataUpdatedAt: ratesUpdatedAt,
    refetch: refetchRates,
  } = useRatePlans();

  const isLoading = plansLoading || ratesLoading;
  const isFetching = plansFetching || ratesFetching;
  const isStale = plansStale || ratesStale;
  const isError = plansError || ratesError;
  const updatedAt = Math.max(plansUpdatedAt ?? 0, ratesUpdatedAt ?? 0);

  // web L81-82 `const safePlans = plans ?? []` / `safeRates = ratePlans ?? []`:
  // memoised so the empty-array fallback keeps a stable identity for the
  // activePlan/rateEntries useMemo dependency lists (react-hooks/exhaustive-deps).
  const safePlans = useMemo(() => plans ?? [], [plans]);
  const safeRates = useMemo(() => ratePlans ?? [], [ratePlans]);

  const activePlan = useMemo(
    () =>
      safePlans.find(p => p.status === 'active' || p.status === 'scheduled') ??
      safePlans[0] ??
      null,
    [safePlans],
  );

  const isCompact = size.cols <= 1;

  const planEntries: DetailEntry[] = useMemo(() => {
    if (!activePlan) return [];

    const items: DetailEntry[] = [];

    items.push({
      label: t('widget.chargePlans.targetSoc', 'Target SOC'),
      value: `${fmtInt(activePlan.target_soc ?? 0, locale)}%`,
      badge: {
        text: activePlan.status ?? '—',
        variant: detailBadgeVariant(activePlan.status),
      },
    });

    items.push({
      label: t('widget.chargePlans.departure', 'Departure'),
      value: activePlan.depart_by ? formatTime(activePlan.depart_by) : '—',
    });

    items.push({
      label: t('widget.chargePlans.schedStart', 'Scheduled Start'),
      value: `${formatDate(activePlan.scheduled_start)} ${formatTime(
        activePlan.scheduled_start,
      )}`,
    });

    items.push({
      label: t('widget.chargePlans.schedEnd', 'Scheduled End'),
      value: `${formatDate(activePlan.scheduled_end)} ${formatTime(
        activePlan.scheduled_end,
      )}`,
    });

    items.push({
      label: t('widget.chargePlans.estEnergy', 'Est. Energy'),
      value:
        activePlan.estimated_kwh != null
          ? `${fmtNumber(activePlan.estimated_kwh, 1, locale)} kWh`
          : '—',
    });

    items.push({
      label: t('widget.chargePlans.estCost', 'Est. Cost'),
      value:
        activePlan.estimated_cost != null
          ? formatCurrency(activePlan.estimated_cost)
          : '—',
    });

    if (activePlan.savings != null && activePlan.savings > 0) {
      items.push({
        label: t('widget.chargePlans.savings', 'Savings'),
        value: formatCurrency(activePlan.savings),
        badge: {
          text: t('widget.chargePlans.saved', 'saved'),
          variant: 'success',
        },
      });
    }

    items.push({
      label: t('widget.chargePlans.ratePlan', 'Rate Plan'),
      value: activePlan.rate_plan ?? '—',
    });

    return items;
  }, [activePlan, t, formatCurrency, formatTime, formatDate, locale]);

  const rateEntries: DetailEntry[] = useMemo(() => {
    return safeRates.map(rp => ({
      label: rp.utility ?? '—',
      value: rp.name ?? '—',
      badge: {text: rp.id ?? '—', variant: 'neutral' as const},
      mono: true,
    }));
  }, [safeRates]);

  const hasData = safePlans.length > 0 || safeRates.length > 0;

  const handleRefresh = () => {
    refetchPlans();
    refetchRates();
  };

  if (isCompact) {
    return (
      <WidgetShell
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        loading={isLoading}
        onRefresh={handleRefresh}
        updatedAt={updatedAt}>
        {activePlan ? (
          <View style={styles.compactWrap}>
            <GlyphIcon color={colors.accent} size={16} />
            <AppText
              style={styles.compactValue}
              testID="charge-plans-target-soc"
              weight="bold">
              {fmtInt(activePlan.target_soc ?? 0, locale)}%
            </AppText>
            <AppText
              numberOfLines={1}
              style={styles.compactCaption}
              tone="muted">
              {t('widget.chargePlans.targetSoc', 'Target SOC')}
            </AppText>
            {activePlan.depart_by ? (
              <AppText
                numberOfLines={1}
                style={styles.compactDepart}
                tone="secondary">
                {formatTime(activePlan.depart_by)}
              </AppText>
            ) : null}
          </View>
        ) : (
          <EmptyState
            icon={<GlyphIcon color={colors.textMuted} size={18} />}
            message={t('widget.chargePlans.noPlans', 'No charge plans')}
            style={styles.emptyPad}
            testID="charge-plans-empty"
          />
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      icon={<GlyphIcon color={colors.accent} size={13} />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={handleRefresh}
      title={t('widget.chargePlans.title', 'Charge Plans')}
      updatedAt={updatedAt}>
      {hasData ? (
        <ScrollView
          contentContainerStyle={styles.standardContent}
          showsVerticalScrollIndicator={false}
          style={styles.standardScroll}>
          {activePlan ? (
            <View>
              <View style={styles.statusRow}>
                <Badge
                  dot
                  testID="charge-plans-status"
                  variant={badgeVariant(activePlan.status)}>
                  {activePlan.status ?? '—'}
                </Badge>
                <AppText
                  numberOfLines={1}
                  style={styles.ratePlanText}
                  tone="secondary">
                  {activePlan.rate_plan ?? ''}
                </AppText>
              </View>

              <View style={styles.summaryGrid} testID="charge-plans-summary">
                <View style={styles.summaryCell}>
                  <StatCard
                    label={t('widget.chargePlans.targetSoc', 'Target SOC')}
                    value={`${fmtInt(activePlan.target_soc ?? 0, locale)}%`}
                  />
                </View>
                <View style={styles.summaryCell}>
                  <StatCard
                    label={t('widget.chargePlans.departure', 'Departure')}
                    value={
                      activePlan.depart_by
                        ? formatTime(activePlan.depart_by)
                        : '—'
                    }
                  />
                </View>
              </View>

              <WidgetDetailCard
                compact={size.rows <= 3}
                emptyIcon={<GlyphIcon color={colors.textMuted} size={18} />}
                emptyMessage={t(
                  'widget.chargePlans.noDetails',
                  'No plan details',
                )}
                entries={planEntries.slice(2)}
                testID="charge-plans-detail"
              />
            </View>
          ) : (
            <EmptyState
              icon={<GlyphIcon color={colors.textMuted} size={18} />}
              message={t('widget.chargePlans.noPlans', 'No charge plans')}
              style={styles.emptyPad}
              testID="charge-plans-empty"
            />
          )}

          {safeRates.length > 0 ? (
            <View style={styles.ratesSection}>
              <AppText
                numberOfLines={1}
                style={styles.ratesHeader}
                tone="muted">
                {t('widget.chargePlans.ratePlans', 'Rate Plans')}
              </AppText>
              <WidgetDetailCard
                compact={size.rows <= 3}
                emptyIcon={<GlyphIcon color={colors.textMuted} size={18} />}
                emptyMessage={t('widget.chargePlans.noRates', 'No rate plans')}
                entries={rateEntries}
                testID="charge-plans-rates"
              />
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <EmptyState
          icon={<GlyphIcon color={colors.textMuted} size={18} />}
          message={t(
            'widget.chargePlans.noData',
            'No charge plans or rate data',
          )}
          style={styles.emptyPad}
          testID="charge-plans-empty"
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  glyph: {
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  // WidgetShell
  shell: {
    flex: 1,
    position: 'relative',
  },
  shellSkeleton: {
    height: '100%',
    minHeight: 120,
  },
  shellError: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellErrorText: {
    textAlign: 'center',
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  shellTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
  },
  shellTitle: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
  },
  shellFreshnessOverlay: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  // DataFreshness
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  freshnessLabel: {
    fontSize: 10,
  },
  // Compact layout
  compactWrap: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  compactValue: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
  },
  compactCaption: {
    fontSize: 10,
    letterSpacing: 0.6,
    maxWidth: '100%',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  compactDepart: {
    fontSize: 12,
    maxWidth: '100%',
  },
  // Standard layout
  standardScroll: {
    flex: 1,
  },
  standardContent: {
    flexDirection: 'column',
    gap: spacing.md,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  ratePlanText: {
    flexShrink: 1,
    fontSize: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  summaryCell: {
    flex: 1,
  },
  ratesSection: {
    borderTopColor: HAIRLINE,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
  },
  ratesHeader: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  // StatCard (data-display)
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'column',
    gap: spacing.xs,
    padding: spacing.md,
  },
  statLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 28,
  },
  // Badge
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // WidgetDetailCard
  detailList: {
    flexDirection: 'column',
  },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  detailRowBorder: {
    borderBottomColor: HAIRLINE,
    borderBottomWidth: 1,
  },
  detailLabel: {
    flexShrink: 1,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  detailValueGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  detailValue: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
  },
  detailMono: {
    fontFamily: 'monospace',
  },
  // EmptyState padding (web py-4)
  emptyPad: {
    paddingVertical: 16,
  },
});
