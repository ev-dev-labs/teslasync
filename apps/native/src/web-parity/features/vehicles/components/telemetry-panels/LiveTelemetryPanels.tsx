// Native parity port of
// web/src/features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx.
//
// The web original is a thin composition: a "Live Telemetry" section header with
// an animated live dot, then a responsive 2-column grid of seven panels —
// PowertrainPanel, ClimatePanel, SecurityPanel, VehicleStatePanel,
// TirePressurePanel, EnergyChargingPanel, MediaNavigationPanel — each wrapped in
// a framer-motion <FadeIn delay>. The public <LiveTelemetryPanels> prop surface
// (motorData, climateData, securityData, tireData, chargingTelemetry, mediaData,
// locationData, live, sseConnected, remoteStartEnabled) is preserved verbatim.
//
// The seven sibling panel components are NOT scheduled in the native conversion
// manifest (sparse file sampling) and have no native module, so — following the
// established native idiom (GlancePage inlines its StatusBadge/GlanceMetric/
// QuickAction sub-components locally rather than importing not-yet-converted
// shared ones) — every panel is reproduced here as a LOCAL sub-component using
// the shared native building blocks (GlassPanel, AppText, EmptyState,
// SemanticIcon, theme tokens) + RN primitives. Only <LiveTelemetryPanels> is
// exported, matching the source's single export.
//
// Browser-only / not-yet-ported web dependencies and how each is reproduced:
//   - framer-motion FadeIn (web/src/components/motion): no native entrance
//     animation — every FadeIn renders at its rest state (a plain View), the
//     established idiom; the per-panel `delay` values carry no native meaning.
//   - react-i18next useTranslation: not wired in native; a local English-default
//     `t(key, fallback)` keeps every common.*/telemetry.* key verbatim and returns
//     the same default string i18next would surface when the key is missing.
//   - @/hooks/useUnits + @/lib/unitConversion (formatTemperature/Speed/Pressure,
//     convertDistanceFromSI, unitPrefs) and @/lib/numberFormat (fmtNumber/fmtInt/
//     fmtWithUnit/safeNumber) and @/lib/cleanNil have no shared native module, so
//     the exact pieces each panel uses are inlined verbatim from the web sources
//     (SI-floor converters + Intl.NumberFormat formatters), deriving the user's
//     unit/locale/precision preferences from the native useSettings exactly as web
//     useUnits derives them (unit_of_length 'mi', unit_of_temp 'F',
//     unit_of_pressure 'psi', decimal_precision, locale).
//   - vehicle-detail/helpers TIRE_PRESSURE_PA + paToKpa: inlined verbatim (the Pa
//     thresholds and the Pa→kPa conversion formatPressure expects).
//   - lucide-react icons (Cog/Thermometer/Shield/Activity/Gauge/BatteryCharging/
//     Headphones, plus per-row Lock/Eye/Fan/…): no native icon font, so each panel
//     header uses the shared SemanticIcon glyph; the small purely-decorative
//     per-row icons are dropped (text labels are preserved), a documented parity
//     trade-off consistent with other ported pages.
//   - @/components/ui GlassPanel/Badge, @/components/data-display MetricCard,
//     @/components/feedback EmptyState → native GlassPanel + EmptyState are used
//     directly; Badge/MetricCard are reproduced as local Chip/MetricTile.
//   - Tailwind className styling → React Native StyleSheet; the responsive
//     lg:grid-cols-2 grid collapses to a single mobile-first column.
//
// Data semantics, value math, null-safety, state names, and quirks are preserved
// byte-faithfully from the source panels (e.g. EnergyCharging formats raw watts/Wh
// with kW/kWh suffixes, and converts range_added_meters_per_hour / 3600 through
// formatSpeed, exactly as web does). No DOM, framer-motion, lucide-react,
// Recharts, Leaflet, or old web UI components are imported.

import React, {useMemo} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {
  ChargingTelemetry,
  ClimateSnapshot,
  LocationSnapshot,
  MediaSnapshot,
  MotorSnapshot,
  SecurityEvent,
  TirePressureSnapshot,
} from '../../../../api/types';

/* ─── i18n fallback (react-i18next is not wired in native) ─────────────────── */

// i18next returns the supplied default when a key is missing; this fallback
// returns the English default while keeping every common.*/telemetry.* key
// verbatim from the web source.
function t(_key: string, fallback: string): string {
  return fallback;
}

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ──────── */

type DistanceUnitPref = 'km' | 'mi';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '°C' | '°F';
// web useUnits only ever derives 'psi' | 'bar' (never kPa) from settings.
type PressureUnitPref = 'psi' | 'bar';

interface UnitPref {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  temperature: TemperatureUnitPref;
  pressure: PressureUnitPref;
  locale: string;
  /** Resolved user precision; undefined falls back to the per-quantity default. */
  precision?: number;
}

// NIST-grade factors, verbatim from web lib/unitConversion.
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const KPA_PER_PSI = 6.894757;
const KPA_PER_BAR = 100;
const SECONDS_PER_HOUR = 3600;

const DEFAULT_EMPTY_DISPLAY = '—';
// Per-quantity default precision when settings.decimal_precision is unset.
const DEFAULT_PRECISION = {
  speed: 0,
  temperature: 1,
  pressure: 1,
} as const;
// numberFormat global default precision (web setGlobalPrecision default).
const DEFAULT_NUMBER_PRECISION = 2;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// Pure SI -> display converters, verbatim from web lib/unitConversion.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  return to === 'mph'
    ? (mps * SECONDS_PER_HOUR) / METERS_PER_MILE
    : (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
}

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  return to === '°F' ? (celsius * 9) / 5 + 32 : celsius;
}

function convertPressureFromSI(kpa: number, to: PressureUnitPref): number {
  return to === 'psi' ? kpa / KPA_PER_PSI : kpa / KPA_PER_BAR;
}

function formatNumber(
  value: number,
  locale: string,
  fractionDigits: number,
): string {
  const options = {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  };
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    // Bad locale tag — fall back to en-US so we still produce a string.
    return new Intl.NumberFormat('en-US', options).format(value);
  }
}

function formatTemperature(
  celsius: number | null | undefined,
  pref: UnitPref,
): string {
  if (!isFiniteNumber(celsius)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const digits = pref.precision ?? DEFAULT_PRECISION.temperature;
  const value = convertTempFromSI(celsius, pref.temperature);
  // No space between number and °unit (typographic convention).
  return `${formatNumber(value, pref.locale, digits)}${pref.temperature}`;
}

function formatSpeed(
  mps: number | null | undefined,
  pref: UnitPref,
): string {
  if (!isFiniteNumber(mps)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const digits = pref.precision ?? DEFAULT_PRECISION.speed;
  const value = convertSpeedFromSI(mps, pref.speed);
  return `${formatNumber(value, pref.locale, digits)} ${pref.speed}`;
}

function formatPressure(
  kpa: number | null | undefined,
  pref: UnitPref,
): string {
  if (!isFiniteNumber(kpa)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const digits = pref.precision ?? DEFAULT_PRECISION.pressure;
  const value = convertPressureFromSI(kpa, pref.pressure);
  return `${formatNumber(value, pref.locale, digits)} ${pref.pressure}`;
}

// Mirrors web lib/cleanNil: filters Go nil string representations.
function cleanNil(v?: string | null): string | undefined {
  if (!v || v === '<nil>' || v === 'nil' || v === 'null') {
    return undefined;
  }
  return v;
}

/* ─── Tire-pressure thresholds (verbatim from vehicle-detail/helpers) ───────── */

// Backend tire-pressure SI baseline is Pascals; all comparisons live in Pa.
const TIRE_PRESSURE_PA = {
  LOW_CRITICAL: 206_800,
  LOW_WARNING: 241_300,
  HIGH_WARNING: 310_300,
  HIGH_CRITICAL: 344_700,
} as const;

// 1 kPa = 1000 Pa. formatPressure expects kPa input.
function paToKpa(pa: number | null | undefined): number | null {
  if (pa == null || !Number.isFinite(pa)) {
    return null;
  }
  return pa / 1000;
}

/* ─── Bound per-render unit formatters (mirror web useUnits hook) ───────────── */

interface TelemetryUnits {
  unitPrefs: UnitPref;
  formatTemperature: (v: number | null | undefined) => string;
  formatSpeed: (v: number | null | undefined) => string;
  formatPressure: (v: number | null | undefined) => string;
  fmtNumber: (v: unknown, decimals?: number) => string;
  fmtInt: (v: unknown) => string;
  fmtWithUnit: (v: unknown, unit: string) => string;
}

function useTelemetryUnits(): TelemetryUnits {
  const {data: settings} = useSettings();
  const unitOfLength = settings?.unit_of_length;
  const unitOfTemp = settings?.unit_of_temp;
  const unitOfPressure = settings?.unit_of_pressure;
  const localeRaw = settings?.locale;
  const decimal = settings?.decimal_precision;

  return useMemo<TelemetryUnits>(() => {
    const locale =
      typeof localeRaw === 'string' && localeRaw.trim() ? localeRaw : 'en-US';
    const precision =
      typeof decimal === 'number' && Number.isFinite(decimal) && decimal >= 0
        ? Math.floor(decimal)
        : undefined;
    // numberFormat global precision: user value if set, else default 2.
    const numberPrecision = precision ?? DEFAULT_NUMBER_PRECISION;

    const pref: UnitPref = {
      distance: unitOfLength === 'mi' ? 'mi' : 'km',
      speed: unitOfLength === 'mi' ? 'mph' : 'km/h',
      temperature: unitOfTemp === 'F' ? '°F' : '°C',
      pressure: unitOfPressure === 'psi' ? 'psi' : 'bar',
      locale,
      precision,
    };

    const fmtNumber = (v: unknown, decimals?: number): string =>
      formatNumber(safeNumber(v), locale, decimals ?? numberPrecision);

    return {
      unitPrefs: pref,
      formatTemperature: v => formatTemperature(v, pref),
      formatSpeed: v => formatSpeed(v, pref),
      formatPressure: v => formatPressure(v, pref),
      fmtNumber,
      fmtInt: v => fmtNumber(v, 0),
      fmtWithUnit: (v, unit) => `${fmtNumber(v)} ${unit}`,
    };
  }, [unitOfLength, unitOfTemp, unitOfPressure, localeRaw, decimal]);
}

/* ─── Shared presentational primitives ─────────────────────────────────────── */

type ToneName =
  | 'success'
  | 'emerald'
  | 'warning'
  | 'danger'
  | 'cyan'
  | 'blue'
  | 'violet'
  | 'neutral';

interface ToneTokens {
  text: string;
  surface: string;
  border: string;
}

// Toned-down chip palette resolved to literals (mirrors the web tailwind
// border-*/30 + bg-*/10 + text-*-400/300 semantics).
const TONE: Record<ToneName, ToneTokens> = {
  success: {
    text: '#4ade80',
    surface: 'rgba(34, 197, 94, 0.10)',
    border: 'rgba(34, 197, 94, 0.30)',
  },
  emerald: {
    text: '#6ee7b7',
    surface: 'rgba(16, 185, 129, 0.10)',
    border: 'rgba(16, 185, 129, 0.30)',
  },
  warning: {
    text: '#fbbf24',
    surface: 'rgba(245, 158, 11, 0.10)',
    border: 'rgba(245, 158, 11, 0.30)',
  },
  danger: {
    text: '#fb7185',
    surface: 'rgba(239, 68, 68, 0.10)',
    border: 'rgba(239, 68, 68, 0.30)',
  },
  cyan: {
    text: '#67e8f9',
    surface: 'rgba(6, 182, 212, 0.10)',
    border: 'rgba(6, 182, 212, 0.30)',
  },
  blue: {
    text: '#60a5fa',
    surface: 'rgba(59, 130, 246, 0.10)',
    border: 'rgba(59, 130, 246, 0.30)',
  },
  violet: {
    text: '#a78bfa',
    surface: 'rgba(168, 85, 247, 0.10)',
    border: 'rgba(168, 85, 247, 0.30)',
  },
  neutral: {
    text: colors.textMuted,
    surface: 'rgba(255, 255, 255, 0.02)',
    border: 'rgba(255, 255, 255, 0.06)',
  },
};

function Chip({label, tone}: {label: string; tone: ToneName}) {
  const c = TONE[tone];
  return (
    <View style={[styles.chip, {backgroundColor: c.surface, borderColor: c.border}]}>
      <AppText variant="caption" weight="semibold" style={{color: c.text}}>
        {label}
      </AppText>
    </View>
  );
}

interface PanelShellProps {
  icon: SemanticIconName;
  title: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}

function PanelShell({icon, title, headerRight, children, testID}: PanelShellProps) {
  return (
    <GlassPanel style={styles.panel} testID={testID}>
      <View style={styles.panelHeader}>
        <SemanticIcon name={icon} size="sm" decorative />
        <AppText variant="body" weight="bold" style={styles.panelTitle}>
          {title}
        </AppText>
        {headerRight ? <View style={styles.panelHeaderRight}>{headerRight}</View> : null}
      </View>
      {children}
    </GlassPanel>
  );
}

function MetricTile({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <View style={styles.metricTile}>
      <AppText
        variant="caption"
        tone="muted"
        weight="semibold"
        numberOfLines={1}
        style={styles.metricTileLabel}>
        {label}
      </AppText>
      <AppText variant="title" weight="bold" numberOfLines={1}>
        {value}
      </AppText>
      {subtitle ? (
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

function StatRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string | number;
  valueColor?: string;
}) {
  return (
    <View style={styles.row}>
      <AppText variant="caption" tone="muted" style={styles.rowLabel}>
        {label}
      </AppText>
      <AppText
        variant="caption"
        weight="semibold"
        style={[styles.rowValue, valueColor ? {color: valueColor} : null]}>
        {value}
      </AppText>
    </View>
  );
}

function PanelMessage({message}: {message: string}) {
  return (
    <AppText variant="caption" tone="muted" style={styles.panelMessage}>
      {message}
    </AppText>
  );
}

function pctWidth(n: number): DimensionValue {
  return `${n}%` as DimensionValue;
}

/* ─── Powertrain panel ─────────────────────────────────────────────────────── */

function PowertrainPanel({
  motorData,
}: {
  motorData: MotorSnapshot | null | undefined;
}) {
  const {formatTemperature: fmtTemp, fmtNumber, fmtInt} = useTelemetryUnits();

  const maxMotorTemp = motorData
    ? Math.max(
        motorData.motor_temp_c_front ?? -Infinity,
        motorData.motor_temp_c_rear ?? -Infinity,
      )
    : null;

  const power = motorData?.power_kw;

  let shiftTone: ToneName = 'neutral';
  if (motorData?.shift_state === 'D') {
    shiftTone = 'success';
  } else if (motorData?.shift_state === 'R') {
    shiftTone = 'danger';
  } else if (motorData?.shift_state === 'N') {
    shiftTone = 'warning';
  }

  return (
    <PanelShell icon="settings" title={t('common.powertrain', 'Powertrain')} testID="powertrain-panel">
      {motorData ? (
        <View style={styles.stack}>
          {/* Shift state badge */}
          <View style={styles.row}>
            <AppText variant="caption" tone="muted" style={styles.rowLabel}>
              {t('telemetry.shiftState', 'Shift State')}
            </AppText>
            <Chip
              tone={shiftTone}
              label={motorData.shift_state ?? t('common.unknown', 'Unknown')}
            />
          </View>

          {/* Power */}
          <View>
            <View style={styles.row}>
              <AppText variant="caption" tone="muted">
                {t('telemetry.power', 'Power')}
              </AppText>
              <AppText variant="caption" weight="semibold" style={styles.mono}>
                {power != null ? fmtNumber(power) : '—'} kW
              </AppText>
            </View>
            <View style={styles.powerTrack}>
              <View style={styles.powerCenterTick} />
              {power != null ? (
                <View
                  style={[
                    styles.powerFill,
                    power >= 0 ? styles.powerFillPos : styles.powerFillNeg,
                    {width: pctWidth(Math.min((Math.abs(power) / 300) * 50, 50))},
                  ]}
                />
              ) : null}
            </View>
            <View style={styles.powerScale}>
              <AppText variant="caption" tone="muted">
                -300
              </AppText>
              <AppText variant="caption" tone="muted">
                0
              </AppText>
              <AppText variant="caption" tone="muted">
                +300
              </AppText>
            </View>
          </View>

          {/* Motor RPM */}
          <View style={styles.metricGrid}>
            <MetricTile
              label={t('telemetry.rpmFront', 'Front RPM')}
              value={motorData.motor_rpm_front != null ? fmtInt(motorData.motor_rpm_front) : '—'}
              subtitle="RPM"
            />
            <MetricTile
              label={t('telemetry.rpmRear', 'Rear RPM')}
              value={motorData.motor_rpm_rear != null ? fmtInt(motorData.motor_rpm_rear) : '—'}
              subtitle="RPM"
            />
          </View>

          {/* Torque split */}
          <View style={styles.metricGrid}>
            <MetricTile
              label={t('telemetry.torqueFront', 'Front Torque')}
              value={motorData.torque_nm_front != null ? fmtNumber(motorData.torque_nm_front) : '—'}
              subtitle="Nm"
            />
            <MetricTile
              label={t('telemetry.torqueRear', 'Rear Torque')}
              value={motorData.torque_nm_rear != null ? fmtNumber(motorData.torque_nm_rear) : '—'}
              subtitle="Nm"
            />
          </View>

          {/* Temperatures */}
          <StatRow
            label={t('telemetry.motorTemp', 'Motor Temp (peak)')}
            value={
              maxMotorTemp != null && isFinite(maxMotorTemp)
                ? fmtTemp(maxMotorTemp)
                : '—'
            }
            valueColor={
              maxMotorTemp != null && isFinite(maxMotorTemp) && maxMotorTemp > 80
                ? TONE.danger.text
                : undefined
            }
          />
          <StatRow
            label={t('telemetry.inverterTemp', 'Inverter Temp')}
            value={fmtTemp(motorData.inverter_temp_c)}
          />

          {/* Regen */}
          <StatRow
            label={t('telemetry.regen', 'Regen')}
            value={motorData.regen_kw != null ? `${fmtNumber(motorData.regen_kw)} kW` : '—'}
            valueColor={TONE.success.text}
          />
        </View>
      ) : (
        <EmptyState title="" message={t('telemetry.noMotorData', 'No motor data available')} />
      )}
    </PanelShell>
  );
}

/* ─── Climate panel ────────────────────────────────────────────────────────── */

const FAN_BAR_WIDTHS = [6, 8, 10, 12, 14, 16];

function ClimatePanel({
  climateData,
}: {
  climateData: ClimateSnapshot | null | undefined;
}) {
  const {formatTemperature: fmtTemp} = useTelemetryUnits();

  return (
    <PanelShell icon="climate" title={t('common.climate', 'Climate')} testID="climate-panel">
      {climateData ? (
        <View style={styles.stack}>
          {/* Cabin + Outside temps */}
          <View style={styles.metricGrid}>
            <MetricTile
              label={t('common.insideTemp', 'Cabin')}
              value={fmtTemp(climateData.inside_temp_c)}
            />
            <MetricTile
              label={t('common.outsideTemp', 'Outside')}
              value={fmtTemp(climateData.outside_temp_c)}
            />
          </View>

          {/* Target temps */}
          <View style={styles.metricGrid}>
            <View style={styles.flex1}>
              <StatRow
                label={t('telemetry.driverSetpoint', 'Driver Setpoint')}
                value={fmtTemp(climateData.driver_setpoint_c)}
              />
            </View>
            <View style={styles.flex1}>
              <StatRow
                label={t('telemetry.passengerSetpoint', 'Passenger Setpoint')}
                value={fmtTemp(climateData.passenger_setpoint_c)}
              />
            </View>
          </View>

          {/* HVAC State */}
          <StatRow
            label={t('telemetry.hvacState', 'HVAC State')}
            value={climateData.hvac_state ?? '—'}
          />

          {/* Fan Speed */}
          <View style={styles.row}>
            <AppText variant="caption" tone="muted" style={styles.rowLabel}>
              {t('telemetry.fanSpeed', 'Fan Speed')}
            </AppText>
            <View style={styles.fanRow}>
              {FAN_BAR_WIDTHS.map((width, index) => {
                const level = index + 1;
                const on = (climateData.fan_status ?? 0) >= level;
                return (
                  <View
                    key={level}
                    style={[
                      styles.fanBar,
                      {width},
                      on ? styles.fanBarOn : styles.fanBarOff,
                    ]}
                  />
                );
              })}
              <AppText variant="caption" weight="semibold" style={styles.fanValue}>
                {climateData.fan_status ?? 0}
              </AppText>
            </View>
          </View>

          {/* System badges */}
          <View style={styles.chipWrap}>
            <Chip
              tone={
                climateData.defrost_mode && climateData.defrost_mode !== 'Off'
                  ? 'blue'
                  : 'neutral'
              }
              label={`${t('telemetry.defrost', 'Defrost')} ${
                climateData.defrost_mode && climateData.defrost_mode !== 'Off'
                  ? climateData.defrost_mode
                  : t('common.off', 'Off')
              }`}
            />
            <Chip
              tone={climateData.is_climate_on ? 'success' : 'neutral'}
              label={`${t('telemetry.climate', 'Climate')} ${
                climateData.is_climate_on ? t('common.on', 'On') : t('common.off', 'Off')
              }`}
            />
            <Chip
              tone={climateData.is_preconditioning ? 'warning' : 'neutral'}
              label={`${t('telemetry.precondition', 'Precondition')} ${
                climateData.is_preconditioning
                  ? t('common.on', 'On')
                  : t('common.off', 'Off')
              }`}
            />
          </View>
        </View>
      ) : (
        <EmptyState title="" message={t('telemetry.noClimateData', 'No climate data available')} />
      )}
    </PanelShell>
  );
}

/* ─── Security panel ───────────────────────────────────────────────────────── */

function SecurityPanel({
  securityData,
  remoteStartEnabled,
}: {
  securityData: SecurityEvent | null | undefined;
  remoteStartEnabled?: boolean | null;
}) {
  const hasData = securityData != null || remoteStartEnabled != null;

  let remoteStartLabel = '—';
  let remoteStartColor: string | undefined;
  if (remoteStartEnabled != null) {
    remoteStartLabel = remoteStartEnabled
      ? t('common.enabled', 'Enabled')
      : t('common.disabled', 'Disabled');
    remoteStartColor = remoteStartEnabled ? TONE.success.text : undefined;
  }

  return (
    <PanelShell icon="security" title={t('common.security', 'Security')} testID="security-panel">
      {hasData ? (
        <View style={styles.stack}>
          {securityData ? (
            <>
              {/* Lock status */}
              <View style={styles.lockRow}>
                <View
                  style={[
                    styles.lockBox,
                    {
                      backgroundColor: securityData.locked
                        ? TONE.success.surface
                        : TONE.warning.surface,
                      borderColor: securityData.locked
                        ? TONE.success.border
                        : TONE.warning.border,
                    },
                  ]}>
                  <SemanticIcon
                    name={securityData.locked ? 'locked' : 'unlocked'}
                    size="md"
                    decorative
                  />
                </View>
                <View style={styles.flex1}>
                  <AppText
                    variant="title"
                    weight="bold"
                    style={{
                      color: securityData.locked
                        ? TONE.success.text
                        : TONE.warning.text,
                    }}>
                    {securityData.locked
                      ? t('common.locked', 'Locked')
                      : t('common.unlocked', 'Unlocked')}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {t('telemetry.lockStatus', 'Vehicle lock status')}
                  </AppText>
                </View>
              </View>

              {/* Sentry Mode */}
              <View style={styles.row}>
                <AppText variant="caption" tone="muted" style={styles.rowLabel}>
                  {t('telemetry.sentryMode', 'Sentry Mode')}
                </AppText>
                <Chip
                  tone={securityData.sentry_mode ? 'danger' : 'neutral'}
                  label={
                    securityData.sentry_mode
                      ? t('common.active', 'Active')
                      : t('common.inactive', 'Inactive')
                  }
                />
              </View>

              {/* Doors */}
              <StatRow
                label={t('telemetry.doors', 'Doors')}
                value={securityData.doors_open ?? t('common.closed', 'Closed')}
              />

              {/* Windows */}
              <StatRow
                label={t('telemetry.windows', 'Windows')}
                value={securityData.windows_open ?? t('common.closed', 'Closed')}
              />

              {/* User presence */}
              <StatRow
                label={t('telemetry.userPresent', 'User Present')}
                value={
                  securityData.user_present
                    ? t('common.yes', 'Yes')
                    : t('common.no', 'No')
                }
                valueColor={securityData.user_present ? TONE.success.text : undefined}
              />

              {securityData.detail ? (
                <AppText variant="caption" tone="muted" style={styles.detailText}>
                  {securityData.detail}
                </AppText>
              ) : null}
            </>
          ) : null}

          {/* Remote Start access */}
          <StatRow
            label={t('telemetry.remoteStart', 'Remote Start')}
            value={remoteStartLabel}
            valueColor={remoteStartColor}
          />
        </View>
      ) : (
        <EmptyState
          title=""
          message={t('telemetry.noSecurityData', 'No security data available')}
        />
      )}
    </PanelShell>
  );
}

/* ─── Vehicle state panel ──────────────────────────────────────────────────── */

function VehicleStatePanel({
  live,
  sseConnected,
}: {
  live: Record<string, unknown>;
  sseConnected: boolean;
}) {
  const {formatSpeed: fmtSpeed} = useTelemetryUnits();

  return (
    <PanelShell
      icon="activity"
      title="Vehicle State"
      testID="vehicle-state-panel"
      headerRight={
        sseConnected ? (
          <View style={styles.liveTag}>
            <View style={styles.liveTagDot} />
            <AppText variant="caption" weight="semibold" style={styles.liveTagText}>
              Live
            </AppText>
          </View>
        ) : undefined
      }>
      <View style={styles.stackTight}>
        {/* Lights */}
        <StatRow
          label="High Beams"
          value={live.lightsHighBeams ? 'On' : 'Off'}
          valueColor={live.lightsHighBeams ? TONE.cyan.text : undefined}
        />
        <StatRow
          label="Turn Signal"
          value={(live.lightsTurnSignal as string) || 'Off'}
          valueColor={
            live.lightsTurnSignal && live.lightsTurnSignal !== 'Off'
              ? TONE.warning.text
              : undefined
          }
        />
        <StatRow
          label="Hazards"
          value={live.lightsHazards ? 'Active' : 'Off'}
          valueColor={live.lightsHazards ? TONE.danger.text : undefined}
        />

        <View style={styles.divider} />

        {/* Driver & Keys */}
        <StatRow
          label="Driver Seat"
          value={live.driverSeatOccupied ? 'Occupied' : 'Empty'}
          valueColor={live.driverSeatOccupied ? TONE.success.text : undefined}
        />
        <StatRow
          label="Paired Keys"
          value={(live.pairedKeyCount as string) || '—'}
        />

        <View style={styles.divider} />

        {/* Access Modes */}
        <StatRow
          label="Valet Mode"
          value={live.valetMode ? 'Enabled' : 'Off'}
          valueColor={live.valetMode ? TONE.violet.text : undefined}
        />
        <StatRow
          label="Service Mode"
          value={live.serviceMode ? 'Active' : 'Off'}
          valueColor={live.serviceMode ? TONE.warning.text : undefined}
        />
        <StatRow
          label="Speed Limit"
          value={
            live.speedLimitMode
              ? fmtSpeed(live.currentSpeedLimit as number)
              : t('common.off', 'Off')
          }
          valueColor={live.speedLimitMode ? TONE.cyan.text : undefined}
        />
        <StatRow label="Center Display" value={(live.centerDisplay as string) || '—'} />
        <StatRow
          label="HomeLink Devices"
          value={(live.homelinkDeviceCount as string) || '—'}
        />
      </View>
    </PanelShell>
  );
}

/* ─── Tire pressure panel ──────────────────────────────────────────────────── */

function tireTextColor(pa: number | null): string {
  if (pa == null) {
    return colors.textMuted;
  }
  if (pa < TIRE_PRESSURE_PA.LOW_CRITICAL || pa > TIRE_PRESSURE_PA.HIGH_CRITICAL) {
    return TONE.danger.text;
  }
  if (pa < TIRE_PRESSURE_PA.LOW_WARNING || pa > TIRE_PRESSURE_PA.HIGH_WARNING) {
    return TONE.warning.text;
  }
  return TONE.success.text;
}

function tireBorderColor(pa: number | null): string {
  if (pa == null) {
    return 'rgba(75, 85, 99, 0.30)';
  }
  if (pa < TIRE_PRESSURE_PA.LOW_CRITICAL || pa > TIRE_PRESSURE_PA.HIGH_CRITICAL) {
    return TONE.danger.border;
  }
  if (pa < TIRE_PRESSURE_PA.LOW_WARNING || pa > TIRE_PRESSURE_PA.HIGH_WARNING) {
    return TONE.warning.border;
  }
  return TONE.success.border;
}

function TirePressurePanel({
  tireData,
}: {
  tireData: TirePressureSnapshot | null | undefined;
}) {
  const {formatPressure: fmtPressure} = useTelemetryUnits();

  return (
    <PanelShell
      icon="tirePressure"
      title={t('common.tirePressure', 'Tire Pressure')}
      testID="tire-pressure-panel">
      {tireData ? (
        <TirePressureContent tireData={tireData} formatPressure={fmtPressure} />
      ) : (
        <PanelMessage message="No tire pressure data available" />
      )}
    </PanelShell>
  );
}

function TirePressureContent({
  tireData,
  formatPressure: fmtPressure,
}: {
  tireData: TirePressureSnapshot;
  formatPressure: (v: number | null | undefined) => string;
}) {
  const tires = [
    {label: 'FL', pa: tireData.front_left},
    {label: 'FR', pa: tireData.front_right},
    {label: 'RL', pa: tireData.rear_left},
    {label: 'RR', pa: tireData.rear_right},
  ];

  const allGood = tires.every(
    tire =>
      tire.pa != null &&
      tire.pa >= TIRE_PRESSURE_PA.LOW_WARNING &&
      tire.pa <= TIRE_PRESSURE_PA.HIGH_WARNING,
  );
  const anyBad = tires.some(
    tire =>
      tire.pa != null &&
      (tire.pa < TIRE_PRESSURE_PA.LOW_CRITICAL ||
        tire.pa > TIRE_PRESSURE_PA.HIGH_CRITICAL),
  );

  let statusTone: ToneName = 'warning';
  let statusLabel = '⚠ Check Pressure';
  if (allGood) {
    statusTone = 'success';
    statusLabel = '✓ All Normal';
  } else if (anyBad) {
    statusTone = 'danger';
    statusLabel = '✗ Attention Needed';
  }

  return (
    <View style={styles.stack}>
      <View style={styles.tireGrid}>
        {tires.map(tire => (
          <View
            key={tire.label}
            style={[styles.tireCell, {borderColor: tireBorderColor(tire.pa)}]}>
            <AppText variant="caption" tone="muted" style={styles.tireLabel}>
              {tire.label}
            </AppText>
            <AppText
              variant="title"
              weight="bold"
              style={[styles.mono, {color: tireTextColor(tire.pa)}]}>
              {fmtPressure(paToKpa(tire.pa))}
            </AppText>
          </View>
        ))}
      </View>
      <View style={styles.tireStatusRow}>
        <Chip tone={statusTone} label={statusLabel} />
      </View>
    </View>
  );
}

/* ─── Energy & charging panel ──────────────────────────────────────────────── */

function EnergyChargingPanel({
  chargingTelemetry,
}: {
  chargingTelemetry: ChargingTelemetry | null | undefined;
}) {
  const {formatSpeed: fmtSpeed, fmtNumber, fmtWithUnit} = useTelemetryUnits();

  let chargingTone: ToneName = 'neutral';
  if (chargingTelemetry?.charging_state === 'Charging') {
    chargingTone = 'cyan';
  } else if (chargingTelemetry?.charging_state === 'Complete') {
    chargingTone = 'success';
  }

  return (
    <PanelShell
      icon="batteryCharging"
      title={t('telemetry.energyCharging', 'Energy & Charging')}
      testID="energy-charging-panel">
      {chargingTelemetry ? (
        <View style={styles.stack}>
          <View style={styles.metricGrid}>
            <MetricTile
              label={t('telemetry.chargerVoltage', 'Charger Voltage')}
              value={
                chargingTelemetry.charger_voltage != null
                  ? fmtNumber(chargingTelemetry.charger_voltage)
                  : '—'
              }
              subtitle="V"
            />
            <MetricTile
              label={t('telemetry.chargerCurrent', 'Charger Current')}
              value={
                chargingTelemetry.charger_actual_current != null
                  ? fmtNumber(chargingTelemetry.charger_actual_current)
                  : '—'
              }
              subtitle="A"
            />
          </View>

          <StatRow
            label={t('telemetry.chargerPower', 'Charger Power')}
            value={
              chargingTelemetry.charger_power_w != null
                ? fmtWithUnit(chargingTelemetry.charger_power_w, 'kW')
                : '—'
            }
          />

          <StatRow
            label={t('telemetry.energyAdded', 'Energy Added')}
            value={
              chargingTelemetry.charge_energy_added_wh != null
                ? fmtWithUnit(chargingTelemetry.charge_energy_added_wh, 'kWh')
                : '—'
            }
          />

          {/* Charging State */}
          <View style={styles.row}>
            <AppText variant="caption" tone="muted" style={styles.rowLabel}>
              {t('telemetry.chargingState', 'Charging State')}
            </AppText>
            <Chip
              tone={chargingTone}
              label={chargingTelemetry.charging_state ?? t('common.unknown', 'Unknown')}
            />
          </View>

          {/* Battery level */}
          <StatRow
            label={t('telemetry.batteryLevel', 'Battery Level')}
            value={
              chargingTelemetry.battery_level != null
                ? `${fmtNumber(chargingTelemetry.battery_level)}%`
                : '—'
            }
          />

          {/* Charge rate */}
          <StatRow
            label={t('telemetry.chargeRate', 'Charge Rate')}
            value={
              chargingTelemetry.range_added_meters_per_hour != null
                ? fmtSpeed(chargingTelemetry.range_added_meters_per_hour / 3600)
                : '—'
            }
          />
        </View>
      ) : (
        <EmptyState
          title=""
          message={t('telemetry.noChargingTelemetry', 'No charging telemetry available')}
        />
      )}
    </PanelShell>
  );
}

/* ─── Media & navigation panel ─────────────────────────────────────────────── */

function MediaNavigationPanel({
  mediaData,
  locationData,
}: {
  mediaData: MediaSnapshot | null | undefined;
  locationData: LocationSnapshot | null | undefined;
}) {
  const {unitPrefs, fmtNumber, fmtInt} = useTelemetryUnits();
  const distanceUnit = unitPrefs.distance;
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);

  let playbackTone: ToneName = 'neutral';
  if (mediaData?.playback_status === 'Playing') {
    playbackTone = 'success';
  } else if (mediaData?.playback_status === 'Paused') {
    playbackTone = 'warning';
  }

  return (
    <PanelShell
      icon="headphones"
      title={t('telemetry.mediaNav', 'Media & Navigation')}
      testID="media-navigation-panel">
      <View style={styles.stackWide}>
        {/* Now Playing */}
        <View>
          <AppText variant="caption" tone="muted" style={styles.sectionLabel}>
            {t('telemetry.nowPlaying', 'Now Playing')}
          </AppText>
          {mediaData ? (
            <View style={styles.mediaCard}>
              <AppText variant="body" weight="bold" numberOfLines={1}>
                {cleanNil(mediaData.now_playing_title) ||
                  t('telemetry.nothingPlaying', 'Nothing playing')}
              </AppText>
              <AppText variant="caption" tone="secondary" numberOfLines={1}>
                {cleanNil(mediaData.now_playing_artist) ||
                  t('telemetry.unknownArtist', 'Unknown artist')}
              </AppText>
              <View style={styles.mediaMetaRow}>
                {cleanNil(mediaData.playback_source) ? (
                  <View style={styles.sourcePill}>
                    <AppText variant="caption" tone="muted">
                      {cleanNil(mediaData.playback_source)}
                    </AppText>
                  </View>
                ) : null}
                {cleanNil(mediaData.playback_status) ? (
                  <Chip
                    tone={playbackTone}
                    label={cleanNil(mediaData.playback_status) ?? ''}
                  />
                ) : null}
              </View>
            </View>
          ) : (
            <PanelMessage message={t('telemetry.noMediaData', 'No media data')} />
          )}
        </View>

        {/* Navigation destination */}
        <View>
          <AppText variant="caption" tone="muted" style={styles.sectionLabel}>
            {t('telemetry.navigation', 'Navigation')}
          </AppText>
          {locationData ? (
            <View style={styles.stackTight}>
              {locationData.destination_name ? (
                <View style={styles.mediaCard}>
                  <AppText variant="body" weight="bold" numberOfLines={1}>
                    {locationData.destination_name}
                  </AppText>
                  <View style={styles.navMetaRow}>
                    {locationData.miles_to_arrival != null ? (
                      <AppText variant="caption" tone="secondary">
                        {fmtNumber(toDistanceDisplay(locationData.miles_to_arrival))}{' '}
                        {distanceUnit}
                      </AppText>
                    ) : null}
                    {locationData.minutes_to_arrival != null ? (
                      <AppText variant="caption" tone="secondary">
                        {fmtInt(locationData.minutes_to_arrival)}{' '}
                        {t('common.minShort', 'min')}
                      </AppText>
                    ) : null}
                  </View>
                </View>
              ) : (
                <PanelMessage
                  message={t('telemetry.noActiveDestination', 'No active destination')}
                />
              )}
              <View style={styles.chipWrap}>
                {locationData.located_at_home ? (
                  <Chip tone="success" label={`🏠 ${t('telemetry.placeHome', 'Home')}`} />
                ) : null}
                {locationData.located_at_work ? (
                  <Chip tone="blue" label={`🏢 ${t('telemetry.placeWork', 'Work')}`} />
                ) : null}
                {locationData.located_at_favorite ? (
                  <Chip
                    tone="violet"
                    label={`⭐ ${t('telemetry.placeFavorite', 'Favorite')}`}
                  />
                ) : null}
              </View>
            </View>
          ) : (
            <PanelMessage message={t('telemetry.noLocationData', 'No location data')} />
          )}
        </View>
      </View>
    </PanelShell>
  );
}

/* ─── Public composition ───────────────────────────────────────────────────── */

interface LiveTelemetryProps {
  motorData: MotorSnapshot | null | undefined;
  climateData: ClimateSnapshot | null | undefined;
  securityData: SecurityEvent | null | undefined;
  tireData: TirePressureSnapshot | null | undefined;
  chargingTelemetry: ChargingTelemetry | null | undefined;
  mediaData: MediaSnapshot | null | undefined;
  locationData: LocationSnapshot | null | undefined;
  live: Record<string, unknown>;
  sseConnected: boolean;
  remoteStartEnabled?: boolean | null;
}

export function LiveTelemetryPanels({
  motorData,
  climateData,
  securityData,
  tireData,
  chargingTelemetry,
  mediaData,
  locationData,
  live,
  sseConnected,
  remoteStartEnabled,
}: LiveTelemetryProps) {
  return (
    <View style={styles.root} testID="live-telemetry-panels">
      {/* Section header with live indicator. FadeIn renders at rest on native. */}
      <View style={styles.sectionHeader}>
        <View style={styles.liveDot} />
        <AppText variant="title" weight="bold">
          {t('common.liveTelemetry', 'Live Telemetry')}
        </AppText>
      </View>

      {/* Web lg:grid-cols-2 collapses to a single mobile-first column. */}
      <View style={styles.grid}>
        <PowertrainPanel motorData={motorData} />
        <ClimatePanel climateData={climateData} />
        <SecurityPanel securityData={securityData} remoteStartEnabled={remoteStartEnabled} />
        <VehicleStatePanel live={live} sseConnected={sseConnected} />
        <TirePressurePanel tireData={tireData} />
        <EnergyChargingPanel chargingTelemetry={chargingTelemetry} />
        <MediaNavigationPanel mediaData={mediaData} locationData={locationData} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  liveDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success,
  },
  grid: {
    gap: spacing.lg,
  },
  panel: {
    padding: spacing.lg,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  panelTitle: {
    flex: 1,
  },
  panelHeaderRight: {
    marginLeft: 'auto',
  },
  panelMessage: {
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  stack: {
    gap: spacing.md,
  },
  stackTight: {
    gap: spacing.sm,
  },
  stackWide: {
    gap: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowLabel: {
    flexShrink: 1,
  },
  rowValue: {
    color: colors.textPrimary,
    textAlign: 'right',
    flexShrink: 1,
  },
  mono: {
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  flex1: {
    flex: 1,
  },
  metricGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metricTile: {
    flex: 1,
    minWidth: 0,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    gap: 2,
  },
  metricTileLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  powerTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    overflow: 'hidden',
    position: 'relative',
    marginTop: spacing.xs,
  },
  powerCenterTick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  powerFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 999,
  },
  powerFillPos: {
    left: '50%',
    backgroundColor: 'rgba(34, 197, 94, 0.60)',
  },
  powerFillNeg: {
    right: '50%',
    backgroundColor: 'rgba(239, 68, 68, 0.60)',
  },
  powerScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  fanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  fanBar: {
    height: 12,
    borderRadius: 3,
  },
  fanBarOn: {
    backgroundColor: 'rgba(53, 213, 255, 0.70)',
  },
  fanBarOff: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  fanValue: {
    color: colors.textPrimary,
    marginLeft: spacing.xs,
  },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  lockBox: {
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
  },
  detailText: {
    fontStyle: 'italic',
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  liveTagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  liveTagText: {
    color: '#6ee7b7',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  tireGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tireCell: {
    width: '47%',
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  tireLabel: {
    letterSpacing: 0.5,
  },
  tireStatusRow: {
    alignItems: 'center',
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  mediaCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    padding: spacing.md,
    gap: spacing.xs,
  },
  mediaMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  navMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  sourcePill: {
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
});
