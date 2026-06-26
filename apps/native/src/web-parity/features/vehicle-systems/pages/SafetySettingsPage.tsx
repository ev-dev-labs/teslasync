// Native parity port of web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx.
//
// Safety Settings page: per-vehicle ADAS surface. An operator picks a vehicle and
// sees a safety score gauge, summary metric cards, live seat-belt/seat/lock
// signals, driving-distance stats, a grid of nine ADAS feature cards, a
// states-over-time chart, and a paginated settings-history table. Backed by:
//   - GET /api/v1/safety/latest?vehicle_id=…   -> latest SafetySnapshot
//   - GET /api/v1/safety?vehicle_id=…&limit=100 -> SafetySnapshot[] history
//   - GET /api/v1/security/latest?vehicle_id=…  -> live SecurityEvent (useSecurityLatest)
//
// Every web behavior + state name is preserved: the global vehicle selection
// (`selectedId` / `activeId`), the three queries (`safety-latest`,
// `safety-history`, `security-latest`) with identical paths, query keys and
// staleTimes (15s/30s/15s), the derived `enabled`/`disabled`/`scorePct`/
// `featureCards`/`chartData`/`historyColumns`/`sortedHistory` memos, the
// inverted-AEB logic, the safety-enum normalisation, the SI distance conversion
// at the display boundary, and the loading/empty/error branches.
//
// The web DOM/Tailwind/Recharts/lucide stack is replaced with React Native
// primitives + the native parity component library. Substitutions (documented
// in the parity sidecar):
//   - `@/components/layout` PageContainer (title/subtitle/actions/error/loading)
//     has no native parity component, so a local screen scaffold reproduces the
//     header (title + subtitle), the actions slot (the global VehicleSelect ->
//     a local NativeSelect picker over useVehicles), a query-driven freshness
//     chip via the native StatusPill, and a page-level native ErrorBoundary.
//   - `@/hooks/useSelectedVehicle` (global store) has no native store wired, so
//     a first-vehicle-default shim over useVehicles reproduces "default to a
//     vehicle, allow switching" (the DiskForecast/BatteryDegradation precedent).
//   - `@/components/charts` Recharts LineChart (3 step-after binary series with
//     an On/Off Y axis + legend) becomes a native SafetyStatesChart: a
//     horizontally-scrollable grid of on/off cells per series with start/end
//     time labels and a legend — the native recharts barrel only renders
//     "unavailable" placeholders, so a true binary-state visual is built here.
//   - `@/components/ui` DataTable (browser <table>) becomes a native fixed-width
//     header + rows inside a horizontal ScrollView, preserving the single
//     sortable `time` column (controlled via useSortToggle) and the web
//     pagination default (25 rows/page).
//   - `@/components/ui` Badge becomes a local themed chip; `@/components/charts`
//     RadialGauge + CHART_COLORS, `@/components/ui` GlassPanel, `@/components/
//     feedback` EmptyState + ErrorBoundary reuse the already-ported parity
//     components. `@/components/data-display` MetricCard / TimeStamp and
//     `@/components/feedback` Skeleton / AlertBanner are inlined native-safe.
//   - `@/components/motion` FadeIn becomes a reduced-motion-aware mount fade.
//   - `@/lib/numberFormat` fmtInt/fmtNumber, `@/lib/dateFormat` formatDateTime,
//     `@/lib/errorMessage` getErrorMessage, `@/lib/typeGuards`
//     asNonEmptyString/asFiniteNumber, `@/lib/safetyEnum`
//     cleanSafetyEnum/isSafetyEnumActive, and `@/lib/unitConversion`
//     convertDistanceFromSI are inlined verbatim (en-US locale; SI metres ->
//     display unit at the render boundary).
//   - `@/hooks/usePageTitle` (sets document.title) is a native no-op shim — RN
//     has no document — but the t() title call is preserved.
//   - `@/hooks/useUnits` mirrors the web out-of-box default (distance 'km').
//   - react-i18next useTranslation becomes a local shim so every key + English
//     copy is preserved verbatim (the key IS the English string here).
//   - lucide-react glyphs (UserCheck/Armchair/Lock/Navigation/Cpu/AlertCircle)
//     are decorative; the native labels carry the meaning, so each maps to a
//     small decorative emoji marker.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
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
import {useQuery} from '@tanstack/react-query';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {StatusPill} from '../../../../components/ui/StatusPill';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {
  useSecurityLatest,
  useVehicles,
  type Vehicle,
} from '../../../api/hooks/useVehicles';
import {CHART_COLORS} from '../../../components/charts/chartUtils';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {ErrorBoundary} from '../../../components/feedback/ErrorBoundary';
import {GlassPanel} from '../../../components/ui/GlassPanel';

/* ─── i18n shim (web `react-i18next` is unavailable in native) ─────────────── */

type TranslationVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  defaultValueOrVars?: string | TranslationVars,
  maybeVars?: TranslationVars,
) => string;

function interpolate(template: string, vars?: TranslationVars): string {
  if (vars == null) {
    return template;
  }
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : match,
  );
}

// Mirrors i18next's flexible signature: t('Enabled') returns the key (which IS
// the English copy here), t(key, 'Default') returns the default, and either
// form interpolates {{vars}}. Native has no translation table, so the
// key/default is the visible string — preserving every web key + copy verbatim.
function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (
      key: string,
      defaultValueOrVars?: string | TranslationVars,
      maybeVars?: TranslationVars,
    ) => {
      if (typeof defaultValueOrVars === 'string') {
        return interpolate(defaultValueOrVars, maybeVars);
      }
      return interpolate(key, defaultValueOrVars);
    },
    [],
  );
}

/* ─── usePageTitle (web sets document.title; native has no document) ───────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── native-safe formatting (web `@/lib/numberFormat`) ────────────────────── */

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

// web `fmtInt` -> fmtNumber(v, 0)
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── native-safe date formatting (web `@/lib/dateFormat` formatDateTime) ───── */

// web `formatDateTime` -> "Apr 4, 2026, 09:30 PM"; '\u2014' for null/invalid.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  return d.toLocaleString('en-US', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/* ─── getErrorMessage (web `@/lib/errorMessage`) ───────────────────────────── */

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

/* ─── type guards (web `@/lib/typeGuards`) ─────────────────────────────────── */

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* ─── safety enum normalisation (web `@/lib/safetyEnum`) ────────────────────── */

const SAFETY_ENUM_PREFIXES = {
  forward_collision_warning: 'ForwardCollisionSensitivity',
  lane_departure_avoidance: 'LaneAssistLevel',
  speed_limit_warning: 'SpeedAssistLevel',
  cruise_follow_distance: 'FollowDistance',
} as const;

type SafetyEnumField = keyof typeof SAFETY_ENUM_PREFIXES;

function cleanSafetyEnum(
  value: unknown,
  field: SafetyEnumField,
  fallback = '\u2014',
): string {
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off';
  }

  const num = asFiniteNumber(value);
  if (num !== null) {
    return String(num);
  }

  const raw = asNonEmptyString(value);
  if (!raw) {
    return fallback;
  }

  const prefix = SAFETY_ENUM_PREFIXES[field];
  if (prefix && raw.startsWith(prefix)) {
    const stripped = raw.slice(prefix.length);
    if (field === 'speed_limit_warning' && stripped === 'None') {
      return 'Off';
    }
    return stripped || raw;
  }
  return raw;
}

function isSafetyEnumActive(value: unknown, field: SafetyEnumField): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const cleaned = cleanSafetyEnum(value, field, '');
  if (cleaned === '') {
    return false;
  }
  const lower = cleaned.toLowerCase();
  if (
    lower === 'off' ||
    lower === 'none' ||
    lower === 'disabled' ||
    lower === '0'
  ) {
    return false;
  }
  return true;
}

/* ─── native unit shim (web `@/hooks/useUnits` + `@/lib/unitConversion`) ────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

// Mirrors web `convertDistanceFromSI` (SI metres -> display unit).
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

// The native parity layer has no settings store wired in, so the hook mirrors
// the web out-of-box default: distance 'km'. The API already returns SI;
// conversion happens here at the display boundary.
function useUnits(): {unitPrefs: {distance: DistanceUnitPref}} {
  return useMemo(() => ({unitPrefs: {distance: 'km' as DistanceUnitPref}}), []);
}

/* ─── Types (web `interface SafetySnapshot` / `FeatureCardDef`) ────────────── */

interface SafetySnapshot {
  id?: number;
  vehicle_id?: number;
  automatic_emergency_braking_off?: boolean | null;
  automatic_blind_spot_camera?: boolean | null;
  blind_spot_collision_warning?: boolean | null;
  emergency_lane_departure_avoidance?: boolean | null;
  // See safetyEnum: pass-through values may arrive as string|boolean|number|null.
  forward_collision_warning?: string | boolean | number | null;
  lane_departure_avoidance?: string | boolean | number | null;
  speed_limit_warning?: string | boolean | number | null;
  cruise_follow_distance?: string | boolean | number | null;
  pin_to_drive_enabled?: boolean | null;
  miles_since_reset?: number | null;
  self_driving_miles_since_reset?: number | null;
  created_at?: string;
}

interface FeatureCardDef {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  valueText: string;
}

/* ─── Helpers (web module-scope helpers) ───────────────────────────────────── */

/** AEB uses inverted logic: `off = false` means the feature IS enabled. */
function isAebEnabled(off: boolean): boolean {
  return !off;
}

/** Wrapper kept so existing call sites read naturally. */
function cleanEnum(value: unknown, field: SafetyEnumField): string {
  return cleanSafetyEnum(value, field);
}

function boolFeatures(snap: SafetySnapshot): boolean[] {
  return [
    isAebEnabled(snap.automatic_emergency_braking_off ?? false),
    snap.automatic_blind_spot_camera ?? false,
    snap.blind_spot_collision_warning ?? false,
    snap.emergency_lane_departure_avoidance ?? false,
    snap.pin_to_drive_enabled ?? false,
    isSafetyEnumActive(snap.forward_collision_warning, 'forward_collision_warning'),
    isSafetyEnumActive(snap.lane_departure_avoidance, 'lane_departure_avoidance'),
    isSafetyEnumActive(snap.speed_limit_warning, 'speed_limit_warning'),
    isSafetyEnumActive(snap.cruise_follow_distance, 'cruise_follow_distance'),
  ];
}

function enabledCount(snap: SafetySnapshot): number {
  return boolFeatures(snap).filter(Boolean).length;
}

const TOTAL_FEATURES = 9;

function scoreColor(pct: number): string {
  if (pct >= 80) {
    return '#10b981';
  }
  if (pct >= 50) {
    return '#f59e0b';
  }
  return '#ef4444';
}

/* ─── decorative glyphs (web lucide icons; labels carry the meaning) ───────── */

const GLYPH_USER = '\uD83D\uDC64'; // UserCheck (seat belt / person)
const GLYPH_SEAT = '\uD83D\uDCBA'; // Armchair (seat)
const GLYPH_LOCK = '\uD83D\uDD12'; // Lock
const GLYPH_NAV = '\uD83E\uDDED'; // Navigation (compass)
const GLYPH_CPU = '\uD83D\uDCBB'; // Cpu (compute / autopilot)
const GLYPH_ALERT = '\u26A0'; // AlertCircle / AlertTriangle

/* ─── FadeIn (web `@/components/motion` FadeIn) ─────────────────────────────── */

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

/* ─── SkeletonBlock (web `@/components/feedback` Skeleton) ──────────────────── */

function SkeletonBlock({
  height,
  width,
}: {
  height: number;
  width?: DimensionValue;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeleton, {height, width: width ?? '100%'}]}
    />
  );
}

SkeletonBlock.displayName = 'SkeletonBlock';

/* ─── SafetyPageSkeleton (web `SafetyPageSkeleton`) ────────────────────────── */

function SafetyPageSkeleton() {
  return (
    <View style={styles.skeletonStack}>
      <View style={styles.skeletonRow}>
        {Array.from({length: 4}).map((_, i) => (
          <View key={i} style={styles.skeletonStatCell}>
            <SkeletonBlock height={80} />
          </View>
        ))}
      </View>
      <View style={styles.skeletonRow}>
        {Array.from({length: 9}).map((_, i) => (
          <View key={i} style={styles.skeletonFeatureCell}>
            <SkeletonBlock height={96} />
          </View>
        ))}
      </View>
      <SkeletonBlock height={300} />
    </View>
  );
}

SafetyPageSkeleton.displayName = 'SafetyPageSkeleton';

/* ─── AlertBanner (web `@/components/feedback` AlertBanner variant="danger") ── */

function AlertBanner({children}: {children: ReactNode}) {
  return (
    <View accessibilityRole="alert" style={styles.alertBanner}>
      <AppText style={styles.alertGlyph} tone="danger">
        {GLYPH_ALERT}
      </AppText>
      <AppText style={styles.alertText} tone="danger" variant="caption">
        {children}
      </AppText>
    </View>
  );
}

AlertBanner.displayName = 'AlertBanner';

/* ─── query-driven freshness chip (web PageContainer `<DataFreshnessAuto>`) ─── */

interface FreshnessQueryLike {
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
}

function FreshnessChip({
  query,
  t,
}: {
  query: FreshnessQueryLike;
  t: NativeTFunction;
}) {
  if (query.isError) {
    return (
      <StatusPill label={t('common.freshness.error', 'Error')} state="offline" />
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
  if (query.isStale) {
    return (
      <StatusPill label={t('common.freshness.stale', 'Stale')} state="warning" />
    );
  }
  return <StatusPill label={t('common.freshness.live', 'Live')} state="online" />;
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
        style={({pressed}) => [styles.selectTrigger, pressed && styles.pressed]}>
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
                ]}>
                <AppText numberOfLines={1} tone={isSelected ? 'accent' : 'primary'}>
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

/* ─── Badge (web `@/components/ui` Badge) ───────────────────────────────────── */

type Variant = 'success' | 'warning' | 'danger' | 'neutral';

function Badge({
  children,
  variant,
  size = 'md',
}: {
  children: ReactNode;
  variant: Variant;
  size?: 'sm' | 'md';
}) {
  return (
    <View
      style={[
        styles.badge,
        badgeVariantStyles[variant],
        size === 'sm' && styles.badgeSm,
      ]}>
      <AppText
        style={[styles.badgeText, {color: badgeTextColor[variant]}]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

Badge.displayName = 'Badge';

/* ─── MetricCard (web `@/components/data-display` MetricCard) ───────────────── */

type MetricColor = 'cyan' | 'green' | 'purple' | 'red' | 'amber' | 'default';

function metricColor(color: MetricColor): string {
  switch (color) {
    case 'green':
      return colors.success;
    case 'purple':
      return colors.violet;
    case 'red':
      return colors.danger;
    case 'amber':
      return colors.warning;
    case 'cyan':
      return colors.accent;
    default:
      return colors.textMuted;
  }
}

function MetricCard({
  label,
  value,
  glyph,
  color = 'cyan',
  subtitle,
}: {
  label: string;
  value: string | number;
  glyph?: string;
  color?: MetricColor;
  subtitle?: string;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricHeader}>
        <View style={[styles.metricDot, {backgroundColor: metricColor(color)}]} />
        <AppText
          numberOfLines={1}
          style={styles.metricLabel}
          tone="muted"
          variant="caption">
          {label}
        </AppText>
        {glyph ? (
          <AppText style={[styles.metricGlyph, {color: metricColor(color)}]}>
            {glyph}
          </AppText>
        ) : null}
      </View>
      <AppText numberOfLines={1} style={styles.metricValue} weight="bold">
        {value}
      </AppText>
      {subtitle ? (
        <AppText
          numberOfLines={1}
          style={styles.metricSubtitle}
          tone="muted"
          variant="caption">
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

MetricCard.displayName = 'MetricCard';

/* ─── SignalCard (web `SignalCard`) ────────────────────────────────────────── */

function SignalCard({
  glyph,
  value,
  label,
  positive,
}: {
  glyph: string;
  value: string;
  label: string;
  positive?: boolean | null;
}) {
  const color =
    positive === true
      ? colors.success
      : positive === false
        ? colors.danger
        : colors.textSecondary;
  return (
    <GlassPanel padding="md" style={styles.signalCard}>
      <AppText style={[styles.signalGlyph, {color}]}>{glyph}</AppText>
      <AppText style={[styles.signalValue, {color}]} weight="bold">
        {value}
      </AppText>
      <AppText style={styles.signalLabel} tone="muted" variant="caption">
        {label}
      </AppText>
    </GlassPanel>
  );
}

SignalCard.displayName = 'SignalCard';

/* ─── SafetyCard (web `SafetyCard`) ────────────────────────────────────────── */

function SafetyCard({
  label,
  description,
  enabled,
  valueText,
}: {
  label: string;
  description: string;
  enabled: boolean;
  valueText: string;
}) {
  return (
    <GlassPanel
      glow={enabled ? 'green' : 'none'}
      hover
      padding="md"
      style={styles.safetyCard}>
      <View style={styles.safetyRow}>
        <View
          style={[
            styles.safetyIconBox,
            enabled ? styles.safetyIconBoxOn : styles.safetyIconBoxOff,
          ]}>
          <View
            style={[
              styles.safetyIconSquare,
              enabled
                ? styles.safetyIconSquareOn
                : styles.safetyIconSquareOff,
            ]}
          />
        </View>
        <View style={styles.safetyTextCol}>
          <AppText numberOfLines={1} style={styles.safetyLabel} weight="semibold">
            {label}
          </AppText>
          <AppText style={styles.safetyDescription} tone="muted" variant="caption">
            {description}
          </AppText>
        </View>
        <View
          style={[
            styles.safetyDot,
            enabled ? styles.safetyDotOn : styles.safetyDotOff,
          ]}
        />
      </View>
      <AppText
        style={[
          styles.safetyValue,
          enabled ? styles.safetyValueOn : styles.safetyValueOff,
        ]}
        weight="semibold">
        {valueText}
      </AppText>
    </GlassPanel>
  );
}

SafetyCard.displayName = 'SafetyCard';

/* ─── Chart data helpers (web `ChartPoint` / `toChartData`) ────────────────── */

interface ChartPoint {
  time: string;
  aeb: number;
  bscw: number;
  elda: number;
}

type ChartSeriesKey = 'aeb' | 'bscw' | 'elda';

interface ChartSeries {
  key: ChartSeriesKey;
  label: string;
  color: string;
}

function toChartData(history: SafetySnapshot[]): ChartPoint[] {
  return [...history]
    .sort(
      (a, b) =>
        new Date(a.created_at ?? '').getTime() -
        new Date(b.created_at ?? '').getTime(),
    )
    .map(s => ({
      aeb: isAebEnabled(s.automatic_emergency_braking_off ?? false) ? 1 : 0,
      bscw: (s.blind_spot_collision_warning ?? false) ? 1 : 0,
      elda: (s.emergency_lane_departure_avoidance ?? false) ? 1 : 0,
      time: formatDateTime(s.created_at),
    }));
}

/* ─── SafetyStatesChart (web Recharts LineChart, 3 binary step series) ──────── */

const CELL_WIDTH = 14;
const CELL_GAP = 4;
const CELL_HEIGHT = 18;
const SERIES_LABEL_WIDTH = 56;

function SafetyStatesChart({
  data,
  series,
  accessibilityLabel,
  t,
}: {
  data: ReadonlyArray<ChartPoint>;
  series: ReadonlyArray<ChartSeries>;
  accessibilityLabel: string;
  t: NativeTFunction;
}) {
  const cellsWidth =
    data.length > 0
      ? data.length * CELL_WIDTH + (data.length - 1) * CELL_GAP
      : 0;
  const first = data[0]?.time ?? '';
  const last = data[data.length - 1]?.time ?? '';

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      accessible
      style={styles.chartRoot}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {series.map(s => (
            <View key={s.key} style={styles.chartSeriesRow}>
              <AppText
                numberOfLines={1}
                style={styles.chartSeriesLabel}
                tone="muted"
                variant="caption"
                weight="semibold">
                {s.label}
              </AppText>
              <View style={styles.chartCellsRow}>
                {data.map((point, index) => {
                  const on = point[s.key] === 1;
                  return (
                    <View
                      key={index}
                      style={[
                        styles.chartCell,
                        {backgroundColor: on ? s.color : colors.border},
                      ]}
                    />
                  );
                })}
              </View>
            </View>
          ))}
          <View style={styles.chartAxisRow}>
            <View style={styles.chartAxisSpacer} />
            <View style={[styles.chartAxisLabels, {width: cellsWidth}]}>
              <AppText
                numberOfLines={1}
                style={styles.chartAxisLabel}
                tone="muted"
                variant="caption">
                {first}
              </AppText>
              <AppText
                numberOfLines={1}
                style={styles.chartAxisLabel}
                tone="muted"
                variant="caption">
                {last}
              </AppText>
            </View>
          </View>
        </View>
      </ScrollView>
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
        <View style={styles.legendItem}>
          <AppText tone="muted" variant="caption">
            {`${t('On')} / ${t('Off')}`}
          </AppText>
        </View>
      </View>
    </View>
  );
}

SafetyStatesChart.displayName = 'SafetyStatesChart';

/* ─── Feature card definitions (web `buildFeatureCards`) ───────────────────── */

function buildFeatureCards(
  snap: SafetySnapshot,
  t: NativeTFunction,
): FeatureCardDef[] {
  const aebOn = isAebEnabled(snap.automatic_emergency_braking_off ?? false);
  const fcwVal = cleanEnum(snap.forward_collision_warning, 'forward_collision_warning');
  const ldaVal = cleanEnum(snap.lane_departure_avoidance, 'lane_departure_avoidance');
  const slwVal = cleanEnum(snap.speed_limit_warning, 'speed_limit_warning');
  const cfdVal = cleanEnum(snap.cruise_follow_distance, 'cruise_follow_distance');
  const fcwOn = isSafetyEnumActive(snap.forward_collision_warning, 'forward_collision_warning');
  const ldaOn = isSafetyEnumActive(snap.lane_departure_avoidance, 'lane_departure_avoidance');
  const slwOn = isSafetyEnumActive(snap.speed_limit_warning, 'speed_limit_warning');

  return [
    {
      key: 'aeb',
      label: t('Auto Emergency Braking'),
      description: t('Automatic collision mitigation'),
      enabled: aebOn,
      valueText: aebOn ? t('Enabled') : t('Disabled'),
    },
    {
      key: 'bsc',
      label: t('Blind Spot Camera'),
      description: t('Camera view when signaling'),
      enabled: snap.automatic_blind_spot_camera ?? false,
      valueText: (snap.automatic_blind_spot_camera ?? false) ? t('Enabled') : t('Disabled'),
    },
    {
      key: 'fcw',
      label: t('Forward Collision Warning'),
      description: t('Warns of potential frontal collisions'),
      enabled: fcwOn,
      valueText: fcwVal,
    },
    {
      key: 'lda',
      label: t('Lane Departure Avoidance'),
      description: t('Prevents unintentional lane changes'),
      enabled: ldaOn,
      valueText: ldaVal,
    },
    {
      key: 'cfd',
      label: t('Cruise Follow Distance'),
      description: t('Adaptive cruise headway setting'),
      enabled: isSafetyEnumActive(snap.cruise_follow_distance, 'cruise_follow_distance'),
      valueText: cfdVal,
    },
    {
      key: 'slw',
      label: t('Speed Limit Warning'),
      description: t('Alerts when exceeding speed limit'),
      enabled: slwOn,
      valueText: slwVal,
    },
    {
      key: 'ptd',
      label: t('Pin to Drive'),
      description: t('Requires PIN before driving'),
      enabled: snap.pin_to_drive_enabled ?? false,
      valueText: (snap.pin_to_drive_enabled ?? false) ? t('Enabled') : t('Disabled'),
    },
    {
      key: 'bscw',
      label: t('Blind Spot Collision Warning'),
      description: t('Alerts for blind-spot hazards'),
      enabled: snap.blind_spot_collision_warning ?? false,
      valueText: (snap.blind_spot_collision_warning ?? false) ? t('Enabled') : t('Disabled'),
    },
    {
      key: 'elda',
      label: t('Emergency Lane Departure Avoidance'),
      description: t('Steers back on unintentional departure'),
      enabled: snap.emergency_lane_departure_avoidance ?? false,
      valueText: (snap.emergency_lane_departure_avoidance ?? false) ? t('Enabled') : t('Disabled'),
    },
  ];
}

/* ─── Table columns (web `buildHistoryColumns`) ────────────────────────────── */

interface Column {
  key: string;
  header: string;
  width: number;
  sortable?: boolean;
  render: (row: SafetySnapshot) => ReactNode;
}

function buildHistoryColumns(t: NativeTFunction): Column[] {
  const boolCell = (val: boolean): ReactNode => (
    <Badge size="sm" variant={val ? 'success' : 'danger'}>
      {val ? 'On' : 'Off'}
    </Badge>
  );
  const enumCell = (text: string): ReactNode => (
    <AppText numberOfLines={1} tone="secondary" variant="caption">
      {text}
    </AppText>
  );

  return [
    {
      key: 'time',
      header: t('Time'),
      width: 150,
      sortable: true,
      render: row => (
        <AppText numberOfLines={1} tone="muted" variant="caption">
          {formatDateTime(row.created_at)}
        </AppText>
      ),
    },
    {
      key: 'aeb',
      header: t('AEB'),
      width: 64,
      render: row =>
        boolCell(isAebEnabled(row.automatic_emergency_braking_off ?? false)),
    },
    {
      key: 'bsc',
      header: t('BSC'),
      width: 64,
      render: row => boolCell(row.automatic_blind_spot_camera ?? false),
    },
    {
      key: 'bscw',
      header: t('BSCW'),
      width: 64,
      render: row => boolCell(row.blind_spot_collision_warning ?? false),
    },
    {
      key: 'fcw',
      header: t('FCW'),
      width: 96,
      render: row =>
        enumCell(cleanEnum(row.forward_collision_warning, 'forward_collision_warning')),
    },
    {
      key: 'lda',
      header: t('LDA'),
      width: 96,
      render: row =>
        enumCell(cleanEnum(row.lane_departure_avoidance, 'lane_departure_avoidance')),
    },
    {
      key: 'elda',
      header: t('ELDA'),
      width: 64,
      render: row => boolCell(row.emergency_lane_departure_avoidance ?? false),
    },
    {
      key: 'cfd',
      header: t('CFD'),
      width: 96,
      render: row =>
        enumCell(cleanEnum(row.cruise_follow_distance, 'cruise_follow_distance')),
    },
    {
      key: 'slw',
      header: t('SLW'),
      width: 96,
      render: row =>
        enumCell(cleanEnum(row.speed_limit_warning, 'speed_limit_warning')),
    },
    {
      key: 'pin',
      header: t('PIN'),
      width: 64,
      render: row => boolCell(row.pin_to_drive_enabled ?? false),
    },
  ];
}

/* ─── useSortToggle (web `@/components/ui` useSortToggle) ───────────────────── */

type SortDir = 'asc' | 'desc';

// Verbatim port of the web hook: default dir 'desc', toggling the active key
// flips the direction, selecting a new key resets to 'desc'. No default key, so
// the initial render shows the already-sorted (desc) data as passed.
function useSortToggle(): {
  sortKey: string;
  sortDir: SortDir;
  onSort: (key: string) => void;
  sortFn: (
    rows: SafetySnapshot[],
    accessor: (row: SafetySnapshot, key: string) => number | string,
  ) => SafetySnapshot[];
} {
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const onSort = useCallback(
    (key: string) => {
      if (key === sortKey) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('desc');
      }
    },
    [sortKey],
  );

  const sortFn = useCallback(
    (
      rows: SafetySnapshot[],
      accessor: (row: SafetySnapshot, key: string) => number | string,
    ): SafetySnapshot[] => {
      if (!sortKey) {
        return rows;
      }
      return [...rows].sort((a, b) => {
        const av = accessor(a, sortKey);
        const bv = accessor(b, sortKey);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    },
    [sortKey, sortDir],
  );

  return {onSort, sortDir, sortFn, sortKey};
}

/* ─── DataTable (web `@/components/ui` DataTable, controlled sort) ──────────── */

// Web `pagination` boolean defaults to 25 rows/page (DataTable defaultPageSize).
const TABLE_PAGE_SIZE = 25;

function DataTable({
  columns,
  data,
  keyExtractor,
  sortKey,
  sortDir,
  onSort,
}: {
  columns: ReadonlyArray<Column>;
  data: ReadonlyArray<SafetySnapshot>;
  keyExtractor: (row: SafetySnapshot) => string | number;
  sortKey: string;
  sortDir: SortDir;
  onSort: (key: string) => void;
}) {
  // Sort is controlled by the parent (useSortToggle + sortFn), exactly like the
  // web DataTable: this table only paginates the already-sorted `data`.
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(data.length / TABLE_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const rows = data.slice(
    safePage * TABLE_PAGE_SIZE,
    (safePage + 1) * TABLE_PAGE_SIZE,
  );
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{width: totalWidth}}>
          <View style={styles.tableHeaderRow}>
            {columns.map(col => {
              const active = sortKey === col.key;
              const indicator = active
                ? sortDir === 'asc'
                  ? ' \u25B2'
                  : ' \u25BC'
                : '';
              return (
                <Pressable
                  accessibilityRole={col.sortable ? 'button' : undefined}
                  disabled={!col.sortable}
                  key={col.key}
                  onPress={() => {
                    if (col.sortable) {
                      onSort(col.key);
                      setPage(0);
                    }
                  }}
                  style={[styles.tableCell, {width: col.width}]}>
                  <AppText
                    numberOfLines={1}
                    tone="muted"
                    variant="caption"
                    weight="semibold">
                    {col.header}
                    {indicator}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          {rows.map(row => (
            <View key={String(keyExtractor(row))} style={styles.tableRow}>
              {columns.map(col => (
                <View key={col.key} style={[styles.tableCell, {width: col.width}]}>
                  {col.render(row)}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {pageCount > 1 ? (
        <View style={styles.pagination}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{disabled: safePage === 0}}
            disabled={safePage === 0}
            onPress={() => setPage(p => Math.max(0, p - 1))}
            style={({pressed}) => [
              styles.pageBtn,
              safePage === 0 && styles.pageBtnDisabled,
              pressed && styles.pressed,
            ]}>
            <AppText variant="caption">{'\u2039'}</AppText>
          </Pressable>
          <AppText tone="muted" variant="caption">
            {`${safePage + 1} / ${pageCount}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{disabled: safePage >= pageCount - 1}}
            disabled={safePage >= pageCount - 1}
            onPress={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            style={({pressed}) => [
              styles.pageBtn,
              safePage >= pageCount - 1 && styles.pageBtnDisabled,
              pressed && styles.pressed,
            ]}>
            <AppText variant="caption">{'\u203A'}</AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

DataTable.displayName = 'DataTable';

const GAUGE_SIZE = 120;

/* ─── SafetySettingsPage ───────────────────────────────────────────────────── */

export default function SafetySettingsPage() {
  const t = useNativeTranslation();
  usePageTitle(t('Safety Settings'));
  const {unitPrefs} = useUnits();
  const distanceUnit = unitPrefs.distance;

  /* --- vehicle selector (web global useSelectedVehicle + VehicleSelect) --- */
  const vehiclesQuery = useVehicles();
  const vehicles: Vehicle[] = vehiclesQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (selectedId == null && firstVehicleId != null) {
      setSelectedId(firstVehicleId);
    }
  }, [selectedId, firstVehicleId]);
  const resolvedId = selectedId ?? firstVehicleId;
  const activeId = resolvedId != null ? String(resolvedId) : '';

  /* --- security data (live safety signals) --- */
  const {data: securityData} = useSecurityLatest(Number(activeId) || 0, 15_000);

  /* --- safety data --- */
  const latestQuery = useQuery<SafetySnapshot>({
    enabled: activeId !== '',
    queryFn: () => request<SafetySnapshot>(`/safety/latest?vehicle_id=${activeId}`),
    queryKey: ['safety-latest', activeId],
    staleTime: 15_000,
  });
  const {data: latest, isLoading: latestLoading, error: latestError} = latestQuery;

  const historyQuery = useQuery<SafetySnapshot[]>({
    enabled: activeId !== '',
    queryFn: () =>
      request<SafetySnapshot[]>(`/safety?vehicle_id=${activeId}&limit=100`),
    queryKey: ['safety-history', activeId],
    staleTime: 30_000,
  });
  const {
    data: history,
    isLoading: historyLoading,
    error: historyError,
  } = historyQuery;

  /* --- derived data --- */
  const anyError = [latestError, historyError].find(Boolean);
  const isLoading = latestLoading || historyLoading;

  const enabled = useMemo(() => (latest ? enabledCount(latest) : 0), [latest]);
  const disabled = TOTAL_FEATURES - enabled;
  const scorePct = useMemo(
    () => (latest ? (enabled / TOTAL_FEATURES) * 100 : 0),
    [latest, enabled],
  );

  const featureCards = useMemo(
    () => (latest ? buildFeatureCards(latest, t) : []),
    [latest, t],
  );

  const chartData = useMemo(
    () => (history ? toChartData(history) : []),
    [history],
  );

  const chartSeries = useMemo<ChartSeries[]>(
    () => [
      {color: CHART_COLORS[0], key: 'aeb', label: t('AEB')},
      {color: CHART_COLORS[1], key: 'bscw', label: t('BSCW')},
      {color: CHART_COLORS[2], key: 'elda', label: t('ELDA')},
    ],
    [t],
  );

  const historyColumns = useMemo(() => buildHistoryColumns(t), [t]);

  const sortedHistory = useMemo(
    () =>
      history
        ? [...history].sort(
            (a, b) =>
              new Date(b.created_at ?? '').getTime() -
              new Date(a.created_at ?? '').getTime(),
          )
        : [],
    [history],
  );

  const {sortKey, sortDir, onSort, sortFn} = useSortToggle();
  const tableData = useMemo(
    () =>
      sortFn(sortedHistory, (row, key) =>
        key === 'time' ? new Date(row.created_at ?? '').getTime() : '',
      ),
    [sortedHistory, sortFn],
  );

  const vehicleOptions: NativeSelectOption[] = vehicles.map(v => ({
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
    value: String(v.id),
  }));

  /* --- render --- */
  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="vehicle-systems-safety-settings">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {t('Safety Settings')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {t('ADAS features, safety score, and driving stats')}
          </AppText>
        </View>
        <View style={styles.actions}>
          <NativeSelect
            accessibilityLabel={t('common.vehicle.select', 'Select vehicle')}
            onChange={v => setSelectedId(v ? Number(v) : null)}
            options={vehicleOptions}
            value={resolvedId != null ? String(resolvedId) : ''}
          />
          <FreshnessChip query={latestQuery} t={t} />
        </View>
      </View>

      <ErrorBoundary name="safety-settings-page">
        <View style={styles.stack}>
          {/* Error banner */}
          {anyError ? (
            <AlertBanner>
              {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(anyError)}`}
            </AlertBanner>
          ) : null}

          {/* Loading skeleton */}
          {isLoading ? <SafetyPageSkeleton /> : null}

          {/* Empty state */}
          {!isLoading && !latest ? (
            <GlassPanel padding="lg">
              <EmptyState
                message={t('No safety data available for this vehicle.')}
                title={t('No safety data available for this vehicle.')}
              />
            </GlassPanel>
          ) : null}

          {/* Content */}
          {!isLoading && latest ? (
            <View style={styles.stack}>
              {/* ---- Safety Score Gauge + Stat Cards ---- */}
              <FadeIn>
                <View style={styles.scoreRow}>
                  <GlassPanel padding="lg" style={styles.gaugePanel}>
                    <RadialGauge
                      color={scoreColor(scorePct)}
                      label={t('Safety Score')}
                      max={TOTAL_FEATURES}
                      size={GAUGE_SIZE}
                      unit={`${fmtInt(scorePct)}%`}
                      value={enabled}
                    />
                    <View style={styles.gaugeBadge}>
                      <Badge
                        variant={
                          scorePct >= 80
                            ? 'success'
                            : scorePct >= 50
                              ? 'warning'
                              : 'danger'
                        }>
                        {`${enabled}/${TOTAL_FEATURES} ${t('enabled')}`}
                      </Badge>
                    </View>
                  </GlassPanel>

                  <View style={styles.scoreMetrics}>
                    <MetricCard
                      color={scorePct >= 80 ? 'green' : scorePct >= 50 ? 'amber' : 'red'}
                      label={t('Safety Score')}
                      value={`${fmtInt(scorePct)}%`}
                    />
                    <MetricCard
                      color="cyan"
                      label={t('Total Features')}
                      value={TOTAL_FEATURES}
                    />
                    <MetricCard color="green" label={t('Enabled')} value={enabled} />
                    <MetricCard
                      color={disabled > 0 ? 'red' : 'green'}
                      label={t('Disabled')}
                      value={disabled}
                    />
                  </View>
                </View>
              </FadeIn>

              {/* ---- Live Safety Signals ---- */}
              <FadeIn delay={0.05}>
                <GlassPanel padding="lg">
                  <AppText style={styles.panelTitle} weight="semibold">
                    {t('safety.liveSignals', 'Live Safety Signals')}
                  </AppText>
                  <View style={styles.signalGrid}>
                    <SignalCard
                      glyph={GLYPH_USER}
                      label={t('safety.driverBelt', 'Driver Belt')}
                      positive={securityData?.driver_seat_belt ?? null}
                      value={
                        securityData?.driver_seat_belt == null
                          ? '\u2014'
                          : securityData.driver_seat_belt
                            ? t('safety.buckled', 'Buckled')
                            : t('safety.unbuckled', 'Unbuckled')
                      }
                    />
                    <SignalCard
                      glyph={GLYPH_USER}
                      label={t('safety.passengerBelt', 'Passenger Belt')}
                      positive={securityData?.passenger_seat_belt ?? null}
                      value={
                        securityData?.passenger_seat_belt == null
                          ? '\u2014'
                          : securityData.passenger_seat_belt
                            ? t('safety.buckled', 'Buckled')
                            : t('safety.unbuckled', 'Unbuckled')
                      }
                    />
                    <SignalCard
                      glyph={GLYPH_SEAT}
                      label={t('safety.driverSeat', 'Driver Seat')}
                      positive={securityData?.driver_seat_occupied ?? null}
                      value={
                        securityData?.driver_seat_occupied == null
                          ? '\u2014'
                          : securityData.driver_seat_occupied
                            ? t('safety.occupied', 'Occupied')
                            : t('safety.empty', 'Empty')
                      }
                    />
                    <SignalCard
                      glyph={GLYPH_LOCK}
                      label={t('safety.vehicleLock', 'Vehicle Lock')}
                      positive={securityData?.locked ?? null}
                      value={
                        securityData?.locked == null
                          ? '\u2014'
                          : securityData.locked
                            ? t('safety.locked', 'Locked')
                            : t('safety.unlocked', 'Unlocked')
                      }
                    />
                  </View>
                </GlassPanel>
              </FadeIn>

              {/* ---- Driving Statistics ---- */}
              <FadeIn delay={0.1}>
                <GlassPanel padding="lg">
                  <AppText style={styles.panelTitle} weight="semibold">
                    {t('safety.drivingStats', 'Driving Statistics')}
                  </AppText>
                  <View style={styles.statsGrid}>
                    <MetricCard
                      glyph={GLYPH_NAV}
                      label={t('safety.distanceSinceReset', 'Distance Since Reset')}
                      subtitle={distanceUnit}
                      value={
                        latest.miles_since_reset != null
                          ? fmtNumber(
                              convertDistanceFromSI(
                                latest.miles_since_reset,
                                distanceUnit,
                              ),
                            )
                          : '\u2014'
                      }
                    />
                    <MetricCard
                      glyph={GLYPH_CPU}
                      label={t('safety.selfDrivingDistance', 'Self-Driving Distance')}
                      subtitle={t('safety.distanceAutopilot', '{{unit}} (autopilot)', {
                        unit: distanceUnit,
                      })}
                      value={
                        latest.self_driving_miles_since_reset != null
                          ? fmtNumber(
                              convertDistanceFromSI(
                                latest.self_driving_miles_since_reset,
                                distanceUnit,
                              ),
                            )
                          : '\u2014'
                      }
                    />
                  </View>
                </GlassPanel>
              </FadeIn>

              {/* ---- Safety Feature Cards (grid) ---- */}
              <FadeIn delay={0.15}>
                <GlassPanel padding="lg">
                  <AppText style={styles.panelTitle} weight="semibold">
                    {t('ADAS Features')}
                  </AppText>
                  <View style={styles.adasGrid}>
                    {featureCards.map(card => (
                      <View key={card.key} style={styles.adasCell}>
                        <SafetyCard
                          description={card.description}
                          enabled={card.enabled}
                          label={card.label}
                          valueText={card.valueText}
                        />
                      </View>
                    ))}
                  </View>
                </GlassPanel>
              </FadeIn>

              {/* ---- Safety States Chart ---- */}
              <FadeIn delay={0.2}>
                <GlassPanel padding="lg">
                  <AppText style={styles.panelTitle} weight="semibold">
                    {t('Safety States Over Time')}
                  </AppText>
                  {chartData.length > 0 ? (
                    <SafetyStatesChart
                      accessibilityLabel={t('Safety States Over Time')}
                      data={chartData}
                      series={chartSeries}
                      t={t}
                    />
                  ) : (
                    <EmptyState
                      message={t('No safety state history to chart yet.')}
                      title={t('No safety state history to chart yet.')}
                    />
                  )}
                </GlassPanel>
              </FadeIn>

              {/* ---- History DataTable ---- */}
              <FadeIn delay={0.3}>
                <GlassPanel padding="lg">
                  <AppText style={styles.panelTitle} weight="semibold">
                    {t('Safety Settings History')}
                  </AppText>
                  {sortedHistory.length === 0 ? (
                    <EmptyState
                      message={t('No history records found.')}
                      title={t('No history records found.')}
                    />
                  ) : (
                    <DataTable
                      columns={historyColumns}
                      data={tableData}
                      keyExtractor={row => row.id ?? 0}
                      onSort={onSort}
                      sortDir={sortDir}
                      sortKey={sortKey}
                    />
                  )}
                </GlassPanel>
              </FadeIn>
            </View>
          ) : null}
        </View>
      </ErrorBoundary>
    </ScrollView>
  );
}

SafetySettingsPage.displayName = 'SafetySettingsPage';

const badgeVariantStyles = StyleSheet.create<Record<Variant, ViewStyle>>({
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

const badgeTextColor: Record<Variant, string> = {
  danger: colors.danger,
  neutral: colors.textSecondary,
  success: colors.success,
  warning: colors.warning,
};

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  adasCell: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },
  adasGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  alertBanner: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  alertGlyph: {
    fontSize: 16,
  },
  alertText: {
    flex: 1,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeSm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
  },
  chartAxisLabel: {
    maxWidth: 120,
  },
  chartAxisLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chartAxisRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  chartAxisSpacer: {
    width: SERIES_LABEL_WIDTH,
  },
  chartCell: {
    borderRadius: 3,
    height: CELL_HEIGHT,
    width: CELL_WIDTH,
  },
  chartCellsRow: {
    flexDirection: 'row',
    gap: CELL_GAP,
  },
  chartRoot: {
    gap: spacing.sm,
    marginTop: spacing.md,
    width: '100%',
  },
  chartSeriesLabel: {
    width: SERIES_LABEL_WIDTH,
  },
  chartSeriesRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  gaugeBadge: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  gaugePanel: {
    alignItems: 'center',
    flexBasis: '30%',
    flexGrow: 1,
    justifyContent: 'center',
    minWidth: 180,
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
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
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
  metricCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '46%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 140,
    padding: spacing.md,
  },
  metricDot: {
    borderRadius: 999,
    height: 9,
    width: 9,
  },
  metricGlyph: {
    fontSize: 14,
  },
  metricHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metricLabel: {
    flexShrink: 1,
    textTransform: 'uppercase',
  },
  metricSubtitle: {},
  metricValue: {
    fontSize: 20,
    lineHeight: 26,
  },
  pageBtn: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pageBtnDisabled: {
    opacity: 0.4,
  },
  pageSubtitle: {},
  pageTitle: {
    color: colors.textPrimary,
  },
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  pressed: {
    opacity: 0.7,
  },
  safetyCard: {
    gap: spacing.sm,
  },
  safetyDescription: {
    fontSize: 10,
  },
  safetyDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  safetyDotOff: {
    backgroundColor: colors.surfaceHover,
  },
  safetyDotOn: {
    backgroundColor: colors.success,
  },
  safetyIconBox: {
    borderRadius: 8,
    padding: spacing.sm,
  },
  safetyIconBoxOff: {
    backgroundColor: colors.surfaceRaised,
  },
  safetyIconBoxOn: {
    backgroundColor: colors.successSurface,
  },
  safetyIconSquare: {
    borderRadius: 5,
    height: 20,
    width: 20,
  },
  safetyIconSquareOff: {
    backgroundColor: colors.surfaceHover,
  },
  safetyIconSquareOn: {
    backgroundColor: colors.success,
  },
  safetyLabel: {
    fontSize: 12,
  },
  safetyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  safetyTextCol: {
    flex: 1,
    gap: 2,
  },
  safetyValue: {
    fontSize: 13,
  },
  safetyValueOff: {
    color: colors.textMuted,
  },
  safetyValueOn: {
    color: colors.success,
  },
  scoreMetrics: {
    flexBasis: '60%',
    flexDirection: 'row',
    flexGrow: 1,
    flexWrap: 'wrap',
    gap: spacing.md,
    minWidth: 240,
  },
  scoreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
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
  signalCard: {
    alignItems: 'center',
    flexBasis: '46%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 140,
  },
  signalGlyph: {
    fontSize: 22,
  },
  signalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  signalLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  signalValue: {
    fontSize: 13,
    textAlign: 'center',
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
  },
  skeletonFeatureCell: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 140,
  },
  skeletonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  skeletonStatCell: {
    flexBasis: '22%',
    flexGrow: 1,
    minWidth: 120,
  },
  skeletonStack: {
    gap: spacing.lg,
  },
  stack: {
    gap: spacing.lg,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  tableCell: {
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  tableHeaderRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: spacing.sm,
  },
  tableRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingVertical: spacing.sm,
  },
});
