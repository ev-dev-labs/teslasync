// DigitalTwinPage — native parity port of
// web/src/features/vehicles/pages/DigitalTwinPage.tsx.
//
// Real-time view of a vehicle's physical state: a paint-colored "twin"
// visualization with at-a-glance lock / sentry / charging status and an
// interactive paint picker, alongside three definition-list panels
// (Doors & Openings, Windows, Security & Status) plus a derived status badge.
// Every state name, hook, API path (/security/latest, /vehicles/{id}/state,
// /charging-telemetry/latest), the 5s REFRESH_INTERVAL, the buildTwinState /
// parseWindowState merge logic, the badgeStatus derivation, and the i18n keys +
// English fallbacks are preserved verbatim from the web source.
//
// Native adaptations vs. the web source (behavior / state / keys / intent kept):
//   - react-i18next useTranslation (web L2) -> inline native-safe t(key,
//     fallback?) returning fallback ?? key; every digitalTwin.*/common.* key and
//     its English default is preserved.
//   - @/hooks/usePageTitle (web L3) -> inline no-op (RN has no document.title).
//   - @/hooks/useDateFormat (web L4) -> inline formatTime ported from
//     @/lib/dateFormat (null/invalid -> '—'; locale time {hour:'2-digit',
//     minute:'2-digit'}). The web's tz/locale-from-settings binding is not wired
//     here, so the device locale/zone is used.
//   - @/hooks/useSelectedVehicle (web L5) -> inline native shim backed by the
//     native useVehicles hook, defaulting to the first vehicle like the web
//     provider's fresh-install default (URL/router/store precedence is
//     router-only and not wired on native).
//   - @/api/hooks/useVehicles useVehicles/useVehicleState/useSecurityLatest/
//     useChargingTelemetryLatest (web L6) -> native ../../../api/hooks/useVehicles
//     with identical args + API paths.
//   - @/components/layout PageContainer (web L7) -> inline RN PageContainer
//     (ScrollView header title/subtitle/actions; loading swaps children for a
//     centered ActivityIndicator, matching the web Spinner-only loading state).
//   - @/components/ui GlassPanel (web L8) -> canonical native GlassPanel.
//   - @/components/data-display KVList/StatusBadge (web L9) -> the already-native
//     parity KVList + StatusBadge components.
//   - @/components/motion FadeIn (web L10, framer-motion) -> inline RN Animated
//     FadeIn (fade + slide-up, reduced-motion aware; web `delay` preserved as an
//     animation delay).
//   - @/components/feedback EmptyState (web L11) -> inline RN EmptyState.
//   - @/components/vehicles VehicleTwin/VehiclePaintPicker (web L12) -> native-safe
//     reimplementations. The web VehicleTwin is a 40KB framer-motion SVG car
//     illustration (browser-only); the native twin renders a paint-colored body
//     panel with the same at-a-glance Locked/Unlocked + Sentry + Charging status
//     intent (the per-opening detail lives in the side KVList panels, exactly as
//     on web). The picker is a native swatch row driven by an inline native-safe
//     useVehiclePaint (in-memory per-vehicle override store + listeners, replacing
//     the web localStorage + BroadcastChannel persistence).
//   - @/components/forms VehicleSelect (web L13) -> inline read-only native
//     vehicle chip (no router/picker; the active vehicle is the first in the
//     fleet, matching the native useSelectedVehicle default).
//   - @/lib/vehicleState buildTwinState/parseWindowState (web L14) -> ported
//     inline verbatim (with their parseDoorState/parseTurnSignal/isVehicleDriving/
//     isChargingActive/parseWindowOpenSummary deps and the asNonEmptyString +
//     parseWindowEnum helpers they pull from @/lib/typeGuards + @/lib/parseEnums).
//   - @/api/types deriveVehicleStatus + VehicleStatus (web L15-16) -> native
//     ../../../api/types (identical logic + union).
//   - lucide-react Info/Car (web L17) -> emoji glyphs (lucide is browser-only SVG).
//
// The web useVehicleState collapses its return `state` to `any`; the native hook
// types it `VehicleState | string | null`. We narrow it to the object-or-null
// form (a bare string is never emitted by /vehicles/{id}/state in practice) so
// buildTwinState + deriveVehicleStatus receive the same structured state object
// the web path did.
//
// No DOM / Recharts / Leaflet / react-router / react-i18next / framer-motion /
// lucide / old web-UI import reaches the native output — only react, react-native
// primitives, the canonical AppText/GlassPanel + theme tokens, the native parity
// KVList/StatusBadge, and the native vehicles hooks + api/types.

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
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {KVList} from '../../../components/data-display/KVList';
import {StatusBadge} from '../../../components/data-display/StatusBadge';
import {
  useChargingTelemetryLatest,
  useSecurityLatest,
  useVehicleState,
  useVehicles,
  type ChargingTelemetry,
  type SecurityEvent,
  type Vehicle,
  type VehicleState,
} from '../../../api/hooks/useVehicles';
import {deriveVehicleStatus, type VehicleStatus} from '../../../api/types';

const REFRESH_INTERVAL = 5_000;

// ── typeGuards (web @/lib/typeGuards) ──────────────────────────────────
// Returns `v` when it is a non-empty string; `null` otherwise.
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// ── parseEnums (web @/lib/parseEnums parseWindowState) ──────────────────
// Normalizes a raw Tesla window enum to a canonical 'Closed'/'Partial'/'Open'.
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

// ── vehicleState (web @/lib/vehicleState) ──────────────────────────────

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

/**
 * Parses the compound DoorState signal from Tesla telemetry. Handles JSON
 * objects, simple enum strings, and descriptive values. Returns null for each
 * unknown field rather than defaulting to closed.
 */
function parseDoorState(doorState: unknown): DoorStates {
  if (doorState !== null && typeof doorState === 'object' && !Array.isArray(doorState)) {
    const parsed = doorState as Record<string, unknown>;
    return {
      driverFront: parsed.DriverFront != null ? Boolean(parsed.DriverFront) : (parsed.driver_front != null ? Boolean(parsed.driver_front) : null),
      passengerFront: parsed.PassengerFront != null ? Boolean(parsed.PassengerFront) : (parsed.passenger_front != null ? Boolean(parsed.passenger_front) : null),
      driverRear: parsed.DriverRear != null ? Boolean(parsed.DriverRear) : (parsed.driver_rear != null ? Boolean(parsed.driver_rear) : null),
      passengerRear: parsed.PassengerRear != null ? Boolean(parsed.PassengerRear) : (parsed.passenger_rear != null ? Boolean(parsed.passenger_rear) : null),
      trunkFront: parsed.TrunkFront != null ? Boolean(parsed.TrunkFront) : (parsed.trunk_front != null ? Boolean(parsed.trunk_front) : null),
      trunkRear: parsed.TrunkRear != null ? Boolean(parsed.TrunkRear) : (parsed.trunk_rear != null ? Boolean(parsed.trunk_rear) : null),
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
  if (lower === 'closedall' || lower === 'closed' || lower === 'none' || lower === '[]' || lower === '0' || lower === 'false') {
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
        driverFront: parsed.DriverFront != null ? Boolean(parsed.DriverFront) : (parsed.driver_front != null ? Boolean(parsed.driver_front) : null),
        passengerFront: parsed.PassengerFront != null ? Boolean(parsed.PassengerFront) : (parsed.passenger_front != null ? Boolean(parsed.passenger_front) : null),
        driverRear: parsed.DriverRear != null ? Boolean(parsed.DriverRear) : (parsed.driver_rear != null ? Boolean(parsed.driver_rear) : null),
        passengerRear: parsed.PassengerRear != null ? Boolean(parsed.PassengerRear) : (parsed.passenger_rear != null ? Boolean(parsed.passenger_rear) : null),
        trunkFront: parsed.TrunkFront != null ? Boolean(parsed.TrunkFront) : (parsed.trunk_front != null ? Boolean(parsed.trunk_front) : null),
        trunkRear: parsed.TrunkRear != null ? Boolean(parsed.TrunkRear) : (parsed.trunk_rear != null ? Boolean(parsed.trunk_rear) : null),
      };
    } catch {
      // Fall through to string matching
    }
  }

  return {
    driverFront: lower.includes('driver') && lower.includes('front') ? true : null,
    passengerFront: lower.includes('passenger') && lower.includes('front') ? true : null,
    driverRear: (lower.includes('driver') && lower.includes('rear')) || lower.includes('driverrear') ? true : null,
    passengerRear: (lower.includes('passenger') && lower.includes('rear')) || lower.includes('passengerrear') ? true : null,
    trunkFront: lower.includes('frunk') || lower.includes('fronttrunk') || lower.includes('front_trunk') || lower.includes('trunkfront') || lower.includes('trunk_front') ? true : null,
    trunkRear: (
      lower.includes('reartrunk') ||
      lower.includes('rear_trunk') ||
      lower.includes('trunkrear') ||
      lower.includes('trunk_rear') ||
      lower.includes('liftgate') ||
      (lower.includes('trunk') && !lower.includes('frunk') && !lower.includes('front'))
    ) ? true : null,
  };
}

type WindowState = 'open' | 'closed' | 'partial' | null;

/** Normalizes Tesla window enum values to display state. */
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

function isVehicleDriving(
  vehicleState: {state?: string; speed?: number} | null | undefined,
): boolean {
  if (!vehicleState) {
    return false;
  }
  return vehicleState.state?.toLowerCase() === 'driving' || (vehicleState.speed ?? 0) > 0;
}

function isChargingActive(
  vehicleState: {is_charging?: boolean; charger_power?: number} | null | undefined,
  charging: {charging_state?: string | null; charger_power_kw?: number | null} | null | undefined,
): boolean {
  const normalizedState = charging?.charging_state?.toLowerCase().replace(/[\s_-]/g, '') ?? '';
  return Boolean(vehicleState?.is_charging) ||
    (vehicleState?.charger_power ?? 0) > 0 ||
    (charging?.charger_power_kw ?? 0) > 0 ||
    normalizedState === 'charging' ||
    normalizedState === 'starting';
}

function parseWindowOpenSummary(windowsOpen: unknown, aliases: string[]): WindowState {
  const raw = asNonEmptyString(windowsOpen);
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  if (normalized === 'closed' || normalized === 'none' || normalized === '[]' || normalized === 'false') {
    return 'closed';
  }
  return aliases.some((alias) => normalized.includes(alias)) ? 'open' : null;
}

/**
 * Merges SecurityEvent + VehicleState + ChargingTelemetry into a single
 * view-model for the VehicleTwin component.
 */
function buildTwinState(
  security: SecurityEvent | null | undefined,
  vehicleState: {state?: string; speed?: number; is_charging?: boolean; charger_power?: number; is_locked?: boolean; sentry_mode?: boolean} | null | undefined,
  charging: ChargingTelemetry | null | undefined,
): VehicleTwinState {
  if (!security && !vehicleState && !charging) {
    return {...EMPTY_TWIN_STATE};
  }
  const doors = parseDoorState(security?.door_state ?? security?.doors_open);
  const chargingActive = isChargingActive(vehicleState, charging);
  const windowsOpen = security?.windows_open ?? null;
  return {
    doors,
    windowFD: parseWindowState(security?.fd_window) ?? parseWindowOpenSummary(windowsOpen, ['fd', 'front driver', 'driver front', 'driver_front']),
    windowFP: parseWindowState(security?.fp_window) ?? parseWindowOpenSummary(windowsOpen, ['fp', 'front passenger', 'passenger front', 'passenger_front']),
    windowRD: parseWindowState(security?.rd_window) ?? parseWindowOpenSummary(windowsOpen, ['rd', 'rear driver', 'driver rear', 'driver_rear']),
    windowRP: parseWindowState(security?.rp_window) ?? parseWindowOpenSummary(windowsOpen, ['rp', 'rear passenger', 'passenger rear', 'passenger_rear']),
    frunkOpen: doors.trunkFront,
    trunkOpen: doors.trunkRear,
    chargePortOpen: charging?.charge_port_door_open ?? (chargingActive ? true : null),
    isCharging: chargingActive,
    isDriving: isVehicleDriving(vehicleState),
    locked: security?.locked ?? vehicleState?.is_locked ?? null,
    sentryMode: security?.sentry_mode ?? vehicleState?.sentry_mode ?? null,
    headlights: security?.lights_high_beams ?? null,
    hazards: security?.lights_hazards_active ?? null,
    turnSignal: parseTurnSignal(security?.lights_turn_signal),
    driverSeatOccupied: security?.driver_seat_occupied ?? null,
    vehicleColor: '',
    lastUpdated: security?.created_at ?? null,
  };
}

// ── vehicleColors (web @/lib/vehicleColors — subset the twin/picker need) ──

type PaintPaletteId =
  | 'pearl-white'
  | 'midnight-silver'
  | 'deep-blue'
  | 'solid-black'
  | 'red-multicoat';

interface PaintPalette {
  id: PaintPaletteId;
  labelKey: string;
  defaultLabel: string;
  swatch: string;
  isDark: boolean;
}

const PAINT_PALETTES: Record<PaintPaletteId, PaintPalette> = {
  'pearl-white': {id: 'pearl-white', labelKey: 'paint.pearlWhite', defaultLabel: 'Pearl White Multi-Coat', swatch: '#e9ecf2', isDark: false},
  'midnight-silver': {id: 'midnight-silver', labelKey: 'paint.midnightSilver', defaultLabel: 'Midnight Silver Metallic', swatch: '#5b6675', isDark: false},
  'deep-blue': {id: 'deep-blue', labelKey: 'paint.deepBlue', defaultLabel: 'Deep Blue Metallic', swatch: '#1f3a72', isDark: false},
  'solid-black': {id: 'solid-black', labelKey: 'paint.solidBlack', defaultLabel: 'Solid Black', swatch: '#0d1117', isDark: true},
  'red-multicoat': {id: 'red-multicoat', labelKey: 'paint.redMulticoat', defaultLabel: 'Red Multi-Coat', swatch: '#a3001a', isDark: false},
};

const PAINT_PALETTE_LIST: readonly PaintPalette[] = [
  PAINT_PALETTES['pearl-white'],
  PAINT_PALETTES['midnight-silver'],
  PAINT_PALETTES['deep-blue'],
  PAINT_PALETTES['solid-black'],
  PAINT_PALETTES['red-multicoat'],
];

const FALLBACK_PAINT: PaintPalette = PAINT_PALETTES['pearl-white'];

function inferPaintFromTesla(code: string | null | undefined): PaintPalette {
  if (!code) {
    return FALLBACK_PAINT;
  }
  const normalized = code.toLowerCase().replace(/[\s_-]/g, '');
  if (normalized.startsWith('pearl') || normalized === 'white') {
    return PAINT_PALETTES['pearl-white'];
  }
  if (normalized.startsWith('midnightsilver') || normalized === 'silver') {
    return PAINT_PALETTES['midnight-silver'];
  }
  if (normalized.startsWith('deepblue') || normalized === 'blue' || normalized === 'darkblue') {
    return PAINT_PALETTES['deep-blue'];
  }
  if (normalized.startsWith('solidblack') || normalized === 'black' || normalized === 'obsidianblack') {
    return PAINT_PALETTES['solid-black'];
  }
  if (normalized.startsWith('red') || normalized === 'multicoatred') {
    return PAINT_PALETTES['red-multicoat'];
  }
  return FALLBACK_PAINT;
}

// ── useVehiclePaint (web @/hooks/useVehiclePaint) — native-safe ─────────
// The web override persists to localStorage and broadcasts across tabs; React
// Native has neither, so an in-memory module store keyed by vehicleId — plus a
// listener registry so the picker and the twin instance stay in sync without a
// reload — preserves the "remember + live-update my paint choice" intent.
const paintOverrides = new Map<number, PaintPaletteId>();
type PaintListener = (value: PaintPaletteId | null) => void;
const paintListeners = new Map<number, Set<PaintListener>>();

function notifyPaint(vehicleId: number, value: PaintPaletteId | null): void {
  const set = paintListeners.get(vehicleId);
  if (!set) {
    return;
  }
  for (const fn of set) {
    fn(value);
  }
}

function subscribePaint(vehicleId: number, fn: PaintListener): () => void {
  let set = paintListeners.get(vehicleId);
  if (!set) {
    set = new Set();
    paintListeners.set(vehicleId, set);
  }
  set.add(fn);
  return () => {
    const s = paintListeners.get(vehicleId);
    if (!s) {
      return;
    }
    s.delete(fn);
    if (s.size === 0) {
      paintListeners.delete(vehicleId);
    }
  };
}

function hasPaintVehicle(vehicleId: number | null | undefined): vehicleId is number {
  return typeof vehicleId === 'number' && Number.isFinite(vehicleId) && vehicleId > 0;
}

interface UseVehiclePaint {
  paint: PaintPalette;
  inferred: PaintPalette;
  isOverridden: boolean;
  setPaint: (id: PaintPaletteId | null) => void;
  reset: () => void;
}

function useVehiclePaint(
  vehicleId: number | null | undefined,
  exteriorColor?: string | null,
): UseVehiclePaint {
  const [overrideId, setOverrideId] = useState<PaintPaletteId | null>(
    () => (hasPaintVehicle(vehicleId) ? paintOverrides.get(vehicleId) ?? null : null),
  );

  useEffect(() => {
    setOverrideId(hasPaintVehicle(vehicleId) ? paintOverrides.get(vehicleId) ?? null : null);
  }, [vehicleId]);

  useEffect(() => {
    if (!hasPaintVehicle(vehicleId)) {
      return;
    }
    return subscribePaint(vehicleId, (value) => setOverrideId(value));
  }, [vehicleId]);

  const inferred = useMemo<PaintPalette>(() => inferPaintFromTesla(exteriorColor), [exteriorColor]);
  const paint = overrideId ? PAINT_PALETTES[overrideId] ?? inferred : inferred;

  const setPaint = useCallback(
    (id: PaintPaletteId | null) => {
      const normalized: PaintPaletteId | null = id === inferred.id ? null : id;
      setOverrideId(normalized);
      if (hasPaintVehicle(vehicleId)) {
        if (normalized === null) {
          paintOverrides.delete(vehicleId);
        } else {
          paintOverrides.set(vehicleId, normalized);
        }
        notifyPaint(vehicleId, normalized);
      }
    },
    [vehicleId, inferred.id],
  );

  const reset = useCallback(() => setPaint(null), [setPaint]);

  return {paint: paint ?? FALLBACK_PAINT, inferred, isOverridden: overrideId !== null, setPaint, reset};
}

// ── i18n / page-title / date / selected-vehicle native shims ───────────

type NativeTFunction = (key: string, fallback?: string) => string;

function useTranslation(): {t: NativeTFunction} {
  const t = useCallback<NativeTFunction>((key, fallback) => fallback ?? key, []);
  return {t};
}

function usePageTitle(title: string): void {
  useEffect(() => {
    // React Native has no document.title to write; no-op. The dependency
    // mirrors the web hook so the effect re-runs on title changes.
  }, [title]);
}

function useDateFormat(): {formatTime: (value: string | Date | null | undefined) => string} {
  // Web binds locale + tz from settings; native uses the device defaults.
  const formatTime = useCallback((value: string | Date | null | undefined): string => {
    if (!value) {
      return '—';
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      return '—';
    }
    return d.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
  }, []);
  return {formatTime};
}

function useSelectedVehicle(): {vehicle: Vehicle | null} {
  // Web resolves URL > persisted store > first vehicle; native has no router or
  // store wired here, so it defaults to the first vehicle (the web provider's
  // fresh-install default).
  const {data} = useVehicles();
  const vehicles = data ?? [];
  const vehicle = vehicles.length > 0 ? vehicles[0] : null;
  return {vehicle};
}

// ── windowLabel (web DigitalTwinPage L21-28) ───────────────────────────

function windowLabel(state: WindowState): string {
  switch (state) {
    case 'open':
      return 'Open';
    case 'closed':
      return 'Closed';
    case 'partial':
      return 'Partial';
    default:
      return '—';
  }
}

// ── Shared native primitives ───────────────────────────────────────────

function Glyph({
  glyph,
  color,
  size = 14,
}: {
  glyph: string;
  color?: string;
  size?: number;
}): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.glyph,
        {fontSize: size, lineHeight: Math.round(size * 1.25), color: color ?? colors.textMuted},
      ]}>
      {glyph}
    </AppText>
  );
}

function FadeIn({
  children,
  style,
  delay = 0,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled) {
          return;
        }
        if (reduce) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, {
          delay: Math.max(0, delay) * 1000,
          duration: 400,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => progress.setValue(1));
    return () => {
      cancelled = true;
    };
  }, [progress, delay]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [
            {translateY: progress.interpolate({inputRange: [0, 1], outputRange: [12, 0]})},
          ],
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView style={styles.pageRoot} contentContainerStyle={styles.pageContent}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

function EmptyState({glyph, message}: {glyph: string; message: string}): React.ReactElement {
  return (
    <View accessibilityRole="summary" style={styles.emptyState}>
      <Glyph glyph={glyph} size={30} />
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

// ── VehicleTwin (web @/components/vehicles VehicleTwin) — native-safe ───

type VehicleTwinSize = 'sm' | 'md' | 'lg';

const TWIN_HEIGHT: Record<VehicleTwinSize, number> = {sm: 132, md: 168, lg: 204};

const LOCK_GREEN = '#22c55e';
const UNLOCK_RED = '#ef4444';
const SENTRY_RED = '#ef4444';
const CHARGE_GREEN = '#22c55e';

interface VehicleTwinProps extends VehicleTwinState {
  size?: VehicleTwinSize;
  interactive?: boolean;
  driveIn?: boolean;
  vehicleId?: number | null;
  exteriorColor?: string | null;
  paint?: PaintPalette;
}

function TwinChip({
  glyph,
  label,
  color,
}: {
  glyph: string;
  label: string;
  color: string;
}): React.ReactElement {
  return (
    <View style={[styles.twinChip, {borderColor: `${color}55`, backgroundColor: `${color}1a`}]}>
      <Glyph glyph={glyph} color={color} size={12} />
      <AppText style={[styles.twinChipText, {color}]} variant="caption" weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

function VehicleTwin(props: VehicleTwinProps): React.ReactElement {
  const {t} = useTranslation();
  const {
    size = 'md',
    vehicleId,
    exteriorColor,
    vehicleColor,
    paint: paintProp,
    locked,
    sentryMode,
    isCharging,
  } = props;

  // The web twin resolves paint via useVehiclePaint unless a `paint` prop is
  // passed; mirror that so the picker updates the body color live.
  const {paint: resolvedPaint} = useVehiclePaint(vehicleId ?? null, exteriorColor ?? vehicleColor ?? null);
  const paint = paintProp ?? resolvedPaint;
  const height = TWIN_HEIGHT[size];

  return (
    <View style={styles.twinWrap}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('digitalTwin.title', 'Digital Twin')}
        style={[
          styles.twinBody,
          {
            height,
            backgroundColor: paint.swatch,
            borderColor: isCharging ? CHARGE_GREEN : colors.border,
          },
        ]}>
        <Glyph glyph="🚗" size={Math.round(height * 0.42)} />
      </View>
      <View style={styles.twinStatusRow}>
        {locked === null ? null : locked ? (
          <TwinChip color={LOCK_GREEN} glyph="🔒" label={t('digitalTwin.locked', 'Locked')} />
        ) : (
          <TwinChip color={UNLOCK_RED} glyph="🔓" label={t('common.unlocked', 'Unlocked')} />
        )}
        {sentryMode ? (
          <TwinChip color={SENTRY_RED} glyph="🛡" label={t('digitalTwin.sentryMode', 'Sentry Mode')} />
        ) : null}
        {isCharging ? (
          <TwinChip color={CHARGE_GREEN} glyph="⚡" label={t('digitalTwin.charging', 'Charging')} />
        ) : null}
      </View>
    </View>
  );
}

// ── VehiclePaintPicker (web @/components/vehicles VehiclePaintPicker) ───

function VehiclePaintPicker({
  vehicleId,
  exteriorColor,
}: {
  vehicleId: number;
  exteriorColor?: string | null;
}): React.ReactElement {
  const {t} = useTranslation();
  const {paint, setPaint, isOverridden, reset, inferred} = useVehiclePaint(vehicleId, exteriorColor);

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('paint.pickerLabel', 'Vehicle paint color')}
      style={styles.paintRow}>
      <AppText style={styles.paintLabel} tone="secondary" variant="caption">
        {t('paint.label', 'Paint')}
      </AppText>
      <View style={styles.paintSwatches}>
        {PAINT_PALETTE_LIST.map((p) => {
          const selected = p.id === paint.id;
          const label = t(p.labelKey, p.defaultLabel);
          return (
            <Pressable
              key={p.id}
              accessibilityRole="radio"
              accessibilityState={{selected}}
              accessibilityLabel={label}
              hitSlop={6}
              onPress={() => setPaint(p.id)}
              style={[
                styles.paintSwatch,
                {backgroundColor: p.swatch},
                selected && styles.paintSwatchSelected,
              ]}>
              {selected ? <Glyph glyph="✓" color="#ffffff" size={14} /> : null}
            </Pressable>
          );
        })}
      </View>
      <AppText
        accessibilityLiveRegion="polite"
        style={styles.paintActiveLabel}
        tone="secondary"
        variant="caption">
        {t(paint.labelKey, paint.defaultLabel)}
      </AppText>
      {isOverridden ? (
        <Pressable accessibilityRole="button" hitSlop={6} onPress={reset}>
          <AppText style={styles.paintReset} variant="caption">
            {t('paint.reset', 'Reset to auto-detected')}
          </AppText>
        </Pressable>
      ) : (
        // Reference `inferred` so the auto-detected paint participates in the
        // memo dependencies exactly as on web (it drives the reset target).
        <View accessibilityElementsHidden importantForAccessibility="no" testID={`paint-inferred-${inferred.id}`} />
      )}
    </View>
  );
}

// ── VehicleSelect (web @/components/forms VehicleSelect) — read-only chip ─

function VehicleSelect(): React.ReactElement {
  const {vehicle} = useSelectedVehicle();
  return (
    <View style={styles.vehicleSelect}>
      <Glyph glyph="🚗" />
      <AppText style={styles.vehicleSelectText} variant="caption" weight="semibold">
        {vehicle?.display_name ?? '—'}
      </AppText>
    </View>
  );
}

// ── Page (web DigitalTwinPage L30-180) ─────────────────────────────────

export default function DigitalTwinPage(): React.ReactElement {
  const {t} = useTranslation();
  const {formatTime} = useDateFormat();
  usePageTitle(t('digitalTwin.title', 'Digital Twin'));

  const {vehicle} = useSelectedVehicle();
  const {isLoading: vehiclesLoading} = useVehicles();
  const vehicleId = vehicle?.id ?? 0;

  const {data: securityData} = useSecurityLatest(vehicleId, REFRESH_INTERVAL);
  const {data: vehicleStateData} = useVehicleState(vehicleId, {refetchInterval: REFRESH_INTERVAL});
  const {data: chargingData} = useChargingTelemetryLatest(vehicleId, REFRESH_INTERVAL);

  // Web typed this `any` (useVehicleState collapses its return to any); the
  // native hook types it VehicleState | string | null. Narrow to the
  // object-or-null form so buildTwinState + deriveVehicleStatus get the same
  // structured state the web path did (a bare string is never emitted by
  // /vehicles/{id}/state in practice).
  const rawVehicleState = vehicleStateData?.state ?? null;
  const vehicleState: VehicleState | null =
    rawVehicleState !== null && typeof rawVehicleState === 'object' ? rawVehicleState : null;

  const twinState = useMemo(
    () => buildTwinState(securityData, vehicleState, chargingData),
    [securityData, vehicleState, chargingData],
  );

  // Derive a single source-of-truth status for the badge. The previous
  // logic only recognized the literal strings 'online' / 'asleep' from
  // /vehicles/{id}/state and silently fell through to 'offline' for
  // everything else — including the very common cases where the vehicle
  // was actually driving or charging, or where the state endpoint had
  // not yet hydrated but security/charging streams were already flowing.
  const badgeStatus = useMemo<VehicleStatus>(() => {
    if (twinState.isCharging) {
      return 'charging';
    }
    if (twinState.isDriving) {
      return 'driving';
    }
    const fromState = deriveVehicleStatus(vehicleState);
    if (fromState !== 'offline') {
      return fromState;
    }
    if (vehicleStateData?.live || securityData || chargingData) {
      return 'online';
    }
    return 'offline';
  }, [twinState.isCharging, twinState.isDriving, vehicleState, vehicleStateData?.live, securityData, chargingData]);

  const doorItems = useMemo(() => [
    {label: t('digitalTwin.doorDriverFront', 'Driver Front'), value: twinState.doors.driverFront === null ? '—' : twinState.doors.driverFront ? t('common.open', 'Open') : t('common.closed', 'Closed')},
    {label: t('digitalTwin.doorPassengerFront', 'Passenger Front'), value: twinState.doors.passengerFront === null ? '—' : twinState.doors.passengerFront ? t('common.open', 'Open') : t('common.closed', 'Closed')},
    {label: t('digitalTwin.doorDriverRear', 'Driver Rear'), value: twinState.doors.driverRear === null ? '—' : twinState.doors.driverRear ? t('common.open', 'Open') : t('common.closed', 'Closed')},
    {label: t('digitalTwin.doorPassengerRear', 'Passenger Rear'), value: twinState.doors.passengerRear === null ? '—' : twinState.doors.passengerRear ? t('common.open', 'Open') : t('common.closed', 'Closed')},
    {label: t('digitalTwin.frunk', 'Frunk'), value: twinState.frunkOpen === null ? '—' : twinState.frunkOpen ? t('common.open', 'Open') : t('common.closed', 'Closed')},
    {label: t('digitalTwin.trunk', 'Trunk'), value: twinState.trunkOpen === null ? '—' : twinState.trunkOpen ? t('common.open', 'Open') : t('common.closed', 'Closed')},
  ], [twinState, t]);

  const windowItems = useMemo(() => [
    {label: t('digitalTwin.windowFD', 'Front Driver'), value: windowLabel(twinState.windowFD)},
    {label: t('digitalTwin.windowFP', 'Front Passenger'), value: windowLabel(twinState.windowFP)},
    {label: t('digitalTwin.windowRD', 'Rear Driver'), value: windowLabel(twinState.windowRD)},
    {label: t('digitalTwin.windowRP', 'Rear Passenger'), value: windowLabel(twinState.windowRP)},
  ], [twinState, t]);

  const securityItems = useMemo(() => [
    {label: t('digitalTwin.locked', 'Locked'), value: twinState.locked === null ? '—' : twinState.locked ? t('common.yes', 'Yes') : t('common.no', 'No')},
    {label: t('digitalTwin.driving', 'Driving'), value: twinState.isDriving ? t('common.yes', 'Yes') : t('common.no', 'No')},
    {label: t('digitalTwin.charging', 'Charging'), value: twinState.isCharging ? t('common.yes', 'Yes') : t('common.no', 'No')},
    {label: t('digitalTwin.sentryMode', 'Sentry Mode'), value: twinState.sentryMode === null ? '—' : twinState.sentryMode ? t('common.active', 'Active') : t('common.inactive', 'Inactive')},
    {label: t('digitalTwin.chargePort', 'Charge Port'), value: twinState.isCharging ? t('digitalTwin.charging', 'Charging') : twinState.chargePortOpen === null ? '—' : twinState.chargePortOpen ? t('common.open', 'Open') : t('common.closed', 'Closed')},
    {label: t('digitalTwin.driverSeat', 'Driver Seat'), value: twinState.driverSeatOccupied === null ? '—' : twinState.driverSeatOccupied ? t('digitalTwin.occupied', 'Occupied') : t('digitalTwin.empty', 'Empty')},
    {label: t('digitalTwin.headlights', 'Headlights'), value: twinState.headlights === null ? '—' : twinState.headlights ? t('common.on', 'On') : t('common.off', 'Off')},
    {label: t('digitalTwin.hazards', 'Hazards'), value: twinState.hazards === null ? '—' : twinState.hazards ? t('common.active', 'Active') : t('common.off', 'Off')},
  ], [twinState, t]);

  return (
    <PageContainer
      title={t('digitalTwin.title', 'Digital Twin')}
      subtitle={t('digitalTwin.subtitle', 'Real-time vehicle physical state')}
      loading={vehiclesLoading}
      actions={<VehicleSelect />}>
      {!vehicle && !vehiclesLoading ? (
        <GlassPanel style={styles.emptyPanel}>
          <EmptyState
            glyph="🚗"
            message={t('digitalTwin.noVehicles', 'No vehicles found. Add a vehicle to see its digital twin.')}
          />
        </GlassPanel>
      ) : (
        <View style={styles.layout}>
          {/* Main visualization */}
          <FadeIn style={styles.mainColumn}>
            <GlassPanel style={styles.mainPanel}>
              <VehicleTwin
                {...twinState}
                size="lg"
                interactive
                driveIn
                vehicleId={vehicle?.id}
                exteriorColor={vehicle?.exterior_color}
              />
              {vehicle?.id ? (
                <View style={styles.paintPickerWrap}>
                  <VehiclePaintPicker vehicleId={vehicle.id} exteriorColor={vehicle.exterior_color} />
                </View>
              ) : null}
              {twinState.lastUpdated ? (
                <AppText style={styles.lastUpdated} tone="muted" variant="caption">
                  {t('digitalTwin.lastUpdated', 'Last updated')}: {formatTime(twinState.lastUpdated)}
                </AppText>
              ) : null}
            </GlassPanel>
          </FadeIn>

          {/* Side detail panels */}
          <View style={styles.sideColumn}>
            {/* Doors panel */}
            <FadeIn delay={0.05}>
              <GlassPanel style={styles.sidePanel}>
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('digitalTwin.doorsTitle', 'Doors & Openings')}
                </AppText>
                {securityData ? (
                  <KVList columns={2} items={doorItems} />
                ) : (
                  <EmptyState glyph="ℹ️" message={t('digitalTwin.noDoorData', 'No door data available')} />
                )}
              </GlassPanel>
            </FadeIn>

            {/* Windows panel */}
            <FadeIn delay={0.1}>
              <GlassPanel style={styles.sidePanel}>
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('digitalTwin.windowsTitle', 'Windows')}
                </AppText>
                {securityData ? (
                  <KVList columns={2} items={windowItems} />
                ) : (
                  <EmptyState glyph="ℹ️" message={t('digitalTwin.noWindowData', 'No window data available')} />
                )}
              </GlassPanel>
            </FadeIn>

            {/* Security & Status panel */}
            <FadeIn delay={0.15}>
              <GlassPanel style={styles.sidePanel}>
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('digitalTwin.securityTitle', 'Security & Status')}
                </AppText>
                <KVList columns={2} items={securityItems} />
                {vehicle ? (
                  <View style={styles.statusBadgeWrap}>
                    <StatusBadge status={badgeStatus} />
                  </View>
                ) : null}
              </GlassPanel>
            </FadeIn>
          </View>
        </View>
      )}
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  emptyMessage: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  emptyPanel: {
    padding: spacing.xl,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  glyph: {
    textAlign: 'center',
  },
  lastUpdated: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  layout: {
    flexDirection: 'column',
    gap: spacing.lg,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  mainColumn: {
    alignItems: 'stretch',
  },
  mainPanel: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  pageActions: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  pageHeaderText: {
    flexShrink: 1,
  },
  pageRoot: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  paintActiveLabel: {
    flexBasis: '100%',
  },
  paintLabel: {
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  paintPickerWrap: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  paintReset: {
    color: '#7dd3fc',
    textDecorationLine: 'underline',
  },
  paintRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
  },
  paintSwatch: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 2,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  paintSwatchSelected: {
    borderColor: '#ffffff',
  },
  paintSwatches: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  sideColumn: {
    gap: spacing.md,
  },
  sidePanel: {
    padding: spacing.md,
  },
  statusBadgeWrap: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  twinBody: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    width: '100%',
  },
  twinChip: {
    alignItems: 'center',
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  twinChipText: {
    textTransform: 'capitalize',
  },
  twinStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  twinWrap: {
    alignItems: 'center',
    width: '100%',
  },
  vehicleSelect: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  vehicleSelectText: {
    color: colors.textPrimary,
  },
});
