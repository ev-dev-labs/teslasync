// Native parity port of
// web/src/features/dashboard/widgets/MaintenanceTrackerWidget.tsx.
//
// The web module is the dashboard "Maintenance" widget. It reads the
// maintenance schedule (GET /api/v1/maintenance via useMaintenance) and the
// service history (GET /api/v1/maintenance/records via useServiceRecords) and
// renders one of two layouts driven by the grid `size.cols`:
//   • Compact (cols <= 1): a centered column with an amber wrench glyph, the
//     soonest item's interval-months as a big number, a "months" caption and the
//     item name — or an EmptyState when there is no maintenance data. The shell
//     gets the maintenance query's freshness (not the combined one) and no title.
//   • Standard (cols >= 2): a split view — a "Next Service" card (the soonest
//     item, an urgency Badge, the name, an "Every N mo" + interval-distance +
//     optional estimated cost row) on top, and a "Recent Service" Timeline of the
//     three most recent service records (newest first) below, or a "No service
//     records yet" line. When neither items nor records exist the whole body is
//     an EmptyState. The title ("Maintenance") + amber wrench icon are shown by
//     the shell.
//
// Urgency is a pure heuristic on interval-months remaining (getUrgency:
// <=0 overdue, <=3 soon, else good) mapped to a Badge variant
// (urgencyBadgeVariant: overdue->danger, soon->warning, else success) and a
// translated label (urgencyLabel). Items are sorted soonest-first by
// intervalMonths; records are sorted date-desc and capped at three, then mapped
// to Timeline rows (the item name resolved from the maintenance list by itemId).
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • lucide-react Wrench/CheckCircle2/Clock -> the app SemanticIcon glyphs
//     (maintenance/success/clock) rendered as a colour-tinted AppText (GlyphIcon).
//     The web lucide icons inherit their parent text colour, so each glyph is
//     tinted to match: the wrench amber (text-amber-400 -> colors.warning), the
//     empty-slot wrench the muted token, the row clock the secondary token, and
//     the timeline check the row colour (#10b981, preserved verbatim).
//   • @/components/ui Badge (variant + size="sm" + dot) -> a local native pill
//     (danger/warning/success) backed by the theme surface/foreground tokens,
//     preserving the urgencyBadgeVariant mapping and the leading dot.
//   • @/components/data-display Timeline -> a local native Timeline porting the
//     web data-display Timeline: a colour-bordered round dot holding the row
//     icon, a connector line between rows, and a title / time / subtitle body.
//   • @/components/feedback EmptyState -> the already-ported native parity
//     EmptyState (icon + message + native `style` in place of `className`).
//   • ./WidgetShell WidgetShell -> a local native WidgetShell covering exactly
//     the props this call site uses (title/icon/loading/updatedAt/isFetching/
//     isStale/isError/onRefresh/children): a Skeleton while loading, a header row
//     (icon + uppercase title + freshness/refresh chip) and the body.
//   • ./types WidgetProps/WidgetSize/WidgetConfig -> ported verbatim as local
//     types (the shared registry types module is not yet in the parity tree).
//   • react-i18next useTranslation('dashboard') -> a local English-fallback
//     useTranslation(ns?) whose t(key, fallback?) returns the fallback (or key),
//     preserving every translation key verbatim.
//   • @/hooks/useUnits (unitPrefs.distance + convertDistanceFromSI) -> a local
//     useUnits() deriving the distance pref from the native useSettings() query
//     exactly like the web hook (unit_of_length === 'mi' ? 'mi' : 'km') plus the
//     inlined @/lib/unitConversion convertDistanceFromSI (SI metres -> km/mi/ft,
//     factors verbatim). The widget's odometer/interval km*0.621371 pre-scaling
//     is preserved exactly (faithful behaviour, quirk and all).
//   • @/hooks/useFormatting (formatCurrency) + @/lib/numberFormat fmtNumber/fmtInt
//     -> derived from the native useSettings() query like the web hooks:
//     formatCurrency = `${symbol}${fmtNumber(amount, decimals ?? precision)}`,
//     fmtNumber locale-aware fixed-decimal, fmtInt === fmtNumber(v, 0). The web
//     fmt* read a module-global locale/precision; here the locale is threaded
//     from settings (ChargePlansWidget precedent).
//   • @/hooks/useDateFormat (formatDate) -> inlined from @/lib/dateFormat's
//     option object ({year:'numeric',month:'short',day:'numeric'}, "—" for
//     missing/invalid) with the locale threaded from settings; RN ships no ported
//     useTimezone so the device zone is used (SoftwareUpdateHistoryWidget
//     precedent).
//   • DOM <div>/<span>/<p> + Tailwind classes -> React Native View/AppText with
//     StyleSheet tokens. The DataFreshness header indicator is computed once at
//     render (no interval) to avoid a dangling timer under --detectOpenHandles.
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {
  useMaintenance,
  useServiceRecords,
} from '../../../api/hooks/useVehicleSystems';
import {useSettings} from '../../../api/hooks/useSettings';

const DEFAULT_LOCALE = 'en-US';

// Timeline row colour for service records. Preserved verbatim from the web
// source (#10b981, emerald-500).
const TIMELINE_COLOR = '#10b981';

// km -> mi factor used by the web widget to pre-scale odometer/interval km
// before the (SI-typed) convertDistanceFromSI call. Preserved verbatim.
const KM_TO_MI = 0.621371;

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

/* ─── inlined @/lib/unitConversion convertDistanceFromSI ─────────────────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';

/** 1 mile = 1609.344 m exactly (international yard, NIST). */
const METERS_PER_MILE = 1609.344;
/** 1 km = 1000 m exactly. */
const METERS_PER_KM = 1000;
/** 1 ft = 0.3048 m exactly (international foot, NIST). */
const METERS_PER_FOOT = 0.3048;

// web @/lib/unitConversion convertDistanceFromSI: pure SI metres -> display unit.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

/* ─── inlined @/lib/dateFormat formatDate ────────────────────────────────── */

type DateInput = string | Date | null | undefined;

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

// web @/hooks/useUnits deriveDistance: unit_of_length === 'mi' ? 'mi' : 'km'.
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

// web @/lib/dateFormat formatDate: "Apr 4, 2026" (locale-driven); "—" for
// missing/invalid. The web useDateFormat also binds an IANA timezone; RN ships
// no ported useTimezone, so the device zone is used while the locale is threaded
// from settings.
function libFormatDate(value: DateInput, locale: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ─── settings-derived @/hooks (useUnits/useFormatting/useDateFormat) ─────── */

interface UnitsBridge {
  distanceUnit: DistanceUnitPref;
  toDistanceDisplay: (value: number) => number;
}

// Native bridge mirroring the web useUnits() subset this widget uses
// (unitPrefs.distance + a convertDistanceFromSI closure), derived from the
// native useSettings() query.
function useUnits(): UnitsBridge {
  const {data: settings} = useSettings();
  const distanceUnit = deriveDistance(settings?.unit_of_length);
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, distanceUnit),
    [distanceUnit],
  );
  return {distanceUnit, toDistanceDisplay};
}

interface FormattingBridge {
  locale: string;
  formatCurrency: (amount: number, decimals?: number) => string;
}

// Native bridge mirroring the web useFormatting() subset this widget uses
// (currencySymbol + formatCurrency), derived from the native useSettings() query.
function useFormatting(): FormattingBridge {
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

interface DateFormatBridge {
  formatDate: (value: DateInput) => string;
}

// Native bridge mirroring the web useDateFormat().formatDate, with the locale
// threaded from useSettings().
function useDateFormat(): DateFormatBridge {
  const {data: settings} = useSettings();
  const locale = deriveLocale(settings?.locale);
  const formatDate = useCallback(
    (value: DateInput) => libFormatDate(value, locale),
    [locale],
  );
  return {formatDate};
}

/* ─── urgency heuristic (web getUrgency/urgencyBadgeVariant/urgencyLabel) ── */

type Urgency = 'overdue' | 'soon' | 'good';
type BadgeVariant = 'danger' | 'warning' | 'success';

/** Determine urgency based on interval months remaining (heuristic). */
function getUrgency(intervalMonths: number): Urgency {
  if (intervalMonths <= 0) return 'overdue';
  if (intervalMonths <= 3) return 'soon';
  return 'good';
}

function urgencyBadgeVariant(urgency: string): BadgeVariant {
  if (urgency === 'overdue') return 'danger';
  if (urgency === 'soon') return 'warning';
  return 'success';
}

function urgencyLabel(urgency: string, t: TFunc): string {
  if (urgency === 'overdue') return t('widget.maintenance.overdue', 'Overdue');
  if (urgency === 'soon') return t('widget.maintenance.soon', 'Soon');
  return t('widget.maintenance.good', 'Good');
}

/* ─── tinted glyph icon (web lucide-react icons) ─────────────────────────── */

function GlyphIcon({
  name,
  color,
  size,
}: {
  name: SemanticIconName;
  color: string;
  size: number;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {color, fontSize: size, lineHeight: size + 2}]}>
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

/* ─── @/components/ui Badge (variant + size="sm" + dot subset) ────────────── */

// web Badge variants danger/warning/success (dark-mode bg/text pairs). The
// native theme maps each to its surface/foreground token. The `dot` is rendered
// in the foreground colour (web `bg-current`).
const BADGE_PALETTE: Record<BadgeVariant, {bg: string; fg: string}> = {
  danger: {bg: colors.dangerSurface, fg: colors.danger},
  warning: {bg: colors.warningSurface, fg: colors.warning},
  success: {bg: colors.successSurface, fg: colors.success},
};

function Badge({
  variant,
  dot,
  children,
}: {
  variant: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
}) {
  const palette = BADGE_PALETTE[variant];
  return (
    <View style={[styles.badge, {backgroundColor: palette.bg}]}>
      {dot ? (
        <View style={[styles.badgeDot, {backgroundColor: palette.fg}]} />
      ) : null}
      <AppText numberOfLines={1} style={[styles.badgeText, {color: palette.fg}]}>
        {children}
      </AppText>
    </View>
  );
}

/* ─── DataFreshness chip (web @/components/data-display) ──────────────────── */

// Computed once at render (no interval) to avoid a dangling timer under
// --detectOpenHandles.
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
  // Compact (dot-only) when the widget has no title (the compact 1-col layout).
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

/* ─── @/components/data-display Timeline (ported) ─────────────────────────── */

interface TimelineRow {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  time: string;
  color: string;
}

// web data-display Timeline: a colour-bordered round dot holding the row icon, a
// connector line between rows, and a title / time / subtitle body.
function Timeline({items}: {items: TimelineRow[]}) {
  return (
    <View style={styles.timeline} testID="timeline">
      {items.map((item, i) => (
        <View key={i} style={styles.timelineRow} testID="timeline-item">
          <View style={styles.timelineDotCol}>
            <View style={[styles.timelineDot, {borderColor: item.color}]}>
              {item.icon}
            </View>
            {i < items.length - 1 ? (
              <View style={styles.timelineConnector} />
            ) : null}
          </View>
          <View style={styles.timelineBody}>
            <View style={styles.timelineTitleRow}>
              <AppText style={styles.timelineTitle}>{item.title}</AppText>
              <AppText
                style={styles.timelineTime}
                tone="muted"
                variant="caption">
                {item.time}
              </AppText>
            </View>
            {item.subtitle ? (
              <AppText
                style={styles.timelineSubtitle}
                tone="muted"
                variant="caption">
                {item.subtitle}
              </AppText>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ─── Main widget ────────────────────────────────────────────────────────── */

export default function MaintenanceTrackerWidget({size}: WidgetProps) {
  const {t} = useTranslation('dashboard');
  const {distanceUnit, toDistanceDisplay} = useUnits();
  const {locale, formatCurrency} = useFormatting();
  const {formatDate} = useDateFormat();

  const {
    data: maintenanceItems,
    isLoading: maintLoading,
    isFetching: maintFetching,
    isStale: maintStale,
    isError: maintIsError,
    dataUpdatedAt: maintUpdatedAt,
    refetch: maintRefetch,
  } = useMaintenance();

  const {
    data: serviceRecords,
    isLoading: recordsLoading,
    isFetching: recordsFetching,
    dataUpdatedAt: recordsUpdatedAt,
  } = useServiceRecords();

  const isLoading = maintLoading || recordsLoading;
  const isCompact = size.cols <= 1;
  const items = useMemo(() => maintenanceItems ?? [], [maintenanceItems]);
  const records = useMemo(() => serviceRecords ?? [], [serviceRecords]);

  // Sort maintenance items by interval (soonest first)
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => (a.intervalMonths ?? 0) - (b.intervalMonths ?? 0)),
    [items],
  );

  const nextItem = sortedItems[0] ?? null;
  const nextUrgency = nextItem ? getUrgency(nextItem.intervalMonths ?? 0) : null;

  // Sort service records by date desc, take last 3
  const recentRecords = useMemo(
    () =>
      [...records]
        .sort((a, b) => new Date(b.date ?? '').getTime() - new Date(a.date ?? '').getTime())
        .slice(0, 3),
    [records],
  );

  // Map service records to timeline items
  const timelineItems = useMemo<TimelineRow[]>(() => {
    // Look up maintenance item name by itemId
    const itemMap = new Map(items.map(m => [m.id, m]));
    return recentRecords.map(rec => {
      const mi = itemMap.get(rec.itemId);
      const odometerDisplay = fmtNumber(
        toDistanceDisplay((rec.odometerKm ?? 0) * KM_TO_MI),
        0,
        locale,
      );
      return {
        icon: <GlyphIcon color={TIMELINE_COLOR} name="success" size={11} />,
        title: mi?.name ?? rec.itemId ?? '—',
        subtitle: rec.notes
          ? `${odometerDisplay} ${distanceUnit} · ${rec.notes}`
          : `${odometerDisplay} ${distanceUnit}`,
        time: rec.date ? formatDate(rec.date) : '—',
        color: TIMELINE_COLOR,
      };
    });
  }, [recentRecords, items, toDistanceDisplay, distanceUnit, formatDate, locale]);

  const updatedAt = Math.max(maintUpdatedAt ?? 0, recordsUpdatedAt ?? 0);
  const hasData = items.length > 0 || records.length > 0;

  const shellProps = {
    loading: isLoading,
    updatedAt,
    isFetching: maintFetching || recordsFetching,
    isStale: maintStale,
    isError: maintIsError,
    onRefresh: () => maintRefetch(),
  };

  // ── Compact layout (1×2): months until next + item name ──
  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        isError={maintIsError}
        isFetching={maintFetching}
        isStale={maintStale}
        onRefresh={() => maintRefetch()}
        updatedAt={maintUpdatedAt}>
        <View style={styles.compact}>
          {nextItem ? (
            <>
              <GlyphIcon color={colors.warning} name="maintenance" size={16} />
              <AppText style={styles.compactValue}>
                {fmtInt(nextItem.intervalMonths ?? 0, locale)}
              </AppText>
              <AppText style={styles.compactUnit} tone="muted" variant="caption">
                {t('widget.maintenance.monthsLeft', 'months')}
              </AppText>
              <AppText
                numberOfLines={1}
                style={styles.compactName}
                tone="secondary"
                variant="caption">
                {nextItem.name ?? '—'}
              </AppText>
            </>
          ) : (
            <EmptyState
              icon={
                <GlyphIcon color={colors.textMuted} name="maintenance" size={18} />
              }
              message={t('widget.maintenance.noData', 'No maintenance data')}
              style={styles.compactEmpty}
              testID="maintenance-empty"
            />
          )}
        </View>
      </WidgetShell>
    );
  }

  // ── Standard layout (2×4): split view ──
  return (
    <WidgetShell
      {...shellProps}
      icon={<GlyphIcon color={colors.warning} name="maintenance" size={13} />}
      title={t('widget.maintenance.title', 'Maintenance')}>
      {hasData ? (
        <View style={styles.standard}>
          {/* Top: Next upcoming maintenance */}
          {nextItem && nextUrgency ? (
            <View style={styles.nextCard}>
              <View style={styles.nextHeaderRow}>
                <AppText
                  style={styles.sectionLabel}
                  tone="muted"
                  variant="caption">
                  {t('widget.maintenance.nextService', 'Next Service')}
                </AppText>
                <Badge dot variant={urgencyBadgeVariant(nextUrgency)}>
                  {urgencyLabel(nextUrgency, t)}
                </Badge>
              </View>
              <AppText
                numberOfLines={1}
                style={styles.nextName}
                weight="semibold">
                {nextItem.name ?? '—'}
              </AppText>
              <View style={styles.nextDetailRow}>
                <View style={styles.nextEvery}>
                  <GlyphIcon
                    color={colors.textSecondary}
                    name="clock"
                    size={11}
                  />
                  <AppText style={styles.nextDetailText} tone="secondary">
                    {`${t('widget.maintenance.every', 'Every')} ${fmtInt(
                      nextItem.intervalMonths ?? 0,
                      locale,
                    )} ${t('widget.maintenance.months', 'mo')}`}
                  </AppText>
                </View>
                <AppText style={styles.nextDetailText} tone="secondary">
                  {`${fmtNumber(
                    toDistanceDisplay((nextItem.intervalKm ?? 0) * KM_TO_MI),
                    0,
                    locale,
                  )} ${distanceUnit}`}
                </AppText>
                {nextItem.estimatedCostUsd != null &&
                nextItem.estimatedCostUsd > 0 ? (
                  <AppText style={styles.nextDetailText} tone="secondary">
                    {formatCurrency(nextItem.estimatedCostUsd)}
                  </AppText>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* Bottom: Recent service records */}
          {recentRecords.length > 0 ? (
            <View style={styles.recentWrap}>
              <AppText
                style={styles.recentLabel}
                tone="muted"
                variant="caption">
                {t('widget.maintenance.recentService', 'Recent Service')}
              </AppText>
              <ScrollView contentContainerStyle={styles.recentList}>
                <Timeline items={timelineItems} />
              </ScrollView>
            </View>
          ) : (
            <View style={styles.recentEmpty}>
              <AppText style={styles.recentEmptyText} tone="muted" variant="caption">
                {t('widget.maintenance.noRecords', 'No service records yet')}
              </AppText>
            </View>
          )}
        </View>
      ) : (
        <EmptyState
          icon={
            <GlyphIcon color={colors.textMuted} name="maintenance" size={18} />
          }
          message={t('widget.maintenance.noData', 'No maintenance data')}
          style={styles.standardEmpty}
          testID="maintenance-empty"
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
  // Badge (web Badge size="sm" + dot)
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 9999,
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
  // Compact layout (web h-full flex-col items-center justify-center gap-1.5)
  compact: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 28,
  },
  compactUnit: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  compactName: {
    fontSize: 12,
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
  },
  compactEmpty: {
    paddingVertical: spacing.sm,
  },
  // Standard layout (web h-full flex-col gap-3)
  standard: {
    flex: 1,
    gap: spacing.md,
  },
  standardEmpty: {
    paddingVertical: spacing.lg,
  },
  // Next service card (web rounded-lg bg-white/[0.03] p-3 border border-white/[0.06])
  nextCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  nextHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionLabel: {
    flexShrink: 1,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  nextName: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  nextDetailRow: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  nextEvery: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    minHeight: 44,
  },
  nextDetailText: {
    fontSize: 12,
  },
  // Recent service (web flex-1 min-h-0)
  recentWrap: {
    flex: 1,
    minHeight: 0,
  },
  recentLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  recentList: {
    paddingVertical: 2,
  },
  recentEmpty: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  recentEmptyText: {
    fontSize: 12,
  },
  // Timeline (web data-display Timeline)
  timeline: {
    gap: spacing.md,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  timelineDotCol: {
    alignItems: 'center',
  },
  timelineDot: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  timelineConnector: {
    backgroundColor: colors.border,
    flex: 1,
    marginTop: spacing.xs,
    width: 1,
  },
  timelineBody: {
    flex: 1,
    paddingBottom: spacing.xs,
  },
  timelineTitleRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  timelineTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  timelineTime: {
    fontSize: 12,
  },
  timelineSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
});
