import {Glyph} from '../../../../../components/icons/Glyph';
// Native parity port of web/src/features/admin/components/devtools/FleetApiSection.tsx.
//
// The web module is the Tesla Fleet API dev-tools section: a setup-wizard
// (OnboardingWorkflow) plus nine tool cards (config, partner registration,
// partner public-key verification, public-key setup, vehicle key pairing,
// fleet-telemetry subscribe, fleet-telemetry config/errors, fleet status, and
// vehicle data tools). It is built from the shared web UI kit (GlassPanel,
// Badge, Button, Input, Select, Textarea, DataTable, CopyButton), the feedback
// kit (Skeleton, AlertBanner), the lucide `Icons` set, react-i18next, TanStack
// Query, and sibling devtools files (ToolCard, ResultPanel, TelemetryErrorsPanel,
// helpers, constants, types) plus the shared SignalConfigModal.
//
// None of the web sibling/UI modules exist in this React Native parity tree yet,
// so — following the established parity precedent (VehicleHeroCard inlines its
// not-yet-ported building blocks) — this port is SELF-CONTAINED: it inlines the
// helpers (apiFetch / useVehicleOptions / extractTelemetryErrors), the
// constants (ICON_COLOR_MAP / ONBOARDING_STEPS / TELEMETRY_FIELDS), the
// TelemetryError type, and native equivalents of ToolCard / ResultPanel /
// TelemetryErrorsPanel / Badge / Button / Select / Textarea / SignalConfigModal,
// while importing the already-ported native primitives (Input, CopyButton,
// Skeleton, AlertBanner, GlassPanel, AppText, SemanticIcon, tokens, the api
// client `request`, and the `Vehicle` type). Behaviour, state names, API paths,
// request bodies, and the four-state error panel are preserved verbatim.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation -> module-level t(key, fallback?, vars?) with
//     {{var}} interpolation; English fallback === key when no fallback is given.
//   • lucide `Icons` -> SemanticIcon glyphs (the parity icon set).
//   • DOM <select> -> a native Select (Pressable trigger + Modal option sheet).
//   • DOM <textarea> -> a multiline <TextInput>.
//   • DataTable -> a lightweight header+rows table (no DOM-only pagination).
//   • Blob/URL/<a download> export -> Share.share of the errors JSON.
//   • localStorage onboarding persistence -> an in-process session store (no
//     AsyncStorage is bundled here), so progress persists for the app session
//     but not across cold starts.
//   • CSS gradient progress bar -> a solid accent fill.
//   • lg:grid-cols-2 tool grid -> a phone-first vertical stack.
// No DOM elements, lucide-react, Recharts, Leaflet, or web UI kit modules are
// imported into the native output.

import React, {useEffect, useMemo, useState, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {request} from '../../../../api/client';
import type {Vehicle} from '../../../../api/types';
import {AlertBanner} from '../../../../components/feedback/AlertBanner';
import {Skeleton} from '../../../../components/feedback/Skeleton';
import {CopyButton} from '../../../../components/ui/CopyButton';
import {Input} from '../../../../components/ui/Input';
import {
  getSemanticIconDefinition,
  SemanticIcon,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

const EM_DASH = '\u2014';
const MONO_FAMILY = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

/* ─── i18n fallback (web react-i18next useTranslation) ────────────────── */

type TranslationValues = Record<string, string | number>;

// English-default translator: with no fallback the key text IS the copy (the
// web source uses human-readable keys like t('Base Url')); {{token}} markers are
// interpolated so step labels resolve identically to the web.
function t(key: string, fallback?: string, values?: TranslationValues): string {
  const base = fallback ?? key;
  if (!values) {
    return base;
  }
  return base.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
    values[token] === undefined ? match : String(values[token]),
  );
}

/* ─── inlined lib helpers (web @/lib/*) ───────────────────────────────── */

// web @/lib/numberFormat fmtInt — locale integer formatting.
function fmtInt(value: unknown): string {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    return EM_DASH;
  }
  return Math.round(num).toLocaleString('en-US');
}

// web @/lib/dateFormat formatDateTime — "Apr 4, 2026, 02:30 PM" or em-dash.
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return EM_DASH;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return EM_DASH;
  }
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// web @/lib/errorMessage getErrorMessage — normalise unknown errors to a string.
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

/* ─── inlined ./helpers ───────────────────────────────────────────────── */

// apiFetch — wraps the dev-tools endpoints, swallowing failures into a
// `{ error }` shape exactly like the web helper.
async function apiFetch(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<Record<string, unknown>> {
  try {
    return await request<Record<string, unknown>>(`/dev-tools/${endpoint}`, {
      method,
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
  } catch (err) {
    return {error: err instanceof Error ? err.message : 'Request failed'};
  }
}

function useVehicleOptions() {
  const {data} = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });
  const vehicles = data ?? [];
  const options = vehicles.map(v => ({
    value: v.vin,
    label: v.display_name || v.vin,
  }));
  return {vehicles, options};
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v !== '') {
      return v;
    }
    if (typeof v === 'number') {
      return String(v);
    }
  }
  return '';
}

// extractTelemetryErrors — defensive unwrap of Tesla's per-vehicle errors
// response. Returns ([], true) for a healthy zero-error response so callers can
// distinguish "vehicle is healthy" from "no request made yet".
function extractTelemetryErrors(data: unknown): {
  errors: TelemetryError[];
  ok: boolean;
} {
  if (data == null || typeof data !== 'object') {
    return {errors: [], ok: false};
  }

  const root = data as Record<string, unknown>;
  const candidates: unknown[] = [
    root.errors,
    (root.response as Record<string, unknown> | undefined)?.errors,
    root.response,
    data,
  ];
  let raw: unknown[] | null = null;
  for (const c of candidates) {
    if (Array.isArray(c)) {
      raw = c;
      break;
    }
  }
  if (raw == null) {
    return {errors: [], ok: false};
  }

  const errors: TelemetryError[] = raw.map((row, i) => {
    const r = (row ?? {}) as Record<string, unknown>;
    const timestamp = pickString(r, [
      'reported_at',
      'timestamp',
      'created_at',
      'ts',
    ]);
    const code = pickString(r, ['error_code', 'code', 'name', 'topic']);
    const message = pickString(r, [
      'error_message',
      'message',
      'body',
      'description',
    ]);
    const vin = pickString(r, ['vin']);
    return {
      rowKey: `${timestamp}|${code}|${vin}|${i}`,
      timestamp,
      code,
      message,
    };
  });
  return {errors, ok: true};
}

/* ─── inlined ./types ─────────────────────────────────────────────────── */

interface TelemetryError {
  rowKey: string;
  timestamp: string;
  code: string;
  message: string;
}

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

/* ─── inlined ./constants ─────────────────────────────────────────────── */

type ToolColor = 'cyan' | 'green' | 'purple' | 'amber' | 'red';

// web ICON_COLOR_MAP (Tailwind neon classes) -> native tinted box tokens.
const TOOL_COLOR_STYLES: Record<ToolColor, {bg: string; border: string; fg: string}> = {
  cyan: {bg: colors.accentSoft, border: colors.borderAccent, fg: colors.accent},
  green: {bg: colors.successSurface, border: colors.successBorder, fg: colors.success},
  purple: {bg: colors.violetSurface, border: colors.violetBorder, fg: colors.violet},
  amber: {bg: colors.warningSurface, border: colors.warningBorder, fg: colors.warning},
  red: {bg: colors.dangerSurface, border: colors.dangerBorder, fg: colors.danger},
};

interface OnboardingStep {
  id: string;
  label: string;
  icon: SemanticIconName;
  desc: string;
}

// web ONBOARDING_STEPS — lucide icons mapped to SemanticIcon names.
const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {id: 'account', label: 'Tesla Developer Account', icon: 'keyRound', desc: 'Create a Tesla Developer account at developer.tesla.com'},
  {id: 'application', label: 'Create Application', icon: 'fileText', desc: 'Register a new application in the Tesla Developer Portal'},
  {id: 'keypair', label: 'Generate Key Pair', icon: 'key', desc: 'Generate an EC private/public key pair for Fleet API authentication'},
  {id: 'register', label: 'Register Partner', icon: 'globe', desc: 'Register as a Fleet API partner with your public key'},
  {id: 'auth', label: 'Authorize Account', icon: 'security', desc: 'Complete OAuth2 authorization to get API access tokens'},
  {id: 'pair', label: 'Pair Vehicle Key', icon: 'link', desc: 'Pair your public key with each vehicle for command access'},
  {id: 'telemetry', label: 'Fleet Telemetry', icon: 'radio', desc: 'Configure Fleet Telemetry streaming for real-time data'},
];

interface CategoryDef {
  category: string;
  fields: string[];
}

// web TELEMETRY_FIELDS — the Fleet Telemetry signal catalogue by category.
const TELEMETRY_FIELDS: CategoryDef[] = [
  {category: 'Location', fields: ['Location', 'GpsHeading', 'GpsState', 'DestinationLocation', 'DestinationName', 'MilesToArrival', 'MinutesToArrival', 'RouteLine', 'RouteLastUpdated', 'OriginLocation', 'LocatedAtHome', 'LocatedAtWork', 'LocatedAtFavorite']},
  {category: 'Driving', fields: ['VehicleSpeed', 'Gear', 'CruiseSetSpeed', 'BrakePedal', 'BrakePedalPos', 'PedalPosition', 'DriveRail', 'LateralAcceleration', 'LongitudinalAcceleration', 'RouteTrafficMinutesDelay', 'LifetimeEnergyGainedRegen', 'LifetimeEnergyUsedDrive']},
  {category: 'Charging', fields: ['BatteryLevel', 'Soc', 'ChargeState', 'DetailedChargeState', 'ChargeLimitSoc', 'ChargeAmps', 'ChargeCurrentRequest', 'ChargeCurrentRequestMax', 'ChargeEnableRequest', 'ChargerVoltage', 'ChargerPhases', 'ChargeRateMilePerHour', 'DCChargingPower', 'DCChargingEnergyIn', 'ACChargingPower', 'ACChargingEnergyIn', 'EnergyRemaining', 'EstBatteryRange', 'IdealBatteryRange', 'RatedRange', 'PackVoltage', 'PackCurrent', 'ChargePortDoorOpen', 'ChargePortLatch', 'ChargePortColdWeatherMode', 'ChargingCableType', 'FastChargerPresent', 'FastChargerType', 'TimeToFullCharge', 'EstimatedHoursToChargeTermination', 'ExpectedEnergyPercentAtTripArrival', 'SuperchargerSessionTripPlanner', 'ScheduledChargingMode', 'ScheduledChargingPending', 'ScheduledChargingStartTime', 'ScheduledDepartureTime', 'PreconditioningEnabled', 'BrickVoltageMax', 'BrickVoltageMin', 'NumBrickVoltageMax', 'NumBrickVoltageMin', 'ModuleTempMax', 'ModuleTempMin', 'NumModuleTempMax', 'NumModuleTempMin', 'BatteryHeaterOn', 'NotEnoughPowerToHeat', 'BMSState', 'BmsFullchargecomplete', 'DCDCEnable', 'IsolationResistance', 'LifetimeEnergyUsed']},
  {category: 'Powershare', fields: ['PowershareStatus', 'PowershareType', 'PowershareStopReason', 'PowershareHoursLeft', 'PowershareInstantaneousPowerKW']},
  {category: 'Climate', fields: ['InsideTemp', 'OutsideTemp', 'HvacFanSpeed', 'HvacFanStatus', 'HvacPower', 'HvacACEnabled', 'HvacAutoMode', 'HvacLeftTemperatureRequest', 'HvacRightTemperatureRequest', 'HvacSteeringWheelHeatAuto', 'HvacSteeringWheelHeatLevel', 'ClimateKeeperMode', 'DefrostMode', 'DefrostForPreconditioning', 'CabinOverheatProtectionMode', 'CabinOverheatProtectionTemperatureLimit', 'SeatHeaterLeft', 'SeatHeaterRight', 'SeatHeaterRearLeft', 'SeatHeaterRearCenter', 'SeatHeaterRearRight', 'SeatVentEnabled', 'ClimateSeatCoolingFrontLeft', 'ClimateSeatCoolingFrontRight', 'AutoSeatClimateLeft', 'AutoSeatClimateRight', 'RearDefrostEnabled', 'RearDisplayHvacEnabled', 'WiperHeatEnabled']},
  {category: 'Vehicle State', fields: ['Locked', 'SentryMode', 'DoorState', 'FdWindow', 'FpWindow', 'RdWindow', 'RpWindow', 'Odometer', 'HomelinkNearby', 'HomelinkDeviceCount', 'GuestModeEnabled', 'GuestModeMobileAccessState', 'DriverSeatOccupied', 'CenterDisplay', 'CurrentLimitMph', 'SpeedLimitMode', 'ValetModeEnabled', 'ServiceMode', 'PairedPhoneKeyAndKeyFobQty', 'LightsHazardsActive', 'LightsHighBeams', 'LightsTurnSignal', 'TonneauPosition', 'TonneauOpenPercent', 'TonneauTentMode']},
  {category: 'Safety', fields: ['DriverSeatBelt', 'PassengerSeatBelt', 'AutomaticEmergencyBrakingOff', 'AutomaticBlindSpotCamera', 'BlindSpotCollisionWarningChime', 'CruiseFollowDistance', 'EmergencyLaneDepartureAvoidance', 'ForwardCollisionWarning', 'LaneDepartureAvoidance', 'SpeedLimitWarning', 'PinToDriveEnabled', 'MilesSinceReset', 'SelfDrivingMilesSinceReset']},
  {category: 'Powertrain', fields: ['DiTorquemotor', 'DiTorqueActualR', 'DiTorqueActualF', 'DiTorqueActualREL', 'DiTorqueActualRER', 'DiSlaveTorqueCmd', 'DiAxleSpeedF', 'DiAxleSpeedR', 'DiAxleSpeedREL', 'DiAxleSpeedRER', 'DiStateR', 'DiStateF', 'DiStateREL', 'DiStateRER', 'DiStatorTempR', 'DiStatorTempF', 'DiStatorTempREL', 'DiStatorTempRER', 'DiHeatsinkTR', 'DiHeatsinkTF', 'DiHeatsinkTREL', 'DiHeatsinkTRER', 'DiInverterTR', 'DiInverterTF', 'DiInverterTREL', 'DiInverterTRER', 'DiMotorCurrentR', 'DiMotorCurrentF', 'DiMotorCurrentREL', 'DiMotorCurrentRER', 'DiVBatR', 'DiVBatF', 'DiVBatREL', 'DiVBatRER', 'Hvil']},
  {category: 'Tires & Service', fields: ['TpmsPressureFl', 'TpmsPressureFr', 'TpmsPressureRl', 'TpmsPressureRr', 'TpmsHardWarnings', 'TpmsSoftWarnings', 'TpmsLastSeenPressureTimeFl', 'TpmsLastSeenPressureTimeFr', 'TpmsLastSeenPressureTimeRl', 'TpmsLastSeenPressureTimeRr']},
  {category: 'Media', fields: ['MediaNowPlayingTitle', 'MediaNowPlayingArtist', 'MediaNowPlayingAlbum', 'MediaNowPlayingStation', 'MediaNowPlayingDuration', 'MediaNowPlayingElapsed', 'MediaPlaybackStatus', 'MediaPlaybackSource', 'MediaAudioVolume', 'MediaAudioVolumeIncrement', 'MediaAudioVolumeMax']},
  {category: 'User Preference', fields: ['Setting24HourTime', 'SettingChargeUnit', 'SettingDistanceUnit', 'SettingTemperatureUnit', 'SettingTirePressureUnit']},
  {category: 'Vehicle Config', fields: ['CarType', 'Trim', 'ExteriorColor', 'RoofColor', 'WheelType', 'VehicleName', 'Version', 'RearSeatHeaters', 'SunroofInstalled', 'EfficiencyPackage', 'EuropeVehicle', 'RightHandDrive', 'RemoteStartEnabled', 'ChargePort', 'OffroadLightbarPresent', 'SoftwareUpdateVersion', 'SoftwareUpdateDownloadPercentComplete', 'SoftwareUpdateInstallationPercentComplete', 'SoftwareUpdateExpectedDurationMinutes', 'SoftwareUpdateScheduledStartTime']},
];

/* ─── inline primitives (web @/components/ui kit) ─────────────────────── */

// Compact icon glyph for inline button / list affordances (the full
// SemanticIcon box is reserved for the AlertBanner / ToolCard badges).
function GlyphLegacyUnused({name, color}: {name: SemanticIconName; color?: string}) {
  return (
    <AppText style={[styles.glyph, color ? {color} : null]} weight="bold">
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

type BadgeVariant = 'success' | 'danger' | 'info' | 'warning' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  dot?: boolean;
  onPress?: () => void;
  children: ReactNode;
}

function Badge({variant = 'neutral', dot, onPress, children}: BadgeProps) {
  const tone = BADGE_STYLES[variant];
  const body = (
    <View style={[styles.badge, {backgroundColor: tone.bg, borderColor: tone.border}]}>
      {dot ? <View style={[styles.badgeDot, {backgroundColor: tone.fg}]} /> : null}
      <AppText style={[styles.badgeText, {color: tone.fg}]} weight="semibold">
        {children}
      </AppText>
    </View>
  );
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress}>
        {body}
      </Pressable>
    );
  }
  return body;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps {
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  onPress?: () => void;
  children: ReactNode;
}

function Button({variant = 'primary', loading, disabled, icon, onPress, children}: ButtonProps) {
  const isDisabled = !!disabled || !!loading;
  const tone = BTN_VARIANT_STYLES[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled, busy: !!loading}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.btn,
        tone.container,
        isDisabled ? styles.btnDisabled : null,
        pressed && !isDisabled ? styles.btnPressed : null,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={tone.text.color} />
      ) : icon ? (
        <View style={styles.btnIcon}>{icon}</View>
      ) : null}
      <AppText style={[styles.btnText, tone.text]} numberOfLines={1} weight="semibold">
        {children}
      </AppText>
    </Pressable>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  placeholder?: string;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Fixed trigger label (web "Set all…" transient select) regardless of value. */
  triggerLabel?: string;
  compact?: boolean;
}

// Native <select> stand-in: a Pressable trigger that opens a Modal option sheet.
function Select({
  label,
  placeholder,
  options,
  value,
  onValueChange,
  triggerLabel,
  compact,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  const display = triggerLabel ?? selected?.label ?? placeholder ?? '';
  const showPlaceholder = !triggerLabel && !selected;

  return (
    <View>
      {label ? <AppText style={styles.fieldLabel}>{label}</AppText> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(true)}
        style={[styles.selectTrigger, compact ? styles.selectTriggerCompact : null]}>
        <AppText
          numberOfLines={1}
          style={[
            compact ? styles.selectValueCompact : styles.selectValue,
            showPlaceholder ? styles.selectPlaceholder : null,
          ]}>
          {display}
        </AppText>
        <AppText style={styles.selectChevron}>{'\u25BE'}</AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.selectSheet}>
            {label ? (
              <AppText style={styles.selectSheetTitle} weight="semibold">
                {label}
              </AppText>
            ) : null}
            <ScrollView style={styles.selectSheetList} nestedScrollEnabled>
              {options.map(option => {
                const active = option.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{selected: active}}
                    key={option.value || option.label}
                    onPress={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                    style={styles.selectOption}>
                    <AppText
                      style={active ? styles.selectOptionActive : styles.selectOptionText}>
                      {option.label}
                    </AppText>
                    {active ? (
                      <AppText style={styles.selectOptionCheck}>{'\u2713'}</AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

interface TextareaProps {
  rows?: number;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
}

function Textarea({rows = 3, placeholder, value, onChangeText}: TextareaProps) {
  return (
    <TextInput
      multiline
      numberOfLines={rows}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      style={[styles.textarea, {minHeight: rows * 20 + 16}]}
      textAlignVertical="top"
      value={value}
    />
  );
}

function CheckBox({
  checked,
  partial,
  onPress,
}: {
  checked: boolean;
  partial?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{checked}}
      hitSlop={8}
      onPress={onPress}
      style={[
        styles.checkbox,
        checked ? styles.checkboxOn : partial ? styles.checkboxPartial : null,
      ]}>
      {checked ? <AppText style={styles.checkboxGlyph}>{'\u2713'}</AppText> : null}
    </Pressable>
  );
}

/* ─── inlined ./ToolCard ──────────────────────────────────────────────── */

interface ToolCardProps {
  icon: SemanticIconName;
  color: ToolColor;
  title: string;
  description: string;
  children: ReactNode;
}

function ToolCard({icon, color, title, description, children}: ToolCardProps) {
  const tint = TOOL_COLOR_STYLES[color] ?? TOOL_COLOR_STYLES.cyan;
  return (
    <GlassPanel style={styles.toolCard}>
      <View style={styles.toolHeader}>
        <View
          style={[styles.toolIcon, {backgroundColor: tint.bg, borderColor: tint.border}]}>
          <AppText style={[styles.toolIconGlyph, {color: tint.fg}]} weight="bold">
            {getSemanticIconDefinition(icon).glyph}
          </AppText>
        </View>
        <View style={styles.toolHeaderText}>
          <AppText style={styles.toolTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.toolDesc} tone="secondary" variant="caption">
            {description}
          </AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

/* ─── inlined ./ResultPanel ───────────────────────────────────────────── */

interface ResultPanelProps {
  title: string;
  data?: unknown;
  error?: string;
  idle?: boolean;
  idleMessage?: string;
}

function ResultPanel({title, data, error, idleMessage}: ResultPanelProps) {
  const hasData = data != null;
  const stringifiedData = hasData ? JSON.stringify(data, null, 2) : '';

  return (
    <View
      style={[
        styles.resultPanel,
        error ? styles.resultPanelError : hasData ? styles.resultPanelOk : styles.resultPanelIdle,
      ]}>
      <View style={styles.resultHeader}>
        <AppText style={styles.resultTitle} tone="secondary" variant="caption" weight="semibold">
          {title}
        </AppText>
        {hasData ? <CopyButton text={stringifiedData} /> : null}
      </View>
      {error ? (
        <AppText style={styles.resultErrorText}>{error}</AppText>
      ) : hasData ? (
        <ScrollView style={styles.codeScroll} nestedScrollEnabled>
          <AppText style={styles.codeText}>{stringifiedData}</AppText>
        </ScrollView>
      ) : (
        <AppText style={styles.resultIdleText}>{idleMessage ?? 'No result yet'}</AppText>
      )}
    </View>
  );
}

/* ─── inlined ./TelemetryErrorsPanel ──────────────────────────────────── */

interface TelemetryErrorsPanelProps {
  title: string;
  loading: boolean;
  error: string | undefined;
  requested: boolean;
  ok: boolean;
  errors: TelemetryError[];
  columns: Column<TelemetryError>[];
  vin: string;
  idleMessage: string;
  emptyMessage: string;
  rawData: unknown;
  rawDisclosureLabel: string;
  downloadLabel: string;
}

// Four-state View Errors panel: idle | loading | error | empty | data.
function TelemetryErrorsPanel({
  title,
  loading,
  error,
  requested,
  ok,
  errors,
  columns,
  vin,
  idleMessage,
  emptyMessage,
  rawData,
  rawDisclosureLabel,
  downloadLabel,
}: TelemetryErrorsPanelProps) {
  const [showRaw, setShowRaw] = useState(false);

  if (!requested) {
    return (
      <View style={[styles.errorsPanel, styles.errorsPanelIdle]}>
        <AppText style={styles.resultTitle} tone="secondary" variant="caption" weight="semibold">
          {title}
        </AppText>
        <AppText style={styles.resultIdleText}>{idleMessage}</AppText>
      </View>
    );
  }
  if (loading) {
    return (
      <View style={[styles.errorsPanel, styles.errorsPanelIdle]}>
        <AppText style={styles.resultTitle} tone="secondary" variant="caption" weight="semibold">
          {title}
        </AppText>
        <View style={styles.errorsLoading}>
          <Skeleton lines={3} />
        </View>
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.errorsPanel, styles.errorsPanelError]}>
        <AppText style={styles.resultTitle} tone="secondary" variant="caption" weight="semibold">
          {title}
        </AppText>
        <AppText style={styles.resultErrorText}>{error}</AppText>
      </View>
    );
  }
  if (errors.length > 0) {
    const onExport = () => {
      Share.share({
        message: JSON.stringify(errors, null, 2),
        title: `telemetry-errors-${vin || 'all'}.json`,
      }).catch(() => undefined);
    };
    return (
      <View style={styles.errorsTableWrap}>
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            {columns.map(col => (
              <View key={col.key} style={styles.tableCell}>
                <AppText tone="muted" variant="caption" weight="semibold">
                  {col.header}
                </AppText>
              </View>
            ))}
          </View>
          <ScrollView style={styles.tableBody} nestedScrollEnabled>
            {errors.map(row => (
              <View key={row.rowKey} style={styles.tableRow}>
                {columns.map(col => (
                  <View key={col.key} style={styles.tableCell}>
                    {col.render(row)}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
        <View style={styles.errorsExportRow}>
          <Button icon={<Glyph name="download" />} onPress={onExport} variant="ghost">
            {downloadLabel}
          </Button>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.errorsPanel, styles.errorsPanelIdle]}>
      <View style={styles.errorsEmptyHeader}>
        <AppText style={styles.resultTitle} tone="secondary" variant="caption" weight="semibold">
          {title}
        </AppText>
        <Badge dot variant={ok ? 'success' : 'warning'}>
          {ok ? '0' : '?'}
        </Badge>
      </View>
      <AppText style={styles.errorsEmptyText} tone="secondary">
        {emptyMessage}
      </AppText>
      {!ok && rawData != null ? (
        <View style={styles.rawDisclosure}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{expanded: showRaw}}
            onPress={() => setShowRaw(prev => !prev)}>
            <AppText style={styles.rawDisclosureLabel} tone="muted" variant="caption">
              {`${showRaw ? '\u25BE' : '\u25B8'} ${rawDisclosureLabel}`}
            </AppText>
          </Pressable>
          {showRaw ? (
            <ScrollView style={styles.codeScroll} nestedScrollEnabled>
              <AppText style={styles.codeText}>
                {JSON.stringify(rawData, null, 2)}
              </AppText>
            </ScrollView>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* ─── inlined @/components/ui/SignalConfigModal ───────────────────────── */

interface IntervalOption {
  value: number;
  label: string;
  desc: string;
}

const INTERVAL_OPTIONS: IntervalOption[] = [
  {value: 0, label: '500ms', desc: 'Real-time'},
  {value: 1, label: '1s', desc: 'Fast'},
  {value: 5, label: '5s', desc: 'Medium'},
  {value: 10, label: '10s', desc: 'Default'},
  {value: 30, label: '30s', desc: 'Slow'},
  {value: 60, label: '60s', desc: '1 min'},
  {value: 300, label: '5m', desc: 'Rare'},
  {value: 900, label: '15m', desc: '15 min'},
  {value: 3600, label: '1h', desc: '1 hour'},
  {value: 86400, label: '24h', desc: 'Daily'},
];

interface SignalConfig {
  name: string;
  category: string;
  selected: boolean;
  interval: number;
}

interface SignalPreset {
  name: string;
  desc: string;
  apply: (fields: SignalConfig[]) => SignalConfig[];
}

const PRESETS: SignalPreset[] = [
  {
    name: '\u26A1 Real-time Driving',
    desc: 'Driving signals at 1s, battery at 10s, config at 24h',
    apply: fields =>
      fields.map(f => ({
        ...f,
        selected: true,
        interval: ['Driving', 'Powertrain', 'Location'].includes(f.category)
          ? 1
          : ['Charging', 'Climate', 'Tires & Service'].includes(f.category)
            ? 10
            : ['Vehicle Config', 'User Preference'].includes(f.category)
              ? 86400
              : 10,
      })),
  },
  {
    name: '\u2696\uFE0F Balanced',
    desc: 'All signals at 10s — good balance of data and battery',
    apply: fields => fields.map(f => ({...f, selected: true, interval: 10})),
  },
  {
    name: '\uD83D\uDD0B Low Power',
    desc: 'All signals at 60s — minimal battery impact',
    apply: fields => fields.map(f => ({...f, selected: true, interval: 60})),
  },
  {
    name: '\uD83C\uDFCE\uFE0F Track Mode',
    desc: 'Driving & powertrain at 1s, everything else at 30s',
    apply: fields =>
      fields.map(f => ({
        ...f,
        selected: true,
        interval: ['Driving', 'Powertrain', 'Location'].includes(f.category)
          ? 1
          : ['Vehicle Config', 'User Preference'].includes(f.category)
            ? 3600
            : 30,
      })),
  },
  {
    name: '\uD83D\uDCB0 Cost Saver',
    desc: 'Essential signals only at 5–15min, non-essentials off',
    apply: fields =>
      fields.map(f => ({
        ...f,
        selected: ['Location', 'Charging', 'Vehicle State', 'Safety'].includes(f.category),
        interval:
          f.category === 'Vehicle State'
            ? 900
            : ['Location', 'Charging', 'Safety'].includes(f.category)
              ? 300
              : 300,
      })),
  },
  {
    name: '\uD83D\uDE34 Sleep Watch',
    desc: 'Security & location at 60s, charging at 1min, rest off',
    apply: fields =>
      fields.map(f => ({
        ...f,
        selected: ['Safety', 'Vehicle State', 'Location', 'Charging', 'Climate'].includes(
          f.category,
        ),
        interval: ['Safety', 'Vehicle State', 'Charging'].includes(f.category)
          ? 60
          : ['Location', 'Climate'].includes(f.category)
            ? 300
            : 300,
      })),
  },
  {
    name: '\uD83D\uDD27 Diagnostics',
    desc: 'Powertrain/tires/climate at 5s, driving at 10s',
    apply: fields =>
      fields.map(f => ({
        ...f,
        selected: true,
        interval: ['Powertrain', 'Tires & Service', 'Climate'].includes(f.category)
          ? 5
          : ['Driving', 'Charging', 'Vehicle State', 'Safety', 'Location'].includes(
                f.category,
              )
            ? 10
            : f.category === 'Media'
              ? 60
              : 3600,
      })),
  },
  {
    name: '\uD83D\uDDFA\uFE0F Trip Logger',
    desc: 'Location at 1s, driving at 5s — optimized for routes',
    apply: fields =>
      fields.map(f => ({
        ...f,
        selected: !['Media', 'User Preference', 'Vehicle Config'].includes(f.category),
        interval:
          f.category === 'Location'
            ? 1
            : f.category === 'Driving'
              ? 5
              : ['Powertrain', 'Charging'].includes(f.category)
                ? 30
                : ['Climate', 'Vehicle State', 'Safety'].includes(f.category)
                  ? 60
                  : 300,
      })),
  },
];

const CATEGORY_ICONS: Record<string, SemanticIconName> = {
  Driving: 'speed',
  Charging: 'battery',
  Climate: 'climate',
  'Vehicle State': 'security',
  Safety: 'security',
  Powertrain: 'bolt',
  'Tires & Service': 'maintenance',
  Media: 'radio',
  Location: 'location',
  'User Preference': 'settings',
  'Vehicle Config': 'settings',
};

interface SignalConfigModalProps {
  open: boolean;
  onClose: () => void;
  categories: CategoryDef[];
  initialSelected: string[];
  initialInterval: number;
  onSubmit: (signals: {name: string; interval: number}[]) => void;
}

function SignalConfigModal({
  open,
  onClose,
  categories,
  initialSelected,
  initialInterval,
  onSubmit,
}: SignalConfigModalProps) {
  const [signals, setSignals] = useState<SignalConfig[]>(() =>
    categories.flatMap(cat =>
      cat.fields.map(f => ({
        name: f,
        category: cat.category,
        selected: initialSelected.includes(f),
        interval: initialInterval,
      })),
    ),
  );
  const [search, setSearch] = useState('');
  const [masterInterval, setMasterInterval] = useState(initialInterval);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(
    () => new Set(categories.map(c => c.category)),
  );

  const filtered = useMemo(
    () => signals.filter(s => s.name.toLowerCase().includes(search.toLowerCase())),
    [signals, search],
  );

  const selectedCount = signals.filter(s => s.selected).length;
  const totalCount = signals.length;
  const allSelected = selectedCount === totalCount;

  const grouped = useMemo(() => {
    const map = new Map<string, SignalConfig[]>();
    for (const s of filtered) {
      const arr = map.get(s.category) || [];
      arr.push(s);
      map.set(s.category, arr);
    }
    return map;
  }, [filtered]);

  const updateSignal = (name: string, updates: Partial<SignalConfig>) => {
    setSignals(prev => prev.map(s => (s.name === name ? {...s, ...updates} : s)));
  };

  const toggleAll = (selected: boolean) => {
    setSignals(prev => prev.map(s => ({...s, selected})));
  };

  const setMasterIntervalAll = (interval: number) => {
    setMasterInterval(interval);
    setSignals(prev => prev.map(s => ({...s, interval})));
  };

  const toggleCategory = (category: string) => {
    const catSignals = signals.filter(s => s.category === category);
    const allCatSelected = catSignals.every(s => s.selected);
    setSignals(prev =>
      prev.map(s => (s.category === category ? {...s, selected: !allCatSelected} : s)),
    );
  };

  const setCategoryInterval = (category: string, interval: number) => {
    setSignals(prev => prev.map(s => (s.category === category ? {...s, interval} : s)));
  };

  const applyPreset = (preset: SignalPreset) => {
    setSignals(prev => preset.apply(prev));
  };

  const toggleExpanded = (category: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleSubmit = () => {
    const selected = signals
      .filter(s => s.selected)
      .map(s => ({name: s.name, interval: s.interval}));
    onSubmit(selected);
    onClose();
  };

  const fastCount = signals.filter(s => s.selected && s.interval === 0).length;
  const defaultCount = signals.filter(s => s.selected && s.interval === 10).length;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.signalModalRoot}>
        <View style={styles.signalModalCard}>
          <View style={styles.signalModalHeader}>
            <AppText style={styles.signalModalTitle} weight="bold">
              Fleet Telemetry Signal Configuration
            </AppText>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={styles.signalModalClose}>
              <AppText style={styles.signalModalCloseGlyph} weight="bold">
                {'\u2715'}
              </AppText>
            </Pressable>
          </View>
          <AppText style={styles.signalModalSub} tone="muted" variant="caption">
            {`${selectedCount} / ${totalCount} signals selected`}
          </AppText>

          {/* Master controls */}
          <View style={styles.signalMaster}>
            <ScrollView
              contentContainerStyle={styles.presetRow}
              horizontal
              showsHorizontalScrollIndicator={false}>
              {PRESETS.map(preset => (
                <Pressable
                  accessibilityRole="button"
                  key={preset.name}
                  onPress={() => applyPreset(preset)}
                  style={styles.presetChip}>
                  <AppText style={styles.presetChipText} variant="caption" weight="semibold">
                    {preset.name}
                  </AppText>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.masterRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => toggleAll(!allSelected)}
                style={[styles.masterToggle, allSelected ? styles.masterToggleOn : null]}>
                <CheckBox checked={allSelected} onPress={() => toggleAll(!allSelected)} />
                <AppText
                  style={allSelected ? styles.masterToggleTextOn : styles.masterToggleText}
                  variant="caption"
                  weight="semibold">
                  {allSelected ? 'Deselect All' : 'Select All'}
                </AppText>
              </Pressable>

              <View style={styles.masterInterval}>
                <AppText style={styles.masterIntervalLabel} tone="muted" variant="caption">
                  Master Interval:
                </AppText>
                <Select
                  compact
                  onValueChange={v => setMasterIntervalAll(Number(v))}
                  options={INTERVAL_OPTIONS.map(o => ({
                    value: String(o.value),
                    label: `${o.label} (${o.desc})`,
                  }))}
                  value={String(masterInterval)}
                />
              </View>
            </View>

            <Input
              icon={<Glyph name="search" />}
              onChangeText={setSearch}
              placeholder="Search signals..."
              value={search}
            />
          </View>

          {/* Signal list */}
          <ScrollView style={styles.signalList} nestedScrollEnabled>
            {Array.from(grouped.entries()).map(([category, catSignals]) => {
              const expanded = expandedCats.has(category);
              const allCatSelected = catSignals.every(s => s.selected);
              const someCatSelected = catSignals.some(s => s.selected);
              const catSelectedCount = catSignals.filter(s => s.selected).length;
              const catIcon = CATEGORY_ICONS[category] ?? 'bolt';

              return (
                <View key={category} style={styles.signalCategory}>
                  <View style={styles.signalCategoryHeader}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{expanded}}
                      hitSlop={6}
                      onPress={() => toggleExpanded(category)}
                      style={styles.signalCategoryToggle}>
                      <AppText style={styles.signalCategoryChevron}>
                        {expanded ? '\u25BE' : '\u25B8'}
                      </AppText>
                    </Pressable>
                    <CheckBox
                      checked={allCatSelected}
                      onPress={() => toggleCategory(category)}
                      partial={!allCatSelected && someCatSelected}
                    />
                    <Glyph name={catIcon} />
                    <AppText
                      numberOfLines={1}
                      style={styles.signalCategoryName}
                      tone="secondary"
                      variant="caption"
                      weight="semibold">
                      {category}
                    </AppText>
                    <AppText style={styles.signalCategoryCount} tone="muted" variant="caption">
                      {`(${catSelectedCount}/${catSignals.length})`}
                    </AppText>
                    <View style={styles.signalCategorySpacer} />
                    <Select
                      compact
                      onValueChange={v => {
                        if (v) {
                          setCategoryInterval(category, Number(v));
                        }
                      }}
                      options={INTERVAL_OPTIONS.map(o => ({
                        value: String(o.value),
                        label: o.label,
                      }))}
                      triggerLabel="Set all…"
                      value=""
                    />
                  </View>

                  {expanded ? (
                    <View style={styles.signalRows}>
                      {catSignals.map(sig => (
                        <View
                          key={sig.name}
                          style={[styles.signalRow, sig.selected ? null : styles.signalRowOff]}>
                          <CheckBox
                            checked={sig.selected}
                            onPress={() =>
                              updateSignal(sig.name, {selected: !sig.selected})
                            }
                          />
                          <AppText
                            numberOfLines={1}
                            style={styles.signalName}
                            variant="caption">
                            {sig.name}
                          </AppText>
                          <Select
                            compact
                            onValueChange={v =>
                              updateSignal(sig.name, {interval: Number(v)})
                            }
                            options={INTERVAL_OPTIONS.map(o => ({
                              value: String(o.value),
                              label: o.label,
                            }))}
                            value={String(sig.interval)}
                          />
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          {/* Footer */}
          <View style={styles.signalFooter}>
            <AppText style={styles.signalFooterText} tone="muted" variant="caption">
              {`${selectedCount} signals selected` +
                (selectedCount > 0 ? ` \u2022 ${fastCount} at 500ms` : '') +
                (selectedCount > 0 ? ` \u2022 ${defaultCount} at 10s` : '')}
            </AppText>
            <View style={styles.signalFooterButtons}>
              <Button onPress={onClose} variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={selectedCount === 0}
                icon={<Glyph name="bolt" />}
                onPress={handleSubmit}
                variant="primary">
                {`Subscribe ${selectedCount} Signals`}
              </Button>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Fleet API tools
   ═══════════════════════════════════════════════════════════════════════ */

function FleetApiConfigTool() {
  const {data, isLoading, error: configError} = useQuery({
    queryKey: ['devtools', 'fleet-api-info'],
    queryFn: () => apiFetch('fleet-api-info'),
  });

  if (isLoading) {
    return (
      <GlassPanel style={styles.loadingPanel}>
        <Skeleton lines={4} />
      </GlassPanel>
    );
  }
  if (configError) {
    return (
      <AlertBanner icon={<SemanticIcon name="alertCircle" size="sm" />} variant="danger">
        {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(configError)}`}
      </AlertBanner>
    );
  }

  const info = data ?? {};
  const baseUrl = (info.baseUrl as string) ?? '';
  const clientId = (info.clientId as string) ?? '';
  const authStatus = info.authenticated === true;
  const regions = (info.regions as string[]) ?? [];

  return (
    <ToolCard color="cyan" description={t('Config Desc')} icon="settings" title={t('Config')}>
      <View style={styles.configGrid}>
        <GlassPanel style={styles.configCell}>
          <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
            {t('Base Url')}
          </AppText>
          <View style={styles.configValueRow}>
            <AppText numberOfLines={1} style={styles.monoValue}>
              {baseUrl || EM_DASH}
            </AppText>
            {baseUrl ? <CopyButton text={baseUrl} /> : null}
          </View>
        </GlassPanel>
        <GlassPanel style={styles.configCell}>
          <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
            {t('Client Id')}
          </AppText>
          <View style={styles.configValueRow}>
            <AppText numberOfLines={1} style={styles.monoValue}>
              {clientId || EM_DASH}
            </AppText>
            {clientId ? <CopyButton text={clientId} /> : null}
          </View>
        </GlassPanel>
        <GlassPanel style={styles.configCell}>
          <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
            {t('Auth Status')}
          </AppText>
          <View style={styles.configValueRow}>
            {authStatus ? (
              <Badge dot variant="success">
                {t('Authenticated')}
              </Badge>
            ) : (
              <Badge dot variant="danger">
                {t('Not Authenticated')}
              </Badge>
            )}
          </View>
        </GlassPanel>
        <GlassPanel style={styles.configCell}>
          <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
            {t('Regions')}
          </AppText>
          <View style={styles.regionsRow}>
            {regions.length > 0 ? (
              regions.map(r => (
                <Badge key={r} variant="info">
                  {r}
                </Badge>
              ))
            ) : (
              <AppText style={styles.mutedValue}>{EM_DASH}</AppText>
            )}
          </View>
        </GlassPanel>
      </View>
    </ToolCard>
  );
}

function PartnerRegistrationTool() {
  const [domain, setDomain] = useState('');
  const mutation = useMutation({
    mutationFn: () => apiFetch('register-partner', 'POST', {domain}),
  });

  const opensslGen = 'openssl ecparam -name prime256v1 -genkey -noout -out private.pem';
  const opensslPub = 'openssl ec -in private.pem -pubout -out public.pem';

  return (
    <ToolCard color="green" description={t('Partner Reg Desc')} icon="globe" title={t('Partner Reg')}>
      <View style={styles.stack}>
        <GlassPanel style={styles.warnPanel}>
          <View style={styles.warnRow}>
            <Glyph color={colors.warning} name="severityWarn" />
            <View style={styles.warnBody}>
              <AppText style={styles.warnTitle} weight="semibold">
                {t('Prerequisites')}
              </AppText>
              <AppText style={styles.warnText}>{t('Prerequisites Desc')}</AppText>
            </View>
          </View>
        </GlassPanel>

        <View style={styles.stackSm}>
          <AppText style={styles.fieldLabel} tone="secondary" variant="caption" weight="semibold">
            {t('Openssl Commands')}
          </AppText>
          <View style={styles.cmdRow}>
            <AppText numberOfLines={1} style={styles.cmdText}>
              {opensslGen}
            </AppText>
            <CopyButton text={opensslGen} />
          </View>
          <View style={styles.cmdRow}>
            <AppText numberOfLines={1} style={styles.cmdText}>
              {opensslPub}
            </AppText>
            <CopyButton text={opensslPub} />
          </View>
        </View>

        <Input
          icon={<Glyph name="globe" />}
          label={t('Domain')}
          onChangeText={setDomain}
          placeholder="yourapp.example.com"
          value={domain}
        />
        <Button
          icon={<Glyph name="play" />}
          loading={mutation.isPending}
          onPress={() => mutation.mutate()}
          variant="primary">
          {t('Register')}
        </Button>
        {mutation.data ? (
          <ResultPanel
            data={mutation.data.error ? undefined : mutation.data}
            error={
              typeof mutation.data.error === 'string' ? mutation.data.error : undefined
            }
            title={t('Partner Reg')}
          />
        ) : null}
      </View>
    </ToolCard>
  );
}

function PartnerPublicKeyTool() {
  const [domain, setDomain] = useState('');

  const mutation = useMutation({
    mutationFn: () => apiFetch(`partner-public-key?domain=${encodeURIComponent(domain)}`),
  });

  const response = mutation.data ?? {};
  const verification = (response.verification ?? {}) as Record<string, unknown>;
  const remoteFound = verification.remote_key_found === true;
  const matchesLocal = verification.matches_local === true;
  const localConfigured = verification.local_key_configured === true;
  const publicKey =
    ((response.response as Record<string, unknown>)?.public_key as string) ?? '';

  return (
    <ToolCard
      color="cyan"
      description={t('devtools.partnerKey.desc', 'Verify your registered public key with Tesla')}
      icon="security"
      title={t('devtools.partnerKey.title', 'Public Key Verification')}>
      <View style={styles.stack}>
        <Input
          icon={<Glyph name="globe" />}
          label={t('Domain')}
          onChangeText={setDomain}
          placeholder="yourapp.example.com"
          value={domain}
        />
        <Button
          disabled={!domain.trim()}
          icon={<Glyph name="play" />}
          loading={mutation.isPending}
          onPress={() => mutation.mutate()}
          variant="primary">
          {t('devtools.partnerKey.verify', 'Verify')}
        </Button>

        {mutation.data ? (
          <>
            <View style={styles.badgeRow}>
              {remoteFound ? (
                <Badge dot variant="success">
                  {t('devtools.partnerKey.keyRegistered', 'Key Registered')}
                </Badge>
              ) : (
                <Badge dot variant="danger">
                  {t('devtools.partnerKey.keyNotFound', 'Key Not Found')}
                </Badge>
              )}
              {remoteFound && localConfigured ? (
                matchesLocal ? (
                  <Badge dot variant="success">
                    {t('devtools.partnerKey.matchesLocal', 'Matches Local Key')}
                  </Badge>
                ) : (
                  <Badge dot variant="warning">
                    {t('devtools.partnerKey.mismatch', 'Does Not Match Local Key')}
                  </Badge>
                )
              ) : null}
              {remoteFound && !localConfigured ? (
                <Badge variant="neutral">
                  {t('devtools.partnerKey.noLocal', 'No Local Key Configured')}
                </Badge>
              ) : null}
            </View>

            {publicKey ? (
              <View style={styles.stackSm}>
                <AppText
                  style={styles.fieldLabel}
                  tone="secondary"
                  variant="caption"
                  weight="semibold">
                  {t('devtools.partnerKey.pemLabel', 'Registered PEM')}
                </AppText>
                <View style={styles.pemBox}>
                  <ScrollView style={styles.pemScroll} nestedScrollEnabled>
                    <AppText style={styles.codeText}>{publicKey}</AppText>
                  </ScrollView>
                  <View style={styles.pemCopyRow}>
                    <CopyButton text={publicKey} />
                  </View>
                </View>
              </View>
            ) : null}

            <ResultPanel
              data={response.error ? undefined : response}
              error={typeof response.error === 'string' ? (response.error as string) : undefined}
              idle={false}
              title={t('devtools.partnerKey.rawResponse', 'Raw Response')}
            />
          </>
        ) : null}
      </View>
    </ToolCard>
  );
}

function PublicKeySetupTool() {
  const queryClient = useQueryClient();
  const [pemInput, setPemInput] = useState('');

  const {data: status, isLoading, error: keyError} = useQuery({
    queryKey: ['devtools', 'public-key-status'],
    queryFn: () => apiFetch('public-key-status'),
  });

  const generateMut = useMutation({
    mutationFn: () => apiFetch('generate-keypair', 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['devtools', 'public-key-status']});
    },
  });

  const uploadMut = useMutation({
    mutationFn: () => apiFetch('upload-public-key', 'POST', {pem: pemInput}),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['devtools', 'public-key-status']});
      setPemInput('');
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => apiFetch('public-key', 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['devtools', 'public-key-status']});
    },
  });

  if (isLoading) {
    return (
      <GlassPanel style={styles.loadingPanel}>
        <Skeleton lines={3} />
      </GlassPanel>
    );
  }
  if (keyError) {
    return (
      <AlertBanner icon={<SemanticIcon name="alertCircle" size="sm" />} variant="danger">
        {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(keyError)}`}
      </AlertBanner>
    );
  }

  const configured = status?.configured === true;
  const fingerprint = (status?.fingerprint as string) ?? '';
  const wellKnownUrl = (status?.wellKnownUrl as string) ?? '';

  return (
    <ToolCard color="purple" description={t('Public Key Desc')} icon="key" title={t('Public Key')}>
      <View style={styles.stack}>
        <View style={styles.inlineRow}>
          <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
            {`${t('Status')}:`}
          </AppText>
          {configured ? (
            <Badge dot variant="success">
              {t('Configured')}
            </Badge>
          ) : (
            <Badge dot variant="warning">
              {t('Not Configured')}
            </Badge>
          )}
        </View>

        {fingerprint ? (
          <View style={styles.cmdRow}>
            <Glyph color={colors.violet} name="fingerprint" />
            <AppText numberOfLines={1} style={styles.cmdText}>
              {fingerprint}
            </AppText>
            <CopyButton text={fingerprint} />
          </View>
        ) : null}

        {wellKnownUrl ? (
          <View style={styles.cmdRow}>
            <Glyph color={colors.accent} name="link" />
            <AppText numberOfLines={1} style={styles.cmdText}>
              {wellKnownUrl}
            </AppText>
            <CopyButton text={wellKnownUrl} />
          </View>
        ) : null}

        <GlassPanel style={styles.warnPanel}>
          <View style={styles.warnRow}>
            <Glyph color={colors.warning} name="severityWarn" />
            <AppText style={styles.warnText}>{t('Private Key Warning')}</AppText>
          </View>
        </GlassPanel>

        <View style={styles.badgeRow}>
          <Button
            icon={<Glyph name="key" />}
            loading={generateMut.isPending}
            onPress={() => generateMut.mutate()}
            variant="primary">
            {t('Generate Keypair')}
          </Button>
          <Button
            icon={<Glyph name="delete" />}
            loading={deleteMut.isPending}
            onPress={() => deleteMut.mutate()}
            variant="danger">
            {t('Delete Keypair')}
          </Button>
        </View>

        <ResultPanel
          data={generateMut.data?.error ? undefined : generateMut.data}
          error={
            typeof generateMut.data?.error === 'string' ? generateMut.data.error : undefined
          }
          idle={!generateMut.data}
          idleMessage={t('devtools.keypairIdle', 'Generate or delete a keypair to see results')}
          title={t('Generate Keypair')}
        />
        <ResultPanel
          data={deleteMut.data?.error ? undefined : deleteMut.data}
          error={typeof deleteMut.data?.error === 'string' ? deleteMut.data.error : undefined}
          idle={!deleteMut.data}
          title={t('Delete Keypair')}
        />

        <View style={styles.stackSm}>
          <AppText style={styles.fieldLabel} tone="secondary" variant="caption" weight="semibold">
            {t('Upload Pem')}
          </AppText>
          <Textarea
            onChangeText={setPemInput}
            placeholder={t('Pem Placeholder')}
            rows={4}
            value={pemInput}
          />
          <Button
            icon={<Glyph name="upload" />}
            loading={uploadMut.isPending}
            onPress={() => uploadMut.mutate()}
            variant="secondary">
            {t('Upload Key')}
          </Button>
          <ResultPanel
            data={uploadMut.data?.error ? undefined : uploadMut.data}
            error={typeof uploadMut.data?.error === 'string' ? uploadMut.data.error : undefined}
            idle={!uploadMut.data}
            idleMessage={t('devtools.uploadIdle', 'Upload a public key to see results')}
            title={t('Upload Key')}
          />
        </View>
      </View>
    </ToolCard>
  );
}

function VehicleKeyPairingTool() {
  const {data} = useQuery({
    queryKey: ['devtools', 'fleet-api-info'],
    queryFn: () => apiFetch('fleet-api-info'),
  });
  const hostname = (data?.hostname as string) ?? 'yourapp.example.com';
  const pairingUrl = `https://tesla.com/_ak/${hostname}`;

  return (
    <ToolCard color="green" description={t('Key Pairing Desc')} icon="vehicle" title={t('Key Pairing')}>
      <View style={styles.stack}>
        <View style={styles.cmdRow}>
          <Glyph color={colors.success} name="link" />
          <AppText numberOfLines={1} style={[styles.cmdText, styles.cmdTextSuccess]}>
            {pairingUrl}
          </AppText>
          <CopyButton text={pairingUrl} />
        </View>
        <View style={styles.infoPanel}>
          <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
            {t('Pairing Instructions')}
          </AppText>
          <View style={styles.stepList}>
            <View style={styles.stepItem}>
              <Glyph color={colors.accent} name="next" />
              <AppText style={styles.stepText} tone="secondary" variant="caption">
                {t('devtools.fleet.pairingStep1', 'Pairing Step1')}
              </AppText>
            </View>
            <View style={styles.stepItem}>
              <Glyph color={colors.accent} name="next" />
              <AppText style={styles.stepText} tone="secondary" variant="caption">
                {t('devtools.fleet.pairingStep2', 'Pairing Step2')}
              </AppText>
            </View>
            <View style={styles.stepItem}>
              <Glyph color={colors.accent} name="next" />
              <AppText style={styles.stepText} tone="secondary" variant="caption">
                {t('devtools.fleet.pairingStep3', 'Pairing Step3')}
              </AppText>
            </View>
          </View>
        </View>
      </View>
    </ToolCard>
  );
}

function FleetTelemetrySubscribeTool() {
  const queryClient = useQueryClient();
  const [vin, setVin] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('443');
  const [interval, setInterval_] = useState(30);
  const [caCert, setCaCert] = useState('');
  const [signalModalOpen, setSignalModalOpen] = useState(false);
  const [selectedSignals, setSelectedSignals] = useState<{name: string; interval: number}[]>([]);

  const {options: vehicleOptions} = useVehicleOptions();

  const subscribeMut = useMutation({
    mutationFn: () =>
      apiFetch('fleet-telemetry-subscribe', 'POST', {
        vins: [vin],
        hostname,
        port: parseInt(port, 10),
        ca: caCert || undefined,
        fields: selectedSignals.length > 0 ? selectedSignals.map(s => s.name) : undefined,
        interval_seconds: interval,
        field_intervals:
          selectedSignals.length > 0
            ? Object.fromEntries(
                selectedSignals
                  .filter(s => s.interval !== interval)
                  .map(s => [s.name, s.interval]),
              )
            : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['devtools']});
    },
  });

  return (
    <ToolCard color="cyan" description={t('Telemetry Sub Desc')} icon="radio" title={t('Telemetry Sub')}>
      <View style={styles.stack}>
        <Select
          label={t('Vehicle')}
          onValueChange={setVin}
          options={vehicleOptions}
          placeholder={t('Select Vehicle')}
          value={vin}
        />
        <View style={styles.fieldGrid}>
          <View style={styles.fieldGridCell}>
            <Input
              icon={<Glyph name="server" />}
              label={t('Hostname')}
              onChangeText={setHostname}
              placeholder="telemetry.example.com"
              value={hostname}
            />
          </View>
          <View style={styles.fieldGridCell}>
            <Input
              icon={<Glyph name="network" />}
              label={t('Port')}
              onChangeText={setPort}
              placeholder="443"
              value={port}
            />
          </View>
        </View>
        <View>
          <AppText style={styles.fieldLabel} tone="secondary" variant="caption" weight="semibold">
            {t('Ca Cert')}
          </AppText>
          <Textarea
            onChangeText={setCaCert}
            placeholder={t('Ca Cert Placeholder')}
            rows={3}
            value={caCert}
          />
        </View>
        <View style={styles.inlineRow}>
          <Button
            icon={<Glyph name="settings" />}
            onPress={() => setSignalModalOpen(true)}
            variant="secondary">
            {`${t('Configure Signals')} (${selectedSignals.length})`}
          </Button>
          <AppText style={styles.mutedValue} tone="muted" variant="caption">
            {`${t('Interval Label')}: ${interval}s`}
          </AppText>
        </View>
        <Button
          icon={<Glyph name="play" />}
          loading={subscribeMut.isPending}
          onPress={() => subscribeMut.mutate()}
          variant="primary">
          {t('Subscribe')}
        </Button>
        {subscribeMut.data ? (
          <ResultPanel
            data={subscribeMut.data.error ? undefined : subscribeMut.data}
            error={
              typeof subscribeMut.data.error === 'string'
                ? subscribeMut.data.error
                : undefined
            }
            title={t('Telemetry Sub')}
          />
        ) : null}
      </View>
      <SignalConfigModal
        categories={TELEMETRY_FIELDS}
        initialInterval={interval}
        initialSelected={selectedSignals.map(s => s.name)}
        onClose={() => setSignalModalOpen(false)}
        onSubmit={signals => {
          setSelectedSignals(signals);
          if (signals.length > 0) {
            setInterval_(signals[0]?.interval ?? 30);
          }
          setSignalModalOpen(false);
        }}
        open={signalModalOpen}
      />
    </ToolCard>
  );
}

function FleetTelemetryConfigTool() {
  const [vin, setVin] = useState('');

  const {options: vehicleOptions} = useVehicleOptions();

  const configQuery = useMutation({mutationFn: () => apiFetch(`fleet-telemetry-config?vin=${vin}`)});
  const errorsQuery = useMutation({mutationFn: () => apiFetch(`fleet-telemetry-errors?vin=${vin}`)});
  const deleteMut = useMutation({
    mutationFn: () => apiFetch(`fleet-telemetry-config?vin=${vin}`, 'DELETE'),
  });

  const errorsApiError =
    typeof errorsQuery.data?.error === 'string'
      ? (errorsQuery.data.error as string)
      : undefined;
  const {errors: errorData, ok: errorsOk} = useMemo(
    () => (errorsApiError ? {errors: [], ok: false} : extractTelemetryErrors(errorsQuery.data)),
    [errorsQuery.data, errorsApiError],
  );

  const errorColumns: Column<TelemetryError>[] = useMemo(
    () => [
      {
        key: 'timestamp',
        header: t('Timestamp'),
        render: r => (
          <AppText variant="caption">
            {r.timestamp ? formatDateTime(r.timestamp) : EM_DASH}
          </AppText>
        ),
      },
      {
        key: 'code',
        header: t('Code'),
        render: r =>
          r.code ? (
            <Badge variant="danger">{r.code}</Badge>
          ) : (
            <AppText tone="muted" variant="caption">
              {EM_DASH}
            </AppText>
          ),
      },
      {
        key: 'message',
        header: t('Message'),
        render: r => (
          <AppText tone="secondary" variant="caption">
            {r.message || EM_DASH}
          </AppText>
        ),
      },
    ],
    [],
  );

  const vinSelected = vin !== '';
  const errorsRequested = errorsQuery.data != null || errorsQuery.isPending;

  return (
    <ToolCard color="purple" description={t('Telemetry Config Desc')} icon="satellite" title={t('Telemetry Config')}>
      <View style={styles.stack}>
        <Select
          label={t('Vehicle')}
          onValueChange={setVin}
          options={vehicleOptions}
          placeholder={t('Select Vehicle')}
          value={vin}
        />
        <View style={styles.badgeRow}>
          <Button
            disabled={!vinSelected}
            icon={<Glyph name="show" />}
            loading={configQuery.isPending}
            onPress={() => configQuery.mutate()}
            variant="primary">
            {t('Get Config')}
          </Button>
          <Button
            disabled={!vinSelected}
            icon={<Glyph name="severityWarn" />}
            loading={errorsQuery.isPending}
            onPress={() => errorsQuery.mutate()}
            variant="secondary">
            {t('View Errors')}
          </Button>
          <Button
            disabled={!vinSelected}
            icon={<Glyph name="delete" />}
            loading={deleteMut.isPending}
            onPress={() => deleteMut.mutate()}
            variant="danger">
            {t('Delete Config')}
          </Button>
        </View>
        <ResultPanel
          data={configQuery.data?.error ? undefined : configQuery.data}
          error={typeof configQuery.data?.error === 'string' ? configQuery.data.error : undefined}
          idle={!configQuery.data}
          idleMessage={t('devtools.configIdle', 'Fetch config to see results')}
          title={t('Telemetry Config')}
        />
        <ResultPanel
          data={deleteMut.data?.error ? undefined : deleteMut.data}
          error={typeof deleteMut.data?.error === 'string' ? deleteMut.data.error : undefined}
          idle={!deleteMut.data}
          title={t('Delete Config')}
        />
        <TelemetryErrorsPanel
          columns={errorColumns}
          downloadLabel={t('Download Errors')}
          emptyMessage={t('devtools.errorsEmpty', 'No Fleet Telemetry errors reported for this vehicle.')}
          error={errorsApiError}
          errors={errorData}
          idleMessage={t('devtools.errorsIdle', 'Click View Errors to fetch recent Fleet Telemetry errors for this vehicle.')}
          loading={errorsQuery.isPending}
          ok={errorsOk}
          rawData={errorsQuery.data}
          rawDisclosureLabel={t('devtools.errorsRaw', 'Show raw Tesla response')}
          requested={errorsRequested}
          title={t('Telemetry Errors')}
          vin={vin}
        />
      </View>
    </ToolCard>
  );
}

function FleetStatusTool() {
  const {vehicles} = useVehicleOptions();
  const fleetStatusMut = useMutation({
    mutationFn: () => apiFetch('fleet-status', 'POST', {vins: vehicles.map(v => v.vin)}),
  });

  return (
    <ToolCard
      color="green"
      description={t('Check fleet status for all vehicles')}
      icon="charging"
      title={t('Fleet Status')}>
      <View style={styles.inlineRowTop}>
        <Button
          disabled={vehicles.length === 0}
          icon={<Glyph name="play" />}
          loading={fleetStatusMut.isPending}
          onPress={() => fleetStatusMut.mutate()}
          variant="primary">
          {t('Check Fleet Status')}
        </Button>
      </View>
      {fleetStatusMut.data ? (
        <ResultPanel
          data={fleetStatusMut.data.error ? undefined : fleetStatusMut.data}
          error={
            typeof fleetStatusMut.data.error === 'string'
              ? fleetStatusMut.data.error
              : undefined
          }
          title={t('Fleet Status')}
        />
      ) : null}
    </ToolCard>
  );
}

function VehicleDataTools() {
  const [vin, setVin] = useState('');
  const {options: vehicleOptions} = useVehicleOptions();

  const chargingMut = useMutation({mutationFn: () => apiFetch(`nearby-charging?vin=${vin}`)});
  const releaseNotesMut = useMutation({mutationFn: () => apiFetch(`release-notes?vin=${vin}`)});
  const alertsMut = useMutation({mutationFn: () => apiFetch(`recent-alerts?vin=${vin}`)});
  const serviceMut = useMutation({mutationFn: () => apiFetch(`service-data?vin=${vin}`)});

  const lastResult =
    chargingMut.data ?? releaseNotesMut.data ?? alertsMut.data ?? serviceMut.data;

  return (
    <ToolCard color="cyan" description={t('Vehicle Data Desc')} icon="vehicle" title={t('Vehicle Data')}>
      <View style={styles.stack}>
        <Select
          label={t('Vehicle')}
          onValueChange={setVin}
          options={vehicleOptions}
          placeholder={t('Select Vehicle')}
          value={vin}
        />
        <View style={styles.badgeRow}>
          <Button
            icon={<Glyph name="location" />}
            loading={chargingMut.isPending}
            onPress={() => chargingMut.mutate()}
            variant="secondary">
            {t('Nearby Charging')}
          </Button>
          <Button
            icon={<Glyph name="fileText" />}
            loading={releaseNotesMut.isPending}
            onPress={() => releaseNotesMut.mutate()}
            variant="secondary">
            {t('Release Notes')}
          </Button>
          <Button
            icon={<Glyph name="severityWarn" />}
            loading={alertsMut.isPending}
            onPress={() => alertsMut.mutate()}
            variant="secondary">
            {t('Recent Alerts')}
          </Button>
          <Button
            icon={<Glyph name="maintenance" />}
            loading={serviceMut.isPending}
            onPress={() => serviceMut.mutate()}
            variant="secondary">
            {t('Service Data')}
          </Button>
        </View>
        {lastResult ? (
          <ResultPanel
            data={lastResult.error ? undefined : lastResult}
            error={typeof lastResult.error === 'string' ? lastResult.error : undefined}
            title={t('Vehicle Data')}
          />
        ) : null}
      </View>
    </ToolCard>
  );
}

/* ─── Onboarding workflow ─────────────────────────────────────────────── */

// Native-safe replacement for the web localStorage 'devtools-onboarding'
// persistence: an in-process store. No AsyncStorage is bundled in this parity
// workspace, so progress persists for the app session but not across cold
// starts (documented in the sidecar).
const onboardingMemoryStore: {value: Record<string, boolean>} = {value: {}};

function readOnboardingState(): Record<string, boolean> {
  return {...onboardingMemoryStore.value};
}

function writeOnboardingState(value: Record<string, boolean>): void {
  onboardingMemoryStore.value = {...value};
}

function OnboardingWorkflow() {
  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState<Record<string, boolean>>(() =>
    readOnboardingState(),
  );

  useEffect(() => {
    writeOnboardingState(completed);
  }, [completed]);

  const {data: keyStatus, error: keyStatusError} = useQuery({
    queryKey: ['devtools', 'public-key-status'],
    queryFn: () => apiFetch('public-key-status'),
    refetchInterval: 30000,
  });

  const {data: fleetInfo, error: fleetInfoError} = useQuery({
    queryKey: ['devtools', 'fleet-api-info'],
    queryFn: () => apiFetch('fleet-api-info'),
    refetchInterval: 30000,
  });

  useEffect(() => {
    const autoDetected: Record<string, boolean> = {...completed};
    if (keyStatus?.configured === true) {
      autoDetected.keypair = true;
    }
    if (fleetInfo?.authenticated === true) {
      autoDetected.auth = true;
    }
    const changed = Object.keys(autoDetected).some(k => autoDetected[k] !== completed[k]);
    if (changed) {
      setCompleted(autoDetected);
    }
  }, [keyStatus, fleetInfo, completed]);

  const completedCount = ONBOARDING_STEPS.filter(s => completed[s.id]).length;
  const progressPct = (completedCount / ONBOARDING_STEPS.length) * 100;
  const step = ONBOARDING_STEPS[currentStep];
  if (!step) {
    return null;
  }

  const markComplete = () => {
    setCompleted(prev => ({...prev, [step.id]: true}));
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const onboardingError = [keyStatusError, fleetInfoError].find(Boolean);
  const stepDone = completed[step.id] === true;
  const stepTint = stepDone ? TOOL_COLOR_STYLES.green : TOOL_COLOR_STYLES.cyan;

  return (
    <View style={styles.stack}>
      {onboardingError ? (
        <AlertBanner icon={<SemanticIcon name="alertCircle" size="sm" />} variant="danger">
          {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(onboardingError)}`}
        </AlertBanner>
      ) : null}

      {/* Progress bar */}
      <View style={styles.stackSm}>
        <View style={styles.progressLabelRow}>
          <AppText tone="secondary" variant="caption">
            {t('Progress')}
          </AppText>
          <AppText tone="secondary" variant="caption">
            {`${completedCount} / ${ONBOARDING_STEPS.length} (${fmtInt(progressPct)}%)`}
          </AppText>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, {width: `${progressPct}%`}]} />
        </View>
      </View>

      {/* Step indicators */}
      <View style={styles.badgeRow}>
        {ONBOARDING_STEPS.map((s, i) => (
          <Badge
            dot={i === currentStep}
            key={s.id}
            onPress={() => setCurrentStep(i)}
            variant={completed[s.id] ? 'success' : i === currentStep ? 'info' : 'neutral'}>
            {s.label}
          </Badge>
        ))}
      </View>

      {/* Step content */}
      <GlassPanel style={styles.loadingPanel}>
        <View style={styles.stepHeader}>
          <View
            style={[styles.toolIcon, {backgroundColor: stepTint.bg, borderColor: stepTint.border}]}>
            <AppText style={[styles.toolIconGlyph, {color: stepTint.fg}]} weight="bold">
              {getSemanticIconDefinition(stepDone ? 'success' : step.icon).glyph}
            </AppText>
          </View>
          <View style={styles.toolHeaderText}>
            <AppText style={styles.toolTitle} weight="semibold">
              {`${t('devtools.onboarding.stepLabel', 'Step {{step}}', {step: currentStep + 1})}: ${step.label}`}
            </AppText>
            <AppText style={styles.toolDesc} tone="secondary" variant="caption">
              {step.desc}
            </AppText>
          </View>
        </View>

        <View style={styles.stepButtons}>
          <Button
            disabled={currentStep === 0}
            icon={<Glyph name="back" />}
            onPress={() => setCurrentStep(currentStep - 1)}
            variant="ghost">
            {t('Previous')}
          </Button>
          <Button
            icon={<Glyph name="success" />}
            onPress={markComplete}
            variant={stepDone ? 'secondary' : 'primary'}>
            {stepDone ? t('Completed') : t('Mark Complete')}
          </Button>
          <Button
            disabled={currentStep === ONBOARDING_STEPS.length - 1}
            icon={<Glyph name="forward" />}
            onPress={() => setCurrentStep(currentStep + 1)}
            variant="ghost">
            {t('Next')}
          </Button>
        </View>
      </GlassPanel>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Fleet API Section — composed layout
   ═══════════════════════════════════════════════════════════════════════ */

export function FleetApiSection() {
  return (
    <View style={styles.section}>
      <View style={styles.stackSm}>
        <AppText style={styles.sectionHeading} weight="semibold">
          {t('devtools.fleet.setupWizard', 'Setup Wizard')}
        </AppText>
        <OnboardingWorkflow />
      </View>

      <View style={styles.stackSm}>
        <AppText style={styles.sectionHeading} weight="semibold">
          {t('devtools.fleet.toolsTitle', 'Fleet API Tools')}
        </AppText>
        <View style={styles.toolGrid}>
          <FleetApiConfigTool />
          <PartnerRegistrationTool />
          <PartnerPublicKeyTool />
          <PublicKeySetupTool />
          <VehicleKeyPairingTool />
          <FleetTelemetrySubscribeTool />
          <FleetTelemetryConfigTool />
          <FleetStatusTool />
          <VehicleDataTools />
        </View>
      </View>
    </View>
  );
}

/* ─── styles ──────────────────────────────────────────────────────────── */

const BADGE_STYLES: Record<BadgeVariant, {bg: string; border: string; fg: string}> = {
  success: {bg: colors.successSurface, border: colors.successBorder, fg: colors.success},
  danger: {bg: colors.dangerSurface, border: colors.dangerBorder, fg: colors.danger},
  info: {bg: colors.accentSoft, border: colors.borderAccent, fg: colors.accent},
  warning: {bg: colors.warningSurface, border: colors.warningBorder, fg: colors.warning},
  neutral: {bg: colors.surfaceRaised, border: colors.border, fg: colors.textSecondary},
};

const BTN_VARIANT_STYLES: Record<ButtonVariant, {container: ViewStyle; text: TextStyle}> = {
  primary: {container: {backgroundColor: colors.accent}, text: {color: colors.background}},
  secondary: {container: {backgroundColor: colors.surfaceRaised}, text: {color: colors.textPrimary}},
  danger: {
    container: {
      backgroundColor: colors.dangerSurface,
      borderColor: colors.dangerBorder,
      borderWidth: 1,
    },
    text: {color: colors.danger},
  },
  ghost: {container: {backgroundColor: 'transparent'}, text: {color: colors.textSecondary}},
};

const styles = StyleSheet.create({
  glyph: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
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
  badgeText: {
    fontSize: 11,
    lineHeight: 16,
  },
  btn: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontSize: 12,
    lineHeight: 16,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.xs,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectTriggerCompact: {
    minHeight: 30,
    minWidth: 96,
    paddingVertical: 4,
  },
  selectValue: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
  },
  selectValueCompact: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 12,
  },
  selectPlaceholder: {
    color: colors.textMuted,
  },
  selectChevron: {
    color: colors.textMuted,
    fontSize: 12,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  selectSheet: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: '70%',
    padding: spacing.md,
    width: '100%',
  },
  selectSheetTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  selectSheetList: {
    flexGrow: 0,
  },
  selectOption: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  selectOptionText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  selectOptionActive: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  selectOptionCheck: {
    color: colors.accent,
    fontSize: 14,
  },
  textarea: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  checkboxOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxPartial: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkboxGlyph: {
    color: colors.background,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  toolCard: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  toolHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  toolIcon: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  toolIconGlyph: {
    fontSize: 13,
    letterSpacing: 0.4,
    lineHeight: 18,
  },
  toolHeaderText: {
    flex: 1,
  },
  toolTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  toolDesc: {
    color: colors.textSecondary,
    marginTop: 2,
  },
  resultPanel: {
    borderRadius: 12,
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  resultPanelError: {
    backgroundColor: colors.dangerSurface,
  },
  resultPanelOk: {
    backgroundColor: colors.successSurface,
  },
  resultPanelIdle: {
    backgroundColor: colors.surfaceRaised,
  },
  resultHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  resultTitle: {
    color: colors.textSecondary,
    flex: 1,
  },
  resultErrorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  resultIdleText: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
    marginTop: 2,
  },
  codeScroll: {
    backgroundColor: colors.surface,
    borderRadius: 6,
    maxHeight: 256,
    padding: spacing.sm,
  },
  codeText: {
    color: colors.textPrimary,
    fontFamily: MONO_FAMILY,
    fontSize: 12,
    lineHeight: 16,
  },
  errorsPanel: {
    borderRadius: 12,
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  errorsPanelIdle: {
    backgroundColor: colors.surfaceRaised,
  },
  errorsPanelError: {
    backgroundColor: colors.dangerSurface,
  },
  errorsLoading: {
    marginTop: spacing.sm,
  },
  errorsTableWrap: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  table: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    backgroundColor: colors.surfaceRaised,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tableBody: {
    maxHeight: 320,
  },
  tableRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tableCell: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  errorsExportRow: {
    alignItems: 'flex-start',
  },
  errorsEmptyHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  errorsEmptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  rawDisclosure: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  rawDisclosureLabel: {
    color: colors.textMuted,
  },
  configGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  configCell: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  configValueRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  monoValue: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontFamily: MONO_FAMILY,
    fontSize: 13,
  },
  mutedValue: {
    color: colors.textMuted,
    fontSize: 13,
  },
  regionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  stack: {
    gap: spacing.md,
  },
  stackSm: {
    gap: spacing.sm,
  },
  warnPanel: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    padding: spacing.sm,
  },
  warnRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  warnBody: {
    flex: 1,
  },
  warnTitle: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 16,
  },
  warnText: {
    color: colors.warning,
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    opacity: 0.85,
  },
  cmdRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 6,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  cmdText: {
    color: colors.accent,
    flex: 1,
    fontFamily: MONO_FAMILY,
    fontSize: 12,
  },
  cmdTextSuccess: {
    color: colors.success,
  },
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pemBox: {
    backgroundColor: colors.surface,
    borderRadius: 6,
    padding: spacing.sm,
  },
  pemScroll: {
    maxHeight: 192,
  },
  pemCopyRow: {
    alignItems: 'flex-end',
    marginTop: spacing.sm,
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  inlineRowTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  infoPanel: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  stepList: {
    gap: spacing.xs,
  },
  stepItem: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stepText: {
    color: colors.textSecondary,
    flex: 1,
  },
  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  fieldGridCell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  loadingPanel: {
    padding: spacing.lg,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: '100%',
  },
  stepHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  stepButtons: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  section: {
    gap: spacing.xl,
  },
  sectionHeading: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  toolGrid: {
    gap: spacing.md,
  },
  signalModalRoot: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  signalModalCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    flex: 1,
    marginTop: spacing.xxl,
    padding: spacing.lg,
  },
  signalModalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  signalModalTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  signalModalClose: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  signalModalCloseGlyph: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  signalModalSub: {
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: 2,
  },
  signalMaster: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  presetRow: {
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  presetChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  presetChipText: {
    color: colors.textSecondary,
  },
  masterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  masterToggle: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  masterToggleOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  masterToggleText: {
    color: colors.textSecondary,
  },
  masterToggleTextOn: {
    color: colors.accent,
  },
  masterInterval: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  masterIntervalLabel: {
    color: colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  signalList: {
    flex: 1,
    marginVertical: spacing.sm,
  },
  signalCategory: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  signalCategoryHeader: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  signalCategoryToggle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  signalCategoryChevron: {
    color: colors.textMuted,
    fontSize: 12,
  },
  signalCategoryName: {
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  signalCategoryCount: {
    color: colors.textMuted,
  },
  signalCategorySpacer: {
    flex: 1,
  },
  signalRows: {
    paddingVertical: spacing.xs,
  },
  signalRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  signalRowOff: {
    opacity: 0.4,
  },
  signalName: {
    color: colors.textPrimary,
    flex: 1,
    fontFamily: MONO_FAMILY,
  },
  signalFooter: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  signalFooterText: {
    color: colors.textMuted,
    flex: 1,
  },
  signalFooterButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
