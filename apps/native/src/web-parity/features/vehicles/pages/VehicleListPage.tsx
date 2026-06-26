// Native parity port of web/src/features/vehicles/pages/VehicleListPage.tsx.
//
// The web page is the Fleet (`/vehicles`) landing surface. It:
//   - loads the fleet with useQuery(['vehicles'], request('/vehicles'),
//     staleTime 30s) (web L66-71);
//   - subscribes the primary vehicle to live SSE via useVehicleLive(primaryId)
//     for its side-effect only (web L74-75);
//   - floats pinned vehicles to the top using usePinned('vehicle') + a stable
//     position/item_id sort (web L78-91);
//   - batch-fetches every vehicle's live state with a single useQuery keyed by
//     the sorted ids, fanning fetchVehicleState out over the fleet, null-
//     collapsing failures, enabled when the fleet is non-empty, refetched every
//     30s (web L94-109);
//   - derives fleet metrics — avgBattery, totalRange (summed in SI metres,
//     converted at display), chargingCount, onlineCount (web L112-123);
//   - exposes a "Sync from Tesla" mutation (POST /vehicles/sync) and a per-
//     vehicle "remove" mutation (DELETE /vehicles/{id}) with toasts + cache
//     invalidations (web L126-153);
//   - renders a loading skeleton, an error panel, an empty state, sync success/
//     error banners, a 4-tile fleet summary, a fleet battery-comparison strip, a
//     vehicle-card list (battery bar, range/odometer/charger power, lock/sentry
//     glyphs, pin/open/remove actions) and a delete ConfirmDialog (web L155-461).
//
// This native port preserves that contract 1:1 — the same state names
// (vehiclesQuery / vehicles / isLoading / error / vehicleList / primaryId /
// vehiclePins / sortedVehicleList / fleetStates / fleet / syncMut / deleteMut /
// deleteTarget), the same query keys / queryFns / staleTime / enabled /
// refetchInterval, the same API paths ('/vehicles', '/vehicles/sync',
// '/vehicles/{id}', '/pinned'), the same SI-metre range math converted only at
// the display boundary, every i18n key + English default, and the same visual
// intent — using React Native primitives, the existing native GlassPanel /
// AppText / theme tokens and the already-ported native parity MetricCard +
// ConfirmDialog.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - @tanstack/react-query useQuery/useMutation/useQueryClient (web L1): kept
//     verbatim — react-query runs natively (identical key/queryFn/mutationFn
//     contract).
//   - react-router-dom Link / useNavigate (web L3): no native router → a
//     native-safe useNavigate() returns a documented no-op (the native navigator
//     owns routing) and Link is a Pressable (accessibilityRole="link") that
//     captures the same target path for parity intent.
//   - react-i18next useTranslation (web L4): no native i18next runtime → inline
//     useNativeTranslation() returns t(key, fallback?) = fallback ?? key,
//     preserving every key + English default.
//   - lucide-react icons (web L5-8): DOM SVGs → semantic emoji glyph stand-ins.
//   - @/components/layout PageContainer (web L10): a native-safe PageContainer
//     (ScrollView scaffold: title/subtitle/actions/loading/error/children) — the
//     props this page uses (the TwoFactorAuthPage / MileagePage precedent).
//   - @/components/ui GlassPanel/Badge/Button/ConfirmDialog/PinButton (web L11):
//     GlassPanel → native GlassPanel; ConfirmDialog → native parity ConfirmDialog;
//     Badge/Button/PinButton → native-safe inline stand-ins preserving their prop
//     shapes (PinButton wires the ported usePinned + useTogglePin so a pin toggle
//     re-orders the list, exactly like web).
//   - @/components/data-display MetricCard/AnimatedNumber/DataFreshnessAuto
//     (web L12): MetricCard → native parity MetricCard; AnimatedNumber → inline
//     RAF ease-out count-up (the FleetSummary precedent); DataFreshnessAuto →
//     inline status pill driven by the query's isError/isFetching/isStale/
//     dataUpdatedAt (the MileagePage precedent).
//   - @/components/feedback Skeleton/EmptyState/StatGridSkeleton (web L13): inline
//     native-safe Skeleton/EmptyState/StatGridSkeleton.
//   - @/components/motion FadeIn/StaggerContainer/StaggerItem (web L14): native
//     has no framer-motion → pass-through Views (the MileagePage precedent).
//   - @/hooks/usePageTitle (web L16): document.title is browser-only → a
//     documented no-op (the native navigator owns the header title).
//   - @/hooks/useUnits (web L17): reproduced as a native-safe useUnits() deriving
//     { distance, locale, precision } + formatDistance from useSettings(); the
//     formatDistance mirrors web/src/lib/unitConversion.ts formatDistance
//     (SI metres → "<n> <unit>", DEFAULT_PRECISION.distance = 1).
//   - @/hooks/useVehicleLive (web L18): the web hook opens an SSE subscription
//     for live signal merge; native has no useVehicleLive port, so it is a
//     documented no-op stand-in preserving the call signature (the web page only
//     consumes it for its side-effect — the return value is discarded).
//   - @/components/feedback/Toast useToast (web L19): native has no toast portal →
//     a native-safe useToast() surfaces success/error via Alert.alert.
//   - @/lib/cn (web L20): the single static className is replaced by a StyleSheet
//     style; no class-name composition is needed.
//   - @/lib/unitConversion convertDistanceFromSI (web L21): inlined verbatim
//     (metres → km / mi) for the consumed 'km' | 'mi' union.
//   - @/lib/numberFormat fmtNumber (web L22): inlined mirroring numberFormat.ts
//     (safeNumber + locale toLocaleString); the web module-global precision
//     (set by useSettings to settings.decimal_precision, default 2) has no native
//     wiring, so the static module default of 2 is used.
//   - @/lib/colors batteryColor (web L23): inlined verbatim (>60 good / >25 warn /
//     else bad) with the web hex constants.
//   - @/api/client request (web L24): the already-ported native request.
//   - @/api/hooks/useVehicles fetchVehicleState (web L25): the already-ported
//     native fetchVehicleState (same '/vehicles/{id}/state' path). Its return
//     widens `.state` to VehicleState | string | null, so the queryFn keeps only
//     structured-object states (else null) — matching the web contract where
//     `.state` is a VehicleState object or absent.
//   - @/api/hooks/usePinned usePinned (web L26): the already-ported native
//     usePinned (+ useTogglePin for the inline PinButton).
//   - @/api/types deriveVehicleStatus/statusVariant/VehicleState (web L27/L29) and
//     @/types/vehicle Vehicle (web L28): imported from the already-ported native
//     web-parity api/types so every status/badge/shape contract is identical.
//   - the web Tailwind grids / hover / transitions collapse to flex-wrap layouts
//     (no native hover); CSS gradients (card top bar, battery fill) reduce to flat
//     colour segments / a solid fill (no gradient/box-shadow primitive on native).
//
// No DOM module, browser HTML element, document/window, react-router-dom,
// react-i18next, lucide-react, framer-motion, Recharts, Leaflet, or old web
// @/components import appears in the native output. No SI unit-suffixed field is
// introduced — range is summed in SI metres and converted only at display.

import React, {useMemo, useRef, useState, useEffect, type ReactNode} from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {request} from '../../../api/client';
import {fetchVehicleState} from '../../../api/hooks/useVehicles';
import {usePinned, useTogglePin} from '../../../api/hooks/usePinned';
import {useSettings} from '../../../api/hooks/useSettings';
import {
  deriveVehicleStatus,
  statusVariant,
  type BadgeVariant,
  type Vehicle,
  type VehicleState,
} from '../../../api/types';
import {ConfirmDialog} from '../../../components/ui/ConfirmDialog';
import {MetricCard, type NeonColor} from '../../../components/data-display/MetricCard';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';

/* ── native translation fallback (native-safe port of react-i18next) ──────── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (_key, fallback) => fallback ?? _key, []);
}

/* ── native-safe usePageTitle (web document.title is browser-only) ────────── */

function usePageTitle(_title: string): void {
  // Web usePageTitle writes document.title; on native the navigator owns the
  // header title, so this is a deliberate no-op (the title is still computed).
}

/* ── native-safe useVehicleLive (web opens an SSE subscription) ───────────── */

function useVehicleLive(_vehicleId?: number): void {
  // The web hook subscribes the primary vehicle to live SSE signal updates and
  // merges them into local state. The web page consumes it purely for the
  // side-effect (the return value is discarded), and native has no useVehicleLive
  // port, so this preserves the call signature as an explicit no-op.
}

/* ── native-safe useToast (web @/components/feedback/Toast) ───────────────── */

function useToast() {
  return useMemo(
    () => ({
      success: (message: string) => Alert.alert(message),
      error: (message: string) => Alert.alert(message),
    }),
    [],
  );
}

/* ── ported lib helpers (web @/lib/*) ─────────────────────────────────────── */

type DistanceUnitPref = 'km' | 'mi';

// Mirrors web/src/lib/unitConversion.ts so the imperial branch matches exactly.
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

// Mirrors web/src/lib/numberFormat.ts fmtNumber default (precision 2, en-US).
function fmtNumber(value: unknown, decimals = 2, locale = 'en-US'): string {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  try {
    return safe.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safe.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

// Mirrors web/src/lib/colors.ts batteryColor + COLOR constants.
const COLOR_GOOD = '#10b981';
const COLOR_WARN = '#f59e0b';
const COLOR_BAD = '#ef4444';

function batteryColor(level: number): string {
  if (level > 60) return COLOR_GOOD;
  if (level > 25) return COLOR_WARN;
  return COLOR_BAD;
}

/* ── native-safe useUnits (web @/hooks/useUnits → useSettings derivation) ─── */

interface UseUnitsResult {
  unitPrefs: {distance: DistanceUnitPref};
  formatDistance: (meters: number | null | undefined) => string;
}

const DISTANCE_PRECISION = 1; // web unitConversion DEFAULT_PRECISION.distance

function useUnits(): UseUnitsResult {
  const {data: settings} = useSettings();
  const unitOfLength = settings?.unit_of_length;
  const localePref = settings?.locale;
  const decimalPrecision = settings?.decimal_precision;

  return useMemo<UseUnitsResult>(() => {
    const distance: DistanceUnitPref = unitOfLength === 'mi' ? 'mi' : 'km';
    const locale =
      typeof localePref === 'string' && localePref.trim().length > 0
        ? localePref
        : 'en-US';
    const precision =
      typeof decimalPrecision === 'number' &&
      Number.isFinite(decimalPrecision) &&
      decimalPrecision >= 0
        ? Math.floor(decimalPrecision)
        : DISTANCE_PRECISION;

    const formatDistance = (meters: number | null | undefined): string => {
      if (meters == null || !Number.isFinite(meters)) return '—';
      const value = convertDistanceFromSI(meters, distance);
      let formatted: string;
      try {
        formatted = new Intl.NumberFormat(locale, {
          minimumFractionDigits: precision,
          maximumFractionDigits: precision,
        }).format(value);
      } catch {
        formatted = value.toFixed(precision);
      }
      return `${formatted} ${distance}`;
    };

    return {unitPrefs: {distance}, formatDistance};
  }, [unitOfLength, localePref, decimalPrecision]);
}

/* ── AnimatedNumber (native-safe port of data-display/AnimatedNumber.tsx) ──── */

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  style?: StyleProp<TextStyle>;
}

function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  suffix,
  style,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = Date.now();
    const to = value;
    const durationMs = duration * 1000;

    function tick() {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - (1 - progress) * (1 - progress); // ease-out quad
      setDisplay(to * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return (
    <AppText style={[styles.tabularNums, style]} weight="bold">
      {fmtNumber(display, decimals)}
      {suffix}
    </AppText>
  );
}

/* ── lucide-react glyph stand-ins (web L5-8) ──────────────────────────────── */

const GLYPH_CAR = '\uD83D\uDE97'; // 🚗 Car
const GLYPH_BATTERY = '\uD83D\uDD0B'; // 🔋 Battery
const GLYPH_GAUGE = '\uD83E\uDDED'; // 🧭 Gauge
const GLYPH_ZAP = '\u26A1'; // ⚡ Zap
const GLYPH_ACTIVITY = '\uD83D\uDCC8'; // 📈 Activity
const GLYPH_REFRESH = '\u21BB'; // ↻ RefreshCw
const GLYPH_COMPARE = '\u21C4'; // ⇄ ArrowLeftRight
const GLYPH_EXTERNAL = '\u2197'; // ↗ ExternalLink
const GLYPH_TRASH = '\uD83D\uDDD1'; // 🗑 Trash2
const GLYPH_LOCK = '\uD83D\uDD12'; // 🔒 Lock
const GLYPH_SHIELD = '\uD83D\uDEE1'; // 🛡 Shield
const GLYPH_PIN = '\uD83D\uDCCC'; // 📌 Pin

/* ── native FadeIn / StaggerContainer / StaggerItem (web @/components/motion) ─ */

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  // framer-motion has no native equivalent; render statically (no entrance anim).
  return <View>{children}</View>;
}

function StaggerContainer({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

function StaggerItem({children}: {children: ReactNode}) {
  return <View>{children}</View>;
}

/* ── native Skeleton / StatGridSkeleton (web @/components/feedback) ────────── */

function Skeleton({style}: {style?: StyleProp<ViewStyle>}) {
  return <View style={[styles.skeleton, style]} />;
}

function StatGridSkeleton({cards}: {cards: number}) {
  return (
    <View style={styles.summaryGrid}>
      {Array.from({length: cards}).map((_, i) => (
        <View key={i} style={styles.summaryCell}>
          <Skeleton style={styles.skeletonStat} />
        </View>
      ))}
    </View>
  );
}

/* ── native Badge (web @/components/ui Badge) ─────────────────────────────── */

const BADGE_COLORS: Record<BadgeVariant, {bg: string; fg: string}> = {
  success: {bg: colors.successSurface, fg: colors.success},
  warning: {bg: colors.warningSurface, fg: colors.warning},
  danger: {bg: colors.dangerSurface, fg: colors.danger},
  info: {bg: colors.accentSoft, fg: colors.accent},
  neutral: {bg: colors.surfaceRaised, fg: colors.textSecondary},
};

function Badge({
  variant = 'neutral',
  dot,
  children,
}: {
  variant?: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
}) {
  const palette = BADGE_COLORS[variant];
  return (
    <View style={[styles.badge, {backgroundColor: palette.bg}]}>
      {dot ? <View style={[styles.badgeDot, {backgroundColor: palette.fg}]} /> : null}
      <AppText style={[styles.badgeText, {color: palette.fg}]}>{children}</AppText>
    </View>
  );
}

/* ── native Button (web @/components/ui Button — icon + loading + variant) ─── */

function PageButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline';
  icon?: string;
  loading?: boolean;
  testID?: string;
}) {
  const disabled = loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'outline' ? styles.buttonOutline : styles.buttonPrimary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
      testID={testID}>
      <AppText
        style={[
          styles.buttonIcon,
          variant === 'outline' ? styles.buttonOutlineText : styles.buttonPrimaryText,
        ]}>
        {loading ? GLYPH_REFRESH : icon}
      </AppText>
      <AppText
        style={variant === 'outline' ? styles.buttonOutlineText : styles.buttonPrimaryText}
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── native PinButton (web @/components/ui PinButton) ─────────────────────── */

function PinButton({itemId}: {itemId: string | number}) {
  const {data: pinned = []} = usePinned('vehicle');
  const toggle = useTogglePin('vehicle');
  const idStr = String(itemId);
  const isPinned = pinned.some(p => String(p.item_id) === idStr);

  return (
    <Pressable
      accessibilityLabel={isPinned ? 'Unpin' : 'Pin'}
      accessibilityRole="button"
      accessibilityState={{selected: isPinned, disabled: toggle.isPending}}
      disabled={toggle.isPending}
      hitSlop={6}
      onPress={() => {
        if (toggle.isPending) return;
        toggle.mutate({itemId: idStr, pin: !isPinned});
      }}
      style={styles.iconAction}
      testID="pin-button">
      <AppText
        style={[styles.iconActionGlyph, {color: isPinned ? '#fcd34d' : colors.textMuted}]}>
        {GLYPH_PIN}
      </AppText>
    </Pressable>
  );
}

/* ── native Link (web react-router-dom Link) + useNavigate ────────────────── */

function useNavigate() {
  return useMemo(
    () =>
      (_to: string): void => {
        // The native navigator owns routing; the web target path is captured for
        // parity intent but no client-side navigation occurs from this port.
      },
    [],
  );
}

function Link({
  to,
  onNavigate,
  style,
  children,
}: {
  to: string;
  onNavigate: (to: string) => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => onNavigate(to)}
      style={style}>
      {children}
    </Pressable>
  );
}

/* ── native EmptyState (web @/components/feedback EmptyState) ──────────────── */

function EmptyState({
  icon,
  title,
  message,
  action,
  testID,
}: {
  icon?: string;
  title?: string;
  message: string;
  action?: {label: string; onClick: () => void};
  testID?: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState} testID={testID}>
      {icon ? <AppText style={styles.emptyIcon}>{icon}</AppText> : null}
      {title ? (
        <AppText style={styles.emptyTitle} weight="semibold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
      {action ? (
        <View style={styles.emptyAction}>
          <PageButton label={action.label} onPress={action.onClick} variant="outline" />
        </View>
      ) : null}
    </View>
  );
}

/* ── DataFreshnessAuto (web @/components/data-display DataFreshnessAuto) ───── */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

interface FreshnessQuery {
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  fresh: '\u25CF', // ●
  fetching: '\u21BB', // ↻
  stale: '\u25CF', // ●
  error: '\u2715', // ✕
};

function relativeFreshness(ms: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return t('freshness.justNow', 'just now');
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return `${Math.floor(seconds / 604_800)}w ago`;
}

function DataFreshnessAuto({query}: {query: FreshnessQuery}) {
  const t = useNativeTranslation();
  const status: FreshnessStatus = query.isError
    ? 'error'
    : query.isFetching
    ? 'fetching'
    : query.isStale
    ? 'stale'
    : 'fresh';

  const color = FRESHNESS_COLOR[status];
  const updatedAt = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;
  const relativeTime =
    updatedAt && !query.isFetching
      ? relativeFreshness(updatedAt, t)
      : query.isFetching
      ? t('freshness.updating', 'updating…')
      : query.isError
      ? t('freshness.error', 'error')
      : '';

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        if (!query.isFetching) query.refetch();
      }}
      style={styles.freshness}
      testID="data-freshness">
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.freshnessGlyph, {color}]}>
        {FRESHNESS_GLYPH[status]}
      </AppText>
      <AppText style={[styles.freshnessText, {color}]}>{relativeTime}</AppText>
    </Pressable>
  );
}

/* ── native PageContainer (web @/components/layout PageContainer) ──────────── */

function PageContainer({
  title,
  subtitle,
  actions,
  error,
  children,
  testID,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  error?: Error;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.scaffold}
      testID={testID ?? 'vehicle-list-page'}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.headerActions}>{actions}</View> : null}
      </View>

      {error ? (
        <View style={styles.pageError} testID="vehicle-list-page-error">
          <AppText style={styles.pageErrorText}>{error.message}</AppText>
        </View>
      ) : null}

      <View style={styles.body}>{children}</View>
    </ScrollView>
  );
}

/* ── Loading skeleton (web L39-54) ────────────────────────────────────────── */

function VehicleListSkeleton() {
  const t = useNativeTranslation();
  return (
    <PageContainer title={t('nav.vehicles', 'Fleet')}>
      <View style={styles.skeletonStack} testID="vehicle-list-skeleton">
        <StatGridSkeleton cards={4} />
        <Skeleton style={styles.skeletonHero} />
        <View style={styles.skeletonRows}>
          {Array.from({length: 3}).map((_, i) => (
            <Skeleton key={i} style={styles.skeletonRow} />
          ))}
        </View>
      </View>
    </PageContainer>
  );
}

/* ── fleet-states entry type (web L113-114) ───────────────────────────────── */

interface FleetEntry {
  vehicle: Vehicle;
  state: VehicleState | null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   VehicleListPage — /vehicles Fleet landing
   ═══════════════════════════════════════════════════════════════════════════ */

export default function VehicleListPage() {
  const t = useNativeTranslation();
  usePageTitle(t('nav.vehicles', 'Fleet'));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const {unitPrefs, formatDistance} = useUnits();

  /* ── Data ── */
  const vehiclesQuery = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
    staleTime: 30_000,
  });
  const {data: vehicles, isLoading, error} = vehiclesQuery;

  // Web uses `const vehicleList = vehicles ?? []` inline; native lint
  // (react-hooks/exhaustive-deps) requires a stable reference for the useMemo /
  // query-key dependencies below, so it is memoized over `vehicles` — identical
  // value, stable identity.
  const vehicleList = useMemo(() => vehicles ?? [], [vehicles]);
  const primaryId = vehicleList[0]?.id;
  useVehicleLive(primaryId);

  /* Pinned vehicles float to the top of the list. */
  const {data: vehiclePins = []} = usePinned('vehicle');
  const sortedVehicleList = useMemo(() => {
    if (vehiclePins.length === 0) return vehicleList;
    const order = new Map<string, number>();
    vehiclePins.forEach(p => order.set(String(p.item_id), p.position));
    return [...vehicleList].sort((a, b) => {
      const ap = order.get(String(a.id));
      const bp = order.get(String(b.id));
      if (ap != null && bp != null) return ap - bp;
      if (ap != null) return -1;
      if (bp != null) return 1;
      return 0;
    });
  }, [vehicleList, vehiclePins]);

  /* Batch-fetch vehicle states for summary + battery chart */
  const {data: fleetStates} = useQuery({
    queryKey: ['fleet-vehicle-states', vehicleList.map(v => v.id).sort()],
    queryFn: () =>
      Promise.all(
        vehicleList.map(async (v): Promise<FleetEntry> => {
          try {
            const {state} = await fetchVehicleState(v.id);
            // Native fetchVehicleState widens `.state` to a legacy scalar string;
            // the web contract is always a structured VehicleState object (or
            // absent), so keep only object states (else null) — matching web.
            return {
              vehicle: v,
              state: state != null && typeof state === 'object' ? state : null,
            };
          } catch {
            return {vehicle: v, state: null};
          }
        }),
      ),
    enabled: vehicleList.length > 0,
    refetchInterval: 30_000,
  });

  /* ── Computed fleet metrics ── */
  const fleet = useMemo(() => {
    const withState = (fleetStates ?? []).filter(
      (e): e is {vehicle: Vehicle; state: VehicleState} => e.state !== null,
    );
    const avg =
      withState.length > 0
        ? withState.reduce((s, e) => s + (e.state.battery_level ?? 0), 0) / withState.length
        : 0;
    const totalRange = withState.reduce((s, e) => s + (e.state.rated_range ?? 0), 0);
    const charging = withState.filter(e => e.state.is_charging).length;
    return {
      entries: withState,
      avgBattery: avg,
      totalRange,
      chargingCount: charging,
      onlineCount: withState.length,
    };
  }, [fleetStates]);

  /* ── Mutations ── */
  const toast = useToast();
  const syncMut = useMutation({
    mutationFn: () => request<{synced: number}>('/vehicles/sync', {method: 'POST'}),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['vehicles']});
      toast.success(t('vehicles.syncToast', 'Vehicles synced successfully'));
    },
    onError: (err: Error) => {
      toast.error(err.message || t('vehicles.syncFailed', 'Failed to sync vehicles'));
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => request<void>(`/vehicles/${id}`, {method: 'DELETE'}),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['vehicles']});
      queryClient.invalidateQueries({queryKey: ['fleet-vehicle-states']});
      setDeleteTarget(null);
      toast.success(t('vehicles.deleteSuccess', 'Vehicle removed'));
    },
    onError: (err: Error) => {
      toast.error(err.message || t('vehicles.deleteFailed', 'Failed to remove vehicle'));
    },
  });

  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null);

  /* ── Loading skeleton ── */
  if (isLoading) {
    return <VehicleListSkeleton />;
  }

  /* ── Error state ── */
  if (error) {
    return (
      <PageContainer
        error={error instanceof Error ? error : new Error(String(error))}
        title={t('nav.vehicles', 'Fleet')}>
        <GlassPanel style={styles.errorPanel}>
          <AppText style={styles.errorText}>
            {t('vehicles.loadError', 'Failed to load vehicles.')}
          </AppText>
        </GlassPanel>
      </PageContainer>
    );
  }

  /* ── Render ── */
  return (
    <PageContainer
      actions={
        <View style={styles.actions}>
          <DataFreshnessAuto query={vehiclesQuery} />
          {vehicleList.length >= 2 ? (
            <PageButton
              icon={GLYPH_COMPARE}
              label={t('vehicles.compareButton', 'Compare vehicles')}
              onPress={() => {
                // Pre-fill the first two vehicles via query params so users land
                // on a populated comparison instead of empty selectors.
                const leftId = vehicleList[0]?.id ?? '';
                const rightId = vehicleList[1]?.id ?? '';
                navigate(`/vehicle-comparison?leftId=${leftId}&rightId=${rightId}`);
              }}
              testID="compare-button"
              variant="outline"
            />
          ) : null}
          <PageButton
            icon={GLYPH_REFRESH}
            label={t('vehicles.syncButton', 'Sync from Tesla')}
            loading={syncMut.isPending}
            onPress={() => syncMut.mutate()}
            testID="sync-button"
          />
        </View>
      }
      subtitle={t('vehicles.subtitle', 'View, manage, and sync your Tesla vehicles')}
      title={t('nav.vehicles', 'Fleet')}>
      {/* Sync feedback banners */}
      {syncMut.isSuccess ? (
        <FadeIn>
          <GlassPanel style={[styles.banner, styles.bannerSuccess]} testID="sync-success-banner">
            <AppText style={styles.bannerSuccessText}>
              {t('vehicles.syncSuccess', 'Vehicles synced successfully.')}
            </AppText>
          </GlassPanel>
        </FadeIn>
      ) : null}
      {syncMut.isError ? (
        <FadeIn>
          <GlassPanel style={[styles.banner, styles.bannerError]} testID="sync-error-banner">
            <AppText style={styles.bannerErrorText}>
              {t('vehicles.syncError', 'Sync failed. Please try again.')}
            </AppText>
          </GlassPanel>
        </FadeIn>
      ) : null}

      {vehicleList.length === 0 ? (
        <EmptyState
          action={{
            label: t('vehicles.syncButton', 'Sync from Tesla'),
            onClick: () => syncMut.mutate(),
          }}
          icon={GLYPH_CAR}
          message={t(
            'vehicles.emptyMessage',
            'Connect your Tesla account and sync your vehicles to get started with fleet tracking, battery monitoring, and trip analysis.',
          )}
          testID="vehicles-empty"
          title={t('vehicles.emptyTitle', 'No vehicles yet')}
        />
      ) : (
        <View style={styles.sections}>
          {/* ── Fleet Summary ── */}
          <FadeIn delay={0.05}>
            <View style={styles.summaryGrid} testID="fleet-summary">
              <View style={styles.summaryCell}>
                <SummaryTile
                  color="cyan"
                  glyph={GLYPH_CAR}
                  label={t('vehicles.totalVehicles', 'Total Vehicles')}
                  value={vehicleList.length}
                />
              </View>
              <View style={styles.summaryCell}>
                <SummaryTile
                  color="green"
                  glyph={GLYPH_BATTERY}
                  label={t('vehicles.avgBattery', 'Avg Battery')}
                  value={`${fmtNumber(fleet.avgBattery)}%`}
                />
              </View>
              <View style={styles.summaryCell}>
                <SummaryTile
                  color="purple"
                  glyph={GLYPH_GAUGE}
                  label={`${t('vehicles.totalRange', 'Total Range')} (${unitPrefs.distance})`}
                  value={fmtNumber(convertDistanceFromSI(fleet.totalRange, unitPrefs.distance))}
                />
              </View>
              <View style={styles.summaryCell}>
                <SummaryTile
                  color="green"
                  glyph={GLYPH_ZAP}
                  label={t('vehicles.chargingOnline', 'Charging / Online')}
                  value={`${fleet.chargingCount} / ${fleet.onlineCount}`}
                />
              </View>
            </View>
          </FadeIn>

          {/* ── Battery Comparison Chart ── */}
          <FadeIn delay={0.1}>
            <GlassPanel style={styles.panel} testID="battery-status-panel">
              <View style={styles.panelHeader}>
                <View style={styles.panelHeaderTitle}>
                  <AppText style={[styles.panelHeaderGlyph, styles.cyanText]}>
                    {GLYPH_ACTIVITY}
                  </AppText>
                  <AppText style={styles.panelTitle} weight="semibold">
                    {t('vehicles.batteryStatus', 'Fleet Battery Status')}
                  </AppText>
                </View>
                <View style={styles.panelHeaderMeta}>
                  <AnimatedNumber
                    style={styles.panelMetaText}
                    suffix="%"
                    value={Math.round(fleet.avgBattery)}
                  />
                  <AppText style={styles.panelMetaText}>
                    {' '}
                    {t('vehicles.avgLabel', 'avg')}
                  </AppText>
                </View>
              </View>

              {fleet.entries.length > 0 ? (
                <View style={styles.batteryList}>
                  {fleet.entries.map(({vehicle, state}) => {
                    const level = state.battery_level ?? 0;
                    const color = batteryColor(level);
                    return (
                      <View key={vehicle.id} style={styles.batteryRow}>
                        <AppText
                          numberOfLines={1}
                          style={styles.batteryName}
                          tone="secondary">
                          {vehicle.display_name || vehicle.vin}
                        </AppText>
                        <View style={styles.batteryTrack}>
                          <View
                            style={[
                              styles.batteryFill,
                              {backgroundColor: color, width: `${level}%`},
                            ]}
                          />
                        </View>
                        <AppText style={styles.batteryPct} weight="semibold">
                          {level}%
                        </AppText>
                        <AppText style={styles.batteryRange} tone="secondary">
                          {formatDistance(state.rated_range ?? 0)}
                        </AppText>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <EmptyState
                  icon={GLYPH_ACTIVITY}
                  message={t('common.noData', 'No data available')}
                  testID="battery-status-empty"
                />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── Vehicle Cards header ── */}
          <FadeIn delay={0.15}>
            <View style={styles.allVehiclesHeader}>
              <AppText style={[styles.panelHeaderGlyph, styles.purpleText]}>
                {GLYPH_CAR}
              </AppText>
              <AppText style={styles.panelTitle} weight="semibold">
                {t('vehicles.allVehicles', 'All Vehicles')}
              </AppText>
            </View>
          </FadeIn>

          {/* ── Vehicle Cards ── */}
          <View testID="vehicles-list">
            <StaggerContainer style={styles.cardList}>
              {sortedVehicleList.map(vehicle => {
                const entry = fleet.entries.find(e => e.vehicle.id === vehicle.id);
                const state = entry?.state ?? null;
                const status = deriveVehicleStatus(state);
                const level = state?.battery_level ?? 0;
                const color = batteryColor(level);

                return (
                  <StaggerItem key={vehicle.id}>
                    <GlassPanel style={styles.card} testID="vehicles-card">
                      <View style={styles.cardAccent}>
                        <View style={[styles.cardAccentSegment, styles.cyanBg]} />
                        <View style={[styles.cardAccentSegment, styles.purpleBg]} />
                        <View style={[styles.cardAccentSegment, styles.greenBg]} />
                      </View>

                      <View style={styles.cardBody}>
                        <View style={styles.cardRow}>
                          {/* Vehicle info */}
                          <View style={styles.cardInfo}>
                            <View style={styles.cardTitleRow}>
                              <Link
                                onNavigate={navigate}
                                style={styles.cardTitleLink}
                                to={`/vehicles/${vehicle.id}`}>
                                <AppText
                                  numberOfLines={1}
                                  style={styles.cardTitle}
                                  weight="semibold">
                                  {vehicle.display_name || vehicle.vin}
                                </AppText>
                              </Link>
                              <Badge dot variant={statusVariant(status)}>
                                {status}
                              </Badge>
                            </View>

                            <AppText style={styles.cardMeta} tone="secondary">
                              {vehicle.model} {vehicle.trim_badging} ·{' '}
                              <AppText style={styles.cardVin} tone="secondary">
                                {vehicle.vin}
                              </AppText>
                            </AppText>

                            {/* Battery + stats row */}
                            <View style={styles.cardStatsRow}>
                              <View style={styles.cardBattery}>
                                <View style={styles.cardBatteryTrack}>
                                  <View
                                    style={[
                                      styles.cardBatteryFill,
                                      {backgroundColor: color, width: `${level}%`},
                                    ]}
                                  />
                                </View>
                                <AnimatedNumber
                                  style={styles.cardBatteryPct}
                                  suffix="%"
                                  value={level}
                                />
                              </View>

                              {state ? (
                                <>
                                  <AppText style={styles.cardStat} tone="secondary">
                                    {formatDistance(state.rated_range ?? 0)}
                                  </AppText>
                                  <AppText style={styles.cardStat} tone="secondary">
                                    {formatDistance(state.odometer ?? 0)}
                                  </AppText>
                                  {state.is_charging ? (
                                    <AppText style={styles.cardCharging} weight="semibold">
                                      {state.charger_power} kW
                                    </AppText>
                                  ) : null}
                                </>
                              ) : null}

                              <View style={styles.cardFlags}>
                                {state?.is_locked ? (
                                  <AppText style={[styles.flagGlyph, styles.greenText]}>
                                    {GLYPH_LOCK}
                                  </AppText>
                                ) : null}
                                {state?.sentry_mode ? (
                                  <AppText style={[styles.flagGlyph, styles.cyanText]}>
                                    {GLYPH_SHIELD}
                                  </AppText>
                                ) : null}
                              </View>
                            </View>
                          </View>

                          {/* Actions */}
                          <View style={styles.cardActions}>
                            <PinButton itemId={vehicle.id} />
                            <Link
                              onNavigate={navigate}
                              style={styles.iconAction}
                              to={`/vehicles/${vehicle.id}`}>
                              <AppText style={styles.iconActionGlyph} tone="secondary">
                                {GLYPH_EXTERNAL}
                              </AppText>
                            </Link>
                            <Pressable
                              accessibilityLabel={t('common.delete', 'Remove')}
                              accessibilityRole="button"
                              hitSlop={6}
                              onPress={() => setDeleteTarget(vehicle)}
                              style={styles.iconAction}
                              testID={`delete-vehicle-${vehicle.id}`}>
                              <AppText style={[styles.iconActionGlyph, styles.dangerText]}>
                                {GLYPH_TRASH}
                              </AppText>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    </GlassPanel>
                  </StaggerItem>
                );
              })}
            </StaggerContainer>
          </View>
        </View>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        confirmLabel={t('common.delete', 'Remove')}
        message={
          deleteTarget
            ? t('vehicles.removeMessage', `Are you sure you want to remove "${
                deleteTarget.display_name || deleteTarget.vin
              }"? This will delete all associated data including drives, charges, and state history.`)
            : ''
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMut.mutate(deleteTarget.id);
        }}
        open={deleteTarget !== null}
        title={t('vehicles.removeTitle', 'Remove Vehicle')}
        variant="danger"
      />
    </PageContainer>
  );
}

/* ── SummaryTile (web MetricCard adapter) ─────────────────────────────────── */

function SummaryTile({
  label,
  value,
  glyph,
  color,
}: {
  label: string;
  value: string | number;
  glyph: string;
  color: NeonColor;
}) {
  return <MetricCard color={color} icon={glyph} label={label} value={value} />;
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    rowGap: spacing.sm,
  },
  allVehiclesHeader: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    columnGap: spacing.xs,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeDot: {
    borderRadius: 999,
    height: 6,
    width: 6,
  },
  badgeText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  banner: {
    borderWidth: 1,
    padding: spacing.md,
  },
  bannerError: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  bannerErrorText: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  bannerSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  bannerSuccessText: {
    color: colors.success,
    fontSize: typography.caption,
  },
  batteryFill: {
    borderRadius: 999,
    height: '100%',
  },
  batteryList: {
    rowGap: spacing.md,
  },
  batteryName: {
    fontSize: typography.caption,
    width: 96,
  },
  batteryPct: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    textAlign: 'right',
    width: 40,
  },
  batteryRange: {
    fontSize: 10,
    textAlign: 'right',
    width: 64,
  },
  batteryRow: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  batteryTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 999,
    flex: 1,
    height: 12,
    overflow: 'hidden',
  },
  body: {
    rowGap: spacing.lg,
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    columnGap: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonIcon: {
    fontSize: 14,
  },
  buttonOutline: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonOutlineText: {
    color: colors.textPrimary,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonPrimaryText: {
    color: colors.background,
  },
  card: {
    overflow: 'hidden',
    padding: 0,
  },
  cardAccent: {
    flexDirection: 'row',
    height: 4,
    opacity: 0.5,
  },
  cardAccentSegment: {
    flex: 1,
    height: '100%',
  },
  cardActions: {
    alignItems: 'center',
    flexShrink: 0,
    rowGap: spacing.xs,
  },
  cardBattery: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  cardBatteryFill: {
    borderRadius: 999,
    height: '100%',
  },
  cardBatteryPct: {
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  cardBatteryTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
    width: 80,
  },
  cardBody: {
    padding: spacing.lg,
  },
  cardCharging: {
    color: colors.success,
    fontSize: typography.caption,
  },
  cardFlags: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    marginLeft: 'auto',
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardList: {
    rowGap: spacing.md,
  },
  cardMeta: {
    fontSize: typography.caption,
    marginBottom: spacing.md,
  },
  cardRow: {
    columnGap: spacing.lg,
    flexDirection: 'row',
  },
  cardStat: {
    fontSize: typography.caption,
  },
  cardStatsRow: {
    alignItems: 'center',
    columnGap: spacing.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  cardTitleLink: {
    flexShrink: 1,
  },
  cardTitleRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  cardVin: {
    fontSize: typography.caption,
  },
  cyanBg: {
    backgroundColor: '#22d3ee',
  },
  cyanText: {
    color: '#22d3ee',
  },
  dangerText: {
    color: colors.danger,
  },
  emptyAction: {
    marginTop: spacing.md,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  emptyMessage: {
    fontSize: typography.caption,
    maxWidth: 360,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    rowGap: spacing.xs,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  errorPanel: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  flagGlyph: {
    fontSize: 14,
  },
  freshness: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  freshnessGlyph: {
    fontSize: 10,
  },
  freshnessText: {
    fontSize: typography.caption,
  },
  greenBg: {
    backgroundColor: '#34d399',
  },
  greenText: {
    color: colors.success,
  },
  header: {
    alignItems: 'flex-start',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  headerText: {
    flex: 1,
    minWidth: 200,
    rowGap: spacing.xs,
  },
  iconAction: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    padding: spacing.sm,
  },
  iconActionGlyph: {
    fontSize: 16,
  },
  pageError: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  pageErrorText: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  pageSubtitle: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panel: {
    padding: spacing.lg,
    rowGap: spacing.md,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  panelHeaderGlyph: {
    fontSize: 14,
  },
  panelHeaderMeta: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  panelHeaderTitle: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  panelMetaText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  purpleBg: {
    backgroundColor: '#c084fc',
  },
  purpleText: {
    color: '#c084fc',
  },
  scaffold: {
    padding: spacing.lg,
    rowGap: spacing.lg,
  },
  sections: {
    rowGap: spacing.xl,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
  },
  skeletonHero: {
    borderRadius: 16,
    height: 144,
  },
  skeletonRow: {
    borderRadius: 16,
    height: 112,
  },
  skeletonRows: {
    rowGap: spacing.md,
  },
  skeletonStack: {
    rowGap: spacing.lg,
  },
  skeletonStat: {
    height: 96,
  },
  summaryCell: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },
  summaryGrid: {
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  tabularNums: {
    fontVariant: ['tabular-nums'],
  },
});
