// Native parity port of web/src/components/vehicles/VehicleHeroCard.tsx.
//
// Replaces the web building blocks with React Native primitives + native tokens:
//   • react-router-dom <Link> (L2, L182-209) -> Pressable + an onNavigate(to) callback
//     (the established native-parity nav idiom); the `to` paths are carried verbatim.
//   • react-i18next useTranslation (L3)       -> inline English-default t(key, fallback, vars?)
//     with {{var}} interpolation (no i18next provider in the native parity tree).
//   • @/lib/cn (L4)                           -> StyleSheet + style arrays.
//   • fmtInt / fmtNumber (L5)                 -> inline locale-aware toLocaleString helpers.
//   • GlassPanel glow="cyan" hover (L6, L77)  -> a glass-surfaced root View (tokens) carrying the
//     ref; the hover-only cyan glow has no native analog so a static accent-tinted border stands in.
//   • RadialGauge (L7)                        -> the native RadialGauge parity port (../charts/RadialGauge).
//   • StatusBadge (L8)                        -> inline VehicleStatusBadge (FSM badgeDot color + capitalized label).
//   • StatCard (L9)                           -> inline StatTile (label + value + optional unit) on a card surface.
//   • Badge (L10)                             -> inline neutral pill for the model chip.
//   • Grid cols={{default:2, md:4}} (L11)     -> a flex-wrap row of 2-up tiles (phone-first default).
//   • FSM_REGISTRY (L12) / VehicleStatus (L15)-> inline VEHICLE_STATE_KEYS + resolved badgeDot color map.
//   • useUnits (L13) / convert*FromSI (L14)   -> inline SI converters reading the native useSettings query,
//     derived exactly like web `useUnits` (unit_of_length, unit_of_temp, decimal_precision, locale).
// The user-uploaded <img> (L87) becomes <Image source={{uri}}>; browser-only loading="lazy" /
// decoding="async" have no native analog and are dropped. No DOM elements, react-router, Recharts,
// Leaflet, or web UI components are imported into the native output.

import React, {forwardRef} from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {useSettings} from '../../api/hooks/useSettings';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {RadialGauge} from '../charts/RadialGauge';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;
const EM_DASH = '\u2014';
const GAUGE_SIZE = 100;
/** web max-h-72 = 18rem = 288px. */
const PHOTO_MAX_HEIGHT = 288;

type DistanceLabel = 'mi' | 'km';
type TemperatureLabel = '°F' | '°C';

/** Vehicle state keys (web FSM_REGISTRY.vehicle.states). */
const VEHICLE_STATE_KEYS: readonly string[] = [
  'online',
  'driving',
  'charging',
  'parked',
  'updating',
  'asleep',
  'offline',
];

/**
 * Resolved FSM badgeDot color per vehicle state (web theme variant + per-state
 * overrides). Mirrors `getStateDefinition('vehicle', status).badgeDot`.
 */
const STATE_DOT_COLOR: Record<string, string> = {
  online: '#4ade80', // success variant badgeDot (bg-green-400)
  driving: '#3b82f6', // override bg-blue-500
  charging: '#facc15', // override bg-yellow-400
  parked: '#06b6d4', // override bg-cyan-500
  updating: '#6366f1', // override bg-indigo-500
  asleep: '#a855f7', // override bg-purple-500
  offline: '#f87171', // danger variant badgeDot (bg-red-400)
};
/** Web StatusBadge falls back to bg-gray-400 for unknown states. */
const FALLBACK_DOT_COLOR = '#9ca3af';

export interface VehicleHeroCardVehicle {
  id: number;
  display_name: string;
  model: string;
  vin: string;
  state: string;
}

export interface VehicleHeroCardState {
  battery_level: number;
  rated_range: number;
  inside_temp: number;
  outside_temp: number;
  odometer: number;
  is_charging: boolean;
  is_locked: boolean;
  sentry_mode: boolean;
  software_version: string;
  power: number;
  state?: string;
}

export interface VehicleHeroCardProps {
  vehicle: VehicleHeroCardVehicle;
  vehicleState?: VehicleHeroCardState | null;
  /**
   * Optional URL for the user-uploaded hero photo. Passed in as a prop so
   * dashboards rendering many hero cards do not trigger one query per card.
   */
  photoUrl?: string | null;
  /** Accepted for web parity; React Native has no CSS class names. */
  className?: string;
  /**
   * Native navigation hook replacing react-router-dom's <Link>. Receives the
   * destination path string verbatim when an action is pressed. No-op if unwired.
   */
  onNavigate?: (to: string) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

function toStatus(state: string): string {
  return VEHICLE_STATE_KEYS.includes(state) ? state : 'offline';
}

/** Inline English-default translator with `{{var}}` interpolation (web useTranslation). */
function t(_key: string, fallback: string, vars?: Record<string, string>): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    name in vars ? vars[name] : `{{${name}}}`,
  );
}

function deriveDistanceLabel(unitOfLength: string | undefined): DistanceLabel {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function deriveTemperatureLabel(unitOfTemp: string | undefined): TemperatureLabel {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

function derivePrecision(decimalPrecision: unknown): number {
  if (
    typeof decimalPrecision !== 'number' ||
    !Number.isFinite(decimalPrecision) ||
    decimalPrecision < 0
  ) {
    return DEFAULT_PRECISION;
  }
  return Math.min(20, Math.floor(decimalPrecision));
}

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

/** Pure SI metres -> display distance (web lib convertDistanceFromSI). */
function convertDistanceFromSI(meters: number, to: DistanceLabel): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

/** Pure SI celsius -> display temperature (web lib convertTempFromSI). */
function convertTempFromSI(celsius: number, to: TemperatureLabel): number {
  return to === '°F' ? (celsius * 9) / 5 + 32 : celsius;
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Locale-aware number formatter (web lib fmtNumber). */
function fmtNumber(value: unknown, decimals: number, locale: string): string {
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safeNumber(value).toLocaleString(locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  }
}

/** Integer formatter with locale separators (web lib fmtInt). */
function fmtInt(value: unknown, locale: string): string {
  return fmtNumber(value, 0, locale);
}

function VehicleStatusBadge({status}: {status: string}) {
  const dotColor = STATE_DOT_COLOR[status] ?? FALLBACK_DOT_COLOR;
  return (
    <View
      accessibilityLabel={status}
      accessibilityRole="text"
      accessible
      style={styles.statusBadge}>
      <View style={[styles.statusDot, {backgroundColor: dotColor}]} />
      <AppText style={styles.statusText} tone="secondary" variant="caption" weight="semibold">
        {status}
      </AppText>
    </View>
  );
}

function ModelBadge({label}: {label: string}) {
  return (
    <View style={styles.modelBadge}>
      <AppText style={styles.modelBadgeText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

function StatTile({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <View style={styles.statTile}>
      <AppText tone="muted" variant="caption" weight="semibold">
        {label}
      </AppText>
      <View style={styles.statValueRow}>
        <AppText style={styles.statValue} weight="bold">
          {value}
        </AppText>
        {unit ? (
          <AppText tone="muted" variant="caption">
            {unit}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function HeroAction({
  label,
  to,
  variant,
  onNavigate,
}: {
  label: string;
  to: string;
  variant: 'primary' | 'ghost';
  onNavigate?: (to: string) => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="link"
      onPress={() => onNavigate?.(to)}
      style={({pressed}) => [
        styles.action,
        variant === 'primary' ? styles.actionPrimary : styles.actionGhost,
        pressed && styles.actionPressed,
      ]}>
      <AppText
        style={variant === 'primary' ? styles.actionPrimaryText : styles.actionGhostText}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

export const VehicleHeroCard = forwardRef<View, VehicleHeroCardProps>(
  function VehicleHeroCard(
    {
      vehicle,
      vehicleState,
      photoUrl,
      className: _className,
      onNavigate,
      style,
      testID,
      'data-testid': dataTestID,
    },
    ref,
  ) {
    const {data: settings} = useSettings();
    const vs = vehicleState;

    // Convert SI base units (meters, °C) to the user's display units. The state
    // endpoint returns odometer and rated_range in meters; always pull the
    // suffix from settings so labels track Settings, never hardcoded units.
    const distanceLabel = deriveDistanceLabel(settings?.unit_of_length); // 'mi' | 'km'
    const temperatureLabel = deriveTemperatureLabel(settings?.unit_of_temp); // '°F' | '°C'
    const locale = deriveLocale(settings?.locale);
    const precision = derivePrecision(settings?.decimal_precision);

    const odometerDisplay = vs
      ? fmtInt(Math.round(convertDistanceFromSI(vs.odometer ?? 0, distanceLabel)), locale)
      : EM_DASH;
    const rangeDisplay = vs
      ? Math.round(convertDistanceFromSI(vs.rated_range ?? 0, distanceLabel))
      : 0;
    const insideTempDisplay = vs
      ? Math.round(convertTempFromSI(vs.inside_temp ?? 0, temperatureLabel))
      : 0;
    const outsideTempDisplay = vs
      ? Math.round(convertTempFromSI(vs.outside_temp ?? 0, temperatureLabel))
      : 0;

    // Range gauge max scales with display unit so the arc fills meaningfully
    // — Tesla long-range packs cap around 400 mi ≈ 644 km.
    const rangeMax = distanceLabel === 'km' ? 644 : 400;
    const tempMax = temperatureLabel === '°C' ? 50 : 122;

    const status = toStatus(vs?.state ?? vehicle.state ?? 'offline');

    return (
      <View
        ref={ref}
        style={[styles.card, style]}
        testID={testID ?? dataTestID ?? 'vehicle-hero-card'}>
        {/* User-uploaded hero photo; absent photo preserves the gauges-only layout. */}
        {photoUrl ? (
          <View style={styles.photoFrame}>
            <Image
              accessibilityLabel={t('vehicleHero.photo.alt', '{{name}} photo', {
                name: vehicle.display_name,
              })}
              accessibilityRole="image"
              accessible
              resizeMode="cover"
              source={{uri: photoUrl}}
              style={styles.photo}
            />
          </View>
        ) : null}

        {/* Vehicle identity and status summary */}
        <View style={styles.identityRow}>
          <View style={styles.identityCopy}>
            <View style={styles.identityTitleRow}>
              <AppText style={styles.vehicleName} variant="title" weight="bold">
                {vehicle.display_name}
              </AppText>
              <VehicleStatusBadge status={status} />
            </View>
            <AppText style={styles.vin} tone="muted" variant="caption">
              {vehicle.vin}
            </AppText>
          </View>
          <ModelBadge label={vehicle.model} />
        </View>

        {/* Current battery, range, and temperature gauges */}
        {vs ? (
          <View style={styles.gaugeRow}>
            <RadialGauge
              color={vs.battery_level > 20 ? '#22d3ee' : '#ef4444'}
              label={t('vehicleHero.gauge.battery', 'Battery')}
              max={100}
              size={GAUGE_SIZE}
              unit="%"
              value={vs.battery_level}
            />
            <RadialGauge
              color="#4ade80"
              label={t('vehicleHero.gauge.range', 'Range')}
              max={rangeMax}
              size={GAUGE_SIZE}
              unit={distanceLabel}
              value={rangeDisplay}
            />
            <RadialGauge
              color="#f59e0b"
              label={t('vehicleHero.gauge.inside', 'Inside')}
              max={tempMax}
              size={GAUGE_SIZE}
              unit={temperatureLabel}
              value={insideTempDisplay}
            />
            <RadialGauge
              color="#a78bfa"
              label={t('vehicleHero.gauge.outside', 'Outside')}
              max={tempMax}
              size={GAUGE_SIZE}
              unit={temperatureLabel}
              value={outsideTempDisplay}
            />
          </View>
        ) : null}

        {/* Detail cards mirror the same display-unit conversions as the gauges */}
        {vs ? (
          <View style={styles.statGrid}>
            <StatTile
              label={t('vehicleHero.stat.insideTemp', 'Inside Temp')}
              unit={temperatureLabel}
              value={insideTempDisplay}
            />
            <StatTile
              label={t('vehicleHero.stat.outsideTemp', 'Outside Temp')}
              unit={temperatureLabel}
              value={outsideTempDisplay}
            />
            <StatTile
              label={t('vehicleHero.stat.odometer', 'Odometer')}
              unit={distanceLabel}
              value={odometerDisplay}
            />
            <StatTile
              label={t('vehicleHero.stat.range', 'Range')}
              unit={distanceLabel}
              value={rangeDisplay}
            />
            <StatTile
              label={t('vehicleHero.stat.status', 'Status')}
              value={
                vs.is_locked
                  ? t('vehicleHero.locked', 'Locked')
                  : t('vehicleHero.unlocked', 'Unlocked')
              }
            />
            <StatTile
              label={t('vehicleHero.stat.sentry', 'Sentry')}
              value={vs.sentry_mode ? t('common.on', 'On') : t('common.off', 'Off')}
            />
            <StatTile
              label={t('vehicleHero.stat.firmware', 'Firmware')}
              value={vs.software_version}
            />
            <StatTile
              label={t('vehicleHero.stat.power', 'Power')}
              unit="kW"
              value={fmtNumber(vs.power, precision, locale)}
            />
          </View>
        ) : null}

        {/* Navigation actions for the vehicle */}
        <View style={styles.actionsRow}>
          <HeroAction
            label={t('vehicleHero.action.details', 'Details')}
            onNavigate={onNavigate}
            to={`/vehicles/${vehicle.id}`}
            variant="primary"
          />
          <HeroAction
            label={t('vehicleHero.action.commands', 'Commands')}
            onNavigate={onNavigate}
            to={`/vehicles/${vehicle.id}/commands`}
            variant="ghost"
          />
          <HeroAction
            label={t('vehicleHero.action.liveMap', 'Live Map')}
            onNavigate={onNavigate}
            to={`/vehicles/${vehicle.id}/map`}
            variant="ghost"
          />
        </View>
      </View>
    );
  },
);

VehicleHeroCard.displayName = 'VehicleHeroCard';

const styles = StyleSheet.create({
  action: {
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionGhost: {
    backgroundColor: colors.surfaceRaised,
  },
  actionGhostText: {
    color: colors.textSecondary,
  },
  actionPressed: {
    opacity: 0.7,
  },
  actionPrimary: {
    backgroundColor: colors.accentSoft,
  },
  actionPrimaryText: {
    color: colors.accent,
  },
  actionsRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  gaugeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    justifyContent: 'center',
  },
  identityCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  identityRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  identityTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  modelBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  modelBadgeText: {
    color: colors.textSecondary,
  },
  photo: {
    height: PHOTO_MAX_HEIGHT,
    width: '100%',
  },
  photoFrame: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statTile: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  statusBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  statusDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  statusText: {
    textTransform: 'capitalize',
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
  },
  statValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  vehicleName: {
    color: colors.textPrimary,
  },
  vin: {
    fontFamily: 'monospace',
  },
});
