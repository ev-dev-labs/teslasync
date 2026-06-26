// Native parity port of web/src/features/analytics/pages/TrueCostPage.tsx.
//
// True Cost of Ownership page: compares the selected vehicle's EV running cost
// against an equivalent gas vehicle. Backed by GET /api/v1/analytics/tco
// (`useCostBreakdown(vehicleIdStr)` -> CostBreakdown). The page renders, top to
// bottom: an opt-in AI narration (outside the `tco` gate), four hero stat cards
// (Total EV Cost / Equiv. Gas Cost / Total Savings / Monthly Savings), a
// cumulative-savings chart, a cost-per-km + monthly EV-vs-gas chart pair, and a
// savings-breakdown summary, with a no-data empty state when the query resolves
// empty.
//
// Every web behavior, state name, API path, unit-handling rule, and i18n key is
// preserved; the web DOM/Tailwind/Recharts/lucide stack is replaced with React
// Native primitives + the native parity component library:
//
//   - `@/components/layout` PageContainer (title/subtitle/loading/error/actions)
//     has no native parity component, so a local ScrollView screen scaffold
//     reproduces the header (title + subtitle), the `actions` row (VehicleSelect
//     + DataFreshnessAuto), the loading spinner, and the error panel, with the
//     body wrapped in the native ErrorBoundary (== PageContainer's
//     PageErrorBoundary). Precedent: IngestXRayPage / DiskForecastPage.
//   - `@/components/ui` GlassPanel reuses the native parity GlassPanel
//     (`glow`/`hover`/`padding`).
//   - `@/components/data-display` Currency -> inlined currency text via the
//     native useFormatting() shim's formatCurrency (precision honoured).
//   - `@/components/data-display` DataFreshnessAuto -> a local FreshnessChip
//     driven by the query (isError/isFetching/isStale) plus the web
//     `forceStaleAfterMs={6h}` cagg-staleness override, rendered via StatusPill.
//   - `@/components/feedback` EmptyState -> native parity EmptyState (title +
//     message; the web icon-only/message-only variants get a short title).
//   - `@/components/motion` FadeIn/StaggerContainer/StaggerItem -> a
//     reduced-motion-aware FadeIn (honouring the web per-section `delay`); the
//     StaggerContainer grid becomes a native wrap grid and each StaggerItem a
//     staggered FadeIn.
//   - `@/components/forms` VehicleSelect (the global header picker backed by the
//     selected-vehicle store) -> a local NativeSelect bound to useVehicles() +
//     local state; combined with `useSelectedVehicle` (URL/store/first-vehicle)
//     this reproduces the "default to the first vehicle, allow switching"
//     behaviour without the web router/store layer.
//   - `@/components/charts` ChartContainer + Recharts AreaChart/BarChart (the
//     native recharts barrel only renders an "unavailable" placeholder) become a
//     local ChartPanel (title + ariaLabel) wrapping a real native SeriesBarChart
//     (proportional View bars in a horizontal ScrollView with a currency y-axis
//     + per-month x labels). The web Area becomes a column chart of the same
//     cumulative metric. ChartContainer's `exportable`/`exportFilename` CSV/PNG
//     download is a browser-only affordance and is unavailable on native (no DOM
//     download) — documented in the sidecar; the title/ariaLabel intent is kept.
//   - `@/components/ai/AITCONarration` reuses the already-ported native parity
//     component (withAiFeature gates the whole surface; ai_mode='off' renders
//     nothing).
//   - `@/hooks/useUnits` + `@/hooks/useFormatting` + `@/hooks/useSettings` ->
//     native shims mirroring the web out-of-box defaults (distance 'km', energy
//     'kWh', currency '$', precision 2, gas_unit 'gallon'); the API already
//     returns SI and conversion happens at the display boundary, exactly as the
//     web hooks do. Precedent: BatteryTab / HeroGauges.
//   - `@/hooks/usePageTitle` (sets document.title) -> native no-op shim (RN has
//     no document) keeping the t() title call.
//   - `@/lib/unitConversion` convertDistanceFromSI + `@/lib/numberFormat`
//     fmtNumber/fmtInt -> inlined native-safe equivalents.
//   - react-i18next useTranslation -> a local t(key, fallback, vars?) shim that
//     interpolates `{{months}}`, so every `tco.*` / `common.*` key + English
//     copy is preserved verbatim as the visible string.
//   - lucide-react Zap/Fuel/Leaf/TrendingUp/DollarSign are decorative; rendered
//     as colour-coded emoji glyphs (the native labels carry the meaning).

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {StatusPill} from '../../../../components/ui/StatusPill';
import {colors, spacing} from '../../../../theme/tokens';
import {useCostBreakdown} from '../../../api/hooks/useAnalytics';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {AITCONarration} from '../../../components/ai/AITCONarration';
import {ErrorBoundary} from '../../../components/feedback/ErrorBoundary';
import {GlassPanel} from '../../../components/ui/GlassPanel';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type TranslationVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

function useNativeTranslation(): NativeTFunction {
  return (_key: string, fallback: string, vars?: TranslationVars) => {
    if (vars == null) {
      return fallback;
    }
    return fallback.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : match,
    );
  };
}

/* ─── usePageTitle (web sets document.title; native has no document) ────────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── native-safe formatting (web `@/lib/numberFormat`) ─────────────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── native unit shim (web `@/hooks/useUnits` + `@/lib/unitConversion`) ────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

// Mirrors web `convertDistanceFromSI` (SI meters -> display unit).
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
    case 'km':
    default:
      return meters / METERS_PER_KM;
  }
}

interface UseUnitsResult {
  unitPrefs: {distance: DistanceUnitPref};
  formatEnergy: (wh: number | null | undefined) => string;
}

// The native parity layer has no settings store wired in, so the hook mirrors
// the web out-of-box defaults: distance 'km', energy 'kWh', en-US locale. The
// API already returns SI; conversion happens here at the display boundary.
function useUnits(): UseUnitsResult {
  return useMemo<UseUnitsResult>(
    () => ({
      unitPrefs: {distance: 'km'},
      formatEnergy: wh => {
        if (wh == null || !Number.isFinite(wh)) {
          return '\u2014';
        }
        return `${fmtNumber(wh / 1000, DEFAULT_GLOBAL_PRECISION)} kWh`;
      },
    }),
    [],
  );
}

/* ─── native formatting shim (web `@/hooks/useFormatting`) ──────────────────── */

const DEFAULT_CURRENCY_SYMBOL = '$';

interface UseFormattingResult {
  formatCurrency: (amount: number, decimals?: number) => string;
}

// Mirrors the web out-of-box defaults: currency symbol '$', precision 2.
function useFormatting(): UseFormattingResult {
  return useMemo<UseFormattingResult>(
    () => ({
      formatCurrency: (amount, decimals) =>
        `${DEFAULT_CURRENCY_SYMBOL}${fmtNumber(
          amount,
          decimals ?? DEFAULT_GLOBAL_PRECISION,
        )}`,
    }),
    [],
  );
}

/* ─── native settings shim (web `@/hooks/useSettings`) ──────────────────────── */

interface UseSettingsResult {
  settings: {gas_unit?: 'gallon' | 'liter'};
}

// The native parity layer has no settings store wired in; mirror the web
// out-of-box default so `settings.gas_unit ?? 'gallon'` resolves to 'gallon'.
function useSettings(): UseSettingsResult {
  return useMemo<UseSettingsResult>(
    () => ({settings: {gas_unit: 'gallon'}}),
    [],
  );
}

/* ─── FadeIn (web `@/components/motion` FadeIn / StaggerItem) ───────────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: delay * 1000,
      duration: 320,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      },
    ],
  };

  return (
    <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>
  );
}

FadeIn.displayName = 'FadeIn';

/* ─── query-driven freshness chip (web `<DataFreshnessAuto>`) ───────────────── */

interface FreshnessQueryLike {
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
}

function FreshnessChip({
  query,
  forceStaleAfterMs,
  t,
}: {
  query: FreshnessQueryLike;
  forceStaleAfterMs: number;
  t: NativeTFunction;
}) {
  // Cagg-driven: force amber after the configured window to surface stale
  // aggregates, mirroring the web `forceStaleAfterMs` override.
  const forcedStale =
    query.dataUpdatedAt > 0 &&
    Date.now() - query.dataUpdatedAt > forceStaleAfterMs;

  if (query.isError) {
    return (
      <StatusPill
        label={t('common.freshness.error', 'Error')}
        state="offline"
      />
    );
  }
  if (query.isFetching) {
    return (
      <StatusPill
        label={t('common.freshness.updating', 'Updating\u2026')}
        state="warning"
      />
    );
  }
  if (query.isStale || forcedStale) {
    return (
      <StatusPill
        label={t('common.freshness.stale', 'Stale')}
        state="warning"
      />
    );
  }
  return (
    <StatusPill label={t('common.freshness.live', 'Live')} state="online" />
  );
}

FreshnessChip.displayName = 'FreshnessChip';

/* ─── NativeSelect (web `@/components/forms` VehicleSelect picker) ──────────── */

interface NativeSelectOption {
  value: string;
  label: string;
}

function NativeSelect({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: string;
  options: NativeSelectOption[];
  onChange: (value: string) => void;
  accessibilityLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <View style={styles.select}>
      <Pressable
        accessibilityHint="Opens the option list"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(prev => !prev)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.pressed]}
      >
        <AppText numberOfLines={1} style={styles.selectValue}>
          {selected ? selected.label : '\u2014'}
        </AppText>
        <AppText style={styles.selectChevron} tone="muted">
          {open ? '\u25B4' : '\u25BE'}
        </AppText>
      </Pressable>
      {open ? (
        <View style={styles.selectList}>
          {options.map(option => {
            const isSelected = option.value === value;
            return (
              <Pressable
                accessibilityLabel={option.label}
                accessibilityRole="button"
                accessibilityState={{selected: isSelected}}
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({pressed}) => [
                  styles.selectOption,
                  isSelected && styles.selectOptionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <AppText
                  numberOfLines={1}
                  tone={isSelected ? 'accent' : 'primary'}
                >
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

NativeSelect.displayName = 'NativeSelect';

/* ─── SeriesBarChart (web `@/components/charts` Recharts Area/BarChart) ─────── */

interface BarSeries {
  key: string;
  label: string;
  color: string;
}

type ChartRow = Record<string, string | number>;

const BAR_WIDTH = 18;
const BAR_INNER_GAP = 6;

function toBarNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function SeriesBarChart({
  data,
  xKey,
  series,
  height,
  yFormatter,
  accessibilityLabel,
  colorFor,
  showLegend,
}: {
  data: ReadonlyArray<ChartRow>;
  xKey: string;
  series: ReadonlyArray<BarSeries>;
  height: number;
  yFormatter: (value: number) => string;
  accessibilityLabel: string;
  colorFor?: (row: ChartRow, seriesKey: string) => string | undefined;
  showLegend?: boolean;
}) {
  const maxVal = data.reduce((max, row) => {
    const rowMax = series.reduce(
      (m, s) => Math.max(m, toBarNumber(row[s.key])),
      0,
    );
    return Math.max(max, rowMax);
  }, 0);

  const yTicks = [maxVal, maxVal / 2, 0].map(yFormatter);
  const columnWidth = Math.max(
    48,
    series.length * BAR_WIDTH + (series.length - 1) * BAR_INNER_GAP + 18,
  );
  const legendVisible = showLegend ?? series.length > 1;

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      accessible
      style={styles.chartRoot}
    >
      <View style={styles.chartFrame}>
        <View style={[styles.yAxis, {height}]}>
          {yTicks.map((tick, index) => (
            <AppText
              key={`${tick}-${index}`}
              numberOfLines={1}
              style={styles.axisLabel}
              tone="muted"
              variant="caption"
            >
              {tick}
            </AppText>
          ))}
        </View>
        <ScrollView
          contentContainerStyle={styles.barsContent}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {data.map((row, rowIndex) => (
            <View
              key={rowIndex}
              style={[styles.barColumn, {width: columnWidth}]}
            >
              <View style={[styles.barTrack, {height}]}>
                <View style={styles.barGroup}>
                  {series.map(s => {
                    const value = toBarNumber(row[s.key]);
                    const pct =
                      maxVal > 0
                        ? Math.max(
                            (Math.max(value, 0) / maxVal) * 100,
                            value > 0 ? 3 : 0,
                          )
                        : 0;
                    const fill = colorFor?.(row, s.key) ?? s.color;
                    return (
                      <View
                        key={s.key}
                        pointerEvents="none"
                        style={[
                          styles.bar,
                          {
                            backgroundColor: fill,
                            height: `${pct}%` as DimensionValue,
                          },
                        ]}
                      />
                    );
                  })}
                </View>
              </View>
              <AppText
                numberOfLines={1}
                style={styles.barLabel}
                tone="muted"
                variant="caption"
              >
                {String(row[xKey] ?? '')}
              </AppText>
            </View>
          ))}
        </ScrollView>
      </View>
      {legendVisible ? (
        <View style={styles.legend}>
          {series.map(s => (
            <View key={s.key} style={styles.legendItem}>
              <View
                pointerEvents="none"
                style={[styles.legendDot, {backgroundColor: s.color}]}
              />
              <AppText tone="muted" variant="caption">
                {s.label}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

SeriesBarChart.displayName = 'SeriesBarChart';

/* ─── ChartPanel (web `@/components/charts` ChartContainer) ─────────────────── */

function ChartPanel({
  title,
  ariaLabel,
  children,
}: {
  title: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  // ChartContainer's exportable CSV/PNG download is a browser-only affordance
  // (no DOM download on native); the title + accessibilityLabel intent is kept.
  return (
    <GlassPanel accessibilityLabel={ariaLabel} padding="lg">
      <AppText style={styles.panelTitle} weight="semibold">
        {title}
      </AppText>
      {children}
    </GlassPanel>
  );
}

ChartPanel.displayName = 'ChartPanel';

/* ─── HeroStatCard (web GlassPanel hero stat cards) ────────────────────────── */

type GlowTint = 'cyan' | 'green' | 'none';

function HeroStatCard({
  glow,
  glyph,
  glyphColor,
  label,
  value,
  valueColor,
  sublabel,
}: {
  glow: GlowTint;
  glyph: string;
  glyphColor: string;
  label: string;
  value: string;
  valueColor: string;
  sublabel: string;
}) {
  return (
    <GlassPanel glow={glow} hover padding="md" style={styles.heroCard}>
      <View style={styles.heroHeader}>
        <AppText style={[styles.heroGlyph, {color: glyphColor}]}>
          {glyph}
        </AppText>
        <AppText
          numberOfLines={1}
          style={styles.heroLabel}
          tone="muted"
          variant="caption"
        >
          {label}
        </AppText>
      </View>
      <AppText
        numberOfLines={1}
        style={[styles.heroValue, {color: valueColor}]}
        weight="bold"
      >
        {value}
      </AppText>
      <AppText
        numberOfLines={2}
        style={styles.heroSub}
        tone="muted"
        variant="caption"
      >
        {sublabel}
      </AppText>
    </GlassPanel>
  );
}

HeroStatCard.displayName = 'HeroStatCard';

/* ─── chart colours (web Recharts literals, preserved) ─────────────────────── */

const COLOR_EV = '#00f0ff';
const COLOR_ICE = '#ef4444';
const COLOR_SAVINGS = '#10b981';
const CHART_TRACK_HEIGHT = 180;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/* ─── TrueCostPage ─────────────────────────────────────────────────────────── */

export default function TrueCostPage() {
  const t = useNativeTranslation();
  usePageTitle(t('tco.title', 'Total Cost of Ownership'));
  const {unitPrefs, formatEnergy} = useUnits();
  const {formatCurrency} = useFormatting();
  const {settings} = useSettings();
  const distanceUnit = unitPrefs.distance;
  const gasUnit = settings.gas_unit ?? 'gallon';
  const gasUnitLabel =
    gasUnit === 'liter'
      ? t('common.unit.liter', 'L')
      : t('common.unit.gallon', 'gal');

  // useSelectedVehicle shim: default to the first vehicle in the fleet (the web
  // hook's final fallback) while letting the header VehicleSelect switch it.
  const vehiclesQuery = useVehicles();
  const vehicles: Vehicle[] = vehiclesQuery.data ?? [];
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(
    null,
  );
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (selectedVehicleId == null && firstVehicleId != null) {
      setSelectedVehicleId(firstVehicleId);
    }
  }, [selectedVehicleId, firstVehicleId]);
  const vehicleId = selectedVehicleId ?? firstVehicleId;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';

  const tcoQuery = useCostBreakdown(vehicleIdStr);
  const {data: tco, isLoading, error} = tcoQuery;

  const fmtCurrency = (v: number) => formatCurrency(v);

  const monthlyBreakdown = tco?.monthly_breakdown ?? [];

  const vehicleOptions: NativeSelectOption[] = vehicles.map(v => ({
    value: String(v.id),
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="analytics-true-cost"
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {t('tco.title', 'True Cost of Ownership')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {t(
              'tco.subtitle',
              'Compare your EV running costs against an equivalent gas vehicle',
            )}
          </AppText>
        </View>
        <View style={styles.actions}>
          <NativeSelect
            accessibilityLabel={t('common.vehicle.select', 'Select vehicle')}
            onChange={v => setSelectedVehicleId(v ? Number(v) : null)}
            options={vehicleOptions}
            value={vehicleId != null ? String(vehicleId) : ''}
          />
          <FreshnessChip
            forceStaleAfterMs={SIX_HOURS_MS}
            query={tcoQuery}
            t={t}
          />
        </View>
      </View>

      <ErrorBoundary name="true-cost-page">
        <View style={styles.stack}>
          {/* Opt-in LLM narrator, rendered OUTSIDE the `tco` gate so it stays
              visible even when the deterministic envelope is still null. The
              withAiFeature HOC inside AITCONarration handles all mode/toggle
              gating; when ai_mode='off' this entire surface is absent. */}
          <AITCONarration vehicleId={vehicleId ?? undefined} />

          {error instanceof Error && !tco ? (
            <GlassPanel padding="lg">
              <EmptyState
                message={error.message}
                title={t('tco.error', 'Failed to load cost analysis')}
              />
            </GlassPanel>
          ) : tco ? (
            <>
              {/* Hero stat cards */}
              <View style={styles.heroGrid}>
                <FadeIn style={styles.heroCardWrap}>
                  <HeroStatCard
                    glow="cyan"
                    glyph={'\u26A1'}
                    glyphColor={colors.accent}
                    label={t('tco.totalEvCost', 'Total EV Cost')}
                    sublabel={`${formatEnergy(tco.total_wh)} \u00B7 ${
                      tco.total_sessions
                    } ${t('tco.sessions', 'sessions')}`}
                    value={fmtCurrency(tco.total_charging_cost)}
                    valueColor={colors.accent}
                  />
                </FadeIn>

                <FadeIn delay={0.05} style={styles.heroCardWrap}>
                  <HeroStatCard
                    glow="none"
                    glyph={'\u26FD'}
                    glyphColor={colors.danger}
                    label={t('tco.equivGasCost', 'Equiv. Gas Cost')}
                    sublabel={`@ ${formatCurrency(
                      tco.gas_price,
                    )}/${gasUnitLabel} \u00B7 ${tco.gas_efficiency_mpg} MPG`}
                    value={fmtCurrency(tco.equivalent_gas_cost)}
                    valueColor={colors.danger}
                  />
                </FadeIn>

                <FadeIn delay={0.1} style={styles.heroCardWrap}>
                  <HeroStatCard
                    glow="green"
                    glyph={'\uD83C\uDF43'}
                    glyphColor={colors.success}
                    label={t('tco.totalSavings', 'Total Savings')}
                    sublabel={t('tco.overMonths', 'Over {{months}} months', {
                      months: fmtNumber(tco.months_of_ownership),
                    })}
                    value={fmtCurrency(tco.total_savings)}
                    valueColor={colors.success}
                  />
                </FadeIn>

                <FadeIn delay={0.15} style={styles.heroCardWrap}>
                  <HeroStatCard
                    glow="green"
                    glyph={'\uD83D\uDCC8'}
                    glyphColor={colors.success}
                    label={t('tco.monthlySavings', 'Monthly Savings')}
                    sublabel={t(
                      'tco.plusMaintenance',
                      '+ ~$50/mo maintenance savings',
                    )}
                    value={fmtCurrency(tco.monthly_savings)}
                    valueColor={colors.success}
                  />
                </FadeIn>
              </View>

              {/* Cumulative savings chart */}
              <FadeIn>
                <ChartPanel
                  ariaLabel={t(
                    'tco.cumulativeSavings.aria',
                    'Cumulative EV-vs-gas savings area chart over time',
                  )}
                  title={t(
                    'tco.cumulativeSavings',
                    'Cumulative Savings Over Time',
                  )}
                >
                  {monthlyBreakdown.length > 0 ? (
                    <SeriesBarChart
                      accessibilityLabel={t(
                        'tco.cumulativeSavings.aria',
                        'Cumulative EV-vs-gas savings area chart over time',
                      )}
                      data={monthlyBreakdown.map(m => ({
                        month: m.month,
                        cumulative_savings: m.cumulative_savings,
                      }))}
                      height={CHART_TRACK_HEIGHT}
                      series={[
                        {
                          key: 'cumulative_savings',
                          label: t(
                            'tco.cumulativeSavings',
                            'Cumulative Savings',
                          ),
                          color: COLOR_SAVINGS,
                        },
                      ]}
                      xKey="month"
                      yFormatter={v => formatCurrency(v, 0)}
                    />
                  ) : (
                    <EmptyState
                      message={t(
                        'tco.noMonthlyData',
                        'No monthly data available yet',
                      )}
                      title={t('tco.noMonthlyData.title', 'No data')}
                    />
                  )}
                </ChartPanel>
              </FadeIn>

              {/* Cost per km comparison + Monthly EV vs Gas */}
              <View style={styles.chartGrid}>
                <FadeIn delay={0.1}>
                  <ChartPanel
                    ariaLabel={t(
                      'tco.costPerKm.aria',
                      'Cost per kilometer bar chart comparing EV electricity to gas',
                    )}
                    title={t('tco.costPerKm', 'Cost per Kilometer')}
                  >
                    <SeriesBarChart
                      accessibilityLabel={t(
                        'tco.costPerKm.aria',
                        'Cost per kilometer bar chart comparing EV electricity to gas',
                      )}
                      colorFor={row =>
                        typeof row.fill === 'string' ? row.fill : undefined
                      }
                      data={[
                        {
                          name: t('tco.evElectric', 'EV (Electric)'),
                          cost: tco.cost_per_km_ev,
                          fill: COLOR_EV,
                        },
                        {
                          name: t('tco.iceGas', 'ICE (Gas)'),
                          cost: tco.cost_per_km_ice,
                          fill: COLOR_ICE,
                        },
                      ]}
                      height={140}
                      series={[
                        {
                          key: 'cost',
                          label: t('tco.costKm', 'Cost/km'),
                          color: COLOR_EV,
                        },
                      ]}
                      showLegend={false}
                      xKey="name"
                      yFormatter={v => formatCurrency(v, 3)}
                    />
                    <View style={styles.perKmGrid}>
                      <View style={styles.perKmCardEv}>
                        <AppText style={styles.perKmValueEv} weight="bold">
                          {formatCurrency(tco.cost_per_km_ev, 3)}
                        </AppText>
                        <AppText
                          style={styles.perKmCaption}
                          tone="muted"
                          variant="caption"
                        >
                          {t('tco.perKmEv', 'per km (EV)')}
                        </AppText>
                      </View>
                      <View style={styles.perKmCardIce}>
                        <AppText style={styles.perKmValueIce} weight="bold">
                          {formatCurrency(tco.cost_per_km_ice, 3)}
                        </AppText>
                        <AppText
                          style={styles.perKmCaption}
                          tone="muted"
                          variant="caption"
                        >
                          {t('tco.perKmGas', 'per km (Gas)')}
                        </AppText>
                      </View>
                    </View>
                  </ChartPanel>
                </FadeIn>

                <FadeIn delay={0.2}>
                  <ChartPanel
                    ariaLabel={t(
                      'tco.monthlyEvVsGas.aria',
                      'Monthly EV vs gas cost comparison bar chart',
                    )}
                    title={t('tco.monthlyEvVsGas', 'Monthly EV vs Gas Cost')}
                  >
                    {monthlyBreakdown.length > 0 ? (
                      <SeriesBarChart
                        accessibilityLabel={t(
                          'tco.monthlyEvVsGas.aria',
                          'Monthly EV vs gas cost comparison bar chart',
                        )}
                        data={monthlyBreakdown.map(m => ({
                          month: m.month,
                          ev_cost: m.ev_cost,
                          equiv_gas_cost: m.equiv_gas_cost,
                        }))}
                        height={140}
                        series={[
                          {
                            key: 'ev_cost',
                            label: t('tco.evCost', 'EV Cost'),
                            color: COLOR_EV,
                          },
                          {
                            key: 'equiv_gas_cost',
                            label: t('tco.gasEquiv', 'Gas Equiv.'),
                            color: COLOR_ICE,
                          },
                        ]}
                        xKey="month"
                        yFormatter={v => formatCurrency(v, 0)}
                      />
                    ) : (
                      <EmptyState
                        message={t(
                          'tco.noMonthlyData',
                          'No monthly data available yet',
                        )}
                        title={t('tco.noMonthlyData.title', 'No data')}
                      />
                    )}
                  </ChartPanel>
                </FadeIn>
              </View>

              {/* Breakdown summary */}
              <FadeIn delay={0.3}>
                <GlassPanel padding="lg">
                  <AppText style={styles.breakdownTitle} weight="semibold">
                    {'\uD83D\uDCB2 '}
                    {t('tco.savingsBreakdown', 'Savings Breakdown')}
                  </AppText>
                  <View style={styles.breakdownGrid}>
                    <View style={styles.breakdownCard}>
                      <AppText
                        style={styles.breakdownLabel}
                        tone="muted"
                        variant="caption"
                      >
                        {t('tco.fuelSavings', 'Fuel Savings')}
                      </AppText>
                      <AppText style={styles.breakdownValue} weight="bold">
                        {fmtCurrency(tco.total_savings)}
                      </AppText>
                      <AppText
                        style={styles.breakdownSub}
                        tone="muted"
                        variant="caption"
                      >
                        {t('tco.electricityVsGas', 'Electricity vs gasoline')}
                      </AppText>
                    </View>
                    <View style={styles.breakdownCard}>
                      <AppText
                        style={styles.breakdownLabel}
                        tone="muted"
                        variant="caption"
                      >
                        {t(
                          'tco.maintenanceSavings',
                          'Maintenance Savings (Est.)',
                        )}
                      </AppText>
                      <AppText style={styles.breakdownValue} weight="bold">
                        {fmtCurrency(tco.maintenance_savings_estimate)}
                      </AppText>
                      <AppText
                        style={styles.breakdownSub}
                        tone="muted"
                        variant="caption"
                      >
                        {t(
                          'tco.noOilChanges',
                          'No oil changes, less brake wear',
                        )}
                      </AppText>
                    </View>
                    <View style={styles.breakdownCard}>
                      <AppText
                        style={styles.breakdownLabel}
                        tone="muted"
                        variant="caption"
                      >
                        {t('tco.totalEstSavings', 'Total Estimated Savings')}
                      </AppText>
                      <AppText style={styles.breakdownValue} weight="bold">
                        {fmtCurrency(
                          tco.total_savings + tco.maintenance_savings_estimate,
                        )}
                      </AppText>
                      <AppText
                        style={styles.breakdownSub}
                        tone="muted"
                        variant="caption"
                      >
                        {`${fmtInt(
                          convertDistanceFromSI(
                            (tco.total_km ?? 0) * 1000,
                            distanceUnit,
                          ),
                        )} ${distanceUnit} \u00B7 ${tco.first_date} \u2192 ${
                          tco.last_date
                        }`}
                      </AppText>
                    </View>
                  </View>
                </GlassPanel>
              </FadeIn>
            </>
          ) : isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <GlassPanel padding="lg">
              <EmptyState
                message={t(
                  'tco.noData',
                  'No data available. Start charging to see your cost analysis.',
                )}
                title={t('tco.noData.title', 'No cost data')}
              />
            </GlassPanel>
          )}
        </View>
      </ErrorBoundary>
    </ScrollView>
  );
}

TrueCostPage.displayName = 'TrueCostPage';

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  axisLabel: {
    textAlign: 'right',
  },
  bar: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    minHeight: 2,
    width: BAR_WIDTH,
  },
  barColumn: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  barGroup: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: BAR_INNER_GAP,
    height: '100%',
  },
  barLabel: {
    maxWidth: 64,
    textAlign: 'center',
  },
  barTrack: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barsContent: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
  },
  breakdownCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: '30%',
    gap: spacing.xs,
    minWidth: 160,
    padding: spacing.md,
  },
  breakdownGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  breakdownLabel: {
    textTransform: 'uppercase',
  },
  breakdownSub: {},
  breakdownTitle: {
    fontSize: 16,
    marginBottom: spacing.lg,
  },
  breakdownValue: {
    color: colors.success,
    fontSize: 20,
    lineHeight: 26,
  },
  chartFrame: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  chartGrid: {
    gap: spacing.lg,
  },
  chartRoot: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerCopy: {
    flexGrow: 1,
    flexShrink: 1,
    gap: spacing.xs,
    minWidth: 200,
  },
  heroCard: {
    gap: spacing.xs,
    height: '100%',
  },
  heroCardWrap: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },
  heroGlyph: {
    fontSize: 14,
  },
  heroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  heroHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  heroLabel: {
    flexShrink: 1,
    textTransform: 'uppercase',
  },
  heroSub: {},
  heroValue: {
    fontSize: 22,
    lineHeight: 28,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  legendDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  pageSubtitle: {},
  pageTitle: {
    color: colors.textPrimary,
  },
  panelTitle: {
    fontSize: 15,
  },
  perKmCaption: {
    textAlign: 'center',
  },
  perKmCardEv: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: '45%',
    gap: spacing.xs,
    padding: spacing.md,
  },
  perKmCardIce: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: '45%',
    gap: spacing.xs,
    padding: spacing.md,
  },
  perKmGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  perKmValueEv: {
    color: colors.accent,
    fontSize: 18,
    lineHeight: 24,
  },
  perKmValueIce: {
    color: colors.danger,
    fontSize: 18,
    lineHeight: 24,
  },
  pressed: {
    opacity: 0.7,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  select: {
    minWidth: 200,
    position: 'relative',
  },
  selectChevron: {
    marginLeft: spacing.sm,
  },
  selectList: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  selectOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectOptionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectValue: {
    flexShrink: 1,
  },
  stack: {
    gap: spacing.lg,
  },
  yAxis: {
    justifyContent: 'space-between',
    paddingBottom: 20,
    width: 56,
  },
});
