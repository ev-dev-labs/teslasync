// Native parity port of
// web/src/features/dashboard/widgets/ClimateControlPanelWidget.tsx.
//
// The dashboard "Climate Control" widget. It reads the latest climate snapshot
// for the active vehicle (5s poll) and renders one of three states inside the
// shared WidgetShell:
//   - compact (1x1): a single centred cabin-temperature read-out;
//   - full (>1x1): an HVAC on/off badge + live power, a cabin/outside
//     temperature pair, fan-speed + steering-wheel-heat metrics, and a wrapping
//     row of seat-heater / defrost / battery-heater status chips;
//   - empty: the climate-data empty state when the snapshot is missing.
//
// Every web dependency is reproduced native-safe and documented here so the
// behaviour, state names, API path, unit handling and i18n intent of all 203
// source lines are preserved:
//
//   - lucide-react icons (Thermometer / Fan / Armchair / CircleDot / Snowflake
//     / Zap / Power) -> decorative text `Glyph`s. RN has no lucide; each icon
//     becomes a small tinted unicode glyph (thermometer/fan/seat/circle-dot/
//     snowflake/bolt/power) marked accessibilityElementsHidden, carrying the
//     same colour signal the web `text-*` classes did (neon-cyan -> accent,
//     blue-400, text-muted, orange-400). No DOM, no lucide import.
//   - @/components/ui Badge -> inline `Badge` (success / neutral pill, the only
//     two variants this widget uses, web `size="sm"`). Same tint mapping as the
//     sibling GuardModeWidget/VehicleUpgradesWidget ports.
//   - @/components/feedback EmptyState -> the real native EmptyState
//     (components/feedback/EmptyState); the web icon/className props have no
//     native equivalent so the "No climate data" message is passed as the
//     title, matching the GuardModeWidget port.
//   - ./WidgetShell -> the real native WidgetShell port in this directory.
//     title/icon/loading/updatedAt/isFetching/isStale/isError/onRefresh are
//     forwarded verbatim (compact => title+icon undefined, exactly like web).
//   - ./types WidgetProps -> re-declared `WidgetProps` (vehicleId/size/config).
//   - @/api/hooks/useVehicles useVehicles + useClimateLatest -> the real native
//     hooks (same `/climate/latest?vehicle_id=` path, same 5000ms poll, same
//     ClimateSnapshot shape).
//   - @/hooks/useUnits useUnits -> an inlined `useUnits` deriving only
//     `unitPrefs.temperature` from native useSettings `unit_of_temp`
//     ('F' -> degF else degC), exactly as web useUnits' deriveTemperature.
//   - @/lib/unitConversion convertTempFromSI -> inlined verbatim (degC passes
//     through, degF = c*9/5+32).
//   - @/lib/numberFormat fmtInt / fmtNumber -> inlined verbatim (safeNumber
//     guard + locale-grouped toLocaleString; fmtInt = fmtNumber(v, 0)).
//   - react-i18next useTranslation('dashboard') -> the inline `t` fallback
//     returning the supplied English default (keeping every widget.climatePanel.*
//     key verbatim), so the i18n intent is preserved without wiring i18next.
//
// State names (id, climateData, isLoading, isFetching, isStale, isError,
// dataUpdatedAt, refetch, unitPrefs, toTemperatureDisplay, tempUnit, isCompact,
// temps, seatHeaters, steeringHeat, hvacOn) and prop names are preserved. The
// web `MetricCell` `icon: ReactNode` becomes a glyph+colour pair, and the web
// `FullView` `t` parameter is dropped in favour of the module-scope `t` (a pure
// structural native adaptation). `toTemperatureDisplay` is wrapped in
// useCallback so the `temps` useMemo stays lint-clean while producing identical
// output to the web (which recomputed it each render).

import React, {useCallback, useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useSettings} from '../../../api/hooks/useSettings';
import {useClimateLatest, useVehicles} from '../../../api/hooks/useVehicles';
import {WidgetShell} from './WidgetShell';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this returns that default while
// keeping every widget.climatePanel.* key verbatim and applying the same
// {{var}} interpolation as the web `t` (useTranslation('dashboard')).
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

/* ─── Inlined formatters (web @/lib/numberFormat) ─────────────────────────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber — locale-grouped, fixed precision. Both call sites pass an
// explicit precision (1 for kW, 0 via fmtInt for temps), so the not-yet-wired
// global precision is irrelevant.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// web fmtInt — integer (0 decimals) via fmtNumber.
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ─────── */

type TemperatureUnitPref = '\u00B0C' | '\u00B0F';

// Pure SI(degC) -> display converter, verbatim from web lib/unitConversion.
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '\u00B0C':
      return celsius;
    case '\u00B0F':
      return (celsius * 9) / 5 + 32;
  }
}

// Mirrors web useUnits: derive the temperature preference from useSettings
// exactly as web's deriveTemperature does (unit_of_temp === 'F' -> degF else
// degC). This widget only reads `unitPrefs.temperature`, so the mirror exposes
// just that.
function useUnits(): {unitPrefs: {temperature: TemperatureUnitPref}} {
  const {data: settings} = useSettings();
  const temperature: TemperatureUnitPref =
    settings?.unit_of_temp === 'F' ? '\u00B0F' : '\u00B0C';
  return useMemo(() => ({unitPrefs: {temperature}}), [temperature]);
}

/* ─── Widget contract types (web .../types.ts subset) ─────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── Decorative glyphs (web lucide icons) ────────────────────────────────── */

const THERMO_GLYPH = '\uD83C\uDF21'; // lucide Thermometer
const FAN_GLYPH = '\uD83C\uDF00'; // lucide Fan
const SEAT_GLYPH = '\uD83D\uDCBA'; // lucide Armchair
const WHEEL_GLYPH = '\u25C9'; // lucide CircleDot
const SNOW_GLYPH = '\u2744'; // lucide Snowflake
const ZAP_GLYPH = '\u26A1'; // lucide Zap
const POWER_GLYPH = '\u23FB'; // lucide Power
const EM_DASH = '\u2014';

// Colours the web used that have no semantic token: tailwind blue-400 (outside
// temp + defrost) and orange-400/orange-500-10 (seat + battery heaters).
const COLOR_BLUE = '#60a5fa';
const COLOR_ORANGE = '#fb923c';
const TINT_ORANGE = 'rgba(249, 115, 22, 0.1)';
const TINT_BLUE = 'rgba(59, 130, 246, 0.1)';

function Glyph({
  glyph,
  color,
  size = 13,
}: {
  glyph: string;
  color: string;
  size?: number;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      style={[styles.glyph, {color, fontSize: size, lineHeight: size + 3}]}>
      {glyph}
    </AppText>
  );
}

/* ─── Badge (web @/components/ui Badge: success / neutral, sm) ─────────────── */

type BadgeVariant = 'success' | 'neutral';

const BADGE_TINTS: Record<BadgeVariant, {bg: string; color: string}> = {
  success: {bg: colors.successSurface, color: colors.success},
  neutral: {bg: colors.surfaceRaised, color: colors.textSecondary},
};

function Badge({
  variant,
  children,
  testID,
}: {
  variant: BadgeVariant;
  children: string;
  testID?: string;
}) {
  const tint = BADGE_TINTS[variant];
  return (
    <View style={[styles.badge, {backgroundColor: tint.bg}]} testID={testID}>
      <AppText
        variant="caption"
        weight="semibold"
        numberOfLines={1}
        style={[styles.badgeText, {color: tint.color}]}>
        {children}
      </AppText>
    </View>
  );
}

/* ─── Status chip (web rounded-full bg/text pill) ─────────────────────────── */

function Chip({
  glyph,
  glyphColor,
  text,
  tint,
  textColor,
  testID,
}: {
  glyph: string;
  glyphColor: string;
  text: string;
  tint: string;
  textColor: string;
  testID?: string;
}) {
  return (
    <View style={[styles.chip, {backgroundColor: tint}]} testID={testID}>
      <Glyph glyph={glyph} color={glyphColor} size={10} />
      <AppText numberOfLines={1} style={[styles.chipText, {color: textColor}]}>
        {text}
      </AppText>
    </View>
  );
}

/* ─── Tiny metric cell (web MetricCell — icon + label + value) ─────────────── */

function MetricCell({
  glyph,
  glyphColor,
  label,
  value,
  testID,
}: {
  glyph: string;
  glyphColor: string;
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <View style={styles.metricCell} testID={testID}>
      <Glyph glyph={glyph} color={glyphColor} size={12} />
      <View style={styles.metricBody}>
        <AppText numberOfLines={1} style={styles.metricLabel}>
          {label}
        </AppText>
        <AppText numberOfLines={1} weight="semibold" style={styles.metricValue}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

/* ─── Compact: single temperature display ─────────────────────────────────── */

function CompactView({
  inside,
  tempUnit,
}: {
  inside: string | null;
  tempUnit: string;
}) {
  return (
    <View style={styles.compact} testID="climate-control-panel-compact">
      <Glyph glyph={THERMO_GLYPH} color={colors.accent} size={20} />
      <AppText weight="bold" style={styles.compactValue}>
        {inside != null ? `${inside}${tempUnit}` : EM_DASH}
      </AppText>
    </View>
  );
}

/* ─── Full (>1x1) view ────────────────────────────────────────────────────── */

interface FullViewProps {
  climateData: NonNullable<ReturnType<typeof useClimateLatest>['data']>;
  temps: {inside: string | null; outside: string | null} | null;
  tempUnit: string;
  seatHeaters: {label: string; level: number}[];
  steeringHeat: number;
}

function FullView({
  climateData,
  temps,
  tempUnit,
  seatHeaters,
  steeringHeat,
}: FullViewProps) {
  const hvacOn =
    (climateData.hvac_power != null && climateData.hvac_power > 0) ||
    climateData.hvac_ac_enabled === true;

  return (
    <View style={styles.full} testID="climate-control-panel-full">
      {/* HVAC status badge */}
      <View style={styles.hvacRow} testID="climate-control-panel-hvac">
        <View style={styles.hvacLeft}>
          <Glyph glyph={POWER_GLYPH} color={colors.textMuted} size={13} />
          <Badge
            variant={hvacOn ? 'success' : 'neutral'}
            testID="climate-control-panel-hvac-badge">
            {hvacOn
              ? t('widget.climatePanel.hvacOn', 'HVAC On')
              : t('widget.climatePanel.hvacOff', 'HVAC Off')}
          </Badge>
        </View>
        {climateData.hvac_power != null && climateData.hvac_power > 0 ? (
          <AppText numberOfLines={1} style={styles.hvacPower}>
            {`${fmtNumber(climateData.hvac_power, 1)} kW`}
          </AppText>
        ) : null}
      </View>

      {/* Temperature row */}
      <View style={styles.grid} testID="climate-control-panel-temps">
        <MetricCell
          glyph={THERMO_GLYPH}
          glyphColor={colors.accent}
          label={t('widget.climatePanel.cabin', 'Cabin')}
          value={temps?.inside != null ? `${temps.inside}${tempUnit}` : EM_DASH}
          testID="climate-control-panel-cabin"
        />
        <MetricCell
          glyph={THERMO_GLYPH}
          glyphColor={COLOR_BLUE}
          label={t('widget.climatePanel.outside', 'Outside')}
          value={
            temps?.outside != null ? `${temps.outside}${tempUnit}` : EM_DASH
          }
          testID="climate-control-panel-outside"
        />
      </View>

      {/* Fan speed */}
      <View style={styles.grid} testID="climate-control-panel-fan">
        <MetricCell
          glyph={FAN_GLYPH}
          glyphColor={colors.textMuted}
          label={t('widget.climatePanel.fanSpeed', 'Fan Speed')}
          value={
            climateData.hvac_fan_speed != null
              ? `${climateData.hvac_fan_speed}`
              : EM_DASH
          }
          testID="climate-control-panel-fanspeed"
        />
        <MetricCell
          glyph={WHEEL_GLYPH}
          glyphColor={colors.textMuted}
          label={t('widget.climatePanel.steeringHeat', 'Wheel Heat')}
          value={
            steeringHeat > 0
              ? `${steeringHeat}/3`
              : t('widget.climatePanel.off', 'Off')
          }
          testID="climate-control-panel-wheelheat"
        />
      </View>

      {/* Seat heaters + status badges */}
      <View style={styles.chipRow} testID="climate-control-panel-seats">
        {seatHeaters.length > 0 ? (
          seatHeaters.map(s => (
            <Chip
              key={s.label}
              glyph={SEAT_GLYPH}
              glyphColor={COLOR_ORANGE}
              tint={TINT_ORANGE}
              textColor={COLOR_ORANGE}
              text={`${s.label} ${s.level}/3`}
              testID={`climate-control-panel-seat-${s.label}`}
            />
          ))
        ) : (
          <AppText numberOfLines={1} style={styles.noSeat}>
            {t('widget.climatePanel.noSeatHeat', 'No seat heaters active')}
          </AppText>
        )}
        {climateData.defrost_mode && climateData.defrost_mode !== 'Off' ? (
          <Chip
            glyph={SNOW_GLYPH}
            glyphColor={COLOR_BLUE}
            tint={TINT_BLUE}
            textColor={COLOR_BLUE}
            text={t('widget.climatePanel.defrost', 'Defrost')}
            testID="climate-control-panel-defrost"
          />
        ) : null}
        {climateData.battery_heater_on ? (
          <Chip
            glyph={ZAP_GLYPH}
            glyphColor={COLOR_ORANGE}
            tint={TINT_ORANGE}
            textColor={COLOR_ORANGE}
            text={t('widget.climatePanel.batHeater', 'Bat Heater')}
            testID="climate-control-panel-batheater"
          />
        ) : null}
      </View>
    </View>
  );
}

/* ─── ClimateControlPanelWidget ───────────────────────────────────────────── */

export default function ClimateControlPanelWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: climateData,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useClimateLatest(id, 5_000);
  const {unitPrefs} = useUnits();
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );

  const tempUnit = unitPrefs.temperature;

  const isCompact = size.cols <= 1 && size.rows <= 1;

  const temps = useMemo(() => {
    if (!climateData) {
      return null;
    }
    return {
      inside:
        climateData.inside_temp != null
          ? fmtInt(toTemperatureDisplay(climateData.inside_temp))
          : null,
      outside:
        climateData.outside_temp != null
          ? fmtInt(toTemperatureDisplay(climateData.outside_temp))
          : null,
    };
  }, [climateData, toTemperatureDisplay]);

  const seatHeaters = useMemo(() => {
    if (!climateData) {
      return [];
    }
    const seats: {label: string; level: number}[] = [];
    if (
      climateData.seat_heater_left != null &&
      climateData.seat_heater_left > 0
    ) {
      seats.push({
        label: t('widget.climatePanel.seatFL', 'FL'),
        level: climateData.seat_heater_left,
      });
    }
    if (
      climateData.seat_heater_right != null &&
      climateData.seat_heater_right > 0
    ) {
      seats.push({
        label: t('widget.climatePanel.seatFR', 'FR'),
        level: climateData.seat_heater_right,
      });
    }
    if (
      climateData.seat_heater_rear_left != null &&
      climateData.seat_heater_rear_left > 0
    ) {
      seats.push({
        label: t('widget.climatePanel.seatRL', 'RL'),
        level: climateData.seat_heater_rear_left,
      });
    }
    if (
      climateData.seat_heater_rear_center != null &&
      climateData.seat_heater_rear_center > 0
    ) {
      seats.push({
        label: t('widget.climatePanel.seatRC', 'RC'),
        level: climateData.seat_heater_rear_center,
      });
    }
    if (
      climateData.seat_heater_rear_right != null &&
      climateData.seat_heater_rear_right > 0
    ) {
      seats.push({
        label: t('widget.climatePanel.seatRR', 'RR'),
        level: climateData.seat_heater_rear_right,
      });
    }
    return seats;
  }, [climateData]);

  const steeringHeat = climateData?.hvac_steering_wheel_heat_level ?? 0;

  return (
    <WidgetShell
      title={
        isCompact ? undefined : t('widget.climatePanel.title', 'Climate Control')
      }
      icon={
        isCompact ? undefined : (
          <Glyph glyph={THERMO_GLYPH} color={colors.accent} size={13} />
        )
      }
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      {climateData ? (
        isCompact ? (
          <CompactView inside={temps?.inside ?? null} tempUnit={tempUnit} />
        ) : (
          <FullView
            climateData={climateData}
            temps={temps}
            tempUnit={tempUnit}
            seatHeaters={seatHeaters}
            steeringHeat={steeringHeat}
          />
        )
      ) : (
        <View style={styles.emptyWrap} testID="climate-control-panel-empty">
          {/* no-action: transient empty state — surfaces when source data is
              missing; no specific recovery action available */}
          <EmptyState
            title={t('widget.climatePanel.noData', 'No climate data')}
            message=""
          />
        </View>
      )}
    </WidgetShell>
  );
}

ClimateControlPanelWidget.displayName = 'ClimateControlPanelWidget';

const styles = StyleSheet.create({
  glyph: {
    textAlign: 'center',
  },
  badge: {
    flexShrink: 1,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 10,
    lineHeight: 14,
  },
  metricCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: 6,
  },
  metricBody: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
  metricValue: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  compact: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: spacing.xs,
  },
  compactValue: {
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  full: {
    flex: 1,
    justifyContent: 'space-between',
    rowGap: 10,
  },
  hvacRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
  },
  hvacLeft: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
  },
  hvacPower: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    columnGap: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 6,
    rowGap: 6,
  },
  noSeat: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
