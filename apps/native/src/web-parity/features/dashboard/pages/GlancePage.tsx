// Native parity port of web/src/features/dashboard/pages/GlancePage.tsx.
//
// GlancePage is the at-a-glance vehicle widget: a page title, then for the
// selected vehicle a name + online/offline status badge, a big battery
// RadialGauge ring, a 2x2 key-metrics grid (Range / Interior temp / Security /
// Location), a row of three command QuickActions (lock-or-unlock, climate
// on/off, horn), a data-freshness indicator, and an "open full app" link. When
// vehicles are loading it shows a spinner; on error an error box; when there is
// no vehicle a GlassPanel + EmptyState.
//
// The web original leans on browser-only infrastructure that has no native
// analogue, so — following the established conversion idiom (FleetComparePage /
// CostAnalysisPage / YearReviewPage) — every such dependency is reproduced with
// React Native primitives + the shared native building blocks and documented:
//
//   - react-router-dom: useSearchParams('vehicle_id') has no native URL query;
//     `vehicleIdParam` keeps its exact name as a `string | null` (always null —
//     the "no query param" case), so the useMemo vehicle-selection logic
//     (param match -> first vehicle) is byte-identical and falls back to the
//     first vehicle exactly like web's default. <Link to="/"> (open full app)
//     has no native navigator wired, so it renders as static muted text (the
//     same translated label), matching the YearReview/FleetCompare idiom.
//   - usePageTitle(title) sets document.title — no native analogue — so it is
//     dropped; the same translated title renders in the on-screen header.
//   - @/components/layout PageContainer (title + loading/error/empty/children
//     scaffold) is inlined: header + the loading -> ActivityIndicator, error ->
//     error box, content branches, preserving the exact gating.
//   - @/components/ui Button -> the QuickAction sub-component is rebuilt on a
//     native Pressable (icon-or-spinner over a label), preserving disabled +
//     loading + accessibilityLabel. @/components/ui Badge -> a local StatusBadge
//     (dot + label, success/neutral). @/components/data-display MetricCard
//     (icon-in-a-coloured-chip + label + value) -> a local GlanceMetric that
//     preserves the exact per-metric colour semantics (green / amber / red /
//     cyan from web lib/tokens neonColorMap). lucide-react icons (Battery,
//     Thermometer, Lock/Unlock, MapPin, Wind, Volume2) have no native font, so
//     QuickActions use the shared SemanticIcon glyphs (lock/unlock/wind/volume)
//     and the metric chips use SemanticIcon-style 2-glyph stand-ins (BT / T° /
//     LK·UL / LO). @/components/charts RadialGauge and
//     @/components/data-display FreshnessIndicator are the already-converted
//     native components and are imported unchanged.
//   - @/components/motion FadeIn (framer-motion) renders at its rest state (a
//     plain View) — the established idiom, no native entrance animation.
//   - @/hooks/useUnits + @/lib/unitConversion + @/lib/numberFormat + @/lib/colors
//     have no shared native module, so the bits this page uses are inlined
//     verbatim: `unitPrefs` (distance/temperature derived from the native
//     useSettings exactly as web useUnits derives them — unit_of_length === 'mi',
//     unit_of_temp === 'F'), convertDistanceFromSI / convertTempFromSI, the
//     fmtNumber + safeNumber number formatters, and batteryColor + COLOR.MUTED.
//   - react-i18next useTranslation -> a native English-default `t` that keeps
//     every glance.* key verbatim and reproduces i18next `{{var}}` interpolation.
//
// Real data hooks are called unchanged: useVehicles(), useVehicleState(vehicleId,
// {refetchInterval: 10_000}), useLocationSnapshotLatest(vehicleId, 30_000) and
// useVehicleCommand() via the native web-parity hooks, so every API path,
// snake_case field, refetch interval, and command name (lock / unlock /
// climate_on / climate_off / honk_horn) is preserved. State names (vehicles,
// vehiclesLoading, vehiclesError, vehicle, vehicleId, stateData, dataUpdatedAt,
// state, location, sendCommand, isOnline, canSendCommands, locationLabel,
// freshnessTimestamp) are preserved. No DOM, react-router, framer-motion,
// lucide-react, Recharts, Leaflet, or old web UI components are imported.

import React, {useMemo} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicleCommand} from '../../../api/hooks/useVehicleCommand';
import {
  useLocationSnapshotLatest,
  useVehicles,
  useVehicleState,
  type Vehicle,
  type VehicleState,
} from '../../../api/hooks/useVehicles';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {FreshnessIndicator} from '../../../components/data-display/FreshnessIndicator';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so this fallback returns the English default
// while keeping every glance.* key verbatim.
function t(
  _key: string,
  fallback: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    return value == null ? '' : String(value);
  });
}

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ──────── */

type DistanceUnitPref = 'km' | 'mi';
type TemperatureUnitPref = '°C' | '°F';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const DEFAULT_PRECISION = 2;

// Pure SI -> display converters, verbatim from web lib/unitConversion.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
  }
}

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/* ─── Inlined colours (mirror web lib/colors batteryColor + COLOR) ─────────── */

const COLOR_GOOD = '#10b981';
const COLOR_WARN = '#f59e0b';
const COLOR_BAD = '#ef4444';
const COLOR_MUTED = '#6b7280';

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

/* ─── Metric chip colour map (mirror web lib/tokens neonColorMap) ──────────── */

type MetricColor = 'green' | 'amber' | 'red' | 'cyan';

interface MetricColorTokens {
  surface: string;
  border: string;
  text: string;
}

// bg-neon-*/10 + ring-neon-*/20-30 + the toned-down text-*-300 shade, resolved
// to literals from web tailwind.config.js / lib/tokens neonColorMap.
const METRIC_COLORS: Record<MetricColor, MetricColorTokens> = {
  green: {
    surface: 'rgba(16, 185, 129, 0.10)',
    border: 'rgba(16, 185, 129, 0.28)',
    text: '#6ee7b7',
  },
  amber: {
    surface: 'rgba(245, 158, 11, 0.10)',
    border: 'rgba(245, 158, 11, 0.28)',
    text: '#fcd34d',
  },
  red: {
    surface: 'rgba(239, 68, 68, 0.10)',
    border: 'rgba(239, 68, 68, 0.28)',
    text: '#fda4af',
  },
  cyan: {
    surface: 'rgba(0, 240, 255, 0.10)',
    border: 'rgba(0, 240, 255, 0.28)',
    text: '#67e8f9',
  },
};

/* ─── Location label (verbatim port of web getLocationLabel) ───────────────── */

/** Derive a user-friendly location label from the location snapshot */
function getLocationLabel(
  location:
    | {
        located_at_home?: boolean;
        located_at_work?: boolean;
        located_at_favorite?: boolean;
        destination_name?: string;
      }
    | null
    | undefined,
  translate: (key: string, fallback: string) => string,
): string {
  if (!location) {
    return '—';
  }
  if (location.located_at_home) {
    return translate('glance.location.home', 'Home');
  }
  if (location.located_at_work) {
    return translate('glance.location.work', 'Work');
  }
  if (location.located_at_favorite) {
    return translate('glance.location.favorite', 'Saved');
  }
  if (location.destination_name) {
    return location.destination_name;
  }
  return '—';
}

// The native useVehicleState normalizer types `.state` as VehicleState | string
// | null (the bare FSM-state string is the "no live snapshot" case); narrow it
// to the VehicleState object the web page consumes, otherwise undefined. The web
// original reads `res.state` as `any`, so a bare string yields undefined member
// reads there too — this preserves that exact behaviour type-safely.
function asVehicleState(
  value: VehicleState | string | null | undefined,
): VehicleState | undefined {
  return value != null && typeof value === 'object' ? value : undefined;
}

/* ── Local sub-components ─────────────────────────────────────────────────── */

interface QuickActionProps {
  iconName: SemanticIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

function QuickAction({
  iconName,
  label,
  onPress,
  disabled,
  loading,
  testID,
}: QuickActionProps) {
  const isDisabled = Boolean(disabled) || Boolean(loading);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled, busy: Boolean(loading)}}
      disabled={isDisabled}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.quickAction,
        isDisabled && styles.quickActionDisabled,
        pressed && !isDisabled && styles.quickActionPressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.accent} testID={`${testID ?? 'quick-action'}-spinner`} />
      ) : (
        <SemanticIcon name={iconName} size="sm" decorative />
      )}
      <AppText
        numberOfLines={1}
        style={styles.quickActionLabel}
        tone="secondary"
        variant="caption">
        {label}
      </AppText>
    </Pressable>
  );
}

interface StatusBadgeProps {
  online: boolean;
  label: string;
  testID?: string;
}

function StatusBadge({online, label, testID}: StatusBadgeProps) {
  return (
    <View
      style={[styles.badge, online ? styles.badgeOnline : styles.badgeNeutral]}
      testID={testID}>
      <View
        style={[
          styles.badgeDot,
          online ? styles.badgeDotOnline : styles.badgeDotNeutral,
        ]}
      />
      <AppText variant="caption" weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

interface GlanceMetricProps {
  label: string;
  value: string;
  glyph: string;
  color: MetricColor;
  testID?: string;
}

function GlanceMetric({label, value, glyph, color, testID}: GlanceMetricProps) {
  const tokens = METRIC_COLORS[color];
  return (
    <View style={styles.metricCard} testID={testID}>
      <View style={styles.metricBody}>
        <AppText
          numberOfLines={1}
          style={styles.metricLabel}
          tone="muted"
          variant="caption"
          weight="semibold">
          {label}
        </AppText>
        <AppText
          numberOfLines={1}
          style={styles.metricValue}
          variant="title"
          weight="bold">
          {value}
        </AppText>
      </View>
      <View
        style={[
          styles.metricChip,
          {backgroundColor: tokens.surface, borderColor: tokens.border},
        ]}>
        <AppText
          style={[styles.metricGlyph, {color: tokens.text}]}
          variant="caption"
          weight="bold">
          {glyph}
        </AppText>
      </View>
    </View>
  );
}

/* ── Main page ────────────────────────────────────────────────────────────── */

export default function GlancePage() {
  const title = t('glance.title', 'Quick Glance');
  // usePageTitle(title) sets document.title on web — no native analogue, so the
  // same translated title renders in the on-screen header instead.

  // useSearchParams().get('vehicle_id') has no native URL query; the name is
  // preserved as a constant null (the "no query param" case), so selection
  // falls back to the first vehicle exactly like web's default.
  const vehicleIdParam: string | null = null;

  const {
    data: vehicles,
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = useVehicles();

  // Support vehicle_id selection; fall back to first vehicle.
  const vehicle = useMemo<Vehicle | null>(() => {
    if (!vehicles?.length) {
      return null;
    }
    if (vehicleIdParam) {
      const found = vehicles.find(v => String(v.id) === vehicleIdParam);
      if (found) {
        return found;
      }
    }
    return vehicles[0];
  }, [vehicles, vehicleIdParam]);

  const vehicleId = vehicle?.id ?? 0;

  const {data: stateData, dataUpdatedAt} = useVehicleState(vehicleId, {
    refetchInterval: 10_000,
  });
  const state = asVehicleState(stateData?.state);

  const {data: location} = useLocationSnapshotLatest(vehicleId, 30_000);

  // Unit prefs derived from useSettings exactly as web useUnits derives them.
  const {data: settings} = useSettings();
  const unitPrefs = useMemo(
    () => ({
      distance: (settings?.unit_of_length === 'mi'
        ? 'mi'
        : 'km') as DistanceUnitPref,
      temperature: (settings?.unit_of_temp === 'F'
        ? '°F'
        : '°C') as TemperatureUnitPref,
    }),
    [settings?.unit_of_length, settings?.unit_of_temp],
  );
  const locale =
    settings?.locale && settings.locale.trim() ? settings.locale : 'en-US';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : DEFAULT_PRECISION;

  // Mirrors web lib/numberFormat.fmtNumber (global precision/locale defaults).
  const fmtNumber = (v: number | null | undefined, decimals?: number): string => {
    const d = decimals ?? userPrecision;
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
  };

  const sendCommand = useVehicleCommand();

  const isOnline = state?.state === 'online' || state?.state === 'parked';
  const canSendCommands = isOnline && !sendCommand.isPending;

  const locationLabel = getLocationLabel(location, t);

  // Use the query's dataUpdatedAt as a proxy for "when we last got data".
  const freshnessTimestamp = useMemo(
    () => (dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : null),
    [dataUpdatedAt],
  );

  const rangeValue =
    state?.rated_range != null
      ? `${fmtNumber(
          convertDistanceFromSI(state.rated_range, unitPrefs.distance),
          0,
        )} ${unitPrefs.distance}`
      : '—';
  const interiorValue =
    state?.inside_temp != null
      ? `${fmtNumber(
          convertTempFromSI(state.inside_temp, unitPrefs.temperature),
          1,
        )}${unitPrefs.temperature}`
      : '—';
  const securityValue = state?.is_locked
    ? t('glance.locked', 'Locked')
    : t('glance.unlocked', 'Unlocked');

  const gaugeColor =
    state?.battery_level != null
      ? batteryColor(state.battery_level)
      : COLOR_MUTED;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={styles.screen}
      testID="glance-page">
      <View style={styles.header}>
        <AppText variant="title" weight="bold">
          {title}
        </AppText>
      </View>

      {vehiclesLoading ? (
        <View style={styles.centerPad} testID="glance-loading">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : vehiclesError ? (
        <View style={styles.errorBox} testID="glance-error">
          <AppText style={styles.errorText} variant="caption">
            {vehiclesError.message}
          </AppText>
        </View>
      ) : !vehicle ? (
        <GlassPanel style={styles.emptyPanel} testID="glance-empty">
          {/* no-action: transient empty state — surfaces when source data is
              missing; no specific recovery action available */}
          <SemanticIcon name="battery" size="lg" decorative />
          <EmptyState message="" title={t('glance.noVehicle', 'No vehicle found')} />
        </GlassPanel>
      ) : (
        // FadeIn (framer-motion) renders at its rest state on native.
        <View style={styles.stage} testID="glance-content">
          {/* Vehicle name + status */}
          <View style={styles.nameBlock}>
            <AppText
              numberOfLines={1}
              style={styles.vehicleName}
              variant="title"
              weight="bold">
              {vehicle.display_name ||
                vehicle.model ||
                t('glance.defaultName', 'Tesla')}
            </AppText>
            <StatusBadge
              label={state?.state ?? t('glance.unknown', 'Unknown')}
              online={isOnline}
              testID="glance-status"
            />
          </View>

          {/* Big battery ring */}
          <View style={styles.gaugeWrap}>
            <RadialGauge
              color={gaugeColor}
              label={t('glance.battery', 'Battery')}
              max={100}
              size={180}
              unit="%"
              value={state?.battery_level ?? 0}
            />
          </View>

          {/* Key metrics grid */}
          <View style={styles.metricsGrid}>
            <GlanceMetric
              color="green"
              glyph="BT"
              label={t('glance.range', 'Range')}
              testID="glance-metric-range"
              value={rangeValue}
            />
            <GlanceMetric
              color="amber"
              glyph="T°"
              label={t('glance.temp', 'Interior')}
              testID="glance-metric-temp"
              value={interiorValue}
            />
            <GlanceMetric
              color={state?.is_locked ? 'green' : 'red'}
              glyph={state?.is_locked ? 'LK' : 'UL'}
              label={t('glance.security', 'Security')}
              testID="glance-metric-security"
              value={securityValue}
            />
            <GlanceMetric
              color="cyan"
              glyph="LO"
              label={t('glance.locationLabel', 'Location')}
              testID="glance-metric-location"
              value={locationLabel}
            />
          </View>

          {/* Quick actions */}
          <View style={styles.actionsRow}>
            <QuickAction
              disabled={!canSendCommands}
              iconName={state?.is_locked ? 'unlocked' : 'locked'}
              label={
                state?.is_locked
                  ? t('glance.action.unlock', 'Unlock')
                  : t('glance.action.lock', 'Lock')
              }
              loading={
                sendCommand.isPending &&
                sendCommand.variables?.command === 'lock'
              }
              onPress={() =>
                sendCommand.mutate({
                  vehicleId,
                  command: state?.is_locked ? 'unlock' : 'lock',
                })
              }
              testID="glance-action-lock"
            />
            <QuickAction
              disabled={!canSendCommands}
              iconName="wind"
              label={
                state?.is_climate_on
                  ? t('glance.action.climateOff', 'Climate Off')
                  : t('glance.action.climateOn', 'Climate On')
              }
              loading={
                sendCommand.isPending &&
                (sendCommand.variables?.command === 'climate_on' ||
                  sendCommand.variables?.command === 'climate_off')
              }
              onPress={() =>
                sendCommand.mutate({
                  vehicleId,
                  command: state?.is_climate_on ? 'climate_off' : 'climate_on',
                })
              }
              testID="glance-action-climate"
            />
            <QuickAction
              disabled={!canSendCommands}
              iconName="volume"
              label={t('glance.action.horn', 'Horn')}
              loading={
                sendCommand.isPending &&
                sendCommand.variables?.command === 'honk_horn'
              }
              onPress={() =>
                sendCommand.mutate({vehicleId, command: 'honk_horn'})
              }
              testID="glance-action-horn"
            />
          </View>

          {/* Freshness */}
          <View style={styles.freshWrap}>
            <FreshnessIndicator size="md" timestamp={freshnessTimestamp} />
          </View>

          {/* Link to full app (router not wired on native -> static label) */}
          <View style={styles.openAppWrap}>
            <AppText style={styles.openApp} tone="muted" variant="caption">
              {t('glance.openApp', 'Open full app →')}
            </AppText>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  badgeDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  badgeDotNeutral: {
    backgroundColor: colors.textMuted,
  },
  badgeDotOnline: {
    backgroundColor: colors.success,
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  badgeOnline: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  centerPad: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  emptyPanel: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  freshWrap: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  gaugeWrap: {
    alignItems: 'center',
    marginVertical: spacing.xl,
  },
  header: {
    marginBottom: spacing.lg,
  },
  metricBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  metricCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: '46%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
    minWidth: 150,
    padding: spacing.md,
  },
  metricChip: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  metricGlyph: {
    letterSpacing: 0.4,
  },
  metricLabel: {
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: colors.textPrimary,
  },
  metricsGrid: {
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    maxWidth: 360,
    width: '100%',
  },
  nameBlock: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  openApp: {
    textAlign: 'center',
  },
  openAppWrap: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  quickAction: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 64,
    minWidth: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  quickActionDisabled: {
    opacity: 0.48,
  },
  quickActionLabel: {
    textAlign: 'center',
  },
  quickActionPressed: {
    opacity: 0.82,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  stage: {
    alignItems: 'center',
  },
  vehicleName: {
    textAlign: 'center',
  },
});
