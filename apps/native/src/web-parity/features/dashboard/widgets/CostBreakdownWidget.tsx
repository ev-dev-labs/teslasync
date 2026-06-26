// Native parity port of web/src/features/dashboard/widgets/CostBreakdownWidget.tsx.
//
// The web widget is a dashboard tile that visualises a vehicle's charging-cost
// breakdown. On 1-col tiles it shows a compact <WidgetBigNumber> (this-month
// cost + "saved vs gas" subtitle + "Saving" badge); on larger tiles it shows a
// Recharts donut of the last 6 months, a <WidgetRankedList> of every month, and
// a 3-up <StatCard> grid (Total Cost / Cost-per-distance / Gas Savings). Data
// comes from useCostBreakdown()/useVehicles(); money is rendered via
// useFormatting().formatCurrency and the distance unit via useUnits().
//
// None of the web visual deps are native-safe, so — mirroring the sibling native
// ports (AutomationStatusWidget, BatteryRadialGaugeWidget, ChargingScheduleWidget)
// — each piece is rebuilt with React Native primitives, AppText, the repo
// SemanticIcon glyphs and the design tokens. Recharts (PieChart/Pie/Cell/Tooltip/
// ResponsiveContainer) has no native renderer and React Native has no SVG here,
// so the donut is reproduced as a proportional segmented bar coloured from the
// same useThemeChartPalette() series, and the hover-only <CostTooltip> is
// surfaced as a static per-segment legend (hover activation is unavailable on
// native — documented in the sidecar). The shared deps with no native port yet
// (WidgetShell, ./shared WidgetRankedList/WidgetBigNumber, ./types,
// @/components/data-display StatCard, @/components/feedback EmptyState,
// @/components/ui Badge, @/hooks/useFormatting, @/hooks/useUnits, react-i18next,
// lucide-react) are inlined as self-contained native-safe parity in this file.
//
// Line-by-line coverage of the source:
//   L1     useMemo -> useMemo (plus useCallback/useEffect/useRef/useState for the
//          inlined WidgetShell + i18n fallback).
//   L2     useTranslation('dashboard') -> useNativeTranslationFallback (namespace
//          retained as I18N_NAMESPACE; every i18n key + fallback preserved, the
//          {{amount}}/{{unit}} interpolation is reproduced).
//   L3     lucide PieChart/DollarSign/TrendingDown/Fuel -> repo SemanticIcon
//          glyphs (pieChart/dollarSign/trendDown/fuel).
//   L4-6   recharts PieChart/Pie/Cell/Tooltip/ResponsiveContainer ->
//          native-safe donut (proportional segmented bar); useThemeChartPalette
//          kept (imported from the native charts barrel, returns palette.series).
//   L7     @/components/data-display StatCard -> inlined native StatCard.
//   L8     @/components/feedback EmptyState -> inlined native EmptyState.
//   L9-10  useCostBreakdown/useVehicles -> native api hooks (same import names).
//   L11    useFormatting -> inlined formatCurrency + currencySymbol.
//   L12    useUnits -> inlined unitPrefs.distance (native 'km' default).
//   L13-15 ./shared WidgetRankedList+RankedItem / WidgetBigNumber + ./WidgetShell
//          -> inlined native parity components.
//   L16    ./types WidgetProps -> inlined WidgetSize/WidgetConfig/WidgetProps.
//   L18    MI_TO_KM = 1.60934 -> ported verbatim.
//   L20-24 DonutSegment interface -> ported verbatim.
//   L26-51 CostTooltip({active,payload,formatCurrency}) -> ported verbatim: null
//          when !active/!payload[0]; reads payload[0].payload; colour dot + name
//          row + formatCurrency(value, 2) line. Rendered statically per donut
//          segment as the legend (hover unavailable on native).
//   L53-56 default export ({vehicleId,size}) + useVehicles + id fallback chain.
//   L58-61 formatCurrency/currencySymbol (useFormatting) + unitPrefs.distance
//          (useUnits) -> inlined; distanceUnit preserved.
//   L63-72 useCostBreakdown(String(id)) destructure (data/isLoading/error/
//          isFetching/isStale/isError/dataUpdatedAt/refetch) -> ported verbatim.
//   L74    isCompact = size.cols <= 1 -> ported.
//   L77    palette = useThemeChartPalette() -> ported.
//   L79    monthlyEntries = data?.monthly_breakdown ?? [] -> ported.
//   L82-86 costPerDist useMemo (cpk = cost_per_km_ev ?? 0; 0 -> 0; mi -> cpk*MI_TO_KM
//          else cpk) -> ported verbatim.
//   L89-92 currentMonthCost useMemo (last entry ev_cost) -> ported.
//   L95-102 donutData useMemo (last 6 -> {name,value,color: palette.series[i%len]})
//          -> ported.
//   L105-113 rankedItems useMemo (all months -> RankedItem with formatCurrency +
//          palette barColor) -> ported.
//   L115-117 hasData / totalSavings / monthlySavings -> ported.
//   L120-160 compact layout: WidgetShell(freshness props) -> hasData ?
//          WidgetBigNumber(currentMonthCost, currencySymbol, monthlyTotal label,
//          savedVsGas subtitle when monthlySavings>0, Saving badge when
//          totalSavings>0, emerald valueColor, animated) : EmptyState(pie,noData).
//   L162-249 standard layout: WidgetShell(title/icon, freshness) -> hasData ?
//          (donut + WidgetRankedList(maxItems 5) + 3 StatCards: Total Cost /
//          Cost-per-distance / Gas Savings) : EmptyState(pie,noData).
//   L250   closing brace -> ported.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/SVG, no Leaflet, no
// framer-motion and no web UI components are imported.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, View} from 'react-native';

import {useThemeChartPalette} from '../../../components/charts';
import {useCostBreakdown} from '../../../api/hooks/useAnalytics';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair while still interpolating the {{amount}}/{{unit}} tokens the
// source passes via the options object, preserving every i18n key + intent.
const I18N_NAMESPACE = 'dashboard';

type NativeTVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: NativeTVars,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: NativeTVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = vars[name];
      return value === undefined ? `{{${name}}}` : String(value);
    });
  }, []);
}

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
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

/* ------------------------------------------------------------------ */
/*  Inlined useFormatting().formatCurrency / currencySymbol            */
/* ------------------------------------------------------------------ */

// Web useFormatting derives currencySymbol/precision from useSettings; with no
// native settings store the faithful defaults are '$' and precision 2 (callers
// pass explicit decimals where they differ), matching the web fallbacks.
const DEFAULT_CURRENCY_SYMBOL = '$';
const DEFAULT_CURRENCY_PRECISION = 2;

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = 2): string {
  try {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return String(safeNumber(value));
  }
}

function formatCurrency(amount: number, decimals?: number): string {
  return `${DEFAULT_CURRENCY_SYMBOL}${fmtNumber(
    amount,
    decimals ?? DEFAULT_CURRENCY_PRECISION,
  )}`;
}

const currencySymbol = DEFAULT_CURRENCY_SYMBOL;

/* ------------------------------------------------------------------ */
/*  Inlined useUnits().unitPrefs.distance                              */
/* ------------------------------------------------------------------ */

// Web useUnits().unitPrefs.distance derives from settings.unit_of_length,
// defaulting to 'km' when it is anything other than 'mi'. Native has no settings
// store wired here, so the distance preference resolves to its 'km' default.
type DistanceUnitPref = 'km' | 'mi' | 'ft';
const DEFAULT_DISTANCE_PREF: DistanceUnitPref = 'km';
// Annotated with the full union (not the narrowed 'km' literal) so the
// `distanceUnit === 'mi'` branch below stays a valid comparison, mirroring the
// web `useUnits().unitPrefs.distance: DistanceUnitPref` type.
const unitPrefs: {distance: DistanceUnitPref} = {distance: DEFAULT_DISTANCE_PREF};

/* ------------------------------------------------------------------ */
/*  lucide icons -> repo SemanticIcon glyphs                           */
/* ------------------------------------------------------------------ */

const PIE_GLYPH = getSemanticIconDefinition('pieChart').glyph;
const DOLLAR_GLYPH = getSemanticIconDefinition('dollarSign').glyph;
const TREND_DOWN_GLYPH = getSemanticIconDefinition('trendDown').glyph;
const FUEL_GLYPH = getSemanticIconDefinition('fuel').glyph;

/* ------------------------------------------------------------------ */
/*  Pure logic + types (ported verbatim)                               */
/* ------------------------------------------------------------------ */

const MI_TO_KM = 1.60934;

// Web WidgetRankedList default bar uses tailwind 'bg-blue-400'; the toned token.
const DEFAULT_BAR_COLOR = '#60a5fa';
// Web valueColor 'text-emerald-400' maps to the success token (#34d399).
const EMERALD_400 = colors.success;

interface DonutSegment {
  name: string;
  value: number;
  color: string;
}

type WidgetBadgeVariant = 'success' | 'warning' | 'error' | 'neutral';
type MappedBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

const badgeVariantMap: Record<WidgetBadgeVariant, MappedBadgeVariant> = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
};

interface RankedItem {
  id: string | number;
  label: string;
  value: number;
  formattedValue: string;
  badge?: {text: string; variant: WidgetBadgeVariant};
  barColor?: string;
}

/* ------------------------------------------------------------------ */
/*  CostTooltip (ported verbatim; rendered statically as legend)       */
/* ------------------------------------------------------------------ */

// web CostTooltip: null when inactive / no payload; otherwise a colour dot, the
// segment name and formatCurrency(value, 2). On native there is no hover, so it
// is rendered once per donut segment as the chart legend.
function CostTooltip({
  active,
  payload,
  formatCurrency: formatCurrencyFn,
}: {
  active?: boolean;
  payload?: Array<{payload: DonutSegment}>;
  formatCurrency: (amount: number, decimals?: number) => string;
}) {
  if (!active || !payload?.[0]) {
    return null;
  }
  const seg = payload[0].payload;
  return (
    <View style={styles.tooltip}>
      <View style={styles.tooltipRow}>
        <View style={[styles.tooltipDot, {backgroundColor: seg.color}]} />
        <AppText numberOfLines={1} style={styles.tooltipName}>
          {seg.name}
        </AppText>
      </View>
      <AppText style={styles.tooltipValue} tone="secondary" variant="caption">
        {formatCurrencyFn(seg.value, 2)}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Native donut (Recharts PieChart parity)                            */
/* ------------------------------------------------------------------ */

// React Native has no SVG/Recharts here, so the donut's part-to-whole intent is
// reproduced with a proportional segmented bar (each slice grows by its value
// and is filled with its palette colour), with the CostTooltip legend beneath.
function CostDonut({
  data,
  formatCurrency: formatCurrencyFn,
}: {
  data: DonutSegment[];
  formatCurrency: (amount: number, decimals?: number) => string;
}) {
  const total = data.reduce((sum, seg) => sum + Math.max(seg.value, 0), 0);

  return (
    <View style={styles.donut}>
      <View style={styles.donutBar}>
        {total > 0
          ? data.map(seg => (
              <View
                key={seg.name}
                style={{
                  backgroundColor: seg.color,
                  flexGrow: Math.max(seg.value, 0),
                }}
              />
            ))
          : null}
      </View>
      <View style={styles.donutLegend}>
        {data.map(seg => (
          <CostTooltip
            active
            formatCurrency={formatCurrencyFn}
            key={seg.name}
            payload={[{payload: seg}]}
          />
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Badge                                       */
/* ------------------------------------------------------------------ */

function Badge({
  variant,
  children,
}: {
  variant: MappedBadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant]]}>
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]}>
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback EmptyState                            */
/* ------------------------------------------------------------------ */

// web EmptyState(icon, message): a centred icon glyph above a muted message.
function EmptyState({
  icon,
  message,
}: {
  icon?: ReactNode;
  message: string;
}) {
  return (
    <View style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

function PieEmptyIcon() {
  return (
    <AppText style={styles.emptyGlyph} tone="muted" weight="bold">
      {PIE_GLYPH}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/data-display StatCard                          */
/* ------------------------------------------------------------------ */

function StatCard({
  label,
  value,
  unit,
  glyph,
  sublabel,
}: {
  label: string;
  value: string | number;
  unit?: string;
  glyph?: string;
  sublabel?: string;
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
      {sublabel ? (
        <AppText
          numberOfLines={1}
          style={styles.statCardSublabel}
          tone="muted"
          variant="caption">
          {sublabel}
        </AppText>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./shared WidgetBigNumber                                   */
/* ------------------------------------------------------------------ */

// web WidgetBigNumber: a large value (AnimatedNumber when animated -> fmtNumber
// with 0 decimals) + optional unit/label/subtitle/badge. The native parity keeps
// the same layout; the count-up animation has no native runtime so the final
// formatted value renders directly.
function WidgetBigNumber({
  value,
  unit,
  label,
  subtitle,
  badge,
  valueColor = colors.textPrimary,
  nullDisplay = '—',
  animated = true,
}: {
  value: number | null;
  unit?: string;
  label?: string;
  subtitle?: string;
  badge?: {text: string; variant: WidgetBadgeVariant};
  valueColor?: string;
  nullDisplay?: string;
  animated?: boolean;
}) {
  return (
    <View style={styles.bigNumber}>
      <View style={styles.bigNumberValueRow}>
        {value !== null ? (
          <AppText style={[styles.bigNumberValue, {color: valueColor}]}>
            {animated ? fmtNumber(value, 0) : String(value)}
          </AppText>
        ) : (
          <AppText style={styles.bigNumberValue} tone="muted">
            {nullDisplay}
          </AppText>
        )}
        {unit ? (
          <AppText style={styles.bigNumberUnit} tone="secondary">
            {unit}
          </AppText>
        ) : null}
      </View>

      {label ? (
        <AppText style={styles.bigNumberLabel} tone="muted">
          {label}
        </AppText>
      ) : null}

      {subtitle ? (
        <AppText style={styles.bigNumberSubtitle} tone="secondary" variant="caption">
          {subtitle}
        </AppText>
      ) : null}

      {badge ? (
        <Badge variant={badgeVariantMap[badge.variant]}>{badge.text}</Badge>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./shared WidgetRankedList                                  */
/* ------------------------------------------------------------------ */

function WidgetRankedList({
  items,
  maxItems,
  compact = false,
  showBars = true,
  emptyMessage = 'No data available',
  emptyIcon,
}: {
  items: RankedItem[];
  maxItems?: number;
  compact?: boolean;
  showBars?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}) {
  const limit = maxItems ?? (compact ? 3 : 5);
  const hideBars = compact || !showBars;

  const visible = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.value - a.value);
    return sorted.slice(0, limit);
  }, [items, limit]);

  const maxValue = useMemo(
    () => visible.reduce((max, item) => Math.max(max, item.value), 0),
    [visible],
  );

  if (visible.length === 0) {
    return <EmptyState icon={emptyIcon} message={emptyMessage} />;
  }

  return (
    <View style={styles.rankedList}>
      {visible.map((item, index) => {
        const barPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;

        return (
          <View key={item.id} style={styles.rankedRow}>
            {!hideBars ? (
              <View
                style={[
                  styles.rankedBar,
                  {
                    backgroundColor: item.barColor ?? DEFAULT_BAR_COLOR,
                    width: `${barPct}%`,
                  },
                ]}
              />
            ) : null}

            <View style={styles.rankedContent}>
              <AppText
                style={styles.rankedRank}
                tone="muted"
                variant="caption"
                weight="semibold">
                {index + 1}
              </AppText>

              <AppText numberOfLines={1} style={styles.rankedLabel}>
                {item.label}
              </AppText>

              {item.badge ? (
                <Badge variant={badgeVariantMap[item.badge.variant]}>
                  {item.badge.text}
                </Badge>
              ) : null}

              <AppText style={styles.rankedValue} weight="semibold">
                {item.formattedValue}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

// Relative "updated" caption helper for the freshness pill (web <DataFreshness>).
function formatFreshness(updatedAt: number, t: NativeTFunction): string {
  const diff = Date.now() - updatedAt;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return t('widget.justNow', 'Just now');
  }
  if (minutes < 60) {
    return `${minutes}m ${t('widget.ago', 'ago')}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${t('widget.ago', 'ago')}`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${t('widget.ago', 'ago')}`;
}

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

export default function CostBreakdownWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const distanceUnit = unitPrefs.distance;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useCostBreakdown(String(id));

  const isCompact = size.cols <= 1;

  // series colours from active theme.
  const palette = useThemeChartPalette();

  const monthlyEntries = useMemo(() => data?.monthly_breakdown ?? [], [data]);

  // Cost per distance unit in user's preference
  const costPerDist = useMemo(() => {
    const cpk = data?.cost_per_km_ev ?? 0;
    if (cpk === 0) {
      return 0;
    }
    return distanceUnit === 'mi' ? cpk * MI_TO_KM : cpk;
  }, [data, distanceUnit]);

  // Current month cost (last entry in breakdown)
  const currentMonthCost = useMemo(() => {
    if (monthlyEntries.length === 0) {
      return 0;
    }
    return monthlyEntries[monthlyEntries.length - 1]?.ev_cost ?? 0;
  }, [monthlyEntries]);

  // Donut segments from monthly breakdown (last 6 months)
  const donutData = useMemo((): DonutSegment[] => {
    const recent = monthlyEntries.slice(-6);
    return recent.map((entry, i) => ({
      color: palette.series[i % palette.series.length],
      name: entry.month ?? '—',
      value: entry.ev_cost ?? 0,
    }));
  }, [monthlyEntries, palette]);

  // Ranked list items from monthly breakdown
  const rankedItems = useMemo((): RankedItem[] => {
    return monthlyEntries.map((entry, i) => ({
      barColor: palette.series[i % palette.series.length],
      formattedValue: formatCurrency(entry.ev_cost ?? 0),
      id: entry.month ?? i,
      label: entry.month ?? '—',
      value: entry.ev_cost ?? 0,
    }));
  }, [monthlyEntries, palette]);

  const hasData = monthlyEntries.length > 0;
  const totalSavings = data?.total_savings ?? 0;
  const monthlySavings = data?.monthly_savings ?? 0;

  // Compact layout: big number + savings subtitle
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
        {hasData ? (
          <WidgetBigNumber
            animated
            badge={
              totalSavings > 0
                ? {
                    text: t('widget.costBreakdown.saving', 'Saving'),
                    variant: 'success' as const,
                  }
                : undefined
            }
            label={t('widget.costBreakdown.monthlyTotal', 'This Month')}
            subtitle={
              monthlySavings > 0
                ? t(
                    'widget.costBreakdown.savedVsGas',
                    'Saved {{amount}} vs gas',
                    {amount: formatCurrency(monthlySavings)},
                  )
                : undefined
            }
            unit={currencySymbol}
            value={currentMonthCost}
            valueColor={EMERALD_400}
          />
        ) : (
          <EmptyState
            icon={<PieEmptyIcon />}
            message={t('widget.costBreakdown.noData', 'No cost data')}
          />
        )}
      </WidgetShell>
    );
  }

  // Standard layout: donut + ranked list + stat cards
  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={
        <AppText style={styles.headerIcon} tone="accent" weight="bold">
          {PIE_GLYPH}
        </AppText>
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.costBreakdown.title', 'Cost Breakdown')}
      updatedAt={dataUpdatedAt}>
      {hasData ? (
        <View style={styles.standardBody}>
          {/* Donut chart */}
          <CostDonut data={donutData} formatCurrency={formatCurrency} />

          {/* Monthly ranked list */}
          <WidgetRankedList
            compact={false}
            emptyIcon={<PieEmptyIcon />}
            emptyMessage={t('widget.costBreakdown.noData', 'No cost data')}
            items={rankedItems}
            maxItems={5}
          />

          {/* Stat cards */}
          <View style={styles.statGrid}>
            <StatCard
              glyph={DOLLAR_GLYPH}
              label={t('widget.costBreakdown.totalCost', 'Total Cost')}
              value={formatCurrency(data?.total_charging_cost ?? 0)}
            />
            <StatCard
              glyph={FUEL_GLYPH}
              label={t('widget.costBreakdown.costPerDist', 'Cost / {{unit}}', {
                unit: distanceUnit,
              })}
              value={costPerDist > 0 ? formatCurrency(costPerDist, 3) : '—'}
            />
            <StatCard
              glyph={TREND_DOWN_GLYPH}
              label={t('widget.costBreakdown.gasSavings', 'Gas Savings')}
              sublabel={
                totalSavings > 0
                  ? t('widget.costBreakdown.lifetime', 'Lifetime')
                  : undefined
              }
              value={totalSavings > 0 ? formatCurrency(totalSavings) : '—'}
            />
          </View>
        </View>
      ) : (
        <EmptyState
          icon={<PieEmptyIcon />}
          message={t('widget.costBreakdown.noData', 'No cost data')}
        />
      )}
    </WidgetShell>
  );
}

CostBreakdownWidget.displayName = 'CostBreakdownWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const COST_BREAKDOWN_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

// Records the web capabilities the source relied on that are unavailable on
// native, so the unavailable state is explicit (parity-contract rule 7).
export const nativeCostBreakdownCapabilities = {
  // Recharts donut + per-slice hover tooltip: replaced by a proportional
  // segmented bar with a static CostTooltip legend (no pointer hover on native).
  rechartsDonutHoverTooltipAvailable: false,
  // useUnits()/useFormatting() settings store is not wired on native; distance
  // resolves to 'km' and currency to '$' with precision 2.
  settingsBackedFormattingAvailable: false,
} as const;

const styles = StyleSheet.create({
  // --- Standard body ---
  standardBody: {
    flexDirection: 'column',
    gap: spacing.md,
  },
  headerIcon: {
    fontSize: 12,
    letterSpacing: 0.4,
    lineHeight: 14,
  },

  // --- Donut ---
  donut: {
    gap: spacing.sm,
    minHeight: 92,
  },
  donutBar: {
    borderRadius: 8,
    flexDirection: 'row',
    height: 18,
    overflow: 'hidden',
  },
  donutLegend: {
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },

  // --- CostTooltip / legend item ---
  tooltip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tooltipRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  tooltipDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  tooltipName: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
  },
  tooltipValue: {
    marginTop: 2,
  },

  // --- Badge ---
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },

  // --- EmptyState ---
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  emptyGlyph: {
    fontSize: 20,
    letterSpacing: 0.5,
    lineHeight: 24,
  },
  emptyMessage: {
    textAlign: 'center',
  },

  // --- StatCard ---
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: 96,
    flexGrow: 1,
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
  statCardSublabel: {
    marginTop: -2,
  },

  // --- WidgetBigNumber ---
  bigNumber: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  bigNumberValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  bigNumberValue: {
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
  },
  bigNumberUnit: {
    fontSize: 18,
    lineHeight: 22,
  },
  bigNumberLabel: {
    fontSize: 10,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  bigNumberSubtitle: {
    textAlign: 'center',
  },

  // --- WidgetRankedList ---
  rankedList: {
    flexDirection: 'column',
    gap: spacing.xs,
  },
  rankedRow: {
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rankedBar: {
    bottom: 0,
    left: 0,
    opacity: 0.15,
    position: 'absolute',
    top: 0,
  },
  rankedContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  rankedRank: {
    minWidth: 20,
    textAlign: 'right',
  },
  rankedLabel: {
    color: colors.textPrimary,
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  rankedValue: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
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

const badgeSurfaceStyles = StyleSheet.create({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
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
