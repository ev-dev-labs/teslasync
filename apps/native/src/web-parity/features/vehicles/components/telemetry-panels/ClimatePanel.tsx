// Native parity port of
// web/src/features/vehicles/components/telemetry-panels/ClimatePanel.tsx.
//
// The web component renders the live climate panel: a "Climate" heading, Cabin /
// Outside temp `MetricCard`s, Driver / Passenger setpoint rows, an HVAC-state
// row, a six-segment fan-speed meter, and Defrost / Climate / Precondition status
// chips — or an `EmptyState` when `climateData` is missing. It is reproduced here
// with React Native primitives, preserving the `ClimatePanelProps`
// (`climateData`), the `defrost_mode && defrost_mode !== 'Off'` chip gate, the
// `fan_status ?? 0 >= level` six-segment fill, the `?? '—'` / `?? 0` fallbacks,
// and every `t()`/`telemetry.*`/`common.*` key + English copy.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - react-i18next `useTranslation` -> `useNativeTranslation()` shim.
//   - lucide-react `Thermometer`/`Fan`/`Snowflake`/`Zap` -> decorative Unicode
//     `Glyph`s.
//   - `@/components/ui` `GlassPanel` -> native parity GlassPanel (p-6 -> 24).
//   - `@/components/data-display` `MetricCard` -> native parity MetricCard
//     (Cabin/Outside carry no web subtitle -> empty `helper`).
//   - `@/components/feedback` `EmptyState` -> native parity EmptyState.
//   - `@/hooks/useUnits` `formatTemperature` -> inlined native-safe formatter
//     (°C metric default, precision 1, '—' empty).
//   - The `cn()`-toggled fan segment widths / chip tints become StyleSheet
//     records selected by the same boolean conditions.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {MetricCard} from '../../../../../components/ui/MetricCard';
import {colors, spacing} from '../../../../../theme/tokens';
import type {ClimateSnapshot} from '../../../../api/types';

/* ─── inline shims ─────────────────────────────────────────────────────────── */

function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

const ICON_THERMOMETER = '\u{1F321}'; // lucide Thermometer
const ICON_FAN = '\u{1F300}'; // lucide Fan
const ICON_SNOWFLAKE = '\u2744'; // lucide Snowflake
const ICON_ZAP = '\u26A1'; // lucide Zap
const EM_DASH = '\u2014';

const BLUE_400 = '#60a5fa';
const GREEN_400 = '#4ade80';
const AMBER_400 = '#fbbf24';

function fmtNumber(v: unknown, decimals = 2, locale = 'en-US'): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  try {
    return n.toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return n.toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

function formatTemperature(celsius: number | null | undefined): string {
  if (typeof celsius !== 'number' || !Number.isFinite(celsius)) {
    return EM_DASH;
  }
  return `${fmtNumber(celsius, 1)}\u00B0C`;
}

const FAN_SEGMENTS = [1, 2, 3, 4, 5, 6];
const FAN_SEGMENT_WIDTH: Record<number, number> = {1: 6, 2: 8, 3: 10, 4: 12, 5: 14, 6: 16};

/* ─── component ─────────────────────────────────────────────────────────────── */

interface ClimatePanelProps {
  climateData: ClimateSnapshot | null | undefined;
}

export function ClimatePanel({climateData}: ClimatePanelProps) {
  const t = useNativeTranslation();

  const defrostActive =
    Boolean(climateData?.defrost_mode) && climateData?.defrost_mode !== 'Off';
  const climateOn = Boolean(climateData?.is_climate_on);
  const preconditioning = Boolean(climateData?.is_preconditioning);
  const fanLevel = climateData?.fan_status ?? 0;

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.headingRow}>
        <AppText importantForAccessibility="no" style={styles.headingIcon}>
          {ICON_THERMOMETER}
        </AppText>
        <AppText accessibilityRole="header" style={styles.heading}>
          {t('common.climate', 'Climate')}
        </AppText>
      </View>

      {climateData ? (
        <View style={styles.body}>
          {/* Cabin + Outside temps */}
          <View style={styles.metricRow}>
            <MetricCard
              helper=""
              label={t('common.insideTemp', 'Cabin')}
              value={formatTemperature(climateData.inside_temp_c)}
            />
            <MetricCard
              helper=""
              label={t('common.outsideTemp', 'Outside')}
              value={formatTemperature(climateData.outside_temp_c)}
            />
          </View>

          {/* Target temps */}
          <View style={styles.rowBetween}>
            <AppText style={styles.muted}>
              {t('telemetry.driverSetpoint', 'Driver Setpoint')}
            </AppText>
            <AppText style={styles.mono}>
              {formatTemperature(climateData.driver_setpoint_c)}
            </AppText>
          </View>
          <View style={styles.rowBetween}>
            <AppText style={styles.muted}>
              {t('telemetry.passengerSetpoint', 'Passenger Setpoint')}
            </AppText>
            <AppText style={styles.mono}>
              {formatTemperature(climateData.passenger_setpoint_c)}
            </AppText>
          </View>

          {/* HVAC State */}
          <View style={styles.rowBetween}>
            <AppText style={styles.muted}>
              {t('telemetry.hvacState', 'HVAC State')}
            </AppText>
            <AppText style={styles.mono}>{climateData.hvac_state ?? EM_DASH}</AppText>
          </View>

          {/* Fan Speed */}
          <View style={styles.rowBetween}>
            <View style={styles.labelWithIcon}>
              <AppText importantForAccessibility="no" style={styles.smallIcon}>
                {ICON_FAN}
              </AppText>
              <AppText style={styles.muted}>{t('telemetry.fanSpeed', 'Fan Speed')}</AppText>
            </View>
            <View style={styles.fanRow}>
              {FAN_SEGMENTS.map(level => (
                <View
                  key={level}
                  style={[
                    styles.fanSegment,
                    {width: FAN_SEGMENT_WIDTH[level]},
                    fanLevel >= level ? styles.fanSegmentOn : styles.fanSegmentOff,
                  ]}
                />
              ))}
              <AppText style={styles.fanValue}>{fanLevel}</AppText>
            </View>
          </View>

          {/* System badges */}
          <View style={styles.chipsRow}>
            <View style={[styles.chip, defrostActive ? styles.chipBlue : styles.chipOff]}>
              <AppText
                importantForAccessibility="no"
                style={[styles.chipGlyph, defrostActive ? styles.chipBlueText : styles.chipOffText]}>
                {ICON_SNOWFLAKE}
              </AppText>
              <AppText style={[styles.chipText, defrostActive ? styles.chipBlueText : styles.chipOffText]}>
                {t('telemetry.defrost', 'Defrost')}{' '}
                {defrostActive ? climateData.defrost_mode : t('common.off', 'Off')}
              </AppText>
            </View>
            <View style={[styles.chip, climateOn ? styles.chipGreen : styles.chipOff]}>
              <AppText
                importantForAccessibility="no"
                style={[styles.chipGlyph, climateOn ? styles.chipGreenText : styles.chipOffText]}>
                {ICON_ZAP}
              </AppText>
              <AppText style={[styles.chipText, climateOn ? styles.chipGreenText : styles.chipOffText]}>
                {t('telemetry.climate', 'Climate')}{' '}
                {climateOn ? t('common.on', 'On') : t('common.off', 'Off')}
              </AppText>
            </View>
            <View style={[styles.chip, preconditioning ? styles.chipAmber : styles.chipOff]}>
              <AppText style={[styles.chipText, preconditioning ? styles.chipAmberText : styles.chipOffText]}>
                {t('telemetry.precondition', 'Precondition')}{' '}
                {preconditioning ? t('common.on', 'On') : t('common.off', 'Off')}
              </AppText>
            </View>
          </View>
        </View>
      ) : (
        <EmptyState
          message={t('telemetry.noClimateData', 'No climate data available')}
          title={t('common.noData', 'No data')}
        />
      )}
    </GlassPanel>
  );
}

ClimatePanel.displayName = 'ClimatePanel';

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  chipAmber: {
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    borderColor: 'rgba(251, 191, 36, 0.3)',
  },
  chipAmberText: {
    color: AMBER_400,
  },
  chipBlue: {
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
    borderColor: 'rgba(96, 165, 250, 0.3)',
  },
  chipBlueText: {
    color: BLUE_400,
  },
  chipGlyph: {
    fontSize: 11,
    lineHeight: 14,
  },
  chipGreen: {
    backgroundColor: 'rgba(74, 222, 128, 0.1)',
    borderColor: 'rgba(74, 222, 128, 0.3)',
  },
  chipGreenText: {
    color: GREEN_400,
  },
  chipOff: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  chipOffText: {
    color: colors.textMuted,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  chipsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  fanRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  fanSegment: {
    borderRadius: 2,
    height: 12,
  },
  fanSegmentOff: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  fanSegmentOn: {
    backgroundColor: colors.accentSoft,
  },
  fanValue: {
    color: colors.textPrimary,
    fontSize: 12,
    marginLeft: 6,
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
  },
  headingIcon: {
    color: colors.accent,
    fontSize: 15,
    lineHeight: 18,
  },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  labelWithIcon: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  mono: {
    color: colors.textPrimary,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  muted: {
    color: colors.textMuted,
    fontSize: 12,
  },
  panel: {
    padding: spacing.lg,
  },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  smallIcon: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
});
