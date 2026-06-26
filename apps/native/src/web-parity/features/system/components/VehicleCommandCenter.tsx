// Native parity port of
// web/src/features/system/components/VehicleCommandCenter.tsx.
//
// The Vehicle Commands control surface: a vehicle header (name, live state
// Badge, freshness, battery / range / cabin-temp readouts), a last-command
// result banner, an "asleep" guard banner, a stale-data warning, a command
// search box, a Quick-Actions favorites bar, and the full command catalogue
// rendered either as a flat search-result grid or as collapsible category
// groups — plus the three centralised command dialogs (input / select /
// confirm). Every state name, query key, API path, mutation, favorites
// persistence, dialog state machine, filtering, category grouping and tile
// dispatch is preserved 1:1 with the web source (mapped line-by-line in the
// .parity.json sidecar).
//
// Native adaptations vs. the web source (behaviour / state / keys kept):
//   - react-i18next useTranslation (web L3) -> a native-safe t(key, fallback?,
//     opts?) shim preserving every key + English default and {{var}}
//     interpolation (no i18n runtime in the parity tree; the WidgetCatalogue/
//     IncidentForm precedent). t('Command sent to') with no fallback returns
//     the key verbatim, matching the web "key IS the English" usage.
//   - @tanstack/react-query useQuery/useMutation/useQueryClient (web L2) are
//     used unchanged (react-query ships in the native app).
//   - @/lib/cn (web L4) -> dropped; Tailwind class merges become RN StyleSheet.
//   - @/lib/numberFormat fmtNumber (web L5) -> an inline en-US fmtNumber
//     (ChargingListPage precedent), called with the same precision.
//   - @/components/ui GlassPanel (web L6) -> the native GlassPanel; Badge
//     (web L7) -> an inline pill; Modal/Input/Button used by the dialogs ->
//     RN <Modal>/<TextInput> + inline pressables (the WidgetCatalogueDialog
//     dialog precedent).
//   - @/components/feedback/Toast useToast (web L8) -> an inline Alert.alert-
//     backed useToast (the parity layer's documented feedback primitive); the
//     toast.success/toast.error call sites + strings are preserved.
//   - @/hooks/useUnits + @/lib/unitConversion convertDistanceFromSI/
//     convertTempFromSI (web L9-10) -> inline native shims reading the native
//     useSettings (unit_of_length / unit_of_temp); the SI->display math is the
//     same as the web lib.
//   - @/api/client request (web L11) -> the native web-parity request client
//     (same generic signature; auto-prefixes /api/v1).
//   - lucide-react icons (web L12-14) -> canonical SemanticIcon glyphs rendered
//     as inline text (there is no thermometer glyph, so the cabin-temp readout
//     uses the 'climate' glyph — documented in the sidecar).
//   - ../commands COMMANDS/CATEGORY_ORDER + the CommandTile/ToggleCommandTile/
//     InputCommandTile/CollapsibleCommandGroup/FavoritesBar/CommandInput|Select|
//     ConfirmDialog siblings (web L15-29) are not yet in the parity tree, so the
//     catalogue + types + child renderers are ported inline as native-safe local
//     definitions (the ChargingListPage "inline the unconverted siblings"
//     precedent; the InputCommandTile "define the CommandDef locally" precedent).
//     The data, the per-command input/select/confirm configs and the press /
//     submit behaviour are faithful; CommandSearch (already converted) is reused.
//   - window.localStorage / sessionStorage (web favorites + group collapse) ->
//     a native-safe in-memory storage shim (RN has no synchronous web storage;
//     the SLOTrackingCard precedent); the getItem/setItem call sites + keys are
//     preserved, persistence is session-scoped (documented).
//   - the web CSS grid (grid-cols-2 sm:3 lg:4) -> a 2-column flex-wrap grid
//     (a phone is the base/xs breakpoint, where the web grid is 2 columns); the
//     hover-only affordances become pressed-state tints (no hover on touch).
//
// No DOM / lucide-react / Recharts / Leaflet / react-i18next / old web-UI
// imports reach the native output — only react, react-native primitives,
// react-query, the canonical AppText + SemanticIcon, the native GlassPanel,
// the native request client + useSettings, the reused CommandSearch, and theme
// tokens. See the .parity.json sidecar for the line-by-line source map.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useSettings} from '../../../api/hooks/useSettings';
import {CommandSearch} from './CommandSearch';

// ─── Native-safe i18n fallback (web react-i18next useTranslation) ────────────
// Preserves every key + English default and {{var}} interpolation. When no
// fallback is supplied the key itself is returned (the web "key IS English").
type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback?: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslation(): {t: NativeTFunction} {
  const t = useCallback<NativeTFunction>((key, fallback, options) => {
    const base = fallback ?? key;
    return options ? interpolate(base, options) : base;
  }, []);
  return {t};
}

// ─── Native-safe session storage (web localStorage / sessionStorage) ─────────
// RN has no synchronous web storage; this in-memory shim keeps the getItem/
// setItem call sites + keys identical. Persistence is session-scoped.
const memoryStore = new Map<string, string>();
const sessionStore = {
  getItem(key: string): string | null {
    return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
  },
  setItem(key: string, value: string): void {
    memoryStore.set(key, value);
  },
};

// ─── Glyph helper (web lucide icon component -> SemanticIcon glyph text) ──────
function glyphFor(name: SemanticIconName): string {
  return getSemanticIconDefinition(name).glyph;
}

const BATTERY_GLYPH = glyphFor('battery');
const WIFI_GLYPH = glyphFor('wifi');
const TEMP_GLYPH = glyphFor('climate'); // no thermometer glyph; closest semantic
const POWER_GLYPH = glyphFor('power');
const CHECK_GLYPH = glyphFor('success');
const ALERT_GLYPH = glyphFor('warning');
const CLOCK_GLYPH = glyphFor('clock');
const STAR_GLYPH = glyphFor('star');
const CHEVRON_GLYPH = glyphFor('expand');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `${hrs}h ago`;
  }
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ─── Unit conversion (web @/lib/unitConversion) ──────────────────────────────
type DistanceUnitPref = 'km' | 'mi';
type TemperatureUnitPref = '°C' | '°F';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  return to === '°F' ? (celsius * 9) / 5 + 32 : celsius;
}

interface UnitPrefsLite {
  distance: DistanceUnitPref;
  temperature: TemperatureUnitPref;
}

// ─── useUnits (web @/hooks/useUnits) ─────────────────────────────────────────
function useUnits(): {unitPrefs: UnitPrefsLite} {
  const {data} = useSettings();
  const distance: DistanceUnitPref =
    data?.unit_of_length === 'mi' ? 'mi' : 'km';
  const temperature: TemperatureUnitPref =
    data?.unit_of_temp === 'F' ? '°F' : '°C';
  const unitPrefs = useMemo<UnitPrefsLite>(
    () => ({distance, temperature}),
    [distance, temperature],
  );
  return {unitPrefs};
}

// ─── useToast (web @/components/feedback/Toast) ──────────────────────────────
type ToastFn = (message: string) => void;
function useToast(): {success: ToastFn; error: ToastFn} {
  return useMemo(() => {
    const show: ToastFn = message => Alert.alert(message);
    return {success: show, error: show};
  }, []);
}

// ─── useIsStale + FreshnessIndicator (web @/components/data-display) ──────────
function computeAge(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }
  const ms = Date.now() - new Date(timestamp).getTime();
  return Math.max(0, Math.floor(ms / 1000));
}

type FreshnessStatus = 'fresh' | 'stale' | 'offline' | 'unknown';

function getStatus(
  age: number | null,
  staleThreshold: number,
  offlineThreshold: number,
): FreshnessStatus {
  if (age === null) {
    return 'unknown';
  }
  if (age < staleThreshold) {
    return 'fresh';
  }
  if (age < offlineThreshold) {
    return 'stale';
  }
  return 'offline';
}

function formatAge(age: number | null): string {
  if (age === null) {
    return '—';
  }
  if (age < 10) {
    return 'just now';
  }
  if (age < 60) {
    return `${age}s ago`;
  }
  if (age < 3600) {
    return `${Math.floor(age / 60)}m ago`;
  }
  return `${Math.floor(age / 3600)}h ago`;
}

function useTenSecondTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);
}

function useIsStale(
  timestamp: string | null | undefined,
  staleThreshold = 120,
): {isStale: boolean; isOffline: boolean; ageLabel: string} {
  useTenSecondTick();
  const age = computeAge(timestamp);
  const isStale = age !== null && age >= staleThreshold;
  const isOffline = age !== null && age >= 600;
  const ageLabel = formatAge(age);
  return {isStale, isOffline, ageLabel};
}

const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  stale: colors.warning,
  offline: colors.danger,
  unknown: colors.surfaceRaised,
};

function FreshnessIndicator({
  timestamp,
  staleThreshold = 120,
  offlineThreshold = 600,
  showLabel = true,
}: {
  timestamp: string | null | undefined;
  staleThreshold?: number;
  offlineThreshold?: number;
  showLabel?: boolean;
}) {
  useTenSecondTick();
  const age = computeAge(timestamp);
  const status = getStatus(age, staleThreshold, offlineThreshold);
  const label = formatAge(age);
  return (
    <View style={styles.freshnessRow}>
      <View style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]} />
      {showLabel ? (
        <AppText style={styles.freshnessLabel} variant="caption">
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

// ─── Badge (web @/components/ui Badge) ───────────────────────────────────────
function Badge({
  variant,
  children,
}: {
  variant: 'neutral' | 'success';
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, variant === 'success' ? styles.badgeSuccess : styles.badgeNeutral]}>
      <AppText
        style={variant === 'success' ? styles.badgeSuccessText : styles.badgeNeutralText}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// ─── AlertBanner (web @/components/feedback AlertBanner) ──────────────────────
function AlertBanner({
  iconGlyph,
  children,
}: {
  iconGlyph?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.alertBanner}>
      {iconGlyph ? (
        <AppText style={styles.alertBannerIcon} variant="caption" weight="bold">
          {iconGlyph}
        </AppText>
      ) : null}
      <AppText style={styles.alertBannerText} variant="caption">
        {children}
      </AppText>
    </View>
  );
}

// ─── Types (web ../commands) ─────────────────────────────────────────────────

type CommandCategory =
  | 'security'
  | 'climate'
  | 'climate_protection'
  | 'charging'
  | 'doors'
  | 'drive'
  | 'windows'
  | 'sunroof'
  | 'schedules'
  | 'alerts'
  | 'navigation'
  | 'software'
  | 'vehicle'
  | 'media';

type CommandVariant = 'default' | 'danger' | 'success';
type CommandType = 'action' | 'toggle' | 'input';

interface InputField {
  name: string;
  labelKey: string;
  labelFallback: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'password';
  validation?: 'pin' | 'number' | 'decimal' | 'text';
  min?: number;
  max?: number;
}

interface InputConfig {
  promptKey: string;
  promptFallback: string;
  paramName: string;
  defaultValue?: string;
  validation?: 'pin' | 'number' | 'decimal' | 'text';
  min?: number;
  max?: number;
  transform?: (value: string) => unknown;
  fields?: InputField[];
  buildParams?: (values: Record<string, string>) => Record<string, unknown>;
  getDefaultValue?: (ctx: {vehicle?: {display_name: string}}) => string;
}

interface SelectOption {
  value: string;
  labelKey: string;
  labelFallback: string;
  description?: string;
}

interface SelectConfig {
  paramName: string;
  options: SelectOption[];
}

interface CommandDef {
  id: string;
  command: string;
  commandOff?: string;
  labelKey: string;
  labelFallback: string;
  sublabelKey?: string;
  sublabelFallback?: string;
  icon: SemanticIconName;
  iconOff?: SemanticIconName;
  category: CommandCategory;
  variant?: CommandVariant;
  type: CommandType;
  stateField?: string;
  dangerous?: boolean;
  confirmKey?: string;
  confirmFallback?: string;
  defaultFavorite?: boolean;
  inputConfig?: InputConfig;
  selectConfig?: SelectConfig;
  params?: Record<string, unknown>;
  countdown?: number;
  confirmInput?: string;
}

export interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
  model: string;
  state: string;
  battery_level: number;
  battery_range: number;
  updated_at: string;
}

export interface VehicleState {
  battery_level: number;
  rated_range: number;
  is_locked: boolean;
  is_charging: boolean;
  is_climate_on: boolean;
  sentry_mode: boolean;
  inside_temp: number;
  speed: number;
}

interface CommandLogEntry {
  id: number;
  vehicle_id: number;
  command: string;
  params: string;
  status: string;
  error: string;
  created_at: string;
}

// ─── Category metadata (web CATEGORY_ORDER / CATEGORY_META) ───────────────────

const CATEGORY_ORDER: CommandCategory[] = [
  'security',
  'climate',
  'climate_protection',
  'charging',
  'doors',
  'drive',
  'windows',
  'sunroof',
  'schedules',
  'alerts',
  'navigation',
  'software',
  'vehicle',
  'media',
];

const CATEGORY_META: Record<
  CommandCategory,
  {labelKey: string; fallback: string; icon: SemanticIconName}
> = {
  security: {labelKey: 'commands.cat.security', fallback: 'Security & Access', icon: 'security'},
  climate: {labelKey: 'commands.cat.climate', fallback: 'Climate & Comfort', icon: 'wind'},
  climate_protection: {labelKey: 'commands.cat.climateProtect', fallback: 'Climate Protection', icon: 'securityAlert'},
  charging: {labelKey: 'commands.cat.charging', fallback: 'Charging', icon: 'charging'},
  doors: {labelKey: 'commands.cat.doors', fallback: 'Doors & Trunk', icon: 'doorOpen'},
  drive: {labelKey: 'commands.cat.drive', fallback: 'Drive', icon: 'vehicle'},
  windows: {labelKey: 'commands.cat.windows', fallback: 'Windows', icon: 'wind'},
  sunroof: {labelKey: 'commands.cat.sunroof', fallback: 'Sunroof', icon: 'arrowUpFromDot'},
  schedules: {labelKey: 'commands.cat.schedules', fallback: 'Schedules', icon: 'calendarPlus'},
  alerts: {labelKey: 'commands.cat.alerts', fallback: 'Alerts & Location', icon: 'speaker'},
  navigation: {labelKey: 'commands.cat.navigation', fallback: 'Navigation', icon: 'navigation'},
  software: {labelKey: 'commands.cat.software', fallback: 'Software', icon: 'download'},
  vehicle: {labelKey: 'commands.cat.vehicle', fallback: 'Vehicle', icon: 'vehicle'},
  media: {labelKey: 'commands.cat.media', fallback: 'Media', icon: 'play'},
};

// ─── Command definitions (web COMMANDS) ──────────────────────────────────────

const COMMANDS: CommandDef[] = [
  // Security & Access
  {
    id: 'wake_up', command: 'wake_up',
    labelKey: 'commands.security.wakeUp', labelFallback: 'Wake Up',
    sublabelKey: 'commands.security.wakeVehicle', sublabelFallback: 'Wake vehicle',
    icon: 'power', category: 'security', type: 'action',
    variant: 'success', defaultFavorite: true,
  },
  {
    id: 'lock', command: 'lock', commandOff: 'unlock',
    labelKey: 'commands.security.lock', labelFallback: 'Lock',
    icon: 'locked', iconOff: 'unlocked', category: 'security', type: 'toggle',
    stateField: 'is_locked', defaultFavorite: true,
  },
  {
    id: 'sentry', command: 'sentry_on', commandOff: 'sentry_off',
    labelKey: 'commands.security.sentry', labelFallback: 'Sentry',
    icon: 'security', category: 'security', type: 'toggle',
    stateField: 'sentry_mode', variant: 'danger', defaultFavorite: true,
  },
  {
    id: 'speed_limit_set', command: 'speed_limit_set_limit',
    labelKey: 'commands.security.speedLimit', labelFallback: 'Speed Limit',
    sublabelKey: 'commands.security.setMph', sublabelFallback: 'Set MPH',
    icon: 'speedCircle', category: 'security', type: 'input', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.security.enterSpeedLimit',
      promptFallback: 'Enter speed limit (50-90 MPH):',
      paramName: 'limit_mph', validation: 'number', min: 50, max: 90,
    },
  },
  {
    id: 'speed_limit_on', command: 'speed_limit_on',
    labelKey: 'commands.security.speedActivate', labelFallback: 'Activate',
    sublabelKey: 'commands.security.speedLimitMode', sublabelFallback: 'Speed Limit',
    icon: 'speedCircle', category: 'security', type: 'input', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.security.enterSpeedPin',
      promptFallback: 'Enter 4-digit PIN:',
      paramName: 'pin', validation: 'pin',
    },
  },
  {
    id: 'speed_limit_off', command: 'speed_limit_off',
    labelKey: 'commands.security.speedDeactivate', labelFallback: 'Deactivate',
    sublabelKey: 'commands.security.speedLimitMode', sublabelFallback: 'Speed Limit',
    icon: 'speedCircle', category: 'security', type: 'input',
    inputConfig: {
      promptKey: 'commands.security.enterSpeedPin',
      promptFallback: 'Enter 4-digit PIN:',
      paramName: 'pin', validation: 'pin',
    },
  },
  {
    id: 'speed_limit_clear_pin', command: 'speed_limit_clear_pin',
    labelKey: 'commands.security.clearSpeedPin', labelFallback: 'Clear Speed PIN',
    sublabelKey: 'commands.security.requiresPin', sublabelFallback: 'Requires PIN',
    icon: 'speedCircle', category: 'security', type: 'input', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.security.enterSpeedPin',
      promptFallback: 'Enter 4-digit PIN:',
      paramName: 'pin', validation: 'pin',
    },
  },
  {
    id: 'speed_limit_clear_pin_admin', command: 'speed_limit_clear_pin_admin',
    labelKey: 'commands.security.clearSpeedPin', labelFallback: 'Clear Speed PIN',
    sublabelKey: 'commands.security.admin', sublabelFallback: 'Admin',
    icon: 'speedCircle', category: 'security', type: 'action', variant: 'danger',
    dangerous: true,
    confirmKey: 'commands.security.confirmClearPin',
    confirmFallback: 'Clear speed limit PIN without authentication?',
  },
  {
    id: 'valet_mode', command: 'set_valet_mode', commandOff: 'valet_off',
    labelKey: 'commands.security.valetMode', labelFallback: 'Valet Mode',
    icon: 'userCheck', iconOff: 'userX', category: 'security', type: 'toggle', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.security.enterValetPin',
      promptFallback: 'Enter 4-digit valet PIN:',
      paramName: 'password', validation: 'pin',
    },
    params: {on: 'true'},
  },
  {
    id: 'reset_valet_pin', command: 'reset_valet_pin',
    labelKey: 'commands.security.resetValetPin', labelFallback: 'Reset Valet PIN',
    sublabelKey: 'commands.security.admin', sublabelFallback: 'Admin',
    icon: 'userX', category: 'security', type: 'action', variant: 'danger',
  },
  {
    id: 'guest_mode', command: 'guest_mode_on', commandOff: 'guest_mode_off',
    labelKey: 'commands.security.guestMode', labelFallback: 'Guest Mode',
    icon: 'userPlus', iconOff: 'userX', category: 'security', type: 'toggle',
  },
  {
    id: 'erase_user_data', command: 'erase_user_data',
    labelKey: 'commands.security.eraseData', labelFallback: 'Erase Data',
    sublabelKey: 'commands.security.guestOnly', sublabelFallback: 'Guest mode only',
    icon: 'eraser', category: 'security', type: 'action', variant: 'danger',
    dangerous: true,
    confirmKey: 'commands.security.confirmErase',
    confirmFallback: 'This will erase all user data from the vehicle touchscreen. Continue?',
    countdown: 5,
    confirmInput: 'ERASE',
  },
  {
    id: 'pin_to_drive', command: 'set_pin_to_drive',
    labelKey: 'commands.security.pinToDrive', labelFallback: 'PIN to Drive',
    sublabelKey: 'commands.security.enable', sublabelFallback: 'Enable',
    icon: 'keyRound', category: 'security', type: 'input', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.security.enterPin',
      promptFallback: 'Enter 4-digit PIN:',
      paramName: 'password', validation: 'pin',
    },
    params: {on: 'true'},
  },
  {
    id: 'reset_pin_to_drive_pin', command: 'reset_pin_to_drive_pin',
    labelKey: 'commands.security.resetPin', labelFallback: 'Reset PIN',
    sublabelKey: 'commands.security.pinToDrive', sublabelFallback: 'PIN to Drive',
    icon: 'keyRound', category: 'security', type: 'action', variant: 'danger',
  },
  {
    id: 'clear_pin_to_drive_admin', command: 'clear_pin_to_drive_admin',
    labelKey: 'commands.security.clearPin', labelFallback: 'Clear PIN',
    sublabelKey: 'commands.security.admin', sublabelFallback: 'Admin',
    icon: 'keyRound', category: 'security', type: 'action', variant: 'danger',
    dangerous: true,
    confirmKey: 'commands.security.confirmClearDrivePin',
    confirmFallback: 'Clear PIN to Drive without authentication?',
  },

  // Climate & Comfort
  {
    id: 'climate', command: 'climate_on', commandOff: 'climate_off',
    labelKey: 'commands.climate.climate', labelFallback: 'Climate',
    icon: 'wind', category: 'climate', type: 'toggle',
    stateField: 'is_climate_on', defaultFavorite: true,
  },
  {
    id: 'set_temps', command: 'set_temps',
    labelKey: 'commands.climate.setTemps', labelFallback: 'Set Temps',
    sublabelKey: 'commands.climate.driverPassenger', sublabelFallback: 'Driver/Passenger',
    icon: 'climate', category: 'climate', type: 'input',
    inputConfig: {
      promptKey: 'commands.climate.enterTemp',
      promptFallback: 'Enter temperature in °C (e.g., 21):',
      paramName: 'driver_temp', validation: 'decimal', min: 15, max: 30,
      buildParams: values => ({driver_temp: values.driver_temp, passenger_temp: values.driver_temp}),
    },
  },
  {
    id: 'seat_heater', command: 'seat_heater',
    labelKey: 'commands.climate.seatHeat', labelFallback: 'Seat Heat',
    sublabelKey: 'commands.climate.driver', sublabelFallback: 'Driver',
    icon: 'flame', category: 'climate', type: 'action',
    params: {heater: '0', level: '3'},
  },
  {
    id: 'seat_cooler', command: 'seat_cooler',
    labelKey: 'commands.climate.seatCool', labelFallback: 'Seat Cool',
    sublabelKey: 'commands.climate.driver', sublabelFallback: 'Driver',
    icon: 'cooling', category: 'climate', type: 'action',
    params: {seat_position: '0', seat_cooler_level: '3'},
  },
  {
    id: 'steering_wheel_heat', command: 'steering_wheel_heat',
    labelKey: 'commands.climate.steeringHeat', labelFallback: 'Steering Heat',
    sublabelKey: 'commands.climate.toggle', sublabelFallback: 'Toggle',
    icon: 'tirePressure', category: 'climate', type: 'action',
    params: {on: 'true'},
  },
  // Climate Protection
  {
    id: 'bioweapon', command: 'bioweapon_on', commandOff: 'bioweapon_off',
    labelKey: 'commands.climate.bioweapon', labelFallback: 'Bioweapon',
    sublabelKey: 'commands.climate.defenseMode', sublabelFallback: 'Defense Mode',
    icon: 'securityAlert', category: 'climate_protection', type: 'toggle', variant: 'danger',
  },
  {
    id: 'cop_on', command: 'cop_on',
    labelKey: 'commands.climate.cop', labelFallback: 'Overheat Protect',
    sublabelKey: 'commands.climate.copOn', sublabelFallback: 'On (AC)',
    icon: 'climate', category: 'climate_protection', type: 'action',
  },
  {
    id: 'cop_fan_only', command: 'cop_fan_only',
    labelKey: 'commands.climate.copFan', labelFallback: 'Overheat Protect',
    sublabelKey: 'commands.climate.fanOnly', sublabelFallback: 'Fan only',
    icon: 'climate', category: 'climate_protection', type: 'action',
  },
  {
    id: 'cop_off', command: 'cop_off',
    labelKey: 'commands.climate.copOff', labelFallback: 'Overheat Protect',
    sublabelKey: 'commands.climate.off', sublabelFallback: 'OFF',
    icon: 'climate', category: 'climate_protection', type: 'action',
  },
  {
    id: 'set_cop_temp', command: 'set_cop_temp',
    labelKey: 'commands.climate.copTemp', labelFallback: 'COP Temp',
    sublabelKey: 'commands.climate.setLevel', sublabelFallback: 'Low/Med/High',
    icon: 'climate', category: 'climate_protection', type: 'input',
    selectConfig: {
      paramName: 'cop_temp',
      options: [
        {value: '0', labelKey: 'commands.climate.copLow', labelFallback: 'Low', description: '90°F / 30°C'},
        {value: '1', labelKey: 'commands.climate.copMedium', labelFallback: 'Medium', description: '95°F / 35°C'},
        {value: '2', labelKey: 'commands.climate.copHigh', labelFallback: 'High', description: '100°F / 40°C'},
      ],
    },
  },
  {
    id: 'climate_keeper', command: 'climate_keeper_on', commandOff: 'climate_keeper_off',
    labelKey: 'commands.climate.climateKeeper', labelFallback: 'Climate Keeper',
    sublabelKey: 'commands.climate.keepMode', sublabelFallback: 'Keep',
    icon: 'wind', iconOff: 'close', category: 'climate_protection', type: 'toggle', variant: 'success',
  },
  {
    id: 'dog_mode', command: 'dog_mode',
    labelKey: 'commands.climate.dogMode', labelFallback: 'Dog Mode',
    icon: 'dog', category: 'climate_protection', type: 'action', variant: 'success',
  },
  {
    id: 'camp_mode', command: 'camp_mode',
    labelKey: 'commands.climate.campMode', labelFallback: 'Camp Mode',
    icon: 'tent', category: 'climate_protection', type: 'action', variant: 'success',
  },
  {
    id: 'preconditioning_max', command: 'preconditioning_max',
    labelKey: 'commands.climate.maxPrecondition', labelFallback: 'Max Precondition',
    sublabelKey: 'commands.climate.override', sublabelFallback: 'Override',
    icon: 'flame', category: 'climate_protection', type: 'action', variant: 'danger',
  },
  {
    id: 'preconditioning_reset', command: 'preconditioning_reset',
    labelKey: 'commands.climate.resetPrecondition', labelFallback: 'Reset Precondition',
    sublabelKey: 'commands.climate.default', sublabelFallback: 'Default',
    icon: 'flame', category: 'climate_protection', type: 'action',
  },

  // Charging
  {
    id: 'charge_port_open', command: 'charge_port_open',
    labelKey: 'commands.charging.chargePort', labelFallback: 'Charge Port',
    sublabelKey: 'commands.charging.open', sublabelFallback: 'Open',
    icon: 'charging', category: 'charging', type: 'action',
  },
  {
    id: 'close_charge_port', command: 'close_charge_port',
    labelKey: 'commands.charging.chargePort', labelFallback: 'Charge Port',
    sublabelKey: 'commands.charging.close', sublabelFallback: 'Close',
    icon: 'charging', category: 'charging', type: 'action',
  },
  {
    id: 'charge', command: 'charge_start', commandOff: 'charge_stop',
    labelKey: 'commands.charging.charge', labelFallback: 'Charge',
    icon: 'charging', category: 'charging', type: 'toggle',
    stateField: 'is_charging', variant: 'success',
  },
  {
    id: 'charge_max_range', command: 'charge_max_range',
    labelKey: 'commands.charging.maxRange', labelFallback: 'Max Range',
    sublabelKey: 'commands.charging.tripMode', sublabelFallback: 'Trip mode',
    icon: 'batteryFull', category: 'charging', type: 'action', variant: 'danger',
  },
  {
    id: 'charge_standard', command: 'charge_standard',
    labelKey: 'commands.charging.standard', labelFallback: 'Standard',
    sublabelKey: 'commands.charging.dailyMode', sublabelFallback: 'Daily mode',
    icon: 'batteryMedium', category: 'charging', type: 'action', variant: 'success',
  },
  {
    id: 'set_charging_amps', command: 'set_charging_amps',
    labelKey: 'commands.charging.setAmps', labelFallback: 'Set Amps',
    sublabelKey: 'commands.charging.amperage', sublabelFallback: 'Amperage',
    icon: 'speed', category: 'charging', type: 'input',
    inputConfig: {
      promptKey: 'commands.charging.enterAmps',
      promptFallback: 'Enter charging amps (e.g., 16, 32, 48):',
      paramName: 'charging_amps',
    },
  },
  {
    id: 'set_charge_limit', command: 'set_charge_limit',
    labelKey: 'commands.charging.setLimit', labelFallback: 'Set Limit',
    sublabelKey: 'commands.charging.percent', sublabelFallback: 'Charge %',
    icon: 'battery', category: 'charging', type: 'input',
    inputConfig: {
      promptKey: 'commands.charging.enterLimit',
      promptFallback: 'Enter charge limit % (50–100):',
      paramName: 'percent', defaultValue: '80',
    },
  },

  // Doors & Trunk
  {
    id: 'frunk_open', command: 'frunk_open',
    labelKey: 'commands.doors.frunk', labelFallback: 'Frunk',
    sublabelKey: 'commands.doors.open', sublabelFallback: 'Open',
    icon: 'doorOpen', category: 'doors', type: 'action', defaultFavorite: true,
  },
  {
    id: 'trunk_open', command: 'trunk_open',
    labelKey: 'commands.doors.trunk', labelFallback: 'Trunk',
    sublabelKey: 'commands.doors.open', sublabelFallback: 'Open',
    icon: 'doorOpen', category: 'doors', type: 'action',
  },

  // Drive
  {
    id: 'remote_start_drive', command: 'remote_start_drive',
    labelKey: 'commands.drive.remoteStart', labelFallback: 'Remote Start',
    sublabelKey: 'commands.drive.keylessDrive', sublabelFallback: 'Keyless drive',
    icon: 'vehicle', category: 'drive', type: 'action', variant: 'danger',
    dangerous: true,
    confirmKey: 'commands.drive.confirmRemoteStart',
    confirmFallback: 'This will enable keyless driving for 2 minutes. Continue?',
    countdown: 3,
  },

  // Windows
  {
    id: 'vent_windows', command: 'vent_windows',
    labelKey: 'commands.windows.vent', labelFallback: 'Vent Windows',
    icon: 'wind', category: 'windows', type: 'action',
  },
  {
    id: 'close_windows', command: 'close_windows',
    labelKey: 'commands.windows.close', labelFallback: 'Close Windows',
    icon: 'close', category: 'windows', type: 'action',
  },

  // Sunroof
  {
    id: 'sunroof_vent', command: 'sunroof_vent',
    labelKey: 'commands.sunroof.vent', labelFallback: 'Sunroof',
    sublabelKey: 'commands.sunroof.ventMode', sublabelFallback: 'Vent',
    icon: 'arrowUpFromDot', category: 'sunroof', type: 'action',
  },
  {
    id: 'sunroof_close', command: 'sunroof_close',
    labelKey: 'commands.sunroof.close', labelFallback: 'Sunroof',
    sublabelKey: 'commands.sunroof.closeMode', sublabelFallback: 'Close',
    icon: 'arrowDownToDot', category: 'sunroof', type: 'action',
  },
  {
    id: 'sunroof_stop', command: 'sunroof_stop',
    labelKey: 'commands.sunroof.stop', labelFallback: 'Sunroof',
    sublabelKey: 'commands.sunroof.stopMode', sublabelFallback: 'Stop',
    icon: 'circleStop', category: 'sunroof', type: 'action',
  },
  // Schedules
  {
    id: 'add_charge_schedule', command: 'add_charge_schedule',
    labelKey: 'commands.schedules.addCharge', labelFallback: 'Add Charge Schedule',
    sublabelKey: 'commands.schedules.midnight', sublabelFallback: 'Midnight daily',
    icon: 'calendarPlus', category: 'schedules', type: 'action', variant: 'success',
    params: {
      id: '0', name: 'Default', days_of_week: '127',
      start_enabled: 'true', start_time: '0',
      end_enabled: 'false', end_time: '0', one_time: 'false',
    },
  },
  {
    id: 'remove_charge_schedule', command: 'remove_charge_schedule',
    labelKey: 'commands.schedules.removeCharge', labelFallback: 'Remove Schedule',
    sublabelKey: 'commands.schedules.byId', sublabelFallback: 'By ID',
    icon: 'calendarMinus', category: 'schedules', type: 'input', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.schedules.enterScheduleId',
      promptFallback: 'Enter schedule ID to remove:',
      paramName: 'id',
    },
  },
  {
    id: 'add_precondition_schedule', command: 'add_precondition_schedule',
    labelKey: 'commands.schedules.addPrecondition', labelFallback: 'Add Precondition',
    sublabelKey: 'commands.schedules.morning', sublabelFallback: '7 AM daily',
    icon: 'calendarPlus', category: 'schedules', type: 'action', variant: 'success',
    params: {
      id: '0', name: 'Morning', days_of_week: '127',
      precondition_time: '420', one_time: 'false',
    },
  },
  {
    id: 'remove_precondition_schedule', command: 'remove_precondition_schedule',
    labelKey: 'commands.schedules.removePrecondition', labelFallback: 'Remove Precondition',
    sublabelKey: 'commands.schedules.byId', sublabelFallback: 'By ID',
    icon: 'calendarMinus', category: 'schedules', type: 'input', variant: 'danger',
    inputConfig: {
      promptKey: 'commands.schedules.enterScheduleId',
      promptFallback: 'Enter schedule ID to remove:',
      paramName: 'id',
    },
  },

  // Alerts & Location
  {
    id: 'honk_horn', command: 'honk_horn',
    labelKey: 'commands.alerts.horn', labelFallback: 'Horn',
    icon: 'volume', category: 'alerts', type: 'action',
    variant: 'danger', defaultFavorite: true,
  },
  {
    id: 'flash_lights', command: 'flash_lights',
    labelKey: 'commands.alerts.flashLights', labelFallback: 'Flash Lights',
    icon: 'location', category: 'alerts', type: 'action',
  },
  {
    id: 'boombox_fart', command: 'boombox_fart',
    labelKey: 'commands.alerts.boombox', labelFallback: 'Boombox',
    sublabelKey: 'commands.alerts.randomFart', sublabelFallback: 'Random fart',
    icon: 'speaker', category: 'alerts', type: 'action',
  },
  {
    id: 'boombox_ping', command: 'boombox_ping',
    labelKey: 'commands.alerts.locatePing', labelFallback: 'Locate Ping',
    sublabelKey: 'commands.alerts.findMyCar', sublabelFallback: 'Find my car',
    icon: 'locate', category: 'alerts', type: 'action',
  },
  {
    id: 'trigger_homelink', command: 'trigger_homelink',
    labelKey: 'commands.homelink.trigger', labelFallback: 'HomeLink',
    sublabelKey: 'commands.homelink.garage', sublabelFallback: 'Garage door',
    icon: 'home', category: 'alerts', type: 'input',
    inputConfig: {
      promptKey: 'commands.homelink.triggerTitle',
      promptFallback: 'Enter vehicle coordinates',
      paramName: '',
      fields: [
        {name: 'lat', labelKey: 'commands.homelink.latitude', labelFallback: 'Latitude', placeholder: '37.7749', type: 'text', validation: 'decimal'},
        {name: 'lon', labelKey: 'commands.homelink.longitude', labelFallback: 'Longitude', placeholder: '-122.4194', type: 'text', validation: 'decimal'},
      ],
      buildParams: values => ({lat: values.lat, lon: values.lon}),
    },
  },

  // Navigation
  {
    id: 'navigation_request', command: 'navigation_request',
    labelKey: 'commands.nav.sendAddress', labelFallback: 'Send Address',
    sublabelKey: 'commands.nav.toVehicleNav', sublabelFallback: 'To vehicle nav',
    icon: 'navigation', category: 'navigation', type: 'input',
    inputConfig: {
      promptKey: 'commands.nav.enterAddress',
      promptFallback: 'Enter destination address:',
      paramName: 'address', validation: 'text',
      buildParams: values => ({
        type: 'share_ext_content_raw',
        value: {'android.intent.extra.TEXT': values.address},
        locale: 'en-US',
      }),
    },
  },
  {
    id: 'navigation_gps_request', command: 'navigation_gps_request',
    labelKey: 'commands.nav.sendGPS', labelFallback: 'Send GPS',
    sublabelKey: 'commands.nav.coordinates', sublabelFallback: 'Lat / Lon',
    icon: 'location', category: 'navigation', type: 'input',
    inputConfig: {
      promptKey: 'commands.nav.sendGPSTitle',
      promptFallback: 'Enter GPS coordinates',
      paramName: '',
      fields: [
        {name: 'lat', labelKey: 'commands.nav.latitude', labelFallback: 'Latitude', placeholder: '37.7749', type: 'text', validation: 'decimal'},
        {name: 'lon', labelKey: 'commands.nav.longitude', labelFallback: 'Longitude', placeholder: '-122.4194', type: 'text', validation: 'decimal'},
      ],
      buildParams: values => ({lat: parseFloat(values.lat), lon: parseFloat(values.lon), order: 0}),
    },
  },
  {
    id: 'navigation_sc_request', command: 'navigation_sc_request',
    labelKey: 'commands.nav.supercharger', labelFallback: 'Supercharger',
    sublabelKey: 'commands.nav.byId', sublabelFallback: 'By ID',
    icon: 'charging', category: 'navigation', type: 'input',
    inputConfig: {
      promptKey: 'commands.nav.enterScId',
      promptFallback: 'Enter Supercharger ID:',
      paramName: 'id', transform: v => parseInt(v, 10),
    },
    params: {order: 0},
  },

  // Software
  {
    id: 'schedule_software_update', command: 'schedule_software_update',
    labelKey: 'commands.software.scheduleUpdate', labelFallback: 'Schedule Update',
    sublabelKey: 'commands.software.installNow', sublabelFallback: 'Install now',
    icon: 'download', category: 'software', type: 'input', variant: 'success',
    inputConfig: {
      promptKey: 'commands.software.enterDelay',
      promptFallback: 'Install in how many minutes? (0 = now, 120 = 2 hours)',
      paramName: 'offset_sec', defaultValue: '0',
      transform: v => String(parseInt(v, 10) * 60),
    },
  },
  {
    id: 'cancel_software_update', command: 'cancel_software_update',
    labelKey: 'commands.software.cancelUpdate', labelFallback: 'Cancel Update',
    sublabelKey: 'commands.software.stopPending', sublabelFallback: 'Stop pending',
    icon: 'error', category: 'software', type: 'action', variant: 'danger',
  },

  // Vehicle
  {
    id: 'set_vehicle_name', command: 'set_vehicle_name',
    labelKey: 'commands.vehicle.rename', labelFallback: 'Rename',
    sublabelKey: 'commands.vehicle.changeName', sublabelFallback: 'Change name',
    icon: 'pencil', category: 'vehicle', type: 'input',
    inputConfig: {
      promptKey: 'commands.vehicle.enterName',
      promptFallback: 'Enter new vehicle name:',
      paramName: 'vehicle_name', validation: 'text',
      getDefaultValue: ctx => ctx.vehicle?.display_name ?? '',
      buildParams: values => ({vehicle_name: values.vehicle_name.trim()}),
    },
  },

  // Media
  {
    id: 'media_toggle_playback', command: 'media_toggle_playback',
    labelKey: 'commands.media.playPause', labelFallback: 'Play / Pause',
    icon: 'play', category: 'media', type: 'action',
  },
  {
    id: 'media_prev_track', command: 'media_prev_track',
    labelKey: 'commands.media.prevTrack', labelFallback: 'Prev Track',
    icon: 'skipBack', category: 'media', type: 'action',
  },
  {
    id: 'media_next_track', command: 'media_next_track',
    labelKey: 'commands.media.nextTrack', labelFallback: 'Next Track',
    icon: 'skipForward', category: 'media', type: 'action',
  },
  {
    id: 'media_prev_fav', command: 'media_prev_fav',
    labelKey: 'commands.media.prevFav', labelFallback: 'Prev Favorite',
    icon: 'heart', category: 'media', type: 'action',
  },
  {
    id: 'media_next_fav', command: 'media_next_fav',
    labelKey: 'commands.media.nextFav', labelFallback: 'Next Favorite',
    icon: 'heart', category: 'media', type: 'action',
  },
  {
    id: 'adjust_volume', command: 'adjust_volume',
    labelKey: 'commands.media.volumeUp', labelFallback: 'Volume Up',
    icon: 'volumeLow', category: 'media', type: 'input',
    inputConfig: {
      promptKey: 'commands.media.enterVolume',
      promptFallback: 'Enter volume level (0.0 – 11.0):',
      paramName: 'volume', defaultValue: '5',
    },
  },
  {
    id: 'media_volume_down', command: 'media_volume_down',
    labelKey: 'commands.media.volumeDown', labelFallback: 'Volume Down',
    icon: 'volumeOff', category: 'media', type: 'action',
  },
];

// ─── Tile styling atoms (web hover/on-state Tailwind classes) ────────────────
const variantBorderStyles = StyleSheet.create<Record<CommandVariant, ViewStyle>>({
  default: {borderColor: colors.borderAccent},
  danger: {borderColor: colors.dangerBorder},
  success: {borderColor: colors.successBorder},
});

interface ToggleOnStyle {
  panel: ViewStyle;
  iconBox: ViewStyle;
  iconColor: string;
  dot: string;
  text: string;
}

const toggleOnStyles: Record<CommandVariant, ToggleOnStyle> = {
  default: {
    panel: {borderColor: colors.borderAccent, backgroundColor: colors.accentSoft},
    iconBox: {backgroundColor: colors.accentSoft},
    iconColor: colors.accent, dot: colors.accent, text: colors.accent,
  },
  danger: {
    panel: {borderColor: colors.dangerBorder, backgroundColor: colors.dangerSurface},
    iconBox: {backgroundColor: colors.dangerSurface},
    iconColor: colors.danger, dot: colors.danger, text: colors.danger,
  },
  success: {
    panel: {borderColor: colors.successBorder, backgroundColor: colors.successSurface},
    iconBox: {backgroundColor: colors.successSurface},
    iconColor: colors.success, dot: colors.success, text: colors.success,
  },
};

interface CommonTileProps {
  loading: boolean;
  lastStatus?: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onRequestDialog: (def: CommandDef) => void;
}

type ExecuteFn = (command: string, params?: Record<string, unknown>) => void;

function FavoriteStar({
  active,
  onPress,
  label,
}: {
  active: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      hitSlop={8}
      onPress={onPress}
      style={styles.favorite}>
      <AppText
        style={[styles.favoriteGlyph, active ? styles.favoriteActive : styles.favoriteInactive]}
        variant="caption"
        weight="bold">
        {STAR_GLYPH}
      </AppText>
    </Pressable>
  );
}

function TileStatus({lastStatus}: {lastStatus?: string}) {
  if (!lastStatus) {
    return null;
  }
  const statusOk = lastStatus.startsWith('✓');
  return (
    <AppText style={[styles.status, statusOk ? styles.statusOk : styles.statusErr]}>
      {lastStatus}
    </AppText>
  );
}

// ─── CommandTile (web ./CommandTile) ─────────────────────────────────────────
function CommandTile({
  def,
  onExecute,
  onRequestDialog,
  loading,
  lastStatus,
  isFavorite,
  onToggleFavorite,
}: CommonTileProps & {def: CommandDef; onExecute: ExecuteFn}) {
  const {t} = useNativeTranslation();
  const variant = def.variant ?? 'default';
  const [pressed, setPressed] = useState(false);

  const handlePress = () => {
    if (loading) {
      return;
    }
    if (def.dangerous) {
      onRequestDialog(def);
      return;
    }
    onExecute(def.command, def.params);
  };

  const label = t(def.labelKey, def.labelFallback);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: loading}}
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={styles.tile}>
      <GlassPanel
        style={[
          styles.panel,
          pressed && !loading && variantBorderStyles[variant],
          loading && styles.panelLoading,
        ]}>
        <FavoriteStar
          active={isFavorite}
          label={t('commands.toggleFavorite', 'Toggle favorite')}
          onPress={onToggleFavorite}
        />
        {def.dangerous ? (
          <AppText style={styles.dangerCorner} variant="caption" weight="bold">
            {ALERT_GLYPH}
          </AppText>
        ) : null}
        <View style={styles.iconBox}>
          {loading ? (
            <ActivityIndicator color={colors.textMuted} size="small" />
          ) : (
            <AppText style={styles.iconGlyph} variant="caption" weight="bold">
              {glyphFor(def.icon)}
            </AppText>
          )}
        </View>
        <View style={styles.labels}>
          <AppText style={styles.label} variant="caption">
            {label}
          </AppText>
          {def.sublabelFallback ? (
            <AppText style={styles.sublabel} variant="caption">
              {t(def.sublabelKey ?? '', def.sublabelFallback)}
            </AppText>
          ) : null}
          <TileStatus lastStatus={lastStatus} />
        </View>
      </GlassPanel>
    </Pressable>
  );
}

// ─── ToggleCommandTile (web ./ToggleCommandTile) ─────────────────────────────
function ToggleCommandTile({
  def,
  state,
  onExecute,
  onRequestDialog,
  loading,
  lastStatus,
  isFavorite,
  onToggleFavorite,
}: CommonTileProps & {def: CommandDef; state: VehicleState | null; onExecute: ExecuteFn}) {
  const {t} = useNativeTranslation();
  const [localToggle, setLocalToggle] = useState(false);

  const isOn =
    def.stateField && state
      ? Boolean((state as unknown as Record<string, unknown>)[def.stateField])
      : localToggle;

  const variant = def.variant ?? 'default';
  const on = toggleOnStyles[variant];
  const iconName = isOn ? def.icon : def.iconOff ?? def.icon;

  const handlePress = () => {
    if (loading) {
      return;
    }
    if (isOn) {
      if (!def.stateField) {
        setLocalToggle(false);
      }
      onExecute(def.commandOff!);
    } else if (def.inputConfig) {
      onRequestDialog(def);
    } else {
      if (!def.stateField) {
        setLocalToggle(true);
      }
      onExecute(def.command, def.params);
    }
  };

  return (
    <Pressable
      accessibilityLabel={t(def.labelKey, def.labelFallback)}
      accessibilityRole="button"
      accessibilityState={{disabled: loading, selected: isOn}}
      onPress={handlePress}
      style={styles.tile}>
      <GlassPanel style={[styles.panel, isOn && on.panel, loading && styles.panelLoading]}>
        <FavoriteStar
          active={isFavorite}
          label={t('commands.toggleFavorite', 'Toggle favorite')}
          onPress={onToggleFavorite}
        />
        <View style={[styles.toggleDot, {backgroundColor: isOn ? on.dot : colors.surfaceRaised}]} />
        <View style={[styles.iconBox, isOn && on.iconBox]}>
          {loading ? (
            <ActivityIndicator color={colors.textMuted} size="small" />
          ) : (
            <AppText
              style={[styles.iconGlyph, isOn ? {color: on.iconColor} : null]}
              variant="caption"
              weight="bold">
              {glyphFor(iconName)}
            </AppText>
          )}
        </View>
        <AppText style={styles.label} variant="caption">
          {t(def.labelKey, def.labelFallback)}
        </AppText>
        <AppText
          style={[styles.toggleState, {color: isOn ? on.text : colors.textMuted}]}
          variant="caption"
          weight="semibold">
          {isOn ? t('commands.on', 'ON') : t('commands.off', 'OFF')}
        </AppText>
        <TileStatus lastStatus={lastStatus} />
      </GlassPanel>
    </Pressable>
  );
}

// ─── InputCommandTile (web ./InputCommandTile) ───────────────────────────────
function InputCommandTile({
  def,
  onRequestDialog,
  loading,
  lastStatus,
  isFavorite,
  onToggleFavorite,
}: CommonTileProps & {def: CommandDef}) {
  const {t} = useNativeTranslation();
  const variant = def.variant ?? 'default';
  const [pressed, setPressed] = useState(false);

  const handlePress = () => {
    if (loading) {
      return;
    }
    onRequestDialog(def);
  };

  const label = t(def.labelKey, def.labelFallback);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: loading}}
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={styles.tile}>
      <GlassPanel
        style={[
          styles.panel,
          pressed && !loading && variantBorderStyles[variant],
          loading && styles.panelLoading,
        ]}>
        <FavoriteStar
          active={isFavorite}
          label={t('commands.toggleFavorite', 'Toggle favorite')}
          onPress={onToggleFavorite}
        />
        <View style={styles.iconBox}>
          {loading ? (
            <ActivityIndicator color={colors.textMuted} size="small" />
          ) : (
            <AppText style={styles.iconGlyph} variant="caption" weight="bold">
              {glyphFor(def.icon)}
            </AppText>
          )}
        </View>
        <View style={styles.labels}>
          <AppText style={styles.label} variant="caption">
            {label}
          </AppText>
          {def.sublabelFallback ? (
            <AppText style={styles.sublabel} variant="caption">
              {t(def.sublabelKey ?? '', def.sublabelFallback)}
            </AppText>
          ) : null}
          <TileStatus lastStatus={lastStatus} />
        </View>
      </GlassPanel>
    </Pressable>
  );
}

// ─── CollapsibleCommandGroup (web ./CollapsibleCommandGroup) ─────────────────
function CollapsibleCommandGroup({
  category,
  vehicleId,
  children,
  count,
  defaultOpen = false,
}: {
  category: CommandCategory;
  vehicleId: number;
  children: ReactNode;
  count: number;
  defaultOpen?: boolean;
}) {
  const {t} = useNativeTranslation();
  const storageKey = `teslasync-cat-${vehicleId}-${category}`;

  const [open, setOpen] = useState(() => {
    try {
      const stored = sessionStore.getItem(storageKey);
      return stored !== null ? stored === 'true' : defaultOpen;
    } catch {
      return defaultOpen;
    }
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      sessionStore.setItem(storageKey, String(next));
    } catch {
      /* noop */
    }
  };

  const meta = CATEGORY_META[category];

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={toggle}
        style={styles.groupHeader}>
        <AppText style={styles.groupIcon} variant="caption" weight="bold">
          {glyphFor(meta.icon)}
        </AppText>
        <AppText style={styles.groupLabel} variant="caption" weight="semibold">
          {t(meta.labelKey, meta.fallback)}
        </AppText>
        <AppText style={styles.groupCount} variant="caption">
          {`(${count})`}
        </AppText>
        <AppText style={styles.groupChevron} variant="caption">
          {open ? glyphFor('collapse') : CHEVRON_GLYPH}
        </AppText>
      </Pressable>
      {open ? <View style={styles.grid}>{children}</View> : null}
    </View>
  );
}

// ─── FavoritesBar (web ./FavoritesBar) ───────────────────────────────────────
function FavoritesBar({
  favorites,
  commands,
  renderTile,
}: {
  favorites: string[];
  commands: CommandDef[];
  renderTile: (cmd: CommandDef) => ReactNode;
}) {
  const {t} = useNativeTranslation();
  const favCmds = commands.filter(c => favorites.includes(c.id));
  if (favCmds.length === 0) {
    return null;
  }

  return (
    <View>
      <View style={styles.favHeader}>
        <AppText style={styles.favStar} variant="caption" weight="bold">
          {STAR_GLYPH}
        </AppText>
        <AppText style={styles.groupLabel} variant="caption" weight="semibold">
          {t('commands.cat.quickActions', 'Quick Actions')}
        </AppText>
        <AppText style={styles.groupCount} variant="caption">
          {`(${favCmds.length})`}
        </AppText>
      </View>
      <View style={styles.grid}>{favCmds.map(c => renderTile(c))}</View>
    </View>
  );
}

// ─── Dialog primitives (web @/components/ui Modal/Input/Button) ──────────────
function DialogShell({
  open,
  onClose,
  children,
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View accessibilityViewIsModal style={[styles.dialogCard, danger && styles.dialogCardDanger]}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function DialogButton({
  label,
  onPress,
  variant = 'ghost',
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'ghost' | 'primary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.dialogBtn,
        variant === 'primary' && styles.dialogBtnPrimary,
        variant === 'danger' && styles.dialogBtnDanger,
        isDisabled && styles.dialogBtnDisabled,
        pressed && !isDisabled && styles.dialogBtnPressed,
      ]}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'ghost' ? colors.textSecondary : colors.background}
          size="small"
        />
      ) : (
        <AppText
          style={[
            styles.dialogBtnText,
            variant === 'primary' && styles.dialogBtnTextPrimary,
            variant === 'danger' && styles.dialogBtnTextDanger,
          ]}
          variant="caption"
          weight="semibold">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

function validateField(
  value: string,
  validation?: string,
  min?: number,
  max?: number,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Required';
  }
  switch (validation) {
    case 'pin':
      return /^\d{4}$/.test(trimmed) ? null : 'Enter a 4-digit PIN';
    case 'number': {
      const num = parseInt(trimmed, 10);
      if (Number.isNaN(num) || String(num) !== trimmed) {
        return 'Enter a whole number';
      }
      if (min != null && num < min) {
        return `Minimum: ${min}`;
      }
      if (max != null && num > max) {
        return `Maximum: ${max}`;
      }
      return null;
    }
    case 'decimal': {
      const num = parseFloat(trimmed);
      if (Number.isNaN(num)) {
        return 'Enter a valid number';
      }
      if (min != null && num < min) {
        return `Minimum: ${min}`;
      }
      if (max != null && num > max) {
        return `Maximum: ${max}`;
      }
      return null;
    }
    default:
      return null;
  }
}

// Web type="pin"->password (secure) and inputMode resolution -> RN secureTextEntry
// + keyboardType (the closest native analogues).
function resolveSecure(validation?: string): boolean {
  return validation === 'pin';
}

function resolveKeyboard(
  validation?: string,
): 'numeric' | 'decimal-pad' | 'default' {
  if (validation === 'pin' || validation === 'number') {
    return 'numeric';
  }
  if (validation === 'decimal') {
    return 'decimal-pad';
  }
  return 'default';
}

// ─── CommandInputDialog (web ./CommandInputDialog) ───────────────────────────
function CommandInputDialog({
  open,
  onClose,
  onSubmit,
  def,
  vehicle,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
  def: CommandDef;
  vehicle?: {display_name: string};
  loading?: boolean;
}) {
  const {t} = useNativeTranslation();
  const ic = def.inputConfig!;
  const fields = ic.fields;

  const buildInitialValues = useCallback((): Record<string, string> => {
    if (fields) {
      const vals: Record<string, string> = {};
      for (const f of fields) {
        vals[f.name] = '';
      }
      return vals;
    }
    const defaultVal = ic.getDefaultValue
      ? ic.getDefaultValue({vehicle})
      : ic.defaultValue ?? '';
    return {[ic.paramName]: defaultVal};
  }, [fields, ic, vehicle]);

  const [values, setValues] = useState<Record<string, string>>(buildInitialValues);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) {
      setValues(buildInitialValues());
      setErrors({});
      setTouched({});
    }
  }, [open, buildInitialValues]);

  const handleChange = (name: string, value: string) => {
    setValues(prev => ({...prev, [name]: value}));
    if (touched[name]) {
      const field = fields?.find(f => f.name === name);
      const v = field?.validation ?? ic.validation;
      const mn = field?.min ?? ic.min;
      const mx = field?.max ?? ic.max;
      setErrors(prev => ({...prev, [name]: validateField(value, v, mn, mx)}));
    }
  };

  const handleBlur = (name: string) => {
    setTouched(prev => ({...prev, [name]: true}));
    const field = fields?.find(f => f.name === name);
    const v = field?.validation ?? ic.validation;
    const mn = field?.min ?? ic.min;
    const mx = field?.max ?? ic.max;
    setErrors(prev => ({...prev, [name]: validateField(values[name] ?? '', v, mn, mx)}));
  };

  const isValid = (): boolean => {
    if (fields) {
      return fields.every(
        f => validateField(values[f.name] ?? '', f.validation, f.min, f.max) === null,
      );
    }
    return validateField(values[ic.paramName] ?? '', ic.validation, ic.min, ic.max) === null;
  };

  const handleSubmit = () => {
    const newErrors: Record<string, string | null> = {};
    const newTouched: Record<string, boolean> = {};
    let valid = true;
    if (fields) {
      for (const f of fields) {
        const err = validateField(values[f.name] ?? '', f.validation, f.min, f.max);
        newErrors[f.name] = err;
        newTouched[f.name] = true;
        if (err) {
          valid = false;
        }
      }
    } else {
      const err = validateField(values[ic.paramName] ?? '', ic.validation, ic.min, ic.max);
      newErrors[ic.paramName] = err;
      newTouched[ic.paramName] = true;
      if (err) {
        valid = false;
      }
    }
    setErrors(newErrors);
    setTouched(newTouched);
    if (valid) {
      onSubmit(values);
    }
  };

  return (
    <DialogShell onClose={onClose} open={open}>
      <View style={styles.dialogHeaderRow}>
        <View style={styles.dialogIconBox}>
          <AppText style={styles.dialogIconGlyph} variant="caption" weight="bold">
            {glyphFor(def.icon)}
          </AppText>
        </View>
        <View style={styles.flexShrink}>
          <AppText style={styles.dialogTitle} variant="body" weight="semibold">
            {t(def.labelKey, def.labelFallback)}
          </AppText>
          <AppText style={styles.dialogPrompt} variant="caption">
            {t(ic.promptKey, ic.promptFallback)}
          </AppText>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.dialogBody} keyboardShouldPersistTaps="handled">
        {fields ? (
          fields.map((field, i) => (
            <View key={field.name} style={styles.fieldBlock}>
              <AppText style={styles.fieldLabel} variant="caption">
                {t(field.labelKey, field.labelFallback)}
              </AppText>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={i === 0}
                keyboardType={resolveKeyboard(field.validation)}
                onBlur={() => handleBlur(field.name)}
                onChangeText={text => handleChange(field.name, text)}
                placeholder={field.placeholder}
                placeholderTextColor={colors.textMuted}
                secureTextEntry={resolveSecure(field.validation)}
                style={[styles.textInput, touched[field.name] && errors[field.name] ? styles.textInputError : null]}
                value={values[field.name] ?? ''}
              />
              {touched[field.name] && errors[field.name] ? (
                <AppText style={styles.fieldError} variant="caption">
                  {errors[field.name]}
                </AppText>
              ) : null}
            </View>
          ))
        ) : (
          <View style={styles.fieldBlock}>
            {def.sublabelFallback ? (
              <AppText style={styles.fieldLabel} variant="caption">
                {t(def.sublabelKey ?? '', def.sublabelFallback)}
              </AppText>
            ) : null}
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              keyboardType={resolveKeyboard(ic.validation)}
              onBlur={() => handleBlur(ic.paramName)}
              onChangeText={text => handleChange(ic.paramName, text)}
              placeholder={ic.defaultValue ?? ''}
              placeholderTextColor={colors.textMuted}
              secureTextEntry={resolveSecure(ic.validation)}
              style={[styles.textInput, touched[ic.paramName] && errors[ic.paramName] ? styles.textInputError : null]}
              value={values[ic.paramName] ?? ''}
            />
            {touched[ic.paramName] && errors[ic.paramName] ? (
              <AppText style={styles.fieldError} variant="caption">
                {errors[ic.paramName]}
              </AppText>
            ) : null}
          </View>
        )}
      </ScrollView>
      <View style={styles.dialogActions}>
        <DialogButton label={t('common.cancel', 'Cancel')} onPress={onClose} variant="ghost" />
        <DialogButton
          disabled={!isValid()}
          label={t('common.send', 'Send')}
          loading={loading}
          onPress={handleSubmit}
          variant="primary"
        />
      </View>
    </DialogShell>
  );
}

// ─── CommandSelectDialog (web ./CommandSelectDialog) ─────────────────────────
function CommandSelectDialog({
  open,
  onClose,
  onSelect,
  def,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (value: string) => void;
  def: CommandDef;
  loading?: boolean;
}) {
  const {t} = useNativeTranslation();
  const sc = def.selectConfig!;

  return (
    <DialogShell onClose={onClose} open={open}>
      <View style={styles.dialogHeaderRow}>
        <View style={styles.dialogIconBox}>
          <AppText style={styles.dialogIconGlyph} variant="caption" weight="bold">
            {glyphFor(def.icon)}
          </AppText>
        </View>
        <AppText style={styles.dialogTitle} variant="body" weight="semibold">
          {t(def.labelKey, def.labelFallback)}
        </AppText>
      </View>
      <ScrollView contentContainerStyle={styles.dialogBody} keyboardShouldPersistTaps="handled">
        {sc.options.map(opt => (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            disabled={loading}
            onPress={() => onSelect(opt.value)}
            style={({pressed}) => [
              styles.selectOption,
              pressed && styles.selectOptionPressed,
              loading && styles.dialogBtnDisabled,
            ]}>
            <AppText style={styles.selectOptionLabel} variant="caption" weight="semibold">
              {t(opt.labelKey, opt.labelFallback)}
            </AppText>
            {opt.description ? (
              <AppText style={styles.selectOptionDesc} variant="caption">
                {opt.description}
              </AppText>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.dialogActionsEnd}>
        <DialogButton label={t('common.cancel', 'Cancel')} onPress={onClose} variant="ghost" />
      </View>
    </DialogShell>
  );
}

// ─── CommandConfirmDialog (web ./CommandConfirmDialog) ───────────────────────
function CommandConfirmDialog({
  open,
  onClose,
  onConfirm,
  def,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  def: CommandDef;
  loading?: boolean;
}) {
  const {t} = useNativeTranslation();
  const countdown = def.countdown ?? 0;
  const confirmInput = def.confirmInput;

  const [remaining, setRemaining] = useState(countdown);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    setRemaining(countdown);
    setInputValue('');
    if (countdown > 0) {
      const interval = setInterval(() => {
        setRemaining(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [open, countdown]);

  const canConfirm =
    remaining === 0 &&
    (!confirmInput || inputValue.trim().toUpperCase() === confirmInput.toUpperCase());

  return (
    <DialogShell danger onClose={onClose} open={open}>
      <View style={styles.dialogHeaderRow}>
        <View style={styles.dialogIconBoxDanger}>
          <AppText style={styles.dialogIconGlyphDanger} variant="caption" weight="bold">
            {ALERT_GLYPH}
          </AppText>
        </View>
        <AppText style={styles.dialogTitle} variant="body" weight="semibold">
          {t(def.labelKey, def.labelFallback)}
        </AppText>
      </View>
      <AppText style={styles.confirmText} variant="caption">
        {t(def.confirmKey ?? '', def.confirmFallback ?? 'Are you sure?')}
      </AppText>
      {confirmInput ? (
        <View style={styles.fieldBlock}>
          <AppText style={styles.fieldLabel} variant="caption">
            {t('commands.confirm.typeToConfirm', 'Type "{{word}}" to confirm:', {word: confirmInput})}
          </AppText>
          <TextInput
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            onChangeText={setInputValue}
            placeholder={confirmInput}
            placeholderTextColor={colors.textMuted}
            style={styles.textInput}
            value={inputValue}
          />
        </View>
      ) : null}
      <View style={styles.dialogActions}>
        <DialogButton label={t('common.cancel', 'Cancel')} onPress={onClose} variant="ghost" />
        <DialogButton
          disabled={!canConfirm}
          label={
            remaining > 0
              ? `${t('common.confirm', 'Confirm')} (${remaining}s)`
              : t('common.confirm', 'Confirm')
          }
          loading={loading}
          onPress={onConfirm}
          variant="danger"
        />
      </View>
    </DialogShell>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

interface VehicleCommandCenterProps {
  vehicle: Vehicle;
  state: VehicleState | null;
}

interface DialogState {
  kind: 'input' | 'select' | 'confirm';
  def: CommandDef;
}

export function VehicleCommandCenter({vehicle, state}: VehicleCommandCenterProps) {
  const {t} = useNativeTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const {unitPrefs} = useUnits();

  const name = vehicle.display_name || vehicle.vin;
  const isAsleep = vehicle.state === 'asleep' || vehicle.state === 'offline';
  const {isStale, ageLabel} = useIsStale(vehicle.updated_at);

  // ─── Command state ──────────────────────────────────────────────────────

  const [lastResult, setLastResult] = useState<{success: boolean; message: string} | null>(null);
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const stored = sessionStore.getItem(`teslasync-cmd-favorites-${vehicle.id}`);
      if (stored) {
        return JSON.parse(stored) as string[];
      }
    } catch {
      /* noop */
    }
    return COMMANDS.filter(c => c.defaultFavorite).map(c => c.id);
  });

  const toggleFavorite = useCallback(
    (cmdId: string) => {
      setFavorites(prev => {
        const next = prev.includes(cmdId)
          ? prev.filter(id => id !== cmdId)
          : [...prev, cmdId];
        try {
          sessionStore.setItem(`teslasync-cmd-favorites-${vehicle.id}`, JSON.stringify(next));
        } catch {
          /* noop */
        }
        return next;
      });
    },
    [vehicle.id],
  );

  // ─── Latest command statuses ────────────────────────────────────────────

  const {data: latestCmds} = useQuery({
    queryKey: ['command-latest', vehicle.id],
    queryFn: () => request<CommandLogEntry[]>(`/vehicles/${vehicle.id}/commands/latest`),
    refetchInterval: 30_000,
  });

  const cmdMap = useMemo(
    () => new Map((latestCmds ?? []).map(c => [c.command, c])),
    [latestCmds],
  );

  const cmdStatus = useCallback(
    (command: string): string | undefined => {
      const entry = cmdMap.get(command);
      if (!entry) {
        return undefined;
      }
      const ago = timeAgo(entry.created_at);
      return entry.status === 'success' ? `✓ ${ago}` : `✗ ${ago}`;
    },
    [cmdMap],
  );

  // ─── Mutations ──────────────────────────────────────────────────────────

  const cmd = useMutation({
    mutationFn: ({command, params}: {command: string; params?: Record<string, unknown>}) =>
      request<{success: boolean; message: string}>(`/vehicles/${vehicle.id}/command/${command}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: params ? JSON.stringify(params) : undefined,
      }),
    onSuccess: data => {
      setLastResult(data);
      qc.invalidateQueries({queryKey: ['command-vehicle-states']});
      qc.invalidateQueries({queryKey: ['vehicle-state']});
      qc.invalidateQueries({queryKey: ['command-latest', vehicle.id]});
      qc.invalidateQueries({queryKey: ['command-history', String(vehicle.id)]});
      if (data.success) {
        toast.success(`${t('Command sent to')} ${name}`);
      } else {
        toast.error(data.message || `${t('Command failed on')} ${name}`);
      }
    },
    onError: (err: Error) => {
      setLastResult({success: false, message: err.message});
      toast.error(`${t('Command failed')}: ${err.message}`);
    },
  });

  const wakeMut = useMutation({
    mutationFn: () =>
      request<{success: boolean}>(`/vehicles/${vehicle.id}/command/wake_up`, {method: 'POST'}),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: ['command-vehicle-states']});
      toast.success(`${name} ${t('is waking up')}`);
    },
    onError: (err: Error) => toast.error(`${t('Failed to wake')} ${name}: ${err.message}`),
  });

  const isLoading = cmd.isPending || wakeMut.isPending;

  // react-query mutate fns are stable; depending on them keeps executeCommand a
  // stable reference (the web source used an empty dep array for the same intent).
  const {mutate: cmdMutate} = cmd;
  const {mutate: wakeMutate} = wakeMut;

  const executeCommand = useCallback(
    (command: string, params?: Record<string, unknown>) => {
      setLastResult(null);
      if (command === 'wake_up') {
        wakeMutate();
      } else {
        cmdMutate({command, params});
      }
    },
    [cmdMutate, wakeMutate],
  );

  // ─── Centralised dialog state ───────────────────────────────────────────

  const [activeDialog, setActiveDialog] = useState<DialogState | null>(null);

  const requestDialog = useCallback((def: CommandDef) => {
    if (def.selectConfig) {
      setActiveDialog({kind: 'select', def});
    } else if (def.inputConfig) {
      setActiveDialog({kind: 'input', def});
    } else if (def.dangerous) {
      setActiveDialog({kind: 'confirm', def});
    }
  }, []);

  const closeDialog = useCallback(() => {
    setActiveDialog(null);
  }, []);

  const handleInputSubmit = useCallback(
    (submitValues: Record<string, string>) => {
      if (!activeDialog) {
        return;
      }
      const {def} = activeDialog;
      const ic = def.inputConfig!;

      let params: Record<string, unknown>;
      if (ic.buildParams) {
        params = ic.buildParams(submitValues);
      } else {
        const rawValue = submitValues[ic.paramName];
        const finalValue = ic.transform ? ic.transform(rawValue) : rawValue;
        params = {...def.params, [ic.paramName]: finalValue};
      }

      executeCommand(def.command, params);
      closeDialog();
    },
    [activeDialog, executeCommand, closeDialog],
  );

  const handleSelectSubmit = useCallback(
    (value: string) => {
      if (!activeDialog) {
        return;
      }
      const {def} = activeDialog;
      const sc = def.selectConfig!;
      executeCommand(def.command, {...def.params, [sc.paramName]: value});
      closeDialog();
    },
    [activeDialog, executeCommand, closeDialog],
  );

  const handleConfirmSubmit = useCallback(() => {
    if (!activeDialog) {
      return;
    }
    const {def} = activeDialog;
    executeCommand(def.command, def.params);
    closeDialog();
  }, [activeDialog, executeCommand, closeDialog]);

  // ─── Filtering ──────────────────────────────────────────────────────────

  const filteredCommands = useMemo(() => {
    if (!search.trim()) {
      return null;
    }
    const q = search.toLowerCase();
    return COMMANDS.filter(
      c =>
        t(c.labelKey, c.labelFallback).toLowerCase().includes(q) ||
        c.category.includes(q) ||
        c.command.includes(q),
    );
  }, [search, t]);

  const commandsByCategory = useMemo(() => {
    const groups = new Map<string, CommandDef[]>();
    for (const c of COMMANDS) {
      const list = groups.get(c.category) ?? [];
      list.push(c);
      groups.set(c.category, list);
    }
    return groups;
  }, []);

  // ─── Tile renderer ─────────────────────────────────────────────────────

  const renderTile = useCallback(
    (def: CommandDef) => {
      const common = {
        lastStatus:
          cmdStatus(def.command) ?? (def.commandOff ? cmdStatus(def.commandOff) : undefined),
        loading: isLoading,
        isFavorite: favorites.includes(def.id),
        onToggleFavorite: () => toggleFavorite(def.id),
        onRequestDialog: requestDialog,
      };

      switch (def.type) {
        case 'toggle':
          return (
            <ToggleCommandTile
              key={def.id}
              {...common}
              def={def}
              onExecute={executeCommand}
              state={state}
            />
          );
        case 'input':
          return <InputCommandTile key={def.id} {...common} def={def} />;
        default:
          return <CommandTile key={def.id} {...common} def={def} onExecute={executeCommand} />;
      }
    },
    [cmdStatus, isLoading, favorites, toggleFavorite, state, executeCommand, requestDialog],
  );

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <GlassPanel style={styles.root}>
      <View style={styles.headerBlock}>
        <View style={styles.headerTitleRow}>
          <AppText style={styles.vehicleName} variant="body" weight="semibold">
            {name}
          </AppText>
          <Badge variant={isAsleep ? 'neutral' : 'success'}>{vehicle.state}</Badge>
          <FreshnessIndicator timestamp={vehicle.updated_at} />
        </View>
        <AppText style={styles.vehicleMeta} variant="caption">
          {`${vehicle.model} · ${vehicle.vin}`}
        </AppText>
        {state ? (
          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <AppText style={styles.metricIcon} variant="caption" weight="bold">
                {BATTERY_GLYPH}
              </AppText>
              <AppText
                style={[styles.metricValue, (state.battery_level ?? 0) > 50 ? styles.metricGood : styles.metricWarn]}
                variant="caption"
                weight="semibold">
                {`${state.battery_level}%`}
              </AppText>
            </View>
            <View style={styles.metric}>
              <AppText style={styles.metricIcon} variant="caption" weight="bold">
                {WIFI_GLYPH}
              </AppText>
              <AppText style={styles.metricSecondary} variant="caption">
                {`${fmtNumber(convertDistanceFromSI(state.rated_range, unitPrefs.distance), 0)} ${unitPrefs.distance}`}
              </AppText>
            </View>
            {state.inside_temp != null ? (
              <View style={styles.metric}>
                <AppText style={styles.metricIcon} variant="caption" weight="bold">
                  {TEMP_GLYPH}
                </AppText>
                <AppText style={styles.metricSecondary} variant="caption">
                  {`${fmtNumber(convertTempFromSI(state.inside_temp, unitPrefs.temperature), 0)}${unitPrefs.temperature}`}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {lastResult ? (
        <View style={[styles.banner, lastResult.success ? styles.bannerSuccess : styles.bannerError]}>
          <AppText
            style={[styles.bannerIcon, lastResult.success ? styles.bannerIconSuccess : styles.bannerIconError]}
            variant="caption"
            weight="bold">
            {lastResult.success ? CHECK_GLYPH : ALERT_GLYPH}
          </AppText>
          <AppText
            style={[styles.bannerText, lastResult.success ? styles.bannerTextSuccess : styles.bannerTextError]}
            variant="caption">
            {lastResult.message}
          </AppText>
        </View>
      ) : null}

      {isAsleep ? (
        <View style={[styles.banner, styles.bannerWarn]}>
          <AppText style={[styles.bannerIcon, styles.bannerIconWarn]} variant="caption" weight="bold">
            {POWER_GLYPH}
          </AppText>
          <AppText style={[styles.bannerText, styles.bannerTextWarn]} variant="caption">
            {`${t('Vehicle is')} ${vehicle.state}. ${t('Wake it up first to send commands.')}`}
          </AppText>
        </View>
      ) : null}

      {isStale && !isAsleep ? (
        <AlertBanner iconGlyph={CLOCK_GLYPH}>
          {t('commands.staleData', 'Vehicle data is {{age}} old. The vehicle may be asleep or offline.', {age: ageLabel})}
        </AlertBanner>
      ) : null}

      <View style={styles.searchBlock}>
        <CommandSearch onChange={setSearch} value={search} />
      </View>

      <View style={styles.commandsStack}>
        {!filteredCommands ? (
          <FavoritesBar commands={COMMANDS} favorites={favorites} renderTile={renderTile} />
        ) : null}

        {filteredCommands ? (
          filteredCommands.length > 0 ? (
            <View style={styles.grid}>{filteredCommands.map(c => renderTile(c))}</View>
          ) : (
            <AppText style={styles.noResults} variant="caption">
              {t('commands.search.noResults', 'No commands match your search')}
            </AppText>
          )
        ) : (
          CATEGORY_ORDER.map(cat => {
            const cmds = commandsByCategory.get(cat);
            if (!cmds?.length) {
              return null;
            }
            return (
              <CollapsibleCommandGroup
                key={cat}
                category={cat}
                count={cmds.length}
                vehicleId={vehicle.id}>
                {cmds.map(c => renderTile(c))}
              </CollapsibleCommandGroup>
            );
          })
        )}
      </View>

      {activeDialog?.kind === 'input' ? (
        <CommandInputDialog
          def={activeDialog.def}
          loading={isLoading}
          onClose={closeDialog}
          onSubmit={handleInputSubmit}
          open
          vehicle={vehicle}
        />
      ) : null}
      {activeDialog?.kind === 'select' ? (
        <CommandSelectDialog
          def={activeDialog.def}
          loading={isLoading}
          onClose={closeDialog}
          onSelect={handleSelectSubmit}
          open
        />
      ) : null}
      {activeDialog?.kind === 'confirm' ? (
        <CommandConfirmDialog
          def={activeDialog.def}
          loading={isLoading}
          onClose={closeDialog}
          onConfirm={handleConfirmSubmit}
          open
        />
      ) : null}
    </GlassPanel>
  );
}

VehicleCommandCenter.displayName = 'VehicleCommandCenter';

const styles = StyleSheet.create({
  root: {
    padding: spacing.lg,
  },
  headerBlock: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  vehicleName: {
    color: colors.textPrimary,
  },
  vehicleMeta: {
    color: colors.textMuted,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  metric: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metricIcon: {
    color: colors.textMuted,
    letterSpacing: 0.4,
  },
  metricValue: {
    color: colors.textSecondary,
  },
  metricGood: {
    color: colors.success,
  },
  metricWarn: {
    color: colors.warning,
  },
  metricSecondary: {
    color: colors.textSecondary,
  },
  banner: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  bannerSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  bannerError: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  bannerWarn: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  bannerIcon: {
    letterSpacing: 0.4,
  },
  bannerIconSuccess: {
    color: colors.success,
  },
  bannerIconError: {
    color: colors.danger,
  },
  bannerIconWarn: {
    color: colors.warning,
  },
  bannerText: {
    flexShrink: 1,
  },
  bannerTextSuccess: {
    color: colors.success,
  },
  bannerTextError: {
    color: colors.danger,
  },
  bannerTextWarn: {
    color: colors.warning,
  },
  searchBlock: {
    marginBottom: spacing.lg,
  },
  commandsStack: {
    gap: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  noResults: {
    color: colors.textMuted,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  freshnessRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  freshnessDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  freshnessLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  badgeSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  badgeNeutralText: {
    color: colors.textSecondary,
  },
  badgeSuccessText: {
    color: colors.success,
  },
  alertBanner: {
    alignItems: 'center',
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  alertBannerIcon: {
    color: colors.warning,
    letterSpacing: 0.4,
  },
  alertBannerText: {
    color: colors.warning,
    flexShrink: 1,
  },
  tile: {
    marginBottom: spacing.md,
    width: '48%',
  },
  panel: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 100,
    padding: spacing.md,
  },
  panelLoading: {
    opacity: 0.5,
  },
  favorite: {
    borderRadius: 4,
    left: 6,
    padding: 2,
    position: 'absolute',
    top: 6,
    zIndex: 1,
  },
  favoriteGlyph: {
    letterSpacing: 0.4,
  },
  favoriteActive: {
    color: colors.warning,
    opacity: 1,
  },
  favoriteInactive: {
    color: colors.textMuted,
    opacity: 0.5,
  },
  dangerCorner: {
    color: colors.danger,
    opacity: 0.6,
    position: 'absolute',
    right: 6,
    top: 6,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    justifyContent: 'center',
    padding: spacing.sm + 2,
  },
  iconGlyph: {
    color: colors.textMuted,
    letterSpacing: 0.4,
  },
  labels: {
    alignItems: 'center',
  },
  label: {
    color: colors.textPrimary,
    fontWeight: '500',
    textAlign: 'center',
  },
  sublabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
    textAlign: 'center',
  },
  status: {
    fontSize: 9,
    lineHeight: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  statusOk: {
    color: colors.success,
  },
  statusErr: {
    color: colors.danger,
  },
  toggleDot: {
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    right: 8,
    top: 8,
    width: 8,
  },
  toggleState: {
    fontSize: 10,
  },
  groupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  groupIcon: {
    color: colors.textMuted,
    letterSpacing: 0.4,
  },
  groupLabel: {
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  groupCount: {
    color: colors.textMuted,
    fontSize: 10,
  },
  groupChevron: {
    color: colors.textMuted,
    marginLeft: 'auto',
  },
  favHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  favStar: {
    color: colors.warning,
    letterSpacing: 0.4,
  },
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dialogCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    maxHeight: '82%',
    padding: spacing.lg,
  },
  dialogCardDanger: {
    borderColor: colors.dangerBorder,
  },
  dialogHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  dialogIconBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    justifyContent: 'center',
    padding: spacing.sm + 2,
  },
  dialogIconGlyph: {
    color: colors.textSecondary,
    letterSpacing: 0.4,
  },
  dialogIconBoxDanger: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderRadius: 12,
    justifyContent: 'center',
    padding: spacing.sm + 2,
  },
  dialogIconGlyphDanger: {
    color: colors.danger,
    letterSpacing: 0.4,
  },
  dialogTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  dialogPrompt: {
    color: colors.textMuted,
  },
  flexShrink: {
    flexShrink: 1,
  },
  dialogBody: {
    gap: spacing.md,
  },
  fieldBlock: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textSecondary,
  },
  textInput: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  textInputError: {
    borderColor: colors.dangerBorder,
  },
  fieldError: {
    color: colors.danger,
    fontSize: 11,
  },
  confirmText: {
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  dialogActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.md,
  },
  dialogActionsEnd: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.md,
  },
  selectOption: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 2,
    padding: spacing.md,
  },
  selectOptionPressed: {
    borderColor: colors.borderAccent,
  },
  selectOptionLabel: {
    color: colors.textPrimary,
  },
  selectOptionDesc: {
    color: colors.textMuted,
  },
  dialogBtn: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dialogBtnPrimary: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderWidth: 1,
  },
  dialogBtnDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
  },
  dialogBtnDisabled: {
    opacity: 0.5,
  },
  dialogBtnPressed: {
    opacity: 0.82,
  },
  dialogBtnText: {
    color: colors.textSecondary,
  },
  dialogBtnTextPrimary: {
    color: colors.accent,
  },
  dialogBtnTextDanger: {
    color: colors.danger,
  },
});
