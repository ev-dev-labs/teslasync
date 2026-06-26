// Native parity port of web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx.
//
// The web widget is a responsive dashboard tile that summarises a vehicle's
// lifetime stats. It renders inside the shared <WidgetShell> and switches
// between a Compact view (cols <= 1: one big animated lifetime-distance number)
// and a Standard/Wide view (a <WidgetStatGrid> of 4 core stats, plus 3 extra
// stats when cols >= 3). Data comes from useLifetimeStats()/useVehicles();
// distance is read in km from the API, converted km -> mi -> the user's display
// unit, and money via useFormatting().formatCurrency.
//
// None of the web visual deps are native-safe, so — mirroring the sibling native
// ports (CostBreakdownWidget, BatteryRadialGaugeWidget, AutomationStatusWidget)
// — each piece is rebuilt with React Native primitives, AppText, the repo
// SemanticIcon glyphs and the design tokens. The shared deps with no native port
// (AnimatedNumber, EmptyState, WidgetShell, ./shared WidgetStatGrid+StatGridItem,
// ./types WidgetProps, @/hooks/useUnits, @/hooks/useFormatting, @/lib/numberFormat
// fmtNumber/fmtInt, @/lib/constants UNITS, @/lib/unitConversion convertDistanceFromSI,
// react-i18next, lucide-react) are inlined as self-contained native-safe parity
// in this file.
//
// Line-by-line coverage of the source:
//   L1     `import { useMemo }` -> useMemo (plus useCallback/useEffect/useRef/
//          useState for the inlined WidgetShell + i18n fallback + useNativeFormat).
//   L2     useTranslation('dashboard') -> useNativeTranslationFallback (namespace
//          kept as I18N_NAMESPACE; every i18n key preserved, English fallbacks
//          returned verbatim).
//   L3     lucide Trophy/Route/Zap/Car/Leaf/DollarSign/CalendarDays -> repo
//          SemanticIcon glyphs (trophy/navigation/bolt/vehicle/leaf/dollarSign/
//          calendar).
//   L4     @/components/data-display AnimatedNumber -> inlined native AnimatedNumber
//          (the count-up has no native runtime, so the final formatted value
//          renders directly — same end-state as the web ease-out animation).
//   L5     @/components/feedback EmptyState -> inlined native EmptyState.
//   L6     useLifetimeStats (api/hooks/useAnalytics) -> native api hook (same name).
//   L7     useVehicles -> native api hook (same name).
//   L8     useFormatting -> folded into useNativeFormat (formatCurrency).
//   L9     useUnits -> folded into useNativeFormat (unitPrefs.distance).
//   L10    fmtNumber/fmtInt (@/lib/numberFormat) -> inlined value-identical natives
//          (safeNumber coerces non-finite -> 0; locale-grouped formatting).
//   L11    UNITS (@/lib/constants) -> inlined KM_TO_MI (+ METERS_PER_KM /
//          METERS_PER_MILE / METERS_PER_FOOT for convertDistanceFromSI).
//   L12    ./WidgetShell -> inlined native WidgetShell (freshness pill + pulse).
//   L13    ./shared WidgetStatGrid + StatGridItem -> inlined native parity.
//   L14    ./types WidgetProps -> inlined WidgetSize/WidgetConfig/WidgetProps mirror.
//   L15    convertDistanceFromSI (@/lib/unitConversion) -> inlined value-identical
//          native (meters/1000 km, meters/1609.344 mi, meters/0.3048 ft).
//   L17    default export ({vehicleId,size}: WidgetProps) -> ported.
//   L18    t = useTranslation('dashboard') -> useNativeTranslationFallback.
//   L19-20 useVehicles() + id = vehicleId ?? vehicles?.[0]?.id ?? 0 -> ported.
//   L22-23 useLifetimeStats(id > 0 ? String(id) : undefined) destructured
//          identically (data/isLoading/error/isFetching/isStale/isError/
//          dataUpdatedAt/refetch) -> ported verbatim.
//   L25-26 useUnits().unitPrefs -> useNativeFormat distance; toDistanceDisplay(value)
//          = convertDistanceFromSI(value, unitPrefs.distance) -> ported (useCallback
//          over the distance pref).
//   L28    distanceUnit = unitPrefs.distance -> ported.
//   L29    useFormatting().formatCurrency -> useNativeFormat formatCurrency.
//   L31-32 isCompact = size.cols <= 1; isWide = size.cols >= 3 -> ported.
//   L34-36 distanceMi = (total_distance_km ?? 0) * KM_TO_MI; displayDistance =
//          toDistanceDisplay(distanceMi) -> ported verbatim (the km -> mi ->
//          convertDistanceFromSI display chain preserved exactly, quirk included).
//   L38-65 coreStats useMemo: 4 items (Total Distance / Total Drives / Total Energy
//          / CO₂ Saved) with the same i18n keys, fmtNumber/fmtInt, units (km|mi /
//          kWh / kg) and glyph icons -> ported verbatim.
//   L67-93 wideStats useMemo: avgDailyMi = ownership_days > 0 ? distanceMi /
//          ownership_days : 0; avgDailyDisplay; 3 items (Total Cost via
//          formatCurrency / Ownership Days / Avg Daily Distance) -> ported verbatim.
//   L95-98 allStats useMemo: isWide ? [...coreStats, ...wideStats] : coreStats.
//   L100-131 compact branch: WidgetShell(freshness props, no title) -> data ? big
//          AnimatedNumber(displayDistance) + "{unit} lifetime" caption :
//          EmptyState(trophy, noData) -> ported.
//   L133-156 standard/wide branch: WidgetShell(title 'Lifetime Stats', amber trophy
//          icon, freshness) -> data ? WidgetStatGrid(allStats, cols=isWide?4:2) :
//          EmptyState(trophy, noData) -> ported.
//   L157   closing brace -> ported.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/SVG, no Leaflet, no
// framer-motion and no web UI components are imported — only RN primitives plus
// existing apps/native components (AppText, SemanticIcon), tokens and native hooks.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {useLifetimeStats} from '../../../api/hooks/useAnalytics';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. The 2-arg `(k, f) => string`
// signature matches the source's local `t` usage exactly.
const I18N_NAMESPACE = 'dashboard';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ------------------------------------------------------------------ */
/*  ./types + ./shared mirrors (no native port yet)                    */
/* ------------------------------------------------------------------ */

interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

// Mirrored field-for-field from web ./shared WidgetStatGrid. `icon` is a repo
// SemanticIcon glyph string instead of the web lucide ReactNode.
interface StatGridItem {
  label: string;
  value: string | number;
  unit?: string;
  icon?: string;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  valueColor?: string;
}

/* ------------------------------------------------------------------ */
/*  Unit + number constants (@/lib/constants UNITS, @/lib/unitConversion) */
/* ------------------------------------------------------------------ */

// web UNITS.KM_TO_MI (constants.ts).
const KM_TO_MI = 0.621371;
// web unitConversion SI denominators.
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

type DistanceUnitPref = 'km' | 'mi' | 'ft';

// Parity for @/lib/unitConversion `convertDistanceFromSI(meters, to)`: divides SI
// meters by the unit denominator. The widget feeds it a km->mi value (see
// distanceMi below) exactly as the web source does, so the displayed number
// matches the web widget bit-for-bit.
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

/* ------------------------------------------------------------------ */
/*  Parity for @/lib/numberFormat fmtNumber / fmtInt                    */
/* ------------------------------------------------------------------ */

// web safeNumber: non-finite / non-number -> 0.
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web fmtNumber(v, decimals, locale): locale-grouped fixed-precision string,
// falling back to en-US when the locale tag is rejected by Intl.
function fmtNumber(value: unknown, decimals = 0, locale = 'en-US'): string {
  try {
    return safeNumber(value).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

// web fmtInt(v): fmtNumber(v, 0).
function fmtInt(value: unknown, locale = 'en-US'): string {
  return fmtNumber(value, 0, locale);
}

/* ------------------------------------------------------------------ */
/*  useUnits().unitPrefs + useFormatting() -> useNativeFormat           */
/* ------------------------------------------------------------------ */

interface NativeFormat {
  distance: DistanceUnitPref;
  locale: string;
  currencySymbol: string;
  formatCurrency: (amount: number, decimals?: number) => string;
}

// Mirror of `useUnits().unitPrefs.distance` + `useFormatting()` resolved directly
// from the ported `useSettings()` query: distance 'mi' only when the user prefers
// miles (else 'km'), '$' currency symbol and 'en-US' locale when unset, decimal
// precision defaulting to 2. formatCurrency matches the web
// `${symbol}${fmtNumber(amount, decimals ?? precision)}`.
function useNativeFormat(): NativeFormat {
  const {data: settings} = useSettings();
  return useMemo<NativeFormat>(() => {
    const unitOfLength = settings?.unit_of_length;
    const distance: DistanceUnitPref = unitOfLength === 'mi' ? 'mi' : 'km';
    const locale =
      typeof settings?.locale === 'string' && settings.locale.trim().length > 0
        ? settings.locale
        : 'en-US';
    const currencySymbol =
      settings?.currency_symbol && settings.currency_symbol.trim()
        ? settings.currency_symbol
        : '$';
    const precision =
      typeof settings?.decimal_precision === 'number' &&
      Number.isFinite(settings.decimal_precision) &&
      settings.decimal_precision >= 0
        ? Math.floor(settings.decimal_precision)
        : 2;
    return {
      distance,
      locale,
      currencySymbol,
      formatCurrency: (amount, decimals) =>
        `${currencySymbol}${fmtNumber(amount, decimals ?? precision, locale)}`,
    };
  }, [settings]);
}

/* ------------------------------------------------------------------ */
/*  lucide icons -> repo SemanticIcon glyphs                           */
/* ------------------------------------------------------------------ */

const TROPHY_GLYPH = getSemanticIconDefinition('trophy').glyph;
const ROUTE_GLYPH = getSemanticIconDefinition('navigation').glyph;
const ZAP_GLYPH = getSemanticIconDefinition('bolt').glyph;
const CAR_GLYPH = getSemanticIconDefinition('vehicle').glyph;
const LEAF_GLYPH = getSemanticIconDefinition('leaf').glyph;
const DOLLAR_GLYPH = getSemanticIconDefinition('dollarSign').glyph;
const CALENDAR_GLYPH = getSemanticIconDefinition('calendar').glyph;

/* ------------------------------------------------------------------ */
/*  Inlined @/components/data-display AnimatedNumber                    */
/* ------------------------------------------------------------------ */

// web AnimatedNumber count-up from 0 -> value over ~1s, displaying
// fmtNumber(display, decimals). The native count-up has no runtime, so the final
// formatted value renders directly (identical end state).
function AnimatedNumber({
  value,
  decimals = 0,
  prefix,
  suffix,
  locale,
  style,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  locale: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText style={style}>
      {`${prefix ?? ''}${fmtNumber(value, decimals, locale)}${suffix ?? ''}`}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback EmptyState                            */
/* ------------------------------------------------------------------ */

// web EmptyState(icon Trophy, message, className="py-4"): a centred icon glyph
// above a muted message line.
function EmptyState({glyph, message}: {glyph?: string; message: string}) {
  return (
    <View style={styles.emptyState}>
      {glyph ? (
        <AppText style={styles.emptyGlyph} tone="muted" weight="bold">
          {glyph}
        </AppText>
      ) : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/data-display StatCard                          */
/* ------------------------------------------------------------------ */

// web StatCard: muted label + optional icon header, a large bold value with an
// optional muted unit suffix.
function StatCard({
  label,
  value,
  unit,
  glyph,
}: {
  label: string;
  value: string | number;
  unit?: string;
  glyph?: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statCardHeader}>
        <AppText
          numberOfLines={1}
          style={styles.statCardLabel}
          tone="muted"
          variant="caption">
          {label}
        </AppText>
        {glyph ? (
          <AppText style={styles.statCardGlyph} tone="muted" weight="bold">
            {glyph}
          </AppText>
        ) : null}
      </View>
      <View style={styles.statCardValueRow}>
        <AppText numberOfLines={1} style={styles.statCardValue} weight="bold">
          {value}
        </AppText>
        {unit ? (
          <AppText style={styles.statCardUnit} tone="muted" variant="caption">
            {unit}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./shared WidgetStatGrid                                    */
/* ------------------------------------------------------------------ */

// web autoCols: 3 when divisible by 3, 4 when divisible by 4, else 2.
function autoCols(count: number): 2 | 3 | 4 {
  if (count % 3 === 0) return 3;
  if (count % 4 === 0) return 4;
  return 2;
}

// web container-query column class -> native flex-basis. Each card grows to fill
// its row, so an N-up grid wraps to 2-up on narrow tiles just like the web
// @container breakpoints.
function colBasis(cols: 1 | 2 | 3 | 4): DimensionValue {
  switch (cols) {
    case 1:
      return '100%';
    case 2:
      return '47%';
    case 3:
      return '31%';
    case 4:
      return '22%';
  }
}

function WidgetStatGrid({
  stats,
  compact,
  cols,
}: {
  stats: StatGridItem[];
  compact?: boolean;
  cols?: 2 | 3 | 4;
}) {
  if (stats.length === 0) {
    return <EmptyState message="No stats available" />;
  }

  const resolvedCols: 1 | 2 | 3 | 4 = compact
    ? 1
    : cols ?? autoCols(stats.length);
  const basis = colBasis(resolvedCols);

  return (
    <View style={[styles.statGrid, compact && styles.statGridCompact]}>
      {stats.map(stat => (
        <View key={stat.label} style={[styles.statGridCell, {flexBasis: basis}]}>
          <StatCard
            glyph={stat.icon}
            label={stat.label}
            unit={stat.unit}
            value={stat.value}
          />
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

// Freshness caption helper for the inlined WidgetShell (web <DataFreshness>
// renders a relative "updated" time when not compact).
function formatFreshness(updatedAt: number, t: NativeTFunction): string {
  const diff = Date.now() - updatedAt;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('widget.justNow', 'Just now');
  if (minutes < 60) return `${minutes}m ${t('widget.ago', 'ago')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${t('widget.ago', 'ago')}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${t('widget.ago', 'ago')}`;
}

// Native parity for the freshness pill the web WidgetShell renders in its header
// (web <DataFreshness>): a pressable refresh affordance with a status dot
// (error -> danger, fetching -> accent, stale -> warning, fresh -> success) and,
// when not compact, a short relative "updated" caption.
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact: boolean;
}) {
  const t = useNativeTranslationFallback();
  const dotStyle = isError
    ? freshnessDotStyles.error
    : isFetching
      ? freshnessDotStyles.fetching
      : isStale
        ? freshnessDotStyles.stale
        : freshnessDotStyles.fresh;

  return (
    <Pressable
      accessibilityLabel={t('widget.refresh', 'Refresh')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshness}>
      <View style={[styles.freshnessDot, dotStyle]} />
      {!compact && updatedAt ? (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {formatFreshness(updatedAt, t)}
        </AppText>
      ) : null}
    </Pressable>
  );
}

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
  // Pulse-on-data-change effect (web `justUpdated`): ported verbatim; the
  // transient flag drives a subtle border highlight in place of the web box
  // shadow.
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
      <View style={styles.shellState}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.shellState}>
        <AppText tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
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
        <View style={styles.shellHeader}>
          <View style={styles.shellHeaderLeft}>
            {icon}
            <AppText style={styles.shellTitle} variant="caption" weight="semibold">
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.shellFreshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Widget                                                             */
/* ------------------------------------------------------------------ */

export default function LifetimeStatsWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useLifetimeStats(id > 0 ? String(id) : undefined);

  const {distance, locale, formatCurrency} = useNativeFormat();
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, distance),
    [distance],
  );

  const distanceUnit = distance;

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // API returns km; convert km → mi (internal) → user pref
  const distanceMi = (data?.total_distance_km ?? 0) * KM_TO_MI;
  const displayDistance = toDistanceDisplay(distanceMi);

  const coreStats = useMemo<StatGridItem[]>(() => {
    if (!data) return [];
    return [
      {
        label: t('widget.lifetimeStats.totalDistance', 'Total Distance'),
        value: fmtNumber(displayDistance, 0, locale),
        unit: distanceUnit,
        icon: ROUTE_GLYPH,
      },
      {
        label: t('widget.lifetimeStats.totalDrives', 'Total Drives'),
        value: fmtInt(data.total_drives ?? 0, locale),
        icon: CAR_GLYPH,
      },
      {
        label: t('widget.lifetimeStats.totalEnergy', 'Total Energy'),
        value: fmtNumber(data.total_energy_kwh ?? 0, 1, locale),
        unit: 'kWh',
        icon: ZAP_GLYPH,
      },
      {
        label: t('widget.lifetimeStats.co2Saved', 'CO₂ Saved'),
        value: fmtNumber(data.co2_offset_kg ?? 0, 0, locale),
        unit: 'kg',
        icon: LEAF_GLYPH,
      },
    ];
  }, [data, displayDistance, distanceUnit, locale, t]);

  const wideStats = useMemo<StatGridItem[]>(() => {
    if (!data) return [];

    const avgDailyMi =
      data.ownership_days > 0 ? distanceMi / data.ownership_days : 0;
    const avgDailyDisplay = toDistanceDisplay(avgDailyMi);

    return [
      {
        label: t('widget.lifetimeStats.totalCost', 'Total Cost'),
        value: formatCurrency(data.total_charging_cost ?? 0),
        icon: DOLLAR_GLYPH,
      },
      {
        label: t('widget.lifetimeStats.ownershipDays', 'Ownership Days'),
        value: fmtInt(data.ownership_days ?? 0, locale),
        icon: CALENDAR_GLYPH,
      },
      {
        label: t('widget.lifetimeStats.avgDailyDistance', 'Avg Daily Distance'),
        value: fmtNumber(avgDailyDisplay, 1, locale),
        unit: distanceUnit,
        icon: ROUTE_GLYPH,
      },
    ];
  }, [data, distanceMi, toDistanceDisplay, distanceUnit, locale, formatCurrency, t]);

  const allStats = useMemo(
    () => (isWide ? [...coreStats, ...wideStats] : coreStats),
    [isWide, coreStats, wideStats],
  );

  // Compact: single big number
  if (isCompact) {
    return (
      <WidgetShell
        error={error ? String(error) : null}
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        loading={isLoading}
        onRefresh={() => refetch()}
        updatedAt={dataUpdatedAt}>
        {data ? (
          <View style={styles.compact}>
            <AnimatedNumber
              locale={locale}
              style={styles.compactValue}
              value={displayDistance}
            />
            <AppText style={styles.compactUnit} tone="muted">
              {`${distanceUnit} ${t('widget.lifetimeStats.lifetime', 'lifetime')}`}
            </AppText>
          </View>
        ) : (
          <EmptyState
            glyph={TROPHY_GLYPH}
            message={t('widget.lifetimeStats.noData', 'No lifetime data')}
          />
        )}
      </WidgetShell>
    );
  }

  // Standard / Wide
  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={
        <AppText style={styles.headerIcon} weight="bold">
          {TROPHY_GLYPH}
        </AppText>
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.lifetimeStats.title', 'Lifetime Stats')}
      updatedAt={dataUpdatedAt}>
      {data ? (
        <WidgetStatGrid cols={isWide ? 4 : 2} stats={allStats} />
      ) : (
        <EmptyState
          glyph={TROPHY_GLYPH}
          message={t('widget.lifetimeStats.noData', 'No lifetime data')}
        />
      )}
    </WidgetShell>
  );
}

LifetimeStatsWidget.displayName = 'LifetimeStatsWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const LIFETIME_STATS_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- Compact body ---
  compact: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
  },
  compactUnit: {
    fontSize: 10,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
  },

  // --- Header icon (amber trophy) ---
  headerIcon: {
    color: colors.warning,
    fontSize: 12,
    letterSpacing: 0.4,
    lineHeight: 14,
  },

  // --- WidgetStatGrid ---
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statGridCompact: {
    gap: spacing.xs,
  },
  statGridCell: {
    flexGrow: 1,
  },

  // --- StatCard ---
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  statCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCardLabel: {
    flexShrink: 1,
  },
  statCardGlyph: {
    fontSize: 12,
    lineHeight: 14,
    marginLeft: spacing.xs,
  },
  statCardValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statCardValue: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
  },
  statCardUnit: {
    flexShrink: 1,
  },

  // --- EmptyState ---
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  emptyGlyph: {
    fontSize: 20,
    letterSpacing: 0.5,
    lineHeight: 24,
  },
  emptyMessage: {
    textAlign: 'center',
  },

  // --- WidgetShell ---
  shell: {
    flex: 1,
  },
  shellPulse: {
    borderColor: colors.successBorder,
    borderRadius: 12,
    borderWidth: 1,
  },
  shellState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  shellHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
  },
  shellTitle: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  shellFreshnessOverlay: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  shellBody: {
    flex: 1,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  // --- DataFreshness ---
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
});

const freshnessDotStyles = StyleSheet.create({
  error: {
    backgroundColor: colors.danger,
  },
  fetching: {
    backgroundColor: colors.accent,
  },
  stale: {
    backgroundColor: colors.warning,
  },
  fresh: {
    backgroundColor: colors.success,
  },
});
