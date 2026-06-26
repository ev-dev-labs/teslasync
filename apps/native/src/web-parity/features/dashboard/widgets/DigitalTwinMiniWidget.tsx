// Native parity port of web/src/features/dashboard/widgets/DigitalTwinMiniWidget.tsx.
//
// `DigitalTwinMiniWidget` is a dashboard widget that renders a live "digital
// twin" of the active vehicle: a small vehicle illustration plus lock + sentry
// status badges. It resolves the active vehicle (the `vehicleId` prop, else the
// first vehicle), polls security + vehicle-state + charging-telemetry every
// `REFRESH_INTERVAL` (5_000 ms), merges them into a single `twinState` view-model
// via `buildTwinState`, and shows either the twin + badges or a "No vehicle data"
// empty state.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3):
//   - `REFRESH_INTERVAL = 5_000` (L13).
//   - vehicle resolution: `vehicleId ? vehicles?.find(v => v.id === vehicleId) ??
//     vehicles?.[0] : vehicles?.[0]`, `id = vehicle?.id ?? 0` (L17-21).
//   - the three polling hooks: `useSecurityLatest(id, REFRESH_INTERVAL)` +
//     `secLoading`, `useVehicleState(id, { refetchInterval: REFRESH_INTERVAL })`
//     with the full destructure (data/stateLoading/stateFetching/stateStale/
//     stateError/stateUpdatedAt/refetchState), `useChargingTelemetryLatest(id,
//     REFRESH_INTERVAL)` (L23-25).
//   - `isLoading = secLoading || stateLoading` (L27), `vehicleState =
//     vehicleStateData?.state ?? null` (L28), the memoized `twinState =
//     buildTwinState(securityData, vehicleState, chargingData)` with the exact
//     deps array (L30-33), and `isCompact = size.cols <= 2 && size.rows <= 2`
//     (L35).
//   - the render: a `WidgetShell` (title `widget.digitalTwinMini 'Digital Twin'`,
//     purple Monitor icon, loading, the freshness props from the vehicle-state
//     query, `noPadding`, and the "Open" action link), whose body is either the
//     vehicle twin + badges (L57-93) or the `widget.noVehicle 'No vehicle data'`
//     empty state (L94-100). The badges block is gated by `!isCompact ||
//     size.rows >= 2` (L69); the lock badge variant/icon/label ternaries (L71-82)
//     and the `sentryMode != null` sentry badge (L83-90) are reproduced verbatim,
//     keeping every i18n key + English default (widget.unlocked/locked/sentryOn/
//     sentryOff/open/digitalTwinMini/noVehicle).
//   - `buildTwinState` (web @/lib/vehicleState) is reproduced faithfully below
//     (pure, portable logic — conversion rule 6): the `parseDoorState`,
//     `parseWindowState` (+ its inlined `parseWindowEnum` from parseEnums and
//     `asNonEmptyString` from typeGuards), `parseTurnSignal`, `parseWindowOpenSummary`,
//     `isVehicleDriving`, `isChargingActive` helpers and the `EMPTY_TWIN_STATE`
//     short-circuit are all ported. The single SI deviation: web reads the legacy
//     `charging.charger_power_kw`; the native SI hook exposes `charger_power_w`
//     (Phase-42/48 stores SI) — the `> 0` "is charging" predicate is unit-agnostic
//     so the boolean result is identical (documented in the sidecar).
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L3) -> a local fallback
//     resolver returning the inline English string (the namespace arg is accepted
//     + ignored), the same shim shape used by the sibling widget ports.
//   - lucide-react `Monitor`/`ArrowUpRight`/`Lock`/`Unlock`/`Shield` (L4) -> there
//     is no `react-native-svg` dependency, so each renders a decorative
//     `<GlyphIcon>` emoji stand-in (Monitor 🖥️, ArrowUpRight ↗, Lock 🔒, Unlock 🔓,
//     Shield 🛡️). The header Monitor keeps the web `text-neon-purple` intent via
//     `colors.violet`; the lock/unlock/shield glyphs ride inside the Badge label
//     (web: the icon inherits the badge `currentColor`); the empty-state Monitor
//     is colourless so it takes the muted token (matching the web `EmptyState`).
//   - react-router-dom `Link to="/digital-twin"` (L2, L49-54) -> a `<Pressable
//     accessibilityRole="link">` reproducing the "Open ↗" affordance + the
//     `widget.open` i18n; the hover:text-cyan-300 maps to a pressed accent tint.
//     There is no router in the isolated parity layer, so the navigation target
//     is not wired (documented).
//   - `@/components/ui` `Badge` (L5) -> the converted web-parity `Badge` port
//     (variant danger/success/info/neutral).
//   - `@/components/feedback` `EmptyState` (L6, not yet ported) -> a local
//     `<LocalEmptyState>` reproducing its icon + message centred layout, keeping
//     the source's "no-action transient empty state" intent (L95).
//   - `@/components/vehicles` `VehicleTwin` (L7) -> a native-safe
//     `<VehicleTwinPlaceholder>`. The web twin is a ~40 KB animated SVG (framer-
//     motion drive-in, per-instance gradient/filter defs, paint palettes, live
//     door/window/charge-port geometry) with no native renderer; the placeholder
//     surfaces the vehicle as a sized 🚗 glyph + a ⚡ charge overlay when
//     `isCharging`, still threading `{...twinState}`/`size`/`vehicleId`/
//     `exteriorColor` so the data flow is preserved. The interactive animated twin
//     and the Tesla paint-code → hex mapping are UNAVAILABLE on native.
//   - `./WidgetShell` `WidgetShell` (L10, sibling not yet ported) -> reproduced
//     locally (same self-contained approach as the sibling widget ports): loading
//     -> skeleton block, error -> centred danger text (surfaced, never hidden),
//     title + icon header, the freshness chip via the converted web-parity
//     `DataFreshness` port, the `noPadding` body switch, the header `actions` slot,
//     and the children body. The web pulse-on-data-change box-shadow glow + the
//     help-tooltip / pin-button header slots are unused affordances with no native
//     analog and are intentionally omitted (documented).
//   - `./types` `WidgetProps` (L11) -> the `WidgetProps` / `WidgetSize` /
//     `WidgetConfig` subset is reproduced + exported locally.
//
// Tailwind spacing -> px (1 unit = 4px); var(--text-*) -> the theme tokens so the
// light/dark cascade is preserved at the token boundary; text-neon-purple ->
// colors.violet, hover:text-cyan-300 -> colors.accent.

import React, {useMemo, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {Badge} from '../../../components/ui/Badge';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {
  useVehicles,
  useVehicleState,
  useSecurityLatest,
  useChargingTelemetryLatest,
  type VehicleState,
  type SecurityEvent,
  type ChargingTelemetry,
} from '../../../api/hooks/useVehicles';

const REFRESH_INTERVAL = 5_000;

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. The hook shape mirrors the web
// `const { t } = useTranslation('dashboard')` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(_namespace?: string): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// ── lucide glyph stand-ins ───────────────────────────────────────────────────
function GlyphIcon({
  glyph,
  color,
  size,
}: {
  glyph: string;
  color: string;
  size: number;
}) {
  const glyphStyle: StyleProp<TextStyle> = {
    color,
    fontSize: size,
    lineHeight: size + 2,
  };
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={glyphStyle}>
      {glyph}
    </AppText>
  );
}

// ── Type reproductions (web ./types) ─────────────────────────────────────────
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

// ── Reproduction of web @/lib/vehicleState (pure logic — rule 6) ──────────────
// `asNonEmptyString` (web @/lib/typeGuards) inlined verbatim.
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

interface DoorStates {
  driverFront: boolean | null;
  passengerFront: boolean | null;
  driverRear: boolean | null;
  passengerRear: boolean | null;
  trunkFront: boolean | null;
  trunkRear: boolean | null;
}

const UNKNOWN_DOORS: DoorStates = {
  driverFront: null,
  passengerFront: null,
  driverRear: null,
  passengerRear: null,
  trunkFront: null,
  trunkRear: null,
};

function parseDoorState(doorState: unknown): DoorStates {
  // Compound signal — accept native object payloads directly.
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

  // Check for "all closed" shorthand values
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

  // Try JSON parse (compound signal serialized as string)
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

  // String matching for descriptive values (e.g. "OpenDriverFront")
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

type WindowState = 'open' | 'closed' | 'partial' | null;

// `parseWindowState` from web @/lib/parseEnums (imported as `parseWindowEnum`),
// inlined verbatim.
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
  // Fallback heuristics
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

type TurnSignalState = 'left' | 'right' | 'both' | 'off' | null;

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

interface VehicleTwinState {
  doors: DoorStates;
  windowFD: WindowState;
  windowFP: WindowState;
  windowRD: WindowState;
  windowRP: WindowState;
  frunkOpen: boolean | null;
  trunkOpen: boolean | null;
  chargePortOpen: boolean | null;
  isCharging: boolean;
  isDriving: boolean;
  locked: boolean | null;
  sentryMode: boolean | null;
  headlights: boolean | null;
  hazards: boolean | null;
  turnSignal: TurnSignalState;
  driverSeatOccupied: boolean | null;
  vehicleColor: string;
  lastUpdated: string | Date | null;
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

function isVehicleDriving(vehicleState: VehicleState | null): boolean {
  if (!vehicleState) {
    return false;
  }
  return (
    vehicleState.state?.toLowerCase() === 'driving' ||
    (vehicleState.speed ?? 0) > 0
  );
}

function isChargingActive(
  vehicleState: VehicleState | null,
  charging: ChargingTelemetry | null | undefined,
): boolean {
  const normalizedState =
    charging?.charging_state?.toLowerCase().replace(/[\s_-]/g, '') ?? '';
  return (
    Boolean(vehicleState?.is_charging) ||
    (vehicleState?.charger_power ?? 0) > 0 ||
    // web reads the legacy `charger_power_kw`; the native SI hook exposes
    // `charger_power_w`. The `> 0` predicate is unit-agnostic (kW>0 ⇔ W>0).
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

// The native `useVehicleState` result's `state` is `VehicleState | string | null`
// (offline responses can be a bare status string). The web call site is `any`, so
// passing a string and reading object fields yields `undefined` at runtime; here
// we narrow to `VehicleState | null` once (string → null → defaults), preserving
// the identical observable result while staying type-safe.
type VehicleStateInput = VehicleState | string | null | undefined;

function buildTwinState(
  security: SecurityEvent | null | undefined,
  vehicleState: VehicleStateInput,
  charging: ChargingTelemetry | null | undefined,
): VehicleTwinState {
  if (!security && !vehicleState && !charging) {
    return {...EMPTY_TWIN_STATE};
  }
  const vs =
    vehicleState != null && typeof vehicleState === 'object'
      ? vehicleState
      : null;
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

// ── Native-safe `VehicleTwin` (web @/components/vehicles) ─────────────────────
// The web twin is an animated SVG; native has no SVG renderer. This placeholder
// surfaces the vehicle as a sized glyph + a charge overlay, threading the same
// props so the data flow is preserved. The interactive animated twin + Tesla
// paint mapping are unavailable on native.
type VehicleTwinSize = 'sm' | 'md' | 'lg';

interface VehicleTwinPlaceholderProps extends VehicleTwinState {
  size?: VehicleTwinSize;
  vehicleId?: number | null;
  exteriorColor?: string | null;
}

const TWIN_GLYPH_SIZE: Record<VehicleTwinSize, number> = {
  sm: 60,
  md: 76,
  lg: 92,
};

function VehicleTwinPlaceholder(props: VehicleTwinPlaceholderProps) {
  const glyphSize = TWIN_GLYPH_SIZE[props.size ?? 'md'];
  const accLabel = `Vehicle digital twin${props.isCharging ? ', charging' : ''}${
    props.isDriving ? ', driving' : ''
  }`;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accLabel}
      style={styles.twinStage}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.twinGlyph, {fontSize: glyphSize, lineHeight: glyphSize * 1.1}]}>
        🚗
      </AppText>
      {props.isCharging ? (
        <View style={styles.twinChargeChip}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.twinChargeGlyph}>
            ⚡
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

// ── Local `EmptyState` (web @/components/feedback, icon + message) ────────────
function LocalEmptyState({
  icon,
  message,
}: {
  icon?: ReactNode;
  message: string;
}) {
  // no-action: transient empty state — surfaces when source data is missing; no
  // specific recovery action available.
  return (
    <View style={styles.emptyState}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText tone="muted" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

// ── Local `WidgetShell` (web ./WidgetShell) ──────────────────────────────────
interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  noPadding?: boolean;
  actions?: ReactNode;
  /** Freshness: ms timestamp from dataUpdatedAt (0 = never). */
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
  noPadding,
  actions,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  if (loading) {
    return <View accessibilityRole="progressbar" style={styles.skeleton} />;
  }
  if (error) {
    return (
      <View style={styles.errorBox}>
        <AppText tone="danger">{error}</AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (typically 1×1 widgets).
  const freshnessCompact = !title;

  const freshnessEl: ReactNode = showFreshness ? (
    <DataFreshness
      updatedAt={updatedAt > 0 ? updatedAt : null}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      isError={isError ?? false}
      onRefresh={onRefresh}
      compact={freshnessCompact}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          <View style={styles.headerRight}>
            {freshnessEl}
            {actions}
          </View>
        </View>
      ) : (
        <>
          {freshnessEl ? (
            <View style={styles.freshnessOverlay}>{freshnessEl}</View>
          ) : null}
          {actions ? (
            <View style={styles.actionsOnlyRow}>{actions}</View>
          ) : null}
        </>
      )}
      <View style={noPadding ? styles.bodyNoPad : styles.body}>{children}</View>
    </View>
  );
}

export default function DigitalTwinMiniWidget({vehicleId, size}: WidgetProps) {
  const {t} = useTranslation('dashboard');
  const {data: vehicles} = useVehicles();
  const vehicle = vehicleId
    ? (vehicles?.find(v => v.id === vehicleId) ?? vehicles?.[0])
    : vehicles?.[0];
  const id = vehicle?.id ?? 0;

  const {data: securityData, isLoading: secLoading} = useSecurityLatest(
    id,
    REFRESH_INTERVAL,
  );
  const {
    data: vehicleStateData,
    isLoading: stateLoading,
    isFetching: stateFetching,
    isStale: stateStale,
    isError: stateError,
    dataUpdatedAt: stateUpdatedAt,
    refetch: refetchState,
  } = useVehicleState(id, {refetchInterval: REFRESH_INTERVAL});
  const {data: chargingData} = useChargingTelemetryLatest(id, REFRESH_INTERVAL);

  const isLoading = secLoading || stateLoading;
  const vehicleState = vehicleStateData?.state ?? null;

  const twinState = useMemo(
    () => buildTwinState(securityData, vehicleState, chargingData),
    [securityData, vehicleState, chargingData],
  );

  const isCompact = size.cols <= 2 && size.rows <= 2;

  return (
    <WidgetShell
      title={t('widget.digitalTwinMini', 'Digital Twin')}
      icon={<GlyphIcon glyph="🖥️" color={colors.violet} size={14} />}
      loading={isLoading}
      updatedAt={stateUpdatedAt}
      isFetching={stateFetching}
      isStale={stateStale}
      isError={stateError}
      onRefresh={() => refetchState()}
      noPadding
      actions={
        <Pressable accessibilityRole="link" hitSlop={6}>
          {({pressed}) => (
            <View style={styles.actionLink}>
              <AppText
                style={[styles.actionText, pressed ? styles.actionPressed : null]}>
                {t('widget.open', 'Open')}
              </AppText>
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[styles.actionGlyph, pressed ? styles.actionPressed : null]}>
                ↗
              </AppText>
            </View>
          )}
        </Pressable>
      }>
      {vehicle ? (
        <View style={styles.twinBody}>
          <View style={styles.twinStageWrap}>
            <VehicleTwinPlaceholder
              {...twinState}
              size="sm"
              vehicleId={vehicle?.id}
              exteriorColor={vehicle?.exterior_color}
            />
          </View>

          {/* Status badges — shown unless very cramped */}
          {!isCompact || size.rows >= 2 ? (
            <View style={styles.badgesRow}>
              <Badge variant={twinState.locked === false ? 'danger' : 'success'}>
                {`${twinState.locked === false ? '🔓' : '🔒'} ${
                  twinState.locked === false
                    ? t('widget.unlocked', 'Unlocked')
                    : twinState.locked
                      ? t('widget.locked', 'Locked')
                      : '—'
                }`}
              </Badge>
              {twinState.sentryMode != null ? (
                <Badge variant={twinState.sentryMode ? 'info' : 'neutral'}>
                  {`🛡️ ${
                    twinState.sentryMode
                      ? t('widget.sentryOn', 'Sentry')
                      : t('widget.sentryOff', 'Off')
                  }`}
                </Badge>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : (
        <LocalEmptyState
          icon={<GlyphIcon glyph="🖥️" color={colors.textMuted} size={20} />}
          message={t('widget.noVehicle', 'No vehicle data')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  actionGlyph: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    lineHeight: 14,
  },
  actionLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2, // gap-0.5
  },
  actionPressed: {
    color: colors.accent, // hover:text-cyan-300
  },
  actionText: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 10, // text-[10px]
    lineHeight: 14,
  },
  actionsOnlyRow: {
    alignItems: 'flex-end',
    paddingBottom: 4, // pb-1
    paddingHorizontal: 16, // px-4
    paddingTop: 12, // pt-3
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6, // gap-1.5
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    paddingBottom: 12, // pb-3
    paddingHorizontal: 16, // px-4
  },
  bodyNoPad: {
    flex: 1,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16, // py-4
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16, // p-4
  },
  freshnessOverlay: {
    position: 'absolute',
    right: 6, // right-1.5
    top: 6, // top-1.5
    zIndex: 5,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4, // pb-1
    paddingHorizontal: 16, // px-4
    paddingTop: 12, // pt-3
  },
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11, // text-[11px]
    fontWeight: '500', // font-medium
    letterSpacing: 0.6, // tracking-wider
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6, // gap-1.5
  },
  shell: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12, // rounded-xl
    flex: 1,
  },
  twinBody: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm, // gap-2
    justifyContent: 'center',
    paddingBottom: spacing.sm, // pb-2
    paddingHorizontal: spacing.sm, // px-2
  },
  twinChargeChip: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 9999,
    height: 24,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 24,
  },
  twinChargeGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  twinGlyph: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
  twinStage: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    position: 'relative',
    width: '100%',
  },
  twinStageWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 0,
    width: '100%',
  },
});
