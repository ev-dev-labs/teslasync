// BatteryHealthPage — native parity port of
// web/src/features/battery/pages/BatteryHealthPage.tsx.
//
// Battery Health dashboard: a health-score hero (4 RadialGauges + years-to-80),
// metric bars, summary metric cards, thermal monitoring, smart insights,
// capacity-trend + range-trend + charge-level-distribution + AC/DC charts,
// a New-vs-Now capacity/range comparison, quick links and recommendations.
//
// Native adaptations (behavior/state names/API paths/unit handling/i18n intent
// preserved; only the rendering substrate changes to React Native primitives):
//   - react-i18next `useTranslation` + i18next `TFunction` (web L2-3) -> an
//     inline native t(key, fallback|opts, vars?) shim preserving every
//     battery.*/common.* key, English default, {{soh}}/{{pct}}/{{count}}/
//     {{rate}}/{{n}} interpolation, AND the i18next `{ ..., defaultValue }`
//     option-object call shape used by buildInsights.
//   - react-router-dom `Link` (web L4) -> non-interactive native quick-link rows
//     (no RN router is wired into this parity page; documented).
//   - lucide-react icons (web L5-10) -> emoji glyphs carrying the same visual
//     intent (lucide-react is browser-only SVG).
//   - `@/components/layout` PageContainer/Grid (web L12) -> inline RN
//     PageContainer (ScrollView header + loading/error gating) + Grid.
//   - `@/components/forms` VehicleSelect (web L13) -> inline read-only native
//     vehicle chip (no router/picker wired; documented).
//   - `@/components/ui` GlassPanel/Badge/Button (web L14) -> inline RN equivalents.
//   - `@/components/charts` (web L15-21): native barrel RadialGauge (real native
//     impl) + ChartContainer (real native impl) + CHART_COLORS; the recharts
//     Area/Bar/Composed/Pie SVG charts are re-expressed as native-safe
//     MiniBars/GroupedBars/SplitBar (the WeeklyDigest DigestBarChart precedent)
//     because SVG cartesian/pie plots, hover tooltips and ReferenceLines are
//     unavailable in React Native.
//   - `@/components/data-display` MetricCard/MetricBar/LiveIndicator (web L22) ->
//     inline RN equivalents.
//   - `@/components/feedback` Skeleton/EmptyState/LiveStaleDataBanner/
//     SectionErrorBoundary/StatGridSkeleton/ChartBlockSkeleton/PageHeaderSkeleton
//     (web L23) -> inline RN equivalents (LiveStaleDataBanner renders null — the
//     web stale-data context is not wired in native; documented).
//   - `@/components/motion` FadeIn (web L24) -> inline passthrough View (no RN
//     entrance animation primitive; the delay prop is preserved + ignored).
//   - `@/components/ai/AIBatteryHealthForecastNarrative` (web L25) -> the native
//     parity component of the same name (../../../components/ai/...).
//   - api hooks (web L27-29): native ../../../api/hooks useBatteryHealthAnalytics/
//     useBatteryDegradation/useChargingSessionsPaginated/useChargingTelemetryLatest
//     kept verbatim with identical args + API paths.
//   - `@/hooks/useUnits` (web L30) -> inline native useUnits reading the native
//     useSettings (same unit_of_length/unit_of_temp derivation; energy=kWh).
//   - `@/lib/unitConversion` (web L31) + `@/lib/numberFormat` (web L38) +
//     `@/lib/dateFormat` (web L39) + `@/lib/colors` (web L37) -> ported inline.
//   - `@/hooks/usePageTitle` (web L32) -> native no-op (no document.title in RN).
//   - `@/hooks/useAlertContext` (web L33) -> native-safe { timestamp:null,
//     signal:null } (alert drill-through URLs are router-only; documented).
//   - `@/hooks/useSelectedVehicle` (web L34) -> inline native useSelectedVehicle
//     backed by the native useVehicles list (seeds to the first vehicle, like the
//     web provider default; URL/localStorage precedence is router-only).
//   - `@/features/onboarding/.../NoVehicleSelected` (web L35) -> inline RN version.
//   - `@/lib/cn` (web L36) -> not needed (native uses StyleSheet + style arrays).
//
// No DOM/Recharts/Leaflet/react-router/react-i18next/framer-motion/lucide/old
// web-UI imports reach the native output.

import React, {useCallback, useEffect, useMemo} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useBatteryHealthAnalytics,
  useBatteryDegradation,
  type BatteryHealthAnalytics,
} from '../../../api/hooks/useEnergy';
import {
  useChargingSessionsPaginated,
  type ApiChargingSession,
} from '../../../api/hooks/useCharging';
import {
  useChargingTelemetryLatest,
  useVehicles,
} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';
import {RadialGauge, ChartContainer, CHART_COLORS} from '../../../components/charts';
import {AIBatteryHealthForecastNarrative} from '../../../components/ai/AIBatteryHealthForecastNarrative';

/* ── i18n: native-safe t() (web react-i18next useTranslation / TFunction) ──── */

type TVars = Record<string, string | number>;
interface TOptions {
  defaultValue?: string;
  [key: string]: string | number | undefined;
}
type NativeT = (key: string, a?: string | TOptions, b?: TVars) => string;

function interpolate(template: string, vars: TVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const value = vars[key];
    return value === undefined ? '' : String(value);
  });
}

/**
 * Native i18n shim covering the three web call shapes:
 *   t('key', 'Fallback')
 *   t('key', 'Fallback {{n}}', { n })
 *   t('key', { soh, defaultValue: 'Fallback {{soh}}' })   // i18next option object
 */
function translate(key: string, a?: string | TOptions, b?: TVars): string {
  let fallback = key;
  let vars: TVars = {};
  if (typeof a === 'string') {
    fallback = a;
    if (b) {
      vars = b;
    }
  } else if (a && typeof a === 'object') {
    const {defaultValue, ...rest} = a;
    fallback = typeof defaultValue === 'string' ? defaultValue : key;
    const collected: TVars = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) {
        collected[k] = v;
      }
    }
    vars = collected;
  }
  return interpolate(fallback, vars);
}

function useTranslation(): {t: NativeT} {
  return {t: translate};
}

/* ── usePageTitle (web @/hooks/usePageTitle) — RN has no document.title ─────── */

function usePageTitle(title: string): void {
  useEffect(() => {
    // No-op in React Native: there is no browser tab / document.title to write.
  }, [title]);
}

/* ── numberFormat (web @/lib/numberFormat) — en-US, no settings precision ───── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPercent(v: unknown, decimals?: number): string {
  return `${fmtNumber(v, decimals ?? 2)}%`;
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ── dateFormat (web @/lib/dateFormat formatDateShort → "Apr 4") ───────────── */

function formatDateShort(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
}

/* ── unitConversion (web @/lib/unitConversion, SI → display) ───────────────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type TemperatureUnitPref = '°C' | '°F';
type EnergyUnitPref = 'Wh' | 'kWh';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

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

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

/* ── useUnits (web @/hooks/useUnits) — reads native useSettings ────────────── */

interface UnitPrefsLite {
  distance: DistanceUnitPref;
  temperature: TemperatureUnitPref;
  energy: EnergyUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefsLite} {
  const {data} = useSettings();
  const distance: DistanceUnitPref = data?.unit_of_length === 'mi' ? 'mi' : 'km';
  const temperature: TemperatureUnitPref =
    data?.unit_of_temp === 'F' ? '°F' : '°C';
  const unitPrefs = useMemo<UnitPrefsLite>(
    () => ({distance, temperature, energy: 'kWh'}),
    [distance, temperature],
  );
  return {unitPrefs};
}

/* ── useAlertContext (web @/hooks/useAlertContext) — router-only drill-through ─ */

interface AlertContextValue {
  timestamp: string | null;
  signal: string | null;
}

// Alert drill-through (?vehicle_id=…&t=…&signal=…) flows from react-router query
// params in the web app. React Native has no such URL context, so the native
// value is empty and the chart alert marker simply never renders (documented).
const NATIVE_ALERT_CONTEXT: AlertContextValue = {timestamp: null, signal: null};

function useAlertContext(): AlertContextValue {
  return NATIVE_ALERT_CONTEXT;
}

/* ── useSelectedVehicle (web @/hooks/useSelectedVehicle) ───────────────────── */

// Web composes react-router useMatch/useSearchParams over a localStorage-backed
// provider seeded to the first vehicle. Native has neither router nor that
// provider wired here, so we read the native useVehicles list and default to the
// first vehicle exactly like the web provider's seed (documented).
function useSelectedVehicle(): {vehicleId: number | null} {
  const {data} = useVehicles();
  const vehicleId = data && data.length > 0 ? data[0].id : null;
  return {vehicleId};
}

/* ── colors (web @/lib/colors COLOR / STATUS_COLORS) ──────────────────────── */

const COLOR = {
  GOOD: '#10b981',
  WARN: '#f59e0b',
  BAD: '#ef4444',
  CYAN: '#00f0ff',
  PURPLE: '#a855f7',
  MUTED: '#6b7280',
  DARK: '#374151',
} as const;

const STATUS_COLORS = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
} as const;

const METRIC_COLOR_HEX: Record<string, string> = {
  cyan: '#00f0ff',
  green: '#10b981',
  blue: '#3b82f6',
  amber: '#f59e0b',
  purple: '#a855f7',
  red: '#ef4444',
};

/* ── Width helper for percentage-based native layout ──────────────────────── */

function pct(n: number): DimensionValue {
  return `${Math.max(0, Math.min(100, n))}%` as DimensionValue;
}

/* ── Icon glyph (lucide-react → emoji, browser-only SVG replaced) ──────────── */

const GLYPH = {
  Heart: '❤️',
  Battery: '🔋',
  BatteryFull: '🔋',
  Gauge: '🎚️',
  RefreshCcw: '🔄',
  Clock: '🕐',
  Zap: '⚡',
  ArrowRight: '→',
  Lightbulb: '💡',
  AlertTriangle: '⚠️',
  CheckCircle: '✅',
  Info: 'ℹ️',
  Target: '🎯',
  Activity: '📈',
  Thermometer: '🌡️',
  ThermometerSun: '☀️',
  ThermometerSnowflake: '❄️',
  Flame: '🔥',
} as const;

function Icon({
  glyph,
  color,
  size = 16,
}: {
  glyph: string;
  color?: string;
  size?: number;
}): React.ReactElement {
  return (
    <AppText style={[{fontSize: size}, color ? {color} : null]}>{glyph}</AppText>
  );
}

/* ── GlassPanel (web @/components/ui GlassPanel) ──────────────────────────── */

function GlassPanel({
  children,
  style,
  glow,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  glow?: 'green' | 'cyan';
}): React.ReactElement {
  return (
    <View
      style={[
        styles.glassPanel,
        glow === 'green' ? styles.glowGreen : null,
        glow === 'cyan' ? styles.glowCyan : null,
        style,
      ]}>
      {children}
    </View>
  );
}

/* ── Badge (web @/components/ui Badge) ────────────────────────────────────── */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'default';

const BADGE_STYLES: Record<
  BadgeVariant,
  {bg: string; border: string; text: string}
> = {
  success: {
    bg: 'rgba(16,185,129,0.12)',
    border: 'rgba(16,185,129,0.32)',
    text: '#34d399',
  },
  warning: {
    bg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.32)',
    text: '#fbbf24',
  },
  danger: {
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.32)',
    text: '#fb7185',
  },
  default: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
};

function Badge({
  children,
  variant = 'default',
  style,
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const tone = BADGE_STYLES[variant];
  return (
    <View
      style={[
        styles.badge,
        {backgroundColor: tone.bg, borderColor: tone.border},
        style,
      ]}>
      <AppText style={[styles.badgeText, {color: tone.text}]} variant="caption">
        {children}
      </AppText>
    </View>
  );
}

/* ── Button (web @/components/ui Button) ──────────────────────────────────── */

function Button({
  children,
  onPress,
  icon,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={[styles.button, style]}>
      <AppText style={styles.buttonText} variant="caption" weight="semibold">
        {children}
      </AppText>
      {icon ? <View style={styles.buttonIcon}>{icon}</View> : null}
    </Pressable>
  );
}

/* ── MetricCard (web @/components/data-display MetricCard) ─────────────────── */

function MetricCard({
  label,
  value,
  icon,
  color = 'cyan',
  subtitle,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  color?: string;
  subtitle?: string;
}): React.ReactElement {
  return (
    <GlassPanel style={styles.metricCard}>
      <View style={styles.metricCardHeader}>
        {icon ? (
          <View
            style={[
              styles.metricCardIcon,
              {borderColor: (METRIC_COLOR_HEX[color] ?? color) + '40'},
            ]}>
            {icon}
          </View>
        ) : null}
        <AppText style={styles.metricCardLabel} tone="muted" variant="caption">
          {label}
        </AppText>
      </View>
      <AppText style={styles.metricCardValue} variant="title" weight="bold">
        {value}
      </AppText>
      {subtitle ? (
        <AppText tone="muted" variant="caption">
          {subtitle}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

/* ── MetricBar (web @/components/data-display MetricBar) ───────────────────── */

function MetricBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}): React.ReactElement {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View>
      <View style={styles.metricBarHead}>
        <AppText tone="secondary" variant="caption">
          {label}
        </AppText>
        <AppText variant="caption" weight="semibold">
          {fmtNumber(value, Number.isInteger(value) ? 0 : 1)}
        </AppText>
      </View>
      <View style={styles.metricBarTrack}>
        <View
          style={[
            styles.metricBarFill,
            {backgroundColor: color, width: pct(ratio * 100)},
          ]}
        />
      </View>
    </View>
  );
}

/* ── LiveIndicator (web @/components/data-display LiveIndicator) ───────────── */

function LiveIndicator(): React.ReactElement {
  return (
    <View style={styles.liveChip}>
      <View style={styles.liveDot} />
      <AppText style={styles.liveText} variant="caption" weight="semibold">
        Live
      </AppText>
    </View>
  );
}

/* ── EmptyState (web @/components/feedback EmptyState) ─────────────────────── */

function EmptyState({
  icon,
  message,
  style,
}: {
  icon?: React.ReactNode;
  message: string;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return (
    <View style={[styles.emptyState, style]}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyText} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ── Skeleton (web @/components/feedback Skeleton) ────────────────────────── */

function Skeleton({
  height = 56,
  style,
}: {
  height?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return <View style={[styles.skeleton, {height}, style]} />;
}

/* ── LiveStaleDataBanner (web @/components/feedback) — context not wired ───── */

function LiveStaleDataBanner(): React.ReactElement | null {
  // The web banner reads a global live-staleness context to surface a warning
  // when streamed values go stale. That context is not wired into this native
  // parity page, so the banner renders nothing (documented in the sidecar).
  return null;
}

/* ── FadeIn (web @/components/motion FadeIn) — no RN entrance animation ────── */

function FadeIn({
  children,
}: {
  children: React.ReactNode;
  delay?: number;
}): React.ReactElement {
  // The web FadeIn is a framer-motion entrance animation. React Native has no
  // drop-in equivalent in this parity layer, so this is a passthrough; the
  // `delay` prop is accepted and ignored to preserve every call site.
  return <View style={styles.fadeIn}>{children}</View>;
}

/* ── SectionErrorBoundary (web @/components/feedback SectionErrorBoundary) ─── */

interface SectionErrorBoundaryProps {
  name: string;
  fallbackTitle: string;
  children: React.ReactNode;
}
interface SectionErrorBoundaryState {
  hasError: boolean;
}

class SectionErrorBoundary extends React.Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = {hasError: false};

  static getDerivedStateFromError(): SectionErrorBoundaryState {
    return {hasError: true};
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <GlassPanel style={styles.sectionError}>
          <AppText tone="danger" variant="caption" weight="semibold">
            {this.props.fallbackTitle}
          </AppText>
        </GlassPanel>
      );
    }
    return this.props.children;
  }
}

/* ── Grid (web @/components/layout Grid) — uses cols.default columns ───────── */

function Grid({
  cols,
  gap = 12,
  children,
}: {
  cols: {default: number; md?: number; lg?: number};
  gap?: number;
  children: React.ReactNode;
}): React.ReactElement {
  const count = Math.max(1, cols.default);
  const basis = pct(100 / count);
  return (
    <View style={[styles.gridRow, {marginHorizontal: -(gap / 2)}]}>
      {React.Children.map(children, child => (
        <View
          style={{
            flexBasis: basis,
            maxWidth: basis,
            paddingHorizontal: gap / 2,
            marginBottom: gap,
          }}>
          {child}
        </View>
      ))}
    </View>
  );
}

/* ── PageContainer (web @/components/layout PageContainer) ────────────────── */

function PageContainer({
  title,
  subtitle,
  actions,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  error?: Error | null;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      style={styles.pageRoot}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="secondary">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      {error ? (
        <GlassPanel style={styles.errorBanner}>
          <AppText tone="danger" variant="caption" weight="semibold">
            {error.message}
          </AppText>
        </GlassPanel>
      ) : null}
      {children}
    </ScrollView>
  );
}

/* ── VehicleSelect (web @/components/forms VehicleSelect) ─────────────────── */

function VehicleSelect(): React.ReactElement {
  const {data} = useVehicles();
  const current = data && data.length > 0 ? data[0] : null;
  // Read-only chip: there is no RN router/dropdown picker wired in this parity
  // page, so the active vehicle (first of the native list) is shown statically.
  return (
    <View style={styles.vehicleSelect}>
      <AppText variant="caption">🚗</AppText>
      <AppText style={styles.vehicleSelectText} variant="caption" weight="semibold">
        {current?.display_name ?? '—'}
      </AppText>
    </View>
  );
}

/* ── NoVehicleSelected (web features/onboarding NoVehicleSelected) ─────────── */

function NoVehicleSelected({pageTitle}: {pageTitle: string}): React.ReactElement {
  const {t} = useTranslation();
  return (
    <PageContainer title={pageTitle}>
      <GlassPanel style={styles.noVehicle}>
        <Icon glyph={GLYPH.Battery} size={36} />
        <AppText style={styles.noVehicleText} tone="muted">
          {t('onboarding.noVehicle', 'Select a vehicle to view this page.')}
        </AppText>
      </GlassPanel>
    </PageContainer>
  );
}

/* ── Native chart renderers (recharts SVG → RN bars) ──────────────────────── */

interface MiniBarPoint {
  label: string;
  value: number;
  color: string;
}

/**
 * Vertical-bar mini chart (replaces the recharts Area/Composed line plots). Bars
 * are scaled to [domainMin, domainMax] (or auto when omitted); x labels are
 * thinned to first/middle/last for legibility on a phone width.
 */
function MiniBars({
  points,
  domainMin,
  domainMax,
}: {
  points: MiniBarPoint[];
  domainMin?: number;
  domainMax?: number;
}): React.ReactElement {
  const values = points.map(p => p.value);
  const lo = domainMin ?? Math.min(...values, 0);
  const hi = domainMax ?? Math.max(...values, 1);
  const span = hi - lo || 1;
  const labelEvery = Math.max(1, Math.floor(points.length / 4));
  return (
    <View>
      <View style={styles.miniBars}>
        {points.map((p, i) => {
          const h = Math.max(4, ((p.value - lo) / span) * 100);
          return (
            <View key={`${p.label}-${i}`} style={styles.miniBarCol}>
              <View style={styles.miniBarTrack}>
                <View
                  style={[
                    styles.miniBarFill,
                    {backgroundColor: p.color, height: pct(h)},
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.miniBarAxis}>
        {points.map((p, i) => (
          <AppText
            key={`lbl-${p.label}-${i}`}
            numberOfLines={1}
            style={styles.miniBarAxisLabel}
            tone="muted"
            variant="caption">
            {i % labelEvery === 0 ? p.label : ''}
          </AppText>
        ))}
      </View>
    </View>
  );
}

interface GroupedBarRow {
  label: string;
  a: number;
  b: number;
}

/** Grouped vertical bars (replaces the recharts grouped BarChart). */
function GroupedBars({
  rows,
  colorA,
  colorB,
}: {
  rows: GroupedBarRow[];
  colorA: string;
  colorB: string;
}): React.ReactElement {
  const max = Math.max(1, ...rows.map(r => Math.max(r.a, r.b)));
  return (
    <View style={styles.miniBars}>
      {rows.map((r, i) => (
        <View key={`${r.label}-${i}`} style={styles.groupCol}>
          <View style={styles.groupBars}>
            <View
              style={[
                styles.groupBar,
                {backgroundColor: colorA, height: pct((r.a / max) * 100)},
              ]}
            />
            <View
              style={[
                styles.groupBar,
                {backgroundColor: colorB, height: pct((r.b / max) * 100)},
              ]}
            />
          </View>
          <AppText
            numberOfLines={1}
            style={styles.groupLabel}
            tone="muted"
            variant="caption">
            {r.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** Proportional horizontal split bar (replaces the recharts AC/DC PieChart). */
function SplitBar({
  segments,
}: {
  segments: {name: string; value: number; fill: string}[];
}): React.ReactElement {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0) || 1;
  return (
    <View>
      <View style={styles.splitBar}>
        {segments.map(s => (
          <View
            key={s.name}
            style={[
              styles.splitSegment,
              {
                width: pct((Math.max(0, s.value) / total) * 100),
                backgroundColor: s.fill,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.legendRow}>
        {segments.map(s => (
          <View key={`leg-${s.name}`} style={styles.legendItem}>
            <View style={[styles.legendSwatch, {backgroundColor: s.fill}]} />
            <AppText tone="secondary" variant="caption">
              {s.name} · {fmtNumber(s.value, 1)} kWh
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Two-swatch legend used beneath the trend/grouped charts. */
function ChartLegend({
  items,
}: {
  items: {label: string; color: string}[];
}): React.ReactElement {
  return (
    <View style={styles.legendRow}>
      {items.map(it => (
        <View key={it.label} style={styles.legendItem}>
          <View style={[styles.legendSwatch, {backgroundColor: it.color}]} />
          <AppText tone="secondary" variant="caption">
            {it.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/* ── Helpers (ported verbatim from web) ───────────────────────────────────── */

interface InsightItem {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: 'good' | 'warning' | 'critical';
}

const insightPanelStyle: Record<
  InsightItem['status'],
  {borderColor: string; backgroundColor: string}
> = {
  good: {borderColor: 'rgba(16,185,129,0.20)', backgroundColor: 'rgba(16,185,129,0.05)'},
  warning: {borderColor: 'rgba(245,158,11,0.20)', backgroundColor: 'rgba(245,158,11,0.05)'},
  critical: {borderColor: 'rgba(239,68,68,0.20)', backgroundColor: 'rgba(239,68,68,0.05)'},
};

const insightIconColor: Record<InsightItem['status'], string> = {
  good: '#6ee7b7',
  warning: '#fcd34d',
  critical: '#fda4af',
};

function gaugeColor(score: number): string {
  if (score >= 90) {
    return CHART_COLORS[1];
  }
  if (score >= 70) {
    return CHART_COLORS[3];
  }
  return CHART_COLORS[5];
}

function healthVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 90) {
    return 'success';
  }
  if (score >= 70) {
    return 'warning';
  }
  return 'danger';
}

function healthLabel(score: number, t: NativeT): string {
  if (score >= 90) {
    return t('battery.health.excellent', 'Excellent');
  }
  if (score >= 70) {
    return t('battery.health.good', 'Good');
  }
  return t('battery.health.degraded', 'Degraded');
}

function degradationColor(pct2: number): string {
  if (pct2 <= 5) {
    return '#10b981';
  }
  if (pct2 <= 15) {
    return '#f59e0b';
  }
  return '#ef4444';
}

function buildInsights(
  health: BatteryHealthAnalytics,
  sessions: ApiChargingSession[] | null,
  t: NativeT,
): InsightItem[] {
  const items: InsightItem[] = [];

  if (health.current_soh >= 90) {
    items.push({
      icon: <Icon glyph={GLYPH.CheckCircle} size={14} />,
      title: t('battery.insight.excellentTitle', 'Excellent Health'),
      description: t('battery.insight.excellentDesc', {
        soh: fmtNumber(health.current_soh, 0),
        defaultValue:
          'Battery health is {{soh}}/100 — performing above average.',
      }),
      status: 'good',
    });
  } else if (health.current_soh >= 70) {
    items.push({
      icon: <Icon glyph={GLYPH.Info} size={14} />,
      title: t('battery.insight.goodTitle', 'Good Health'),
      description: t('battery.insight.goodDesc', {
        soh: fmtNumber(health.current_soh, 0),
        defaultValue: 'Battery health is {{soh}}/100 — normal degradation for age.',
      }),
      status: 'warning',
    });
  } else {
    items.push({
      icon: <Icon glyph={GLYPH.AlertTriangle} size={14} />,
      title: t('battery.insight.concernTitle', 'Health Concern'),
      description: t('battery.insight.concernDesc', {
        soh: fmtNumber(health.current_soh, 0),
        defaultValue:
          'Battery health dropped to {{soh}}/100 — consider service check.',
      }),
      status: 'critical',
    });
  }

  if (health.fast_charge_pct > 50) {
    items.push({
      icon: <Icon glyph={GLYPH.AlertTriangle} size={14} />,
      title: t('battery.insight.highFastChargeTitle', 'High Fast-Charge Usage'),
      description: t('battery.insight.highFastChargeDesc', {
        pct: fmtPercent(health.fast_charge_pct),
        defaultValue:
          '{{pct}} of sessions are fast-charging. Mix in slow charging for longevity.',
      }),
      status: 'warning',
    });
  } else {
    items.push({
      icon: <Icon glyph={GLYPH.CheckCircle} size={14} />,
      title: t('battery.insight.goodHabitsTitle', 'Good Charging Habits'),
      description: t(
        'battery.insight.goodHabitsDesc',
        'Most charges are slow/AC — ideal for battery longevity.',
      ),
      status: 'good',
    });
  }

  if (sessions) {
    const deepDischarges = sessions.filter(s => s.start_soc_pct < 10).length;
    if (deepDischarges > 3) {
      items.push({
        icon: <Icon glyph={GLYPH.AlertTriangle} size={14} />,
        title: t('battery.insight.deepDischargeTitle', 'Deep Discharges Detected'),
        description: t('battery.insight.deepDischargeDesc', {
          count: deepDischarges,
          defaultValue:
            '{{count}} recent sessions started below 10%. Avoid deep discharges when possible.',
        }),
        status: 'warning',
      });
    }

    const superchargerCount = sessions.filter(s =>
      s.charger_type?.toLowerCase().includes('tesla'),
    ).length;
    if (superchargerCount > sessions.length * 0.6) {
      items.push({
        icon: <Icon glyph={GLYPH.Info} size={14} />,
        title: t('battery.insight.highSuperchargerTitle', 'High Supercharger Usage'),
        description: t('battery.insight.highSuperchargerDesc', {
          count: superchargerCount,
          defaultValue:
            '{{count}} Supercharger sessions. Occasional slow charging helps battery health.',
        }),
        status: 'warning',
      });
    }
  }

  if (health.degradation_rate_yr < 3) {
    items.push({
      icon: <Icon glyph={GLYPH.Target} size={14} />,
      title: t('battery.insight.lowDegTitle', 'Low Degradation Rate'),
      description: t('battery.insight.lowDegDesc', {
        rate: fmtNumber(health.degradation_rate_yr, 1),
        defaultValue: '{{rate}}% per year — well below industry average of 3–5%.',
      }),
      status: 'good',
    });
  }

  return items;
}

function buildRecommendations(
  health: BatteryHealthAnalytics,
  t: NativeT,
): string[] {
  const tips: string[] = [];
  if (health.fast_charge_pct > 30) {
    tips.push(
      t('battery.tip.reduceFast', 'Reduce fast charging frequency to slow degradation.'),
    );
  }
  if (health.full_charge_pct > 40) {
    tips.push(
      t(
        'battery.tip.avoid100',
        'Avoid charging to 100% regularly — keep the limit at 80–90%.',
      ),
    );
  }
  if (health.avg_depth_of_discharge > 70) {
    tips.push(t('battery.tip.avoidDeep', 'Try to avoid deep discharges below 20%.'));
  }
  if (health.degradation_rate_yr > 3) {
    tips.push(
      t(
        'battery.tip.aboveAvg',
        'Your degradation rate is above average — review charging habits.',
      ),
    );
  }
  if (tips.length === 0) {
    tips.push(
      t('battery.tip.great', 'Your battery health looks great — keep up the good habits!'),
    );
  }
  return tips;
}

const QUICK_LINKS: {to: string; labelKey: string; fallback: string}[] = [
  {to: '/battery-cells', labelKey: 'battery.links.cells', fallback: 'Battery Cells'},
  {to: '/battery-degradation', labelKey: 'battery.links.degradation', fallback: 'Degradation'},
  {to: '/energy-flow', labelKey: 'battery.links.energyFlow', fallback: 'Energy Flow'},
  {to: '/projected-range', labelKey: 'battery.links.projectedRange', fallback: 'Projected Range'},
  {to: '/vampire-drain', labelKey: 'battery.links.vampireDrain', fallback: 'Vampire Drain'},
  {to: '/sleep-efficiency', labelKey: 'battery.links.sleepEfficiency', fallback: 'Sleep Efficiency'},
];

/* ── Loading skeleton (mirrors the page layout) ──────────────────────────── */

function BatteryHealthSkeleton(): React.ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      style={styles.pageRoot}
      testID="battery-health-skeleton">
      <Skeleton height={48} />
      <Grid cols={{default: 3}} gap={12}>
        {Array.from({length: 6}, (_, i) => (
          <Skeleton key={`s1-${i}`} height={72} />
        ))}
      </Grid>
      <Skeleton height={300} />
      <Grid cols={{default: 2}} gap={12}>
        <Skeleton height={200} />
        <Skeleton height={200} />
      </Grid>
      <Skeleton height={260} />
      <Grid cols={{default: 3}} gap={12}>
        {Array.from({length: 6}, (_, i) => (
          <Skeleton key={`s2-${i}`} height={72} />
        ))}
      </Grid>
    </ScrollView>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function BatteryHealthPage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('battery.title', 'Battery Health'));
  const {unitPrefs} = useUnits();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;
  // Backend analytics `range_km` is genuinely km (derived SI). Route km → metres
  // then through `convertDistanceFromSI` so the legacy helper isn't mixed with km.
  const fromKm = useCallback(
    (km: number): number =>
      convertDistanceFromSI(km * 1000, unitPrefs.distance),
    [unitPrefs.distance],
  );

  // Vehicle selector: header picker is the source of truth (native: first vehicle).
  const alertCtx = useAlertContext();
  const {vehicleId} = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;

  const alertMarkerLabel = useMemo(
    () => (alertCtx.timestamp ? formatDateShort(alertCtx.timestamp) : null),
    [alertCtx.timestamp],
  );

  // Data fetching.
  const {
    data: health,
    isLoading: healthLoading,
    error: healthError,
  } = useBatteryHealthAnalytics(vehicleIdStr);
  const {data: degradation} = useBatteryDegradation(vehicleIdStr);
  const {data: sessions} = useChargingSessionsPaginated(vehicleId, {limit: 100});
  const {data: chargingLive} = useChargingTelemetryLatest(vehicleId ?? 0);

  // Derived: insights & recommendations.
  const insights = useMemo(
    () => (health ? buildInsights(health, sessions ?? null, t) : []),
    [health, sessions, t],
  );
  const recommendations = useMemo(
    () => (health ? buildRecommendations(health, t) : []),
    [health, t],
  );

  // Derived: degradation projection sanity (reject absurd regression slopes).
  const projectionTrustworthy = useMemo(() => {
    const pred = degradation?.prediction;
    if (!pred?.has_enough_data) {
      return false;
    }
    const slope = Math.abs(pred.slope_per_year ?? 0);
    if (!Number.isFinite(slope) || slope > 50) {
      return false;
    }
    const yrs = pred.years_to_80_pct;
    if (yrs == null || !Number.isFinite(yrs) || yrs <= 0) {
      return false;
    }
    return true;
  }, [degradation]);

  // Derived: prediction chart.
  const predictionChartData = useMemo(() => {
    const hist = (health?.history ?? []).map(h => ({
      label: formatDateShort(h.date),
      actual: h.soh_pct as number | undefined,
      predicted: undefined as number | undefined,
    }));
    const proj = projectionTrustworthy
      ? (degradation?.prediction?.projection_points ?? []).map(p => ({
          label: p.month.slice(0, 7),
          actual: undefined as number | undefined,
          predicted: p.health as number | undefined,
        }))
      : [];
    if (hist.length > 0 && proj.length > 0) {
      proj[0] = {...proj[0], actual: hist[hist.length - 1].actual};
    }
    return [...hist, ...proj];
  }, [health, degradation, projectionTrustworthy]);

  // Derived: range trend.
  const rangeTrend = useMemo(() => {
    const points = (health?.history ?? []).map(h => ({
      label: formatDateShort(h.date),
      range: Math.round(fromKm(h.range_km)),
    }));
    if (points.length === 0 || points.every(p => p.range <= 0)) {
      return [];
    }
    return points;
  }, [health, fromKm]);

  // Derived: charge level distribution.
  const chargeLevelDist = useMemo(() => {
    const items = sessions ?? [];
    if (items.length === 0) {
      return [];
    }
    const buckets = Array.from({length: 10}, (_, i) => ({
      range: `${i * 10}–${i * 10 + 10}%`,
      startCount: 0,
      endCount: 0,
    }));
    items.forEach(s => {
      const si = Math.min(Math.floor(s.start_soc_pct / 10), 9);
      buckets[si].startCount++;
      if (s.end_soc_pct != null) {
        const ei = Math.min(Math.floor(s.end_soc_pct / 10), 9);
        buckets[ei].endCount++;
      }
    });
    return buckets;
  }, [sessions]);

  // Derived: charging habits from sessions.
  const chargingHabits = useMemo(() => {
    const items = sessions ?? [];
    if (items.length === 0) {
      return null;
    }
    const startLevels = items.map(s => s.start_soc_pct);
    const endLevels = items
      .filter(s => s.end_soc_pct != null)
      .map(s => s.end_soc_pct as number);
    const avgStart =
      startLevels.length > 0
        ? startLevels.reduce((a, b) => a + b, 0) / startLevels.length
        : 0;
    const avgEnd =
      endLevels.length > 0
        ? endLevels.reduce((a, b) => a + b, 0) / endLevels.length
        : 80;
    const superchargerCount = items.filter(s =>
      s.charger_type?.toLowerCase().includes('tesla'),
    ).length;
    const dcFastCount = items.filter(
      s => s.charger_type && !s.charger_type.toLowerCase().includes('tesla'),
    ).length;
    return {avgStart, avgEnd, superchargerCount, dcFastCount, total: items.length};
  }, [sessions]);

  // Derived: AC/DC breakdown.
  const energyBreakdown = useMemo(() => {
    const items = sessions ?? [];
    if (items.length === 0) {
      return null;
    }
    let acEnergy = 0;
    let dcEnergy = 0;
    let acCount = 0;
    let dcCount = 0;
    items.forEach(s => {
      const isDC =
        (s.charger_type != null && s.charger_type.length > 0) ||
        (s.peak_power_w != null && s.peak_power_w > 20_000);
      const energy = convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh');
      if (isDC) {
        dcEnergy += energy;
        dcCount++;
      } else {
        acEnergy += energy;
        acCount++;
      }
    });
    return {
      pieData: [
        {name: 'AC', value: +fmtNumber(acEnergy, 1), fill: '#10b981'},
        {name: 'DC', value: +fmtNumber(dcEnergy, 1), fill: '#f59e0b'},
      ],
      acCount,
      dcCount,
      totalEnergy: acEnergy + dcEnergy,
      totalSessions: items.length,
    };
  }, [sessions]);

  const yearsTo80 = projectionTrustworthy
    ? fmtNumber(degradation?.prediction?.years_to_80_pct, 1)
    : '—';

  // No vehicle: defensive guard.
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('battery.title', 'Battery Health')} />;
  }

  // Loading.
  if (healthLoading) {
    return <BatteryHealthSkeleton />;
  }

  // Empty / error.
  if (!health) {
    return (
      <PageContainer
        title={t('battery.title', 'Battery Health')}
        subtitle={t(
          'battery.subtitle',
          'Degradation tracking, prediction, charging habits & longevity insights',
        )}
        error={(healthError as Error | null) ?? null}>
        <EmptyState
          icon={<Icon glyph={GLYPH.Battery} size={36} />}
          message={t('battery.empty', 'No battery health data available yet.')}
        />
      </PageContainer>
    );
  }

  const capacityRatio =
    health.original_capacity > 0
      ? Math.max(
          0,
          Math.min(100, (health.estimated_capacity / health.original_capacity) * 100),
        )
      : 0;

  // Main render.
  return (
    <PageContainer
      title={t('battery.title', 'Battery Health')}
      subtitle={t(
        'battery.subtitle',
        'Degradation tracking, prediction, charging habits & longevity insights',
      )}
      actions={
        <View style={styles.headerActions}>
          <VehicleSelect />
          <LiveIndicator />
        </View>
      }>
      <LiveStaleDataBanner />
      {/* AI battery-health forecast narrator. */}
      <FadeIn>
        <AIBatteryHealthForecastNarrative vehicleId={vehicleId ?? undefined} />
      </FadeIn>

      {/* ── 1. Health Score Hero ─────────────────────────────────────────── */}
      <SectionErrorBoundary
        name="battery:health-hero"
        fallbackTitle={t('battery.section.heroFailed', 'Health score panel failed to load')}>
        <FadeIn>
          <GlassPanel style={styles.heroPanel}>
            <View style={styles.heroRow}>
              <View style={styles.heroGaugeCell}>
                <RadialGauge
                  value={health.current_soh}
                  max={100}
                  label={t('battery.gauge.health', 'Health Score')}
                  unit="/100"
                  size={130}
                  color={gaugeColor(health.current_soh)}
                />
                <Badge variant={healthVariant(health.current_soh)} style={styles.heroBadge}>
                  {healthLabel(health.current_soh, t)}
                </Badge>
              </View>
              <View style={styles.heroGaugeCell}>
                <RadialGauge
                  value={capacityRatio}
                  max={100}
                  label={t('battery.gauge.capacity', 'Capacity')}
                  unit="%"
                  color="#00f0ff"
                />
              </View>
              <View style={styles.heroGaugeCell}>
                <RadialGauge
                  value={health.degradation_rate_yr}
                  max={10}
                  label={t('battery.gauge.degradation', 'Degradation')}
                  unit="%/yr"
                  color={degradationColor(health.degradation_rate_yr)}
                />
              </View>
              <View style={styles.heroGaugeCell}>
                <RadialGauge
                  value={health.total_cycles}
                  max={1500}
                  label={t('battery.gauge.cycles', 'Cycles')}
                  unit=""
                  color="#a855f7"
                />
              </View>
              <View style={styles.heroGaugeCell}>
                <AppText variant="display" weight="bold">
                  {yearsTo80}
                </AppText>
                <AppText style={styles.heroCaption} tone="muted" variant="caption">
                  {t('battery.yearsTo80', 'Years to 80%')}
                </AppText>
                <AppText tone="muted" variant="caption">
                  {t('battery.warrantyNote', 'warranty threshold')}
                </AppText>
              </View>
            </View>
          </GlassPanel>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 2. Metric Bars ───────────────────────────────────────────────── */}
      <SectionErrorBoundary
        name="battery:metric-bars"
        fallbackTitle={t('battery.section.metricBarsFailed', 'Metric bars failed to load')}>
        <FadeIn delay={0.05}>
          <GlassPanel style={styles.panel}>
            <Grid cols={{default: 1, md: 3}} gap={16}>
              <View>
                <MetricBar
                  label={t('battery.bar.capacity', 'Current Capacity')}
                  value={Math.round(
                    (health.estimated_capacity / health.original_capacity) * 100,
                  )}
                  max={100}
                  color="#00f0ff"
                />
                <AppText style={styles.barCaption} tone="muted" variant="caption">
                  {fmtNumber(health.estimated_capacity, 1)} /{' '}
                  {fmtNumber(health.original_capacity, 1)} kWh
                </AppText>
              </View>
              <View>
                <MetricBar
                  label={t('battery.bar.degradation', 'Degradation')}
                  value={health.degradation_rate_yr}
                  max={10}
                  color={degradationColor(health.degradation_rate_yr)}
                />
                <AppText style={styles.barCaption} tone="muted" variant="caption">
                  {fmtNumber(health.degradation_rate_yr, 2)}%{' '}
                  {t('battery.perYear', 'per year')}
                </AppText>
              </View>
              <View>
                <MetricBar
                  label={t('battery.bar.cycles', 'Charge Cycles')}
                  value={health.total_cycles}
                  max={1500}
                  color="#a855f7"
                />
                <AppText style={styles.barCaption} tone="muted" variant="caption">
                  {t('battery.warrantyLimit', 'Tesla warranty: 1,500 cycles / 70%')}
                </AppText>
              </View>
            </Grid>
          </GlassPanel>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 3. Summary Metric Cards ──────────────────────────────────────── */}
      <SectionErrorBoundary
        name="battery:summary-cards"
        fallbackTitle={t('battery.section.summaryCardsFailed', 'Summary metrics failed to load')}>
        <FadeIn delay={0.1}>
          <Grid cols={{default: 2, lg: 3}} gap={12}>
            <MetricCard
              label={t('battery.metric.soh', 'State of Health')}
              value={fmtPercent(health.current_soh)}
              icon={<Icon glyph={GLYPH.Heart} size={18} />}
              color="cyan"
            />
            <MetricCard
              label={t('battery.metric.currentCap', 'Current Capacity')}
              value={`${fmtNumber(health.estimated_capacity, 1)} kWh`}
              icon={<Icon glyph={GLYPH.Battery} size={18} />}
              color="green"
            />
            <MetricCard
              label={t('battery.metric.originalCap', 'Original Capacity')}
              value={`${fmtNumber(health.original_capacity, 1)} kWh`}
              icon={<Icon glyph={GLYPH.BatteryFull} size={18} />}
              color="blue"
            />
            <MetricCard
              label={t('battery.metric.degradation', 'Degradation Rate')}
              value={`${fmtNumber(health.degradation_rate_yr, 2)}%/${t('battery.yr', 'yr')}`}
              icon={<Icon glyph={GLYPH.Gauge} size={18} />}
              color="amber"
            />
            <MetricCard
              label={t('battery.metric.cycles', 'Total Cycles')}
              value={fmtNumber(health.total_cycles, 0)}
              icon={<Icon glyph={GLYPH.RefreshCcw} size={18} />}
              color="purple"
            />
            <MetricCard
              label={t('battery.metric.age', 'Battery Age')}
              value={
                health.battery_age_months > 0
                  ? `${health.battery_age_months} ${t('battery.months', 'months')}`
                  : '—'
              }
              icon={<Icon glyph={GLYPH.Clock} size={18} />}
              color="red"
            />
            <MetricCard
              label={t('battery.metric.fullChargeComplete', 'Full Charge Complete')}
              value={
                chargingLive?.bms_fullcharge_complete == null
                  ? '—'
                  : chargingLive.bms_fullcharge_complete
                    ? t('common.yes', 'Yes')
                    : t('common.no', 'No')
              }
              icon={<Icon glyph={GLYPH.CheckCircle} size={18} />}
              color={chargingLive?.bms_fullcharge_complete ? 'green' : 'cyan'}
            />
          </Grid>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 3b. Thermal Monitoring ───────────────────────────────────────── */}
      <SectionErrorBoundary
        name="battery:thermal"
        fallbackTitle={t('battery.section.thermalFailed', 'Thermal monitoring failed to load')}>
        <FadeIn delay={0.12}>
          <GlassPanel style={styles.panel}>
            <View style={styles.sectionTitleRow}>
              <Icon glyph={GLYPH.Thermometer} color="#f59e0b" size={16} />
              <AppText variant="body" weight="semibold">
                {t('battery.thermal.title', 'Thermal Monitoring')}
              </AppText>
            </View>
            <Grid cols={{default: 2, lg: 4}} gap={12}>
              <MetricCard
                label={t('battery.thermal.moduleTempMax', 'Module Temp (Max)')}
                value={
                  chargingLive?.module_temp_max != null
                    ? `${fmtNumber(toTemperatureDisplay(chargingLive.module_temp_max), 1)} ${tempUnit}`
                    : '—'
                }
                subtitle={
                  chargingLive?.num_module_temp_max != null
                    ? t('battery.thermal.moduleNumber', 'Module #{{n}}', {
                        n: chargingLive.num_module_temp_max,
                      })
                    : undefined
                }
                icon={<Icon glyph={GLYPH.ThermometerSun} size={18} />}
                color="amber"
              />
              <MetricCard
                label={t('battery.thermal.moduleTempMin', 'Module Temp (Min)')}
                value={
                  chargingLive?.module_temp_min != null
                    ? `${fmtNumber(toTemperatureDisplay(chargingLive.module_temp_min), 1)} ${tempUnit}`
                    : '—'
                }
                subtitle={
                  chargingLive?.num_module_temp_min != null
                    ? t('battery.thermal.moduleNumber', 'Module #{{n}}', {
                        n: chargingLive.num_module_temp_min,
                      })
                    : undefined
                }
                icon={<Icon glyph={GLYPH.ThermometerSnowflake} size={18} />}
                color="cyan"
              />
              <MetricCard
                label={t('battery.thermal.heater', 'Battery Heater')}
                value={
                  chargingLive?.battery_heater_on == null
                    ? '—'
                    : chargingLive.battery_heater_on
                      ? t('common.on', 'On')
                      : t('common.off', 'Off')
                }
                icon={<Icon glyph={GLYPH.Flame} size={18} />}
                color={chargingLive?.battery_heater_on ? 'red' : 'green'}
              />
              <MetricCard
                label={t('battery.thermal.tempSpread', 'Temperature Spread')}
                value={
                  chargingLive?.module_temp_max != null &&
                  chargingLive?.module_temp_min != null
                    ? `${fmtNumber(
                        toTemperatureDisplay(chargingLive.module_temp_max) -
                          toTemperatureDisplay(chargingLive.module_temp_min),
                        1,
                      )} ${tempUnit}`
                    : '—'
                }
                icon={<Icon glyph={GLYPH.Activity} size={18} />}
                color="purple"
              />
            </Grid>
          </GlassPanel>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 4. Smart Insights ────────────────────────────────────────────── */}
      <SectionErrorBoundary
        name="battery:insights"
        fallbackTitle={t('battery.section.insightsFailed', 'Smart insights failed to load')}>
        <FadeIn delay={0.15}>
          <View style={styles.insightsBlock}>
            <View style={styles.sectionTitleRow}>
              <Icon glyph={GLYPH.Heart} color="#ef4444" size={16} />
              <AppText variant="body" weight="semibold">
                {t('battery.insights.title', 'Smart Insights')}
              </AppText>
            </View>
            {insights.length > 0 ? (
              <Grid cols={{default: 1, md: 2}} gap={12}>
                {insights.map((ins, i) => (
                  <GlassPanel
                    key={`ins-${i}`}
                    style={[styles.insightCard, insightPanelStyle[ins.status]]}>
                    <View style={styles.insightRow}>
                      <View style={styles.insightIcon}>
                        <AppText style={{color: insightIconColor[ins.status]}}>
                          {ins.icon}
                        </AppText>
                      </View>
                      <View style={styles.insightTextCol}>
                        <AppText variant="caption" weight="semibold">
                          {ins.title}
                        </AppText>
                        <AppText style={styles.insightDesc} tone="secondary" variant="caption">
                          {ins.description}
                        </AppText>
                      </View>
                    </View>
                  </GlassPanel>
                ))}
              </Grid>
            ) : (
              <EmptyState
                icon={<Icon glyph={GLYPH.Info} size={28} />}
                message={t('battery.insights.empty', 'Not enough data for insights yet')}
              />
            )}
          </View>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 5. Capacity Trend & Prediction ───────────────────────────────── */}
      <FadeIn delay={0.2}>
        <ChartContainer
          title={t('battery.chart.capacityTrend', 'Capacity Trend & Prediction')}
          subtitle={t('battery.chart.dashedProjected', 'Dashed = projected')}
          ariaLabel={t(
            'battery.chart.capacityTrend.aria',
            'Battery capacity trend with dashed projection line over time',
          )}
          exportable
          exportFilename="capacity-trend">
          {predictionChartData.length > 0 ? (
            <View style={styles.chartBody}>
              <MiniBars
                domainMax={100}
                domainMin={60}
                points={predictionChartData.map(d => ({
                  label: d.label,
                  value: d.actual ?? d.predicted ?? 0,
                  color: d.actual != null ? COLOR.CYAN : 'rgba(0,240,255,0.4)',
                }))}
              />
              <ChartLegend
                items={[
                  {label: t('battery.chart.actual', 'Actual %'), color: COLOR.CYAN},
                  {
                    label: t('battery.chart.predicted', 'Predicted %'),
                    color: 'rgba(0,240,255,0.4)',
                  },
                ]}
              />
              <ChartLegend
                items={[
                  {
                    label: t('battery.chart.warnThreshold', '80% warranty warning'),
                    color: STATUS_COLORS.warning,
                  },
                  {
                    label: t('battery.chart.critThreshold', '70% warranty limit'),
                    color: STATUS_COLORS.critical,
                  },
                ]}
              />
              {alertMarkerLabel ? (
                <AppText style={styles.thresholdNote} tone="muted" variant="caption">
                  {t('battery.chart.alertAt', 'Alert at')} {alertMarkerLabel}
                </AppText>
              ) : null}
            </View>
          ) : (
            <EmptyState
              icon={<Icon glyph={GLYPH.Activity} size={28} />}
              message={t('battery.chart.noTrend', 'Not enough snapshots for trend analysis')}
            />
          )}
        </ChartContainer>
      </FadeIn>

      {/* ── 6. Range Trend ───────────────────────────────────────────────── */}
      <FadeIn delay={0.25}>
        <ChartContainer
          title={t('battery.chart.rangeTrend', 'Estimated Range Over Time')}
          ariaLabel={t(
            'battery.chart.rangeTrend.aria',
            'Estimated battery range over time area chart',
          )}
          exportable
          exportFilename="range-trend"
          annotations={{vehicleId, scope: 'battery', chartId: 'battery-health-range-trend'}}>
          {rangeTrend.length > 0 ? (
            <View style={styles.chartBody}>
              <MiniBars
                points={rangeTrend.map(p => ({
                  label: p.label,
                  value: p.range,
                  color: COLOR.GOOD,
                }))}
              />
              <ChartLegend
                items={[
                  {
                    label: `${t('battery.chart.range', 'Range')} (${unitPrefs.distance})`,
                    color: COLOR.GOOD,
                  },
                ]}
              />
            </View>
          ) : (
            <EmptyState
              icon={<Icon glyph={GLYPH.Activity} size={28} />}
              message={t('battery.chart.noRange', 'No range data yet')}
            />
          )}
        </ChartContainer>
      </FadeIn>

      {/* ── 7. Charge Level Distribution ─────────────────────────────────── */}
      <SectionErrorBoundary
        name="battery:charge-level-dist"
        fallbackTitle={t('battery.section.chargeDistFailed', 'Charge level distribution failed to load')}>
        <FadeIn delay={0.3}>
          <GlassPanel style={styles.panel}>
            <View style={styles.sectionTitleRow}>
              <Icon glyph={GLYPH.Zap} color="#f59e0b" size={16} />
              <AppText variant="body" weight="semibold">
                {t('battery.chart.chargeDist', 'Charge Level Distribution')}
              </AppText>
              <AppText tone="muted" variant="caption">
                {t('battery.chart.chargeDistSub', 'Recent 100 sessions')}
              </AppText>
            </View>
            {chargeLevelDist.length > 0 ? (
              <>
                <View style={styles.chartBody}>
                  <GroupedBars
                    colorA="#ef4444"
                    colorB="#10b981"
                    rows={chargeLevelDist.map(b => ({
                      label: b.range,
                      a: b.startCount,
                      b: b.endCount,
                    }))}
                  />
                  <ChartLegend
                    items={[
                      {label: t('battery.chart.chargeStarted', 'Charge Started'), color: '#ef4444'},
                      {label: t('battery.chart.chargeEnded', 'Charge Ended'), color: '#10b981'},
                    ]}
                  />
                </View>
                {chargingHabits && (
                  <Grid cols={{default: 2, md: 4}} gap={12}>
                    <View style={styles.habitCell}>
                      <AppText variant="title" weight="bold">
                        {fmtPercent(chargingHabits.avgStart)}
                      </AppText>
                      <AppText tone="muted" variant="caption">
                        {t('battery.habit.avgStart', 'Avg Start Level')}
                      </AppText>
                    </View>
                    <View style={styles.habitCell}>
                      <AppText style={styles.emerald} variant="title" weight="bold">
                        {fmtPercent(chargingHabits.avgEnd)}
                      </AppText>
                      <AppText tone="muted" variant="caption">
                        {t('battery.habit.avgEnd', 'Avg End Level')}
                      </AppText>
                    </View>
                    <View style={styles.habitCell}>
                      <AppText style={styles.amber} variant="title" weight="bold">
                        {chargingHabits.superchargerCount}
                      </AppText>
                      <AppText tone="muted" variant="caption">
                        {t('battery.habit.supercharger', 'Supercharger Sessions')}
                      </AppText>
                    </View>
                    <View style={styles.habitCell}>
                      <AppText style={styles.cyan} variant="title" weight="bold">
                        {chargingHabits.total -
                          chargingHabits.superchargerCount -
                          chargingHabits.dcFastCount}
                      </AppText>
                      <AppText tone="muted" variant="caption">
                        {t('battery.habit.home', 'Home Charges')}
                      </AppText>
                    </View>
                  </Grid>
                )}
              </>
            ) : (
              <EmptyState
                icon={<Icon glyph={GLYPH.Zap} size={28} />}
                message={t('battery.chart.noSessions', 'No charging session data yet')}
              />
            )}
          </GlassPanel>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 8. Capacity & Range: New vs Now ──────────────────────────────── */}
      <SectionErrorBoundary
        name="battery:capacity-range"
        fallbackTitle={t('battery.section.capacityRangeFailed', 'Capacity & range comparison failed to load')}>
        <FadeIn delay={0.35}>
          <GlassPanel style={styles.panel}>
            <View style={styles.sectionTitleRow}>
              <Icon glyph={GLYPH.Activity} color="#00f0ff" size={16} />
              <AppText variant="body" weight="semibold">
                {t('battery.newVsNow.title', 'Capacity & Range: New vs Now')}
              </AppText>
            </View>
            <Grid cols={{default: 2, md: 4}} gap={12}>
              <GlassPanel style={styles.newVsNowCell}>
                <AppText style={styles.newVsNowLabel} tone="muted" variant="caption">
                  {t('battery.newVsNow.capNew', 'Capacity When New')}
                </AppText>
                <AppText variant="title" weight="bold">
                  {fmtNumber(health.original_capacity, 1)}
                  <AppText tone="muted" variant="caption">
                    {' '}
                    kWh
                  </AppText>
                </AppText>
              </GlassPanel>
              <GlassPanel style={styles.newVsNowCell}>
                <AppText style={styles.newVsNowLabel} tone="muted" variant="caption">
                  {t('battery.newVsNow.capNow', 'Capacity Now')}
                </AppText>
                <AppText style={styles.cyan} variant="title" weight="bold">
                  {fmtNumber(health.estimated_capacity, 1)}
                  <AppText tone="muted" variant="caption">
                    {' '}
                    kWh
                  </AppText>
                </AppText>
                <AppText style={styles.rose} variant="caption">
                  -{fmtNumber(health.original_capacity - health.estimated_capacity, 1)} kWh
                </AppText>
              </GlassPanel>
              <GlassPanel style={styles.newVsNowCell}>
                <AppText style={styles.newVsNowLabel} tone="muted" variant="caption">
                  {t('battery.newVsNow.rangeNew', 'Range When New')}
                </AppText>
                <AppText variant="title" weight="bold">
                  {health.history.length > 0
                    ? fmtInt(fromKm(health.history[0].range_km))
                    : '—'}
                  <AppText tone="muted" variant="caption">
                    {' '}
                    {unitPrefs.distance}
                  </AppText>
                </AppText>
              </GlassPanel>
              <GlassPanel style={styles.newVsNowCell}>
                <AppText style={styles.newVsNowLabel} tone="muted" variant="caption">
                  {t('battery.newVsNow.rangeNow', 'Range Now')}
                </AppText>
                <AppText style={styles.emerald} variant="title" weight="bold">
                  {health.history.length > 0
                    ? fmtInt(fromKm(health.history[health.history.length - 1].range_km))
                    : '—'}
                  <AppText tone="muted" variant="caption">
                    {' '}
                    {unitPrefs.distance}
                  </AppText>
                </AppText>
                {health.history.length >= 2 && (
                  <AppText style={styles.rose} variant="caption">
                    -
                    {fmtInt(
                      fromKm(
                        health.history[0].range_km -
                          health.history[health.history.length - 1].range_km,
                      ),
                    )}{' '}
                    {unitPrefs.distance} {t('battery.newVsNow.lost', 'lost')}
                  </AppText>
                )}
              </GlassPanel>
            </Grid>
          </GlassPanel>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 9. AC/DC Energy Breakdown ────────────────────────────────────── */}
      <SectionErrorBoundary
        name="battery:acdc-breakdown"
        fallbackTitle={t('battery.section.acdcFailed', 'AC/DC energy breakdown failed to load')}>
        <FadeIn delay={0.4}>
          <Grid cols={{default: 1, lg: 2}} gap={16}>
            <ChartContainer
              title={t('battery.chart.acdc', 'AC / DC Energy Breakdown')}
              ariaLabel={t('battery.chart.acdc.aria', 'AC versus DC energy share pie chart')}
              exportable
              exportFilename="energy-breakdown">
              {energyBreakdown ? (
                <View style={styles.chartBody}>
                  <SplitBar segments={energyBreakdown.pieData} />
                </View>
              ) : (
                <EmptyState
                  icon={<Icon glyph={GLYPH.Zap} size={28} />}
                  message={t('battery.chart.noBreakdown', 'No charging data for breakdown')}
                />
              )}
            </ChartContainer>

            <GlassPanel style={styles.panel}>
              <View style={styles.sectionTitleRow}>
                <Icon glyph={GLYPH.Gauge} color="#a855f7" size={16} />
                <AppText variant="body" weight="semibold">
                  {t('battery.stats.title', 'Charging Statistics')}
                </AppText>
              </View>
              {energyBreakdown ? (
                <View style={styles.statsList}>
                  {[
                    {
                      label: t('battery.stats.totalSessions', 'Total Sessions'),
                      value: String(energyBreakdown.totalSessions),
                    },
                    {
                      label: t('battery.stats.acSessions', 'AC Sessions'),
                      value: String(energyBreakdown.acCount),
                    },
                    {
                      label: t('battery.stats.dcSessions', 'DC / Supercharger'),
                      value: String(energyBreakdown.dcCount),
                    },
                    {
                      label: t('battery.stats.totalEnergy', 'Total Energy Added'),
                      value: `${fmtNumber(energyBreakdown.totalEnergy, 1)} kWh`,
                    },
                    {
                      label: t('battery.stats.cycles', 'Charge Cycles'),
                      value: String(health.total_cycles),
                    },
                  ].map(row => (
                    <View key={row.label} style={styles.statRow}>
                      <AppText tone="secondary" variant="caption">
                        {row.label}
                      </AppText>
                      <AppText variant="caption" weight="semibold">
                        {row.value}
                      </AppText>
                    </View>
                  ))}
                </View>
              ) : (
                <EmptyState
                  icon={<Icon glyph={GLYPH.Activity} size={28} />}
                  message={t('battery.stats.empty', 'No charging statistics yet')}
                />
              )}
            </GlassPanel>
          </Grid>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 10. Quick Links ──────────────────────────────────────────────── */}
      <SectionErrorBoundary
        name="battery:quick-links"
        fallbackTitle={t('battery.section.quickLinksFailed', 'Quick links failed to load')}>
        <FadeIn delay={0.45}>
          <GlassPanel style={styles.panel}>
            <Grid cols={{default: 2, md: 3}} gap={12}>
              {QUICK_LINKS.map(link => (
                <Button
                  key={link.to}
                  icon={<Icon glyph={GLYPH.ArrowRight} size={14} />}>
                  {t(link.labelKey, link.fallback)}
                </Button>
              ))}
            </Grid>
          </GlassPanel>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 11. Recommendations ──────────────────────────────────────────── */}
      <SectionErrorBoundary
        name="battery:recommendations"
        fallbackTitle={t('battery.section.recommendationsFailed', 'Recommendations failed to load')}>
        <FadeIn delay={0.5}>
          <GlassPanel glow="green" style={styles.panel}>
            <Badge variant="success" style={styles.recoBadge}>
              💡 {t('battery.recommendations.title', 'Recommendations')}
            </Badge>
            <View style={styles.recoList}>
              {recommendations.map((tip, idx) => (
                <View key={`tip-${idx}`} style={styles.recoRow}>
                  <Icon glyph={GLYPH.Lightbulb} color="#4ade80" size={14} />
                  <AppText style={styles.recoText} tone="secondary" variant="caption">
                    {tip}
                  </AppText>
                </View>
              ))}
            </View>
          </GlassPanel>
        </FadeIn>
      </SectionErrorBoundary>
    </PageContainer>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  pageRoot: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pageHeaderText: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  pageSubtitle: {
    maxWidth: 520,
  },
  pageActions: {
    alignItems: 'flex-end',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  errorBanner: {
    borderColor: colors.dangerBorder,
  },
  glassPanel: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.lg,
  },
  glowGreen: {
    borderColor: colors.successBorder,
  },
  glowCyan: {
    borderColor: colors.borderAccent,
  },
  panel: {
    gap: spacing.md,
  },
  heroPanel: {
    padding: spacing.lg,
  },
  heroRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    justifyContent: 'space-around',
  },
  heroGaugeCell: {
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 110,
  },
  heroBadge: {
    marginTop: spacing.xs,
  },
  heroCaption: {
    marginTop: spacing.xs,
    textTransform: 'uppercase',
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontWeight: '600',
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonText: {
    color: colors.textPrimary,
  },
  buttonIcon: {
    marginLeft: spacing.sm,
  },
  metricCard: {
    gap: spacing.xs,
    padding: spacing.md,
  },
  metricCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricCardIcon: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  metricCardLabel: {
    flexShrink: 1,
  },
  metricCardValue: {
    marginTop: spacing.xs,
  },
  metricBarHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  metricBarTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  metricBarFill: {
    borderRadius: 999,
    height: '100%',
  },
  barCaption: {
    marginTop: spacing.xs,
  },
  liveChip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  liveDot: {
    backgroundColor: colors.success,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  liveText: {
    color: colors.success,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  emptyIcon: {
    opacity: 0.7,
  },
  emptyText: {
    textAlign: 'center',
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
  },
  fadeIn: {
    gap: spacing.md,
  },
  sectionError: {
    borderColor: colors.dangerBorder,
  },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  insightsBlock: {
    gap: spacing.sm,
  },
  insightCard: {
    padding: spacing.md,
  },
  insightRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  insightIcon: {
    marginTop: 1,
  },
  insightTextCol: {
    flexShrink: 1,
    gap: 2,
  },
  insightDesc: {
    marginTop: 2,
  },
  chartBody: {
    gap: spacing.md,
  },
  miniBars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 3,
    height: 160,
  },
  miniBarCol: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  miniBarTrack: {
    height: '100%',
    justifyContent: 'flex-end',
  },
  miniBarFill: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    width: '100%',
  },
  miniBarAxis: {
    flexDirection: 'row',
    gap: 3,
    marginTop: spacing.xs,
  },
  miniBarAxisLabel: {
    flex: 1,
    fontSize: 9,
    textAlign: 'center',
  },
  groupCol: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
  },
  groupBars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 2,
    height: 140,
  },
  groupBar: {
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    width: 6,
  },
  groupLabel: {
    fontSize: 8,
  },
  splitBar: {
    borderRadius: 999,
    flexDirection: 'row',
    height: 24,
    overflow: 'hidden',
    width: '100%',
  },
  splitSegment: {
    height: '100%',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendSwatch: {
    borderRadius: 3,
    height: 10,
    width: 10,
  },
  thresholdNote: {
    marginTop: spacing.xs,
  },
  habitCell: {
    alignItems: 'center',
  },
  newVsNowCell: {
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.md,
  },
  newVsNowLabel: {
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  statsList: {
    gap: spacing.xs,
  },
  statRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  vehicleSelect: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  vehicleSelectText: {
    color: colors.textPrimary,
  },
  noVehicle: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  noVehicleText: {
    textAlign: 'center',
  },
  recoBadge: {
    marginBottom: spacing.sm,
  },
  recoList: {
    gap: spacing.sm,
  },
  recoRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  recoText: {
    flexShrink: 1,
  },
  cyan: {
    color: '#67e8f9',
  },
  emerald: {
    color: '#6ee7b7',
  },
  amber: {
    color: '#fcd34d',
  },
  rose: {
    color: '#fda4af',
  },
});
