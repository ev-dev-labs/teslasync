// Native parity port of web/src/features/vehicles/components/VehicleCard.tsx.
//
// A single fleet vehicle card: a thin multi-colour accent strip, a stylised car
// visualisation, an info column (name link + status badge, model/trim/VIN
// subtitle, and a live-stats row of battery ring / range / interior temp /
// odometer / charging power / lock + sentry indicators), and a right-hand action
// column (view-details link + remove button). Every state name, API field,
// unit-handling path, i18n key + default, and the `state &&` stats guard is
// preserved.
//
// React Native has no DOM, react-router-dom <Link>, lucide-react SVG icons,
// framer-motion, CSS gradients, Tailwind, or the web shared ui/data-display
// components, so the web tree is reproduced with native View/Pressable/AppText/
// GlassPanel/SemanticIcon layers + theme tokens.
//
// Browser-only / not-yet-ported web dependencies and how each is reproduced:
//   - react-router-dom <Link to={`/vehicles/${id}`}> (web L1, L56-61, L129-135):
//     React Native has no DOM router, so — following the committed native idiom
//     (QuickLinksSection, ChargingSessionCard) — each link becomes an accessible
//     Pressable with accessibilityRole="link" and accessibilityValue.text = the
//     destination path, preserving the exact `to` target. Navigation itself is
//     the host screen's responsibility.
//   - lucide-react ExternalLink/Trash2/Lock/Shield (web L2): no native icon
//     font, so ExternalLink -> shared SemanticIcon 'externalLink' (accent),
//     Trash2 -> SemanticIcon 'delete' (danger); the two tiny inline status
//     indicators map to colour-toned glyphs — Lock -> 'LK' (colors.success,
//     matching web text-green-500), Shield/sentry -> 'SH' (colors.accent,
//     matching web text-cyan-400) — the documented GuardModeWidget glyph idiom
//     ('SC'/'SO'), and the same two-letter convention SemanticIcon uses for
//     'locked'/'security'.
//   - react-i18next useTranslation('vehicles') (web L3): not wired natively; a
//     local English-default t(key, fallback) returns the same default i18next
//     surfaces for a missing key, keeping every card.* key verbatim.
//   - @/components/ui GlassPanel (web L4) -> shared native GlassPanel. The web
//     hover `glow="cyan"`, group-hover opacity transitions, and the
//     `bg-gradient-to-r` accent strip are hover/CSS-gradient-only; the strip is
//     approximated with three equal cyan/violet/green segments and the
//     hover/glow affordances render statically (accepted-for-parity).
//   - @/components/ui Button variant="ghost" size="sm" (web L5, L136-144) -> a
//     native Pressable carrying onPress={() => onDelete(vehicle)} + the
//     removeVehicle accessibility label.
//   - @/components/data-display StatusBadge (web L6) -> local native StatusBadge:
//     a rounded pill with a per-status dot colour (mirroring the web FSM
//     badgeDot map: driving=blue, charging=yellow, parked=cyan, updating=indigo,
//     asleep=purple, online=green, offline=red) + the capitalised status label.
//   - @/components/data-display ProgressRing (web L7) -> local native ProgressRing
//     drawn with positioned arc segments (the RadialGauge native idiom — no SVG
//     stroke-dash in RN), preserving value/max/size/strokeWidth/color/label.
//   - @/components/data-display TeslaCarViz + parseModelKey (web L8) -> local
//     native TeslaCarViz (View-drawn side-profile car: body + cabin + two wheels
//     + a battery-level bar tinted by batteryColor, with charging/sentry/lock
//     glyph overlays); parseModelKey is inlined verbatim.
//   - @/hooks/useUnits (web L9) -> inline useUnits deriving distance/temperature/
//     locale/precision from the native useSettings exactly as web useUnits does,
//     exposing unitPrefs + formatDistance + formatTemperature that delegate to
//     the inlined SI formatters.
//   - @/api/hooks/useVehicles useVehicleState + getVehicleStatus (web L10) ->
//     imported from the native useVehicles parity hook.
//   - @/lib/unitConversion convertDistanceFromSI + formatDistance/
//     formatTemperature (web L11) -> inlined verbatim (NIST metre constants,
//     Celsius->Fahrenheit, Intl.NumberFormat, DEFAULT_PRECISION distance/
//     temperature = 1, '—' empty fallback).
//   - @/lib/numberFormat fmtInt (web L12) -> inlined (fmtNumber(v, 0) with the
//     same safeNumber guard + en-US grouping).
//   - @/lib/colors batteryColor (web L13) -> inlined verbatim (>60 good / >25
//     warn / else bad).
//   - @/api/types Vehicle + VehicleState (web L14-15) -> imported type-only from
//     the native web-parity api/types.
//
// No DOM, react-router-dom, lucide-react, Recharts, Leaflet, framer-motion, or
// old web UI components are imported — only React Native primitives + shared
// native AppText/GlassPanel/SemanticIcon/tokens and the native useVehicles/
// useSettings parity hooks.

import React, {useCallback, useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useSettings} from '../../../api/hooks/useSettings';
import {getVehicleStatus, useVehicleState} from '../../../api/hooks/useVehicles';
import type {Vehicle, VehicleState} from '../../../api/types';

/* ─── i18n fallback (react-i18next is not wired in native) ─────────────────── */

// i18next returns the supplied default when a key is missing; this fallback
// returns the English default while keeping every card.* key verbatim.
function t(_key: string, fallback: string): string {
  return fallback;
}

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ─────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type TemperatureUnitPref = '°C' | '°F';

interface UnitPrefs {
  distance: DistanceUnitPref;
  temperature: TemperatureUnitPref;
  locale?: string;
  precision?: number;
}

// NIST metre constants (web lib/unitConversion).
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;
const DEFAULT_EMPTY_DISPLAY = '—';
const DEFAULT_DISTANCE_PRECISION = 1;
const DEFAULT_TEMPERATURE_PRECISION = 1;
const DEFAULT_LOCALE = 'en-US';

// Pure SI -> display converter, verbatim from web lib/unitConversion.
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

// Verbatim from web lib/unitConversion.convertTempFromSI.
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Locale-aware grouping, verbatim from web lib/numberFormat/unitConversion.
function formatNumber(
  value: number,
  locale: string | undefined,
  fractionDigits: number,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  }
}

function resolvePrecision(prefs: UnitPrefs, fallback: number): number {
  if (
    typeof prefs.precision === 'number' &&
    Number.isFinite(prefs.precision) &&
    prefs.precision >= 0
  ) {
    return Math.floor(prefs.precision);
  }
  return fallback;
}

// web lib/unitConversion.formatDistance (space before the unit suffix).
function formatDistance(
  meters: number | null | undefined,
  prefs: UnitPrefs,
): string {
  if (!isFiniteNumber(meters)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const digits = resolvePrecision(prefs, DEFAULT_DISTANCE_PRECISION);
  const value = convertDistanceFromSI(meters, prefs.distance);
  return `${formatNumber(value, prefs.locale, digits)} ${prefs.distance}`;
}

// web lib/unitConversion.formatTemperature (no space before the °unit suffix).
function formatTemperature(
  celsius: number | null | undefined,
  prefs: UnitPrefs,
): string {
  if (!isFiniteNumber(celsius)) {
    return DEFAULT_EMPTY_DISPLAY;
  }
  const digits = resolvePrecision(prefs, DEFAULT_TEMPERATURE_PRECISION);
  const value = convertTempFromSI(celsius, prefs.temperature);
  return `${formatNumber(value, prefs.locale, digits)}${prefs.temperature}`;
}

// web lib/numberFormat.fmtInt -> fmtNumber(v, 0).
function fmtInt(v: unknown): string {
  return formatNumber(safeNumber(v), DEFAULT_LOCALE, 0);
}

// Mirrors web useUnits: derive prefs from useSettings exactly as web's
// deriveDistance / deriveTemperature / deriveLocale / derivePrecision do, and
// expose only the formatters this card consumes (distance + temperature).
function useUnits(): {
  unitPrefs: UnitPrefs;
  formatDistance: (value: number | null | undefined) => string;
  formatTemperature: (value: number | null | undefined) => string;
} {
  const {data: settings} = useSettings();

  const distance: DistanceUnitPref =
    settings?.unit_of_length === 'mi' ? 'mi' : 'km';
  const temperature: TemperatureUnitPref =
    settings?.unit_of_temp === 'F' ? '°F' : '°C';
  const locale =
    typeof settings?.locale === 'string' && settings.locale.trim().length > 0
      ? settings.locale
      : DEFAULT_LOCALE;
  const rawPrecision = settings?.decimal_precision;
  const precision =
    typeof rawPrecision === 'number' &&
    Number.isFinite(rawPrecision) &&
    rawPrecision >= 0
      ? Math.floor(rawPrecision)
      : undefined;

  return useMemo(() => {
    const unitPrefs: UnitPrefs = {distance, temperature, locale, precision};
    return {
      unitPrefs,
      formatDistance: (value: number | null | undefined) =>
        formatDistance(value, unitPrefs),
      formatTemperature: (value: number | null | undefined) =>
        formatTemperature(value, unitPrefs),
    };
  }, [distance, temperature, locale, precision]);
}

/* ─── Inlined colour helpers (web lib/colors) ─────────────────────────────── */

const COLOR_GOOD = '#10b981';
const COLOR_WARN = '#f59e0b';
const COLOR_BAD = '#ef4444';

// Verbatim from web lib/colors.batteryColor.
function batteryColor(level: number): string {
  if (level > 60) {
    return COLOR_GOOD;
  }
  if (level > 25) {
    return COLOR_WARN;
  }
  return COLOR_BAD;
}

/* ─── parseModelKey + TeslaCarViz (web data-display/TeslaCarViz) ───────────── */

type TeslaModel = 'model3' | 'models' | 'modely' | 'modelx' | 'cybertruck';

// Parse a vehicle.model string into a TeslaModel key — verbatim from web.
function parseModelKey(modelStr?: string): TeslaModel {
  if (!modelStr) {
    return 'model3';
  }
  const s = modelStr.toLowerCase().replace(/\s+/g, '');
  if (s.includes('cybertruck') || s.includes('ct')) {
    return 'cybertruck';
  }
  if (s.includes('modelx') || s.includes('mx')) {
    return 'modelx';
  }
  if (s.includes('modely') || s.includes('my')) {
    return 'modely';
  }
  if (s.includes('models') || s.includes('ms')) {
    return 'models';
  }
  return 'model3';
}

interface TeslaCarVizProps {
  model: TeslaModel;
  size: 'sm' | 'md' | 'lg';
  batteryLevel: number;
  isCharging: boolean;
  isLocked: boolean;
  isClimateOn: boolean;
  speed: number;
  sentryMode: boolean;
}

const CAR_SIZES: Record<'sm' | 'md' | 'lg', {width: number; bodyHeight: number}> =
  {
    sm: {width: 92, bodyHeight: 30},
    md: {width: 132, bodyHeight: 42},
    lg: {width: 184, bodyHeight: 58},
  };

const MODEL_LABELS: Record<TeslaModel, string> = {
  model3: 'Model 3',
  models: 'Model S',
  modely: 'Model Y',
  modelx: 'Model X',
  cybertruck: 'Cybertruck',
};

// Native View-drawn stand-in for the web SVG TeslaCarViz: conveys the same
// battery level (tinted by batteryColor) + charging/locked/sentry status the web
// car graphic shows. speed + isClimateOn are part of the web prop contract and
// are surfaced through the accessibility label (the card always passes speed=0 /
// isClimateOn=false, exactly as the web call site does).
function TeslaCarViz({
  model,
  size,
  batteryLevel,
  isCharging,
  isLocked,
  isClimateOn,
  speed,
  sentryMode,
}: TeslaCarVizProps) {
  const dims = CAR_SIZES[size];
  const clampedLevel = Math.max(0, Math.min(100, safeNumber(batteryLevel)));
  const fillColor = batteryColor(clampedLevel);
  const wheel = Math.round(dims.bodyHeight * 0.46);

  const accessibilityLabel = [
    MODEL_LABELS[model],
    `battery ${Math.round(clampedLevel)}%`,
    isCharging ? 'charging' : null,
    isLocked ? 'locked' : 'unlocked',
    sentryMode ? 'sentry on' : null,
    isClimateOn ? 'climate on' : null,
    speed > 0 ? `moving ${Math.round(speed)}` : 'parked',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID="vehicle-card-carviz"
      style={[styles.carViz, {width: dims.width}]}>
      <View style={styles.carStage}>
        <View
          style={[
            styles.carBody,
            {height: dims.bodyHeight, borderColor: fillColor},
          ]}>
          <View style={styles.carCabin} />
          {isCharging ? (
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={[styles.carBolt, {color: COLOR_GOOD}]}>
              {'\u26A1'}
            </AppText>
          ) : null}
          {sentryMode ? (
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={[styles.carSentry, {color: colors.accent}]}>
              SH
            </AppText>
          ) : null}
        </View>
        <View style={[styles.carWheelRow, {width: dims.width}]}>
          <View
            style={[styles.carWheel, {width: wheel, height: wheel, borderRadius: wheel / 2}]}
          />
          <View
            style={[styles.carWheel, {width: wheel, height: wheel, borderRadius: wheel / 2}]}
          />
        </View>
      </View>

      <View style={[styles.carBatteryTrack, {width: dims.width}]}>
        <View
          style={[
            styles.carBatteryFill,
            {width: `${clampedLevel}%`, backgroundColor: fillColor},
          ]}
        />
      </View>

      <View style={styles.carFooter}>
        <AppText variant="caption" weight="bold" style={{color: fillColor}}>
          {Math.round(clampedLevel)}%
        </AppText>
        {isLocked ? (
          <AppText
            variant="caption"
            weight="bold"
            accessibilityLabel="Locked"
            style={[styles.carLock, {color: COLOR_GOOD}]}>
            LK
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/* ─── StatusBadge (web data-display/StatusBadge — per-status FSM dot) ──────── */

// Mirrors the web FSM `badgeDot` map (getStateDefinition('vehicle', status)):
// online=green / driving=blue / charging=yellow / parked=cyan / updating=indigo
// / asleep=purple / offline=red, defaulting to muted grey for unknown states.
const STATUS_DOT_COLOR: Record<string, string> = {
  online: COLOR_GOOD,
  driving: '#3b82f6',
  charging: '#facc15',
  parked: colors.accent,
  updating: '#6366f1',
  asleep: '#a855f7',
  offline: COLOR_BAD,
};

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function StatusBadge({status}: {status: string}) {
  const dotColor = STATUS_DOT_COLOR[status] ?? colors.textMuted;
  return (
    <View style={styles.statusBadge} testID="vehicle-card-status">
      <View style={[styles.statusDot, {backgroundColor: dotColor}]} />
      <AppText variant="caption" weight="semibold" tone="secondary">
        {capitalize(status)}
      </AppText>
    </View>
  );
}

/* ─── ProgressRing (web data-display/ProgressRing — arc-segment approximation) */

interface ProgressRingProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}

const RING_SEGMENTS = 48;

function ProgressRing({
  value,
  max = 100,
  size = 48,
  strokeWidth = 4,
  color = '#3b82f6',
  label,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const clamped = Math.max(0, Math.min(safeNumber(value), safeMax));
  const progress = safeMax > 0 ? clamped / safeMax : 0;
  const activeSegments = Math.round(progress * RING_SEGMENTS);
  const segmentWidth = Math.max(2, (circumference / RING_SEGMENTS) * 0.62);

  const segments = useMemo(
    () =>
      Array.from({length: RING_SEGMENTS}, (_, index) => {
        const angle = -90 + (index / RING_SEGMENTS) * 360;
        const radians = (angle * Math.PI) / 180;
        const left = center + radius * Math.cos(radians) - segmentWidth / 2;
        const top = center + radius * Math.sin(radians) - strokeWidth / 2;
        return {
          key: `seg-${index}`,
          left,
          top,
          rotate: `${angle + 90}deg`,
        };
      }),
    [center, radius, segmentWidth, strokeWidth],
  );

  return (
    <View style={styles.ring} testID="vehicle-card-battery-ring">
      <View style={{width: size, height: size}}>
        {segments.map((segment, index) => (
          <View
            key={segment.key}
            style={[
              styles.ringSegment,
              {
                width: segmentWidth,
                height: strokeWidth,
                borderRadius: strokeWidth / 2,
                left: segment.left,
                top: segment.top,
                backgroundColor:
                  index < activeSegments ? color : colors.border,
                transform: [{rotateZ: segment.rotate}],
              },
            ]}
          />
        ))}
      </View>
      {label ? (
        <AppText variant="caption" weight="semibold" tone="muted">
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

/* ─── VehicleCard ─────────────────────────────────────────────────────────── */

interface VehicleCardProps {
  vehicle: Vehicle;
  onDelete: (v: Vehicle) => void;
}

export function VehicleCard({vehicle, onDelete}: VehicleCardProps) {
  const {unitPrefs, formatDistance: fmtDistance, formatTemperature: fmtTemp} =
    useUnits();

  const {data: stateData} = useVehicleState(vehicle.id);

  // The native useVehicleState result types `state` as VehicleState | string |
  // null (degraded envelopes can surface a bare string); narrow with the hook's
  // own object-guard so `state` is VehicleState | undefined exactly as the web
  // source typed it (a non-object/degraded value hides the stats row + reads as
  // 'offline', the same graceful fallback).
  const rawState = stateData?.state;
  const state: VehicleState | undefined =
    rawState != null && typeof rawState === 'object' ? rawState : undefined;
  const status = getVehicleStatus(state);
  const batColor = batteryColor(state?.battery_level ?? 0);

  const handleDelete = useCallback(() => onDelete(vehicle), [onDelete, vehicle]);

  return (
    <GlassPanel style={styles.panel} testID="vehicle-card">
      {/* Gradient accent strip (web bg-gradient cyan -> purple -> green). */}
      <View style={styles.accentStrip}>
        <View style={[styles.accentSegment, {backgroundColor: colors.accent}]} />
        <View style={[styles.accentSegment, {backgroundColor: colors.violet}]} />
        <View style={[styles.accentSegment, {backgroundColor: COLOR_GOOD}]} />
      </View>

      <View style={styles.body}>
        <View style={styles.row}>
          {/* Car viz */}
          <View style={styles.carColumn}>
            <TeslaCarViz
              model={parseModelKey(vehicle.model)}
              size="sm"
              batteryLevel={state?.battery_level ?? 50}
              isCharging={state?.is_charging ?? false}
              isLocked={state?.is_locked ?? true}
              isClimateOn={false}
              speed={0}
              sentryMode={state?.sentry_mode ?? false}
            />
          </View>

          {/* Info */}
          <View style={styles.info}>
            <View style={styles.titleRow}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={vehicle.display_name || vehicle.vin}
                accessibilityValue={{text: `/vehicles/${vehicle.id}`}}
                testID="vehicle-card-name-link"
                style={styles.nameLink}>
                <AppText
                  variant="body"
                  weight="bold"
                  numberOfLines={1}
                  style={styles.name}>
                  {vehicle.display_name || vehicle.vin}
                </AppText>
              </Pressable>
              <StatusBadge status={status} />
            </View>
            <AppText variant="caption" tone="muted" style={styles.subtitle}>
              {vehicle.model} {vehicle.trim_badging} ·{' '}
              <AppText variant="caption" tone="muted" style={styles.mono}>
                {vehicle.vin}
              </AppText>
            </AppText>

            {/* Stats row */}
            {state && (
              <View style={styles.statsRow}>
                <View style={styles.batteryStat}>
                  <ProgressRing
                    value={state.battery_level}
                    size={36}
                    strokeWidth={3}
                    color={batColor}
                    label=""
                  />
                  <View>
                    <AppText variant="caption" weight="bold" style={styles.statValue}>
                      {state.battery_level}%
                    </AppText>
                    <AppText style={styles.statMicro} tone="muted">
                      {fmtDistance(state.rated_range)}
                    </AppText>
                  </View>
                </View>

                <View style={styles.statBlock}>
                  <AppText variant="caption" weight="semibold" style={styles.statValue}>
                    {fmtTemp(state.inside_temp)}
                  </AppText>
                  <AppText style={styles.statMicro} tone="muted">
                    {t('card.interior', 'Interior')}
                  </AppText>
                </View>

                <View style={styles.statBlock}>
                  <AppText variant="caption" weight="semibold" style={styles.statValue}>
                    {fmtInt(convertDistanceFromSI(state.odometer ?? 0, unitPrefs.distance))}
                  </AppText>
                  <AppText style={styles.statMicro} tone="muted">
                    {unitPrefs.distance}
                  </AppText>
                </View>

                {state.is_charging && (
                  <View style={styles.statBlock}>
                    <AppText
                      variant="caption"
                      weight="semibold"
                      style={[styles.statValue, {color: COLOR_GOOD}]}>
                      {state.charger_power} kW
                    </AppText>
                    <AppText style={styles.statMicro} tone="muted">
                      {t('card.charging', 'Charging')}
                    </AppText>
                  </View>
                )}

                <View style={styles.statusGlyphs}>
                  {state.is_locked && (
                    <AppText
                      variant="caption"
                      weight="bold"
                      accessibilityLabel="Locked"
                      style={{color: COLOR_GOOD}}>
                      LK
                    </AppText>
                  )}
                  {state.sentry_mode && (
                    <AppText
                      variant="caption"
                      weight="bold"
                      accessibilityLabel="Sentry"
                      style={{color: colors.accent}}>
                      SH
                    </AppText>
                  )}
                </View>
              </View>
            )}
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t('card.viewDetails', 'View details')}
              accessibilityValue={{text: `/vehicles/${vehicle.id}`}}
              testID="vehicle-card-view-link"
              style={({pressed}) => [styles.actionButton, pressed && styles.actionPressed]}>
              <SemanticIcon name="externalLink" size="sm" decorative />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('card.removeVehicle', 'Remove vehicle')}
              onPress={handleDelete}
              testID="vehicle-card-delete"
              style={({pressed}) => [styles.actionButton, pressed && styles.actionPressed]}>
              <SemanticIcon name="delete" size="sm" decorative />
            </Pressable>
          </View>
        </View>
      </View>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 0,
    overflow: 'hidden',
  },
  accentStrip: {
    flexDirection: 'row',
    height: 3,
    opacity: 0.5,
  },
  accentSegment: {
    flex: 1,
  },
  body: {
    padding: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
  },
  carColumn: {
    flexShrink: 0,
  },
  carViz: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  carStage: {
    alignItems: 'center',
  },
  carBody: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
    justifyContent: 'center',
    alignItems: 'center',
  },
  carCabin: {
    position: 'absolute',
    top: -7,
    width: '54%',
    height: 14,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSelected,
  },
  carBolt: {
    position: 'absolute',
    right: 4,
    top: 2,
    fontSize: 12,
  },
  carSentry: {
    position: 'absolute',
    left: 4,
    top: 2,
    fontSize: 9,
  },
  carWheelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    marginTop: -4,
  },
  carWheel: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  carBatteryTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  carBatteryFill: {
    height: '100%',
    borderRadius: 999,
  },
  carFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  carLock: {
    marginLeft: spacing.xs,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: 6,
  },
  nameLink: {
    flexShrink: 1,
  },
  name: {
    color: colors.textPrimary,
  },
  subtitle: {
    marginBottom: spacing.md,
  },
  mono: {
    fontFamily: 'monospace',
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.lg,
    rowGap: spacing.sm,
  },
  batteryStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statBlock: {
    alignItems: 'center',
  },
  statValue: {
    color: colors.textPrimary,
  },
  statMicro: {
    fontSize: 10,
    lineHeight: 14,
  },
  statusGlyphs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: 'auto',
  },
  actions: {
    flexShrink: 0,
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionButton: {
    borderRadius: 12,
    padding: spacing.xs,
  },
  actionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.surfaceRaised,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  ring: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  ringSegment: {
    position: 'absolute',
  },
});
