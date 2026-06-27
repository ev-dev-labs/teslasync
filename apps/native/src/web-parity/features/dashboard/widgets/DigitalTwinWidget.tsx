import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/dashboard/widgets/DigitalTwinWidget.tsx.
//
// The web widget is the dashboard "Digital Twin" tile. It resolves a vehicle
// (`vehicleId` prop -> matching vehicle, else the first vehicle from
// `useVehicles()`), polls `useVehicleState(id, {refetchInterval: 5_000})`,
// `useSecurityLatest(id, 5_000)` and `useChargingTelemetryLatest(id, 5_000)`
// (GET /api/v1/vehicles/{id}/state, /security/latest?vehicle_id=,
// /charging-telemetry/latest?vehicle_id= — all preserved verbatim by the
// already-ported native useVehicles hooks), merges them with `buildTwinState`
// into a `VehicleTwinState`, and renders inside a `WidgetShell` either the
// `VehicleTwin` car diagram + a wrapping status-chip row + the vehicle name, or
// — when no vehicle is resolved — an `EmptyState` ("No vehicle data").
//
// Every state name (`vehicles`, `vehicle`, `id`, `stateData`, `stateLoading`,
// `isFetching`, `isStale`, `isError`, `dataUpdatedAt`, `refetch`, `security`,
// `securityLoading`, `charging`, `state`, `twinState`, `windowStates`,
// `hasWindowData`, `openWindowCount`, `sideDoorStates`, `openDoorCount`,
// `twinSize`, `lockBadgeVariant`, `lockLabel`, `windowBadgeVariant`,
// `windowLabel`), the `vehicleId ? vehicles?.find(...) ?? vehicles?.[0] :
// vehicles?.[0]` resolution, the `REFRESH_INTERVAL = 5_000` constant, the
// `useMemo(buildTwinState, [security, state, charging])` memoization, every
// derived count / variant / label expression, and every `widget.*` i18n key
// with its English fallback are preserved. `buildTwinState` and its parser
// helpers (`@/lib/vehicleState` + `@/lib/parseEnums` + `@/lib/typeGuards`) are
// inlined verbatim because they are not yet ported. Browser-only pieces are
// mapped to native-safe equivalents (documented in the parity sidecar):
//
//   - react-i18next `useTranslation('dashboard')` -> local
//     `useNativeTranslationFallback()` t() shim returning the English fallback
//     verbatim (same pattern as the sibling widget ports).
//   - lucide-react `Monitor, Lock, Unlock, ArrowUpRight` -> decorative Unicode
//     glyphs in an `AppText` with `importantForAccessibility="no"` (Monitor
//     '\u{1F5A5}', Lock '\u{1F512}', Unlock '\u{1F513}', ArrowUpRight
//     '\u2197'); h-3.5 (14px) -> title icon fontSize 14, h-5 (20px) -> empty
//     icon fontSize 20, h-2.5 (10px) -> badge icon fontSize 10. `text-neon-purple`
//     maps to the violet token.
//   - react-router-dom `<Link to="/digital-twin">` -> a `Pressable` with
//     `accessibilityRole="link"` whose onPress is intentionally inert: the
//     standalone web-parity layer has no navigator wired in, so the "Open"
//     affordance is presentational-only (documented in the sidecar).
//   - `@/components/ui` `Badge` -> inlined `WidgetBadge` (variant -> token
//     surface + text colour, optional `dot` in the text colour, optional lock
//     glyph; rounded-full, gap-1, px-2/py-0.5, text-xs/font-medium). The web
//     `info` variant has no token, so it maps to the literal blue rgba/hex.
//   - `@/components/feedback` `EmptyState` -> inlined `WidgetEmptyState`
//     (centered glyph icon + muted message; the Monitor h-5 icon, message key,
//     and py-4 padding intent preserved). The web `WidgetShell` -> an inlined
//     native `WidgetShell` on a GlassPanel (Spinner loading, danger-text error,
//     uppercase title row + a compact freshness dot/refresh control + the
//     `actions` slot) — identical to the sibling widget ports, now also
//     forwarding `actions`.
//   - `@/components/vehicles` `VehicleTwin` is the already-ported native SVG-less
//     car diagram; the `relative z-10 drop-shadow-2xl` wrapper -> a zIndexed
//     View (RN has no drop-shadow filter) and the `bg-neon-purple/10 blur-2xl`
//     glow -> a translucent violet rounded View (RN has no blur filter).
//   - SI note: web `buildTwinState` read `charging.charger_power_kw`; the ported
//     native `ChargingTelemetry` is SI and exposes `charger_power_w` instead.
//     The charging-active test is `> 0`, identical in either unit, so it reads
//     `charger_power_w` here (Phase-48 SI canonical, no legacy `_kwh`/`_kw`).

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useChargingTelemetryLatest,
  useSecurityLatest,
  useVehicleState,
  useVehicles,
  type ChargingTelemetry,
  type SecurityEvent,
  type VehicleState,
} from '../../../api/hooks/useVehicles';
import {Spinner} from '../../../components/feedback/Spinner';
import {
  VehicleTwin,
  type DoorStates,
  type TurnSignalState,
  type VehicleTwinSize,
  type VehicleTwinState,
  type WindowState,
} from '../../../components/vehicles/VehicleTwin';

const REFRESH_INTERVAL = 5_000;

/* ─── local widget types (mirror ./types — not yet ported) ─────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── i18n fallback shim (web react-i18next is unavailable in native) ───────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── decorative glyphs (lucide-react stand-ins) ───────────────────────────── */

const ICON_MONITOR = '\u{1F5A5}'; // lucide Monitor
const ICON_LOCK = '\u{1F512}'; // lucide Lock
const ICON_UNLOCK = '\u{1F513}'; // lucide Unlock
const GLYPH_ARROW_UP_RIGHT = '\u2197'; // lucide ArrowUpRight
const GLYPH_REFRESH = '\u21BB';

function GlyphLegacyUnused({glyph, style}: {glyph: string; style?: StyleProp<TextStyle>}) {
  return (
    <AppText allowFontScaling={false} importantForAccessibility="no" style={style}>
      {glyph}
    </AppText>
  );
}

/* ─── inlined type guard (web @/lib/typeGuards asNonEmptyString) ────────────── */

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/* ─── inlined twin-state builder (web @/lib/vehicleState buildTwinState) ─────
   Ported verbatim from web/src/lib/vehicleState.ts (with its parseEnums
   parseWindowState inlined as parseWindowEnum). The DoorStates / WindowState /
   TurnSignalState / VehicleTwinState types are imported from the already-ported
   VehicleTwin so the spread into <VehicleTwin {...twinState}/> stays type-safe. */

const UNKNOWN_DOORS: DoorStates = {
  driverFront: null,
  passengerFront: null,
  driverRear: null,
  passengerRear: null,
  trunkFront: null,
  trunkRear: null,
};

function parseDoorState(doorState: unknown): DoorStates {
  if (
    doorState !== null &&
    typeof doorState === 'object' &&
    !Array.isArray(doorState)
  ) {
    const parsed = doorState as Record<string, unknown>;
    return {
      driverFront:
        parsed.DriverFront != null
          ? Boolean(parsed.DriverFront)
          : parsed.driver_front != null
            ? Boolean(parsed.driver_front)
            : null,
      passengerFront:
        parsed.PassengerFront != null
          ? Boolean(parsed.PassengerFront)
          : parsed.passenger_front != null
            ? Boolean(parsed.passenger_front)
            : null,
      driverRear:
        parsed.DriverRear != null
          ? Boolean(parsed.DriverRear)
          : parsed.driver_rear != null
            ? Boolean(parsed.driver_rear)
            : null,
      passengerRear:
        parsed.PassengerRear != null
          ? Boolean(parsed.PassengerRear)
          : parsed.passenger_rear != null
            ? Boolean(parsed.passenger_rear)
            : null,
      trunkFront:
        parsed.TrunkFront != null
          ? Boolean(parsed.TrunkFront)
          : parsed.trunk_front != null
            ? Boolean(parsed.trunk_front)
            : null,
      trunkRear:
        parsed.TrunkRear != null
          ? Boolean(parsed.TrunkRear)
          : parsed.trunk_rear != null
            ? Boolean(parsed.trunk_rear)
            : null,
    };
  }

  const raw = asNonEmptyString(doorState);
  if (!raw) {
    return {...UNKNOWN_DOORS};
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return {...UNKNOWN_DOORS};
  }

  const lower = trimmed.toLowerCase();
  if (
    lower === 'closedall' ||
    lower === 'closed' ||
    lower === 'none' ||
    lower === '[]' ||
    lower === '0' ||
    lower === 'false'
  ) {
    return {
      driverFront: false,
      passengerFront: false,
      driverRear: false,
      passengerRear: false,
      trunkFront: null,
      trunkRear: null,
    };
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return {
        driverFront:
          parsed.DriverFront != null
            ? Boolean(parsed.DriverFront)
            : parsed.driver_front != null
              ? Boolean(parsed.driver_front)
              : null,
        passengerFront:
          parsed.PassengerFront != null
            ? Boolean(parsed.PassengerFront)
            : parsed.passenger_front != null
              ? Boolean(parsed.passenger_front)
              : null,
        driverRear:
          parsed.DriverRear != null
            ? Boolean(parsed.DriverRear)
            : parsed.driver_rear != null
              ? Boolean(parsed.driver_rear)
              : null,
        passengerRear:
          parsed.PassengerRear != null
            ? Boolean(parsed.PassengerRear)
            : parsed.passenger_rear != null
              ? Boolean(parsed.passenger_rear)
              : null,
        trunkFront:
          parsed.TrunkFront != null
            ? Boolean(parsed.TrunkFront)
            : parsed.trunk_front != null
              ? Boolean(parsed.trunk_front)
              : null,
        trunkRear:
          parsed.TrunkRear != null
            ? Boolean(parsed.TrunkRear)
            : parsed.trunk_rear != null
              ? Boolean(parsed.trunk_rear)
              : null,
      };
    } catch {
      // Fall through to string matching
    }
  }

  return {
    driverFront:
      lower.includes('driver') && lower.includes('front') ? true : null,
    passengerFront:
      lower.includes('passenger') && lower.includes('front') ? true : null,
    driverRear:
      (lower.includes('driver') && lower.includes('rear')) ||
      lower.includes('driverrear')
        ? true
        : null,
    passengerRear:
      (lower.includes('passenger') && lower.includes('rear')) ||
      lower.includes('passengerrear')
        ? true
        : null,
    trunkFront:
      lower.includes('frunk') ||
      lower.includes('fronttrunk') ||
      lower.includes('front_trunk') ||
      lower.includes('trunkfront') ||
      lower.includes('trunk_front')
        ? true
        : null,
    trunkRear:
      lower.includes('reartrunk') ||
      lower.includes('rear_trunk') ||
      lower.includes('trunkrear') ||
      lower.includes('trunk_rear') ||
      lower.includes('liftgate') ||
      (lower.includes('trunk') &&
        !lower.includes('frunk') &&
        !lower.includes('front'))
        ? true
        : null,
  };
}

// Inlined from web @/lib/parseEnums parseWindowState (string normalizer).
function parseWindowEnum(raw: unknown): string {
  const s = asNonEmptyString(raw);
  if (!s) {
    return '';
  }
  const g = s.replace(/WindowState/i, '');
  if (g.includes('Closed')) {
    return 'Closed';
  }
  if (g.includes('Partial')) {
    return 'Partial';
  }
  if (g.includes('Open')) {
    return 'Open';
  }
  return g || s;
}

function parseWindowState(state: unknown): WindowState {
  const raw = asNonEmptyString(state);
  if (!raw) {
    return null;
  }
  const clean = parseWindowEnum(raw);
  if (clean === 'Closed') {
    return 'closed';
  }
  if (clean === 'Partial') {
    return 'partial';
  }
  if (clean === 'Open') {
    return 'open';
  }
  const lower = raw.toLowerCase();
  if (lower.includes('closed') || lower === '0') {
    return 'closed';
  }
  if (lower.includes('partial') || lower.includes('vent')) {
    return 'partial';
  }
  if (lower.includes('open')) {
    return 'open';
  }
  return null;
}

function parseTurnSignal(signal: unknown): TurnSignalState {
  const raw = asNonEmptyString(signal);
  if (!raw) {
    return null;
  }
  const lower = raw.toLowerCase().replace(/turnsignal/i, '');
  if (lower.includes('both')) {
    return 'both';
  }
  if (lower.includes('left')) {
    return 'left';
  }
  if (lower.includes('right')) {
    return 'right';
  }
  if (lower.includes('off') || lower === '' || lower === '0') {
    return 'off';
  }
  return null;
}

const EMPTY_TWIN_STATE: VehicleTwinState = {
  doors: {...UNKNOWN_DOORS},
  windowFD: null,
  windowFP: null,
  windowRD: null,
  windowRP: null,
  frunkOpen: null,
  trunkOpen: null,
  chargePortOpen: null,
  isCharging: false,
  isDriving: false,
  locked: null,
  sentryMode: null,
  headlights: null,
  hazards: null,
  turnSignal: null,
  driverSeatOccupied: null,
  vehicleColor: '',
  lastUpdated: null,
};

function isVehicleDriving(
  vehicleState: {state?: string; speed?: number} | null | undefined,
): boolean {
  if (!vehicleState) {
    return false;
  }
  return (
    vehicleState.state?.toLowerCase() === 'driving' ||
    (vehicleState.speed ?? 0) > 0
  );
}

function isChargingActive(
  vehicleState: {is_charging?: boolean; charger_power?: number} | null | undefined,
  charging: {charging_state?: string | null; charger_power_w?: number | null} | null | undefined,
): boolean {
  const normalizedState =
    charging?.charging_state?.toLowerCase().replace(/[\s_-]/g, '') ?? '';
  return (
    Boolean(vehicleState?.is_charging) ||
    (vehicleState?.charger_power ?? 0) > 0 ||
    (charging?.charger_power_w ?? 0) > 0 ||
    normalizedState === 'charging' ||
    normalizedState === 'starting'
  );
}

function parseWindowOpenSummary(
  windowsOpen: unknown,
  aliases: string[],
): WindowState {
  const raw = asNonEmptyString(windowsOpen);
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  if (
    normalized === 'closed' ||
    normalized === 'none' ||
    normalized === '[]' ||
    normalized === 'false'
  ) {
    return 'closed';
  }
  return aliases.some(alias => normalized.includes(alias)) ? 'open' : null;
}

function buildTwinState(
  security: SecurityEvent | null | undefined,
  // The native useVehicleState types `state` as `VehicleState | string`; the web
  // hook typed it `any`. A raw string state is narrowed to null here (a string
  // has no .state/.speed/.is_locked fields, so the web read yielded undefined
  // for them anyway — behaviour is identical).
  vehicleState: VehicleState | string | null | undefined,
  charging: ChargingTelemetry | null | undefined,
): VehicleTwinState {
  if (!security && !vehicleState && !charging) {
    return {...EMPTY_TWIN_STATE};
  }
  const vs =
    vehicleState && typeof vehicleState === 'object' ? vehicleState : null;
  const doors = parseDoorState(security?.door_state ?? security?.doors_open);
  const chargingActive = isChargingActive(vs, charging);
  const windowsOpen = security?.windows_open ?? null;
  return {
    doors,
    windowFD:
      parseWindowState(security?.fd_window) ??
      parseWindowOpenSummary(windowsOpen, [
        'fd',
        'front driver',
        'driver front',
        'driver_front',
      ]),
    windowFP:
      parseWindowState(security?.fp_window) ??
      parseWindowOpenSummary(windowsOpen, [
        'fp',
        'front passenger',
        'passenger front',
        'passenger_front',
      ]),
    windowRD:
      parseWindowState(security?.rd_window) ??
      parseWindowOpenSummary(windowsOpen, [
        'rd',
        'rear driver',
        'driver rear',
        'driver_rear',
      ]),
    windowRP:
      parseWindowState(security?.rp_window) ??
      parseWindowOpenSummary(windowsOpen, [
        'rp',
        'rear passenger',
        'passenger rear',
        'passenger_rear',
      ]),
    frunkOpen: doors.trunkFront,
    trunkOpen: doors.trunkRear,
    chargePortOpen: charging?.charge_port_door_open ?? (chargingActive ? true : null),
    isCharging: chargingActive,
    isDriving: isVehicleDriving(vs),
    locked: security?.locked ?? vs?.is_locked ?? null,
    sentryMode: security?.sentry_mode ?? vs?.sentry_mode ?? null,
    headlights: security?.lights_high_beams ?? null,
    hazards: security?.lights_hazards_active ?? null,
    turnSignal: parseTurnSignal(security?.lights_turn_signal),
    driverSeatOccupied: security?.driver_seat_occupied ?? null,
    vehicleColor: '',
    lastUpdated: security?.created_at ?? null,
  };
}

/* ─── inlined Badge (web @/components/ui Badge) ─────────────────────────────── */

type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_COLORS: Record<BadgeVariant, {bg: string; text: string}> = {
  neutral: {bg: colors.surfaceRaised, text: colors.textSecondary},
  success: {bg: colors.successSurface, text: colors.success},
  warning: {bg: colors.warningSurface, text: colors.warning},
  danger: {bg: colors.dangerSurface, text: colors.danger},
  // web `info` (bg-blue-100/text-blue-800) has no token -> literal blue.
  info: {bg: 'rgba(59, 130, 246, 0.16)', text: '#60a5fa'},
};

function WidgetBadge({
  variant = 'neutral',
  dot,
  iconGlyph,
  children,
}: {
  variant?: BadgeVariant;
  dot?: boolean;
  iconGlyph?: string;
  children: string;
}) {
  const c = BADGE_COLORS[variant];
  return (
    <View style={[styles.badge, {backgroundColor: c.bg}]}>
      {dot ? <View style={[styles.badgeDot, {backgroundColor: c.text}]} /> : null}
      {iconGlyph ? (
        <Glyph glyph={iconGlyph} style={[styles.badgeIcon, {color: c.text}]} />
      ) : null}
      <AppText style={[styles.badgeText, {color: c.text}]}>{children}</AppText>
    </View>
  );
}

/* ─── inlined EmptyState (web @/components/feedback EmptyState) ─────────────── */

function WidgetEmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── inlined WidgetShell freshness control (web DataFreshness) ─────────────── */

interface WidgetFreshnessProps {
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetFreshness({
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetFreshnessProps) {
  let dotColor: string = colors.success;
  if (isError) {
    dotColor = colors.danger;
  } else if (isStale) {
    dotColor = colors.warning;
  } else if (isFetching) {
    dotColor = colors.accent;
  }

  const dot = <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />;

  if (!onRefresh) {
    return <View style={styles.freshnessRow}>{dot}</View>;
  }

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshnessRow}>
      {dot}
      <AppText importantForAccessibility="no" style={styles.freshnessGlyph}>
        {GLYPH_REFRESH}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined WidgetShell (web WidgetShell.tsx) ─────────────────────────────── */

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
  actions?: ReactNode;
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
  actions,
  children,
}: WidgetShellProps) {
  if (loading) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <Spinner size="sm" />
        </View>
      </GlassPanel>
    );
  }

  if (error) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <AppText style={styles.errorText} tone="danger">
            {error}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshness = showFreshness ? (
    <WidgetFreshness
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
    />
  ) : null;

  return (
    <GlassPanel style={styles.shell}>
      {title ? (
        <View style={styles.headerRow}>
          <View style={styles.headerTitleGroup}>
            {icon}
            <AppText style={styles.titleText} tone="muted">
              {title}
            </AppText>
          </View>
          <View style={styles.headerActions}>
            {freshness}
            {actions}
          </View>
        </View>
      ) : freshness ? (
        <View style={styles.freshnessOverlay}>{freshness}</View>
      ) : null}
      {children}
    </GlassPanel>
  );
}

/* ─── the widget ───────────────────────────────────────────────────────────── */

export default function DigitalTwinWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const vehicle = vehicleId
    ? vehicles?.find(v => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];
  const id = vehicle?.id ?? 0;
  const {
    data: stateData,
    isLoading: stateLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id, {refetchInterval: REFRESH_INTERVAL});
  const {data: security, isLoading: securityLoading} = useSecurityLatest(
    id,
    REFRESH_INTERVAL,
  );
  const {data: charging} = useChargingTelemetryLatest(id, REFRESH_INTERVAL);
  const state = stateData?.state;

  const twinState = useMemo(
    () => buildTwinState(security, state, charging),
    [security, state, charging],
  );

  // Web navigates to /digital-twin via react-router <Link>. The standalone
  // web-parity layer has no navigator wired in, so this affordance is inert
  // (documented in the parity sidecar).
  const handleOpenDigitalTwin = useCallback(() => {
    // no navigation target available in the parity layer
  }, []);

  const windowStates = [
    twinState.windowFD,
    twinState.windowFP,
    twinState.windowRD,
    twinState.windowRP,
  ];
  const hasWindowData = windowStates.some(windowState => windowState !== null);
  const openWindowCount = windowStates.filter(
    windowState => windowState !== null && windowState !== 'closed',
  ).length;
  const sideDoorStates = [
    twinState.doors.driverFront,
    twinState.doors.passengerFront,
    twinState.doors.driverRear,
    twinState.doors.passengerRear,
  ];
  const openDoorCount = sideDoorStates.filter(Boolean).length;
  const twinSize: VehicleTwinSize =
    size.cols >= 3 || size.rows >= 5 ? 'md' : 'sm';

  const lockBadgeVariant: BadgeVariant =
    twinState.locked === null ? 'neutral' : twinState.locked ? 'success' : 'danger';
  const lockLabel =
    twinState.locked === null
      ? t('widget.lockUnknown', 'Lock Unknown')
      : twinState.locked
        ? t('widget.locked', 'Locked')
        : t('widget.unlocked', 'Unlocked');
  const windowBadgeVariant: BadgeVariant = !hasWindowData
    ? 'neutral'
    : openWindowCount === 0
      ? 'success'
      : 'warning';
  const windowLabel = !hasWindowData
    ? t('widget.windowsUnknown', 'Windows Unknown')
    : openWindowCount === 0
      ? t('widget.windowsClosed', 'Windows Closed')
      : `${openWindowCount} ${t('widget.windowsOpen', 'Open')}`;

  return (
    <WidgetShell
      actions={
        <Pressable
          accessibilityRole="link"
          hitSlop={6}
          onPress={handleOpenDigitalTwin}
          style={styles.openAction}>
          <AppText style={styles.openText} tone="muted">
            {t('widget.open', 'Open')}
          </AppText>
          <Glyph glyph={GLYPH_ARROW_UP_RIGHT} style={styles.openGlyph} />
        </Pressable>
      }
      icon={<Glyph glyph={ICON_MONITOR} style={styles.titleIcon} />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={stateLoading || securityLoading}
      onRefresh={() => refetch()}
      title={t('widget.digitalTwin', 'Digital Twin')}
      updatedAt={dataUpdatedAt}>
      {vehicle ? (
        <View style={styles.body}>
          <View style={styles.twinWrap}>
            <View style={styles.twinGlow} />
            <VehicleTwin
              {...twinState}
              driveIn
              exteriorColor={vehicle?.exterior_color}
              size={twinSize}
              style={styles.twin}
              vehicleId={vehicle?.id}
            />
          </View>

          <View style={styles.badgesRow}>
            <WidgetBadge
              iconGlyph={twinState.locked === false ? ICON_UNLOCK : ICON_LOCK}
              variant={lockBadgeVariant}>
              {lockLabel}
            </WidgetBadge>
            <WidgetBadge variant={windowBadgeVariant}>{windowLabel}</WidgetBadge>
            {twinState.isDriving ? (
              <WidgetBadge dot variant="info">
                {t('widget.driving', 'Driving')}
              </WidgetBadge>
            ) : null}
            {twinState.isCharging ? (
              <WidgetBadge dot variant="info">
                {t('widget.charging', 'Charging')}
              </WidgetBadge>
            ) : null}
            {twinState.sentryMode ? (
              <WidgetBadge dot variant="warning">
                {t('widget.sentryOn', 'Sentry')}
              </WidgetBadge>
            ) : null}
            {twinState.headlights ? (
              <WidgetBadge dot variant="neutral">
                {t('widget.headlightsOn', 'Lights On')}
              </WidgetBadge>
            ) : null}
            {twinState.hazards ? (
              <WidgetBadge dot variant="warning">
                {t('widget.hazardsOn', 'Hazards')}
              </WidgetBadge>
            ) : null}
            {openDoorCount > 0 ? (
              <WidgetBadge variant="warning">
                {`${openDoorCount} ${t('widget.doorsOpen', 'Doors Open')}`}
              </WidgetBadge>
            ) : null}
            {twinState.frunkOpen ? (
              <WidgetBadge variant="warning">
                {t('widget.frunkOpen', 'Frunk Open')}
              </WidgetBadge>
            ) : null}
            {twinState.trunkOpen ? (
              <WidgetBadge variant="warning">
                {t('widget.trunkOpen', 'Trunk Open')}
              </WidgetBadge>
            ) : null}
          </View>

          <AppText style={styles.caption} tone="muted">
            {vehicle.display_name || vehicle.vin}
          </AppText>
        </View>
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <WidgetEmptyState
          icon={<Glyph glyph={ICON_MONITOR} style={styles.emptyIcon} />}
          message={t('widget.noVehicle', 'No vehicle data')}
        />
      )}
    </WidgetShell>
  );
}

DigitalTwinWidget.displayName = 'DigitalTwinWidget';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  badgeIcon: {
    fontSize: 10,
    lineHeight: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  badgesRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
  },
  body: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    minHeight: 0,
  },
  caption: {
    fontSize: 12,
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    padding: spacing.md,
  },
  emptyIcon: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 24,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 14,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessGlyph: {
    color: colors.textMuted,
    fontSize: 13,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    zIndex: 5,
  },
  freshnessRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  openAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  openGlyph: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 14,
  },
  openText: {
    fontSize: 10,
    lineHeight: 14,
  },
  shell: {
    borderRadius: 16,
    gap: spacing.sm,
    padding: spacing.md,
  },
  titleIcon: {
    color: colors.violet,
    fontSize: 14,
    lineHeight: 16,
  },
  titleText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  twin: {
    zIndex: 1,
  },
  twinGlow: {
    backgroundColor: 'rgba(167, 139, 250, 0.1)',
    borderRadius: 999,
    bottom: 8,
    height: 64,
    left: 32,
    position: 'absolute',
    right: 32,
  },
  twinWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 170,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
});
