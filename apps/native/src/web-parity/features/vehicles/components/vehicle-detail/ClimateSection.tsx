// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/ClimateSection.tsx.
//
// Vehicle Detail — the "Climate" panel. Renders the latest ClimateSnapshot as a
// responsive grid of eight metric cards (inside / outside / driver-setpoint
// temperatures, fan speed, left/right seat heaters, defrost mode, and the
// climate-on flag) or a transient no-action empty state when climateData is
// absent. The prop name (climateData), every `??` field fallback, the `!= null`
// String() ladders, the defrost `&& !== 'Off'` truthiness, the
// `is_ac_on ?? is_climate_on` coalescing, each per-card colour choice, and all
// i18n keys + English defaults are preserved verbatim.
//
// Web -> native mapping (contract rules 4, 5 & 7); each browser-only dependency
// is replaced with a React Native-safe equivalent and documented in the sidecar:
//   - react-i18next `useTranslation` (web L1, L15) -> inline useNativeTranslation():
//     a stable (key, fallback) => fallback shim so every t('key', 'English') call
//     keeps its English default and translation-key intent.
//   - lucide-react Wind/Thermometer/CircleDot/Snowflake/Flame (web L2) -> no native
//     SVG renderer, so each becomes the shared SemanticIcon chip passed to the
//     MetricCard `icon` slot (DrivingTab precedent): Wind -> 'wind' (title marker +
//     Fan Speed), Thermometer -> 'climate' (the three temperature cards), CircleDot
//     -> 'heating' (the two seat-heater cards), Snowflake -> 'cooling' (Defrost),
//     Flame -> 'flame' (Climate On). The SemanticIcon bakes its own tone, a
//     documented minor tradeoff vs the web's per-card neon icon colour; the panel
//     marker's web cyan tint is likewise a minor tradeoff.
//   - `@/components/ui` GlassPanel (web L4, L19) -> the existing native GlassPanel
//     (className 'p-6' -> padding 24).
//   - `@/components/data-display` MetricCard (web L5) -> the ported native
//     web-parity MetricCard, whose label/value/icon/color prop surface matches the
//     web component 1:1 (colours 'green'/'cyan'/'purple' preserved per card).
//   - `@/components/feedback` EmptyState (web L6, L100) -> the source passes a
//     message only, so native renders the same single centred muted message rather
//     than the shared native EmptyState (which requires a title the call site does
//     not supply, SecurityPanel precedent). The web "no-action: transient empty
//     state" comment is preserved below.
//   - `@/hooks/useUnits` useUnits().formatTemperature (web L7, L16) -> a local
//     formatTemperature mirroring web useUnits + lib/unitConversion.formatTemperature
//     exactly: derive tempUnit ('F' -> '°F' else '°C') + locale + the temperature
//     default precision (settings.decimal_precision floored when valid, else the
//     web DEFAULT_PRECISION.temperature of 1) from the native useSettings query,
//     then `${fmtNumberRaw(convertTempFromSI(c, unit), digits, locale)}${unit}`
//     with the same `—` empty fallback and no number/°unit space.
//   - `@/api/types` ClimateSnapshot (web L8) -> imported from the ported native
//     web-parity api/types (identical snake_case wire shape).
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, lucide-react or
// react-i18next are imported — only react, react-native primitives (StyleSheet,
// View), the existing apps/native SemanticIcon / AppText / GlassPanel / theme
// tokens, and the ported web-parity MetricCard + format primitives + useSettings
// hook + ClimateSnapshot type.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {ClimateSnapshot} from '../../../../api/types';
import {MetricCard} from '../../../../components/data-display/MetricCard';
import {
  convertTempFromSI,
  fmtNumberRaw,
  isFiniteNumber,
  resolveLocale,
  type TempUnit,
} from '../../../../components/data-display/format/_formatPrimitives';

interface ClimateSectionProps {
  climateData: ClimateSnapshot | null | undefined;
}

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next useTranslation replacement: returns the English fallback so the
// translation-key intent is preserved at every call site.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

/**
 * Em-dash placeholder (web `'—'`, U+2014). Shared by the fan-speed / seat-heater
 * value ladders and the temperature empty fallback (web lib DEFAULT_EMPTY_DISPLAY).
 */
const DASH = '\u2014';

/** Web lib DEFAULT_PRECISION.temperature — the fallback decimal precision. */
const TEMPERATURE_FALLBACK_PRECISION = 1;

/** Mirror web useUnits.deriveTemperature: 'F' -> °F, otherwise °C. */
function deriveTemperature(unitOfTemp: string | undefined): TempUnit {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

/**
 * Mirror web lib resolvePrecision(pref, undefined, DEFAULT_PRECISION.temperature):
 * use settings.decimal_precision (floored) when it is a valid non-negative number,
 * otherwise fall back to the temperature default of 1.
 */
function resolveTemperaturePrecision(
  decimalPrecision: number | undefined,
): number {
  if (
    typeof decimalPrecision === 'number' &&
    Number.isFinite(decimalPrecision) &&
    decimalPrecision >= 0
  ) {
    return Math.floor(decimalPrecision);
  }
  return TEMPERATURE_FALLBACK_PRECISION;
}

export function ClimateSection({climateData}: ClimateSectionProps) {
  const t = useNativeTranslation();
  const {data: settings} = useSettings();

  // Faithful port of useUnits().formatTemperature: SI °C in, user-unit string out.
  const tempUnit = deriveTemperature(settings?.unit_of_temp);
  const locale = resolveLocale(settings?.locale);
  const tempPrecision = resolveTemperaturePrecision(settings?.decimal_precision);
  const formatTemperature = (value: number | null | undefined): string => {
    if (!isFiniteNumber(value)) {
      return DASH;
    }
    return `${fmtNumberRaw(
      convertTempFromSI(value, tempUnit),
      tempPrecision,
      locale,
    )}${tempUnit}`;
  };

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <SemanticIcon decorative name="wind" size="sm" />
        <AppText style={styles.title}>
          {t('vehicles.detail.climate', 'Climate')}
        </AppText>
      </View>
      {climateData ? (
        <View style={styles.grid}>
          <View style={styles.gridItem}>
            <MetricCard
              color="green"
              icon={<SemanticIcon decorative name="climate" size="sm" />}
              label={t('common.insideTemp', 'Inside Temp')}
              value={formatTemperature(
                climateData.inside_temp ?? climateData.inside_temp_c,
              )}
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCard
              color="cyan"
              icon={<SemanticIcon decorative name="climate" size="sm" />}
              label={t('common.outsideTemp', 'Outside Temp')}
              value={formatTemperature(
                climateData.outside_temp ?? climateData.outside_temp_c,
              )}
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCard
              color="purple"
              icon={<SemanticIcon decorative name="climate" size="sm" />}
              label={t('vehicles.detail.driverSetpoint', 'Driver Setpoint')}
              value={formatTemperature(
                climateData.driver_temp_setting ?? climateData.driver_setpoint_c,
              )}
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCard
              color="cyan"
              icon={<SemanticIcon decorative name="wind" size="sm" />}
              label={t('vehicles.detail.fanSpeed', 'Fan Speed')}
              value={
                climateData.hvac_fan_status != null
                  ? String(climateData.hvac_fan_status)
                  : climateData.fan_status != null
                    ? String(climateData.fan_status)
                    : DASH
              }
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCard
              color="green"
              icon={<SemanticIcon decorative name="heating" size="sm" />}
              label={t('vehicles.detail.seatHeaterL', 'Seat Heater Left')}
              value={
                climateData.seat_heater_left != null
                  ? `${t('common.level', 'Level')} ${climateData.seat_heater_left}`
                  : DASH
              }
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCard
              color="green"
              icon={<SemanticIcon decorative name="heating" size="sm" />}
              label={t('vehicles.detail.seatHeaterR', 'Seat Heater Right')}
              value={
                climateData.seat_heater_right != null
                  ? `${t('common.level', 'Level')} ${climateData.seat_heater_right}`
                  : DASH
              }
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCard
              color={
                climateData.defrost_mode && climateData.defrost_mode !== 'Off'
                  ? 'green'
                  : 'cyan'
              }
              icon={<SemanticIcon decorative name="cooling" size="sm" />}
              label={t('vehicles.detail.defrost', 'Defrost')}
              value={
                climateData.defrost_mode && climateData.defrost_mode !== 'Off'
                  ? climateData.defrost_mode
                  : t('common.off', 'Off')
              }
            />
          </View>
          <View style={styles.gridItem}>
            <MetricCard
              color={
                (climateData.is_ac_on ?? climateData.is_climate_on)
                  ? 'green'
                  : 'cyan'
              }
              icon={<SemanticIcon decorative name="flame" size="sm" />}
              label={t('vehicles.detail.climateOn', 'Climate On')}
              value={
                (climateData.is_ac_on ?? climateData.is_climate_on)
                  ? t('common.on', 'On')
                  : t('common.off', 'Off')
              }
            />
          </View>
        </View>
      ) : (
        // no-action: transient empty state — surfaces when source data is missing;
        // no specific recovery action available.
        <View style={styles.emptyState}>
          <AppText style={styles.emptyText} tone="muted">
            {t('vehicles.detail.noClimateData', 'No climate data available')}
          </AppText>
        </View>
      )}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 24,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridItem: {
    flexBasis: 150,
    flexGrow: 1,
    minWidth: 150,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    maxWidth: 360,
    textAlign: 'center',
  },
});

export default ClimateSection;
