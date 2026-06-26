// MotorSection — native parity port of
// web/src/features/vehicles/components/vehicle-detail/MotorSection.tsx.
//
// The web component is the vehicle-detail "Powertrain" card: a GlassPanel with a
// Cog + title header above an 8-tile MetricCard grid (Shift State, Pack Voltage,
// Motor Current (F), Front/Rear Torque, Front/Rear RPM, Motor Temp (peak)), or a
// centred empty state when motorData is null/undefined. Pack Voltage prefers the
// rear bus voltage then the front; Motor Temp shows the warmer of the two motor
// temperatures (front/rear) in the user's unit.
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - react-i18next useTranslation (web L1) -> native-safe t(key, fallback)
//     keeping every vehicles.detail.* key + English fallback verbatim.
//   - lucide-react Cog/Activity/Thermometer/Gauge/Settings/Zap/Battery (web L2):
//     lucide is browser-only SVG and forbidden in native output (rule 4). Each is
//     rendered as the native SemanticIcon glyph vocabulary — Cog -> 'settingsAlt'
//     ('S2'), Settings -> 'settings' ('SE'), Activity -> 'activity' ('AC'),
//     Thermometer -> 'climate' ('CL', the SummaryStats Thermometer mapping),
//     Gauge -> 'speedCircle' ('SC', the GForcePanel/SummaryStats Gauge mapping),
//     Zap -> 'bolt' ('ZP'), Battery -> 'battery' ('BT').
//   - `@/components/ui` GlassPanel (web L4) -> the native GlassPanel.
//   - `@/components/data-display` MetricCard (web L5): no native MetricCard parity
//     port exists yet, so a local MetricCard is built from RN primitives
//     reproducing the web structure (text column: metric-label eyebrow + bold
//     value beside a right-aligned colour-tinted icon chip). Only the slots this
//     file uses are ported (label/value/icon/color) — the TemperatureMetricCards
//     precedent.
//   - `@/components/feedback` EmptyState (web L6): the web call passes ONLY
//     `message` (no title/icon/action), so the shared EmptyState renders a single
//     centred line. The native EmptyState requires a title, so the message-only
//     case is reproduced locally as a centred muted message with the web py-16
//     vertical padding (no fabricated title) — faithful to the source.
//   - `@/hooks/useUnits` useUnits().formatTemperature (web L7/17): this parity
//     tree has no settings wiring, so the web SI-floor default ('°C', precision 1,
//     no space before °, convertTempFromSI identity) is used directly — the
//     TemperatureMetricCards / TemperatureSection precedent.
//   - `@/lib/numberFormat` fmtNumber/fmtInt (web L8) -> ported inline with the web
//     global defaults (precision 2 / locale en-US; fmtInt == precision 0).
//   - `@/api/types` MotorSnapshot (web L9) -> the native web-parity api/types
//     MotorSnapshot (same snake_case shape).
// No DOM / lucide-react / Recharts / Leaflet / old web-UI imports — RN primitives
// only. See the .parity.json sidecar for the line-by-line map.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import type {MotorSnapshot} from '../../../../api/types';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key, fallback) => fallback;
}

// ---- Native-safe number formatting (web @/lib/numberFormat) ------------------
// fmtNumber/fmtInt ported with the web global defaults: precision 2, locale
// en-US (fmtInt == precision 0). The parity tree has no useSettings overrides.

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeNumber(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = DEFAULT_PRECISION): string {
  try {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

// ---- Native-safe temperature formatter (web useUnits().formatTemperature) ----
// The web hook converts an SI Celsius value to the user's unit and appends the
// suffix with NO space before the ° unit. With no settings wiring here, the
// SI-floor default ('°C', convertTempFromSI identity, precision 1) is used.

const DEFAULT_TEMP_UNIT = '°C';
const DEFAULT_TEMP_PRECISION = 1;

function formatTemperature(value: number): string {
  return `${fmtNumber(value, DEFAULT_TEMP_PRECISION)}${DEFAULT_TEMP_UNIT}`;
}

// ---- Neon colour map (web @/lib/tokens neonColorMap) ------------------------
// `text` = Tailwind 300-level shade; `bg`/`ring` = the neon hue at 10% / 20%
// alpha (tailwind.config.js neon palette). Mirrors the web MetricCard icon chip
// `bg-neon-{c}/10 ring-neon-{c}/20` with the icon glyph tinted `text-{c}-300`.

type NeonColor = 'cyan' | 'green' | 'purple';

const NEON_COLOR: Record<
  NeonColor,
  {text: string; bg: string; ring: string}
> = {
  cyan: {text: '#67e8f9', bg: 'rgba(0, 240, 255, 0.1)', ring: 'rgba(0, 240, 255, 0.2)'},
  green: {text: '#6ee7b7', bg: 'rgba(16, 185, 129, 0.1)', ring: 'rgba(16, 185, 129, 0.2)'},
  purple: {text: '#d8b4fe', bg: 'rgba(168, 85, 247, 0.1)', ring: 'rgba(168, 85, 247, 0.2)'},
};

// web `text-[var(--neon-cyan)]` header tint (tailwind neon-cyan == #00f0ff).
const NEON_CYAN = '#00f0ff';

// web L2 lucide glyphs -> native SemanticIcon glyph vocabulary.
const COG_GLYPH = getSemanticIconDefinition('settingsAlt').glyph;
const SETTINGS_GLYPH = getSemanticIconDefinition('settings').glyph;
const BATTERY_GLYPH = getSemanticIconDefinition('battery').glyph;
const BOLT_GLYPH = getSemanticIconDefinition('bolt').glyph;
const ACTIVITY_GLYPH = getSemanticIconDefinition('activity').glyph;
const GAUGE_GLYPH = getSemanticIconDefinition('speedCircle').glyph;
const THERMOMETER_GLYPH = getSemanticIconDefinition('climate').glyph;

// ---- Local MetricCard (web @/components/data-display MetricCard) -------------
// Reproduces the web card: a text column (metric-label eyebrow + bold value)
// beside a right-aligned colour-tinted icon chip holding the SemanticIcon glyph.
// Only the slots this file uses are ported (label/value/icon/color).

function MetricCard({
  label,
  value,
  icon,
  color = 'cyan',
}: {
  label: string;
  value: string;
  icon: string;
  color?: NeonColor;
}): React.ReactElement {
  const c = NEON_COLOR[color];

  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.cardText}>
          <AppText numberOfLines={1} style={styles.metricLabel} tone="muted">
            {label}
          </AppText>
          <AppText style={styles.metricValue}>{value}</AppText>
        </View>
        <View
          style={[styles.iconChip, {backgroundColor: c.bg, borderColor: c.ring}]}>
          <AppText style={[styles.iconGlyph, {color: c.text}]}>{icon}</AppText>
        </View>
      </View>
    </View>
  );
}

MetricCard.displayName = 'MetricCard';

// ---- Component --------------------------------------------------------------

interface MotorSectionProps {
  motorData: MotorSnapshot | null | undefined;
}

export function MotorSection({
  motorData,
}: MotorSectionProps): React.ReactElement {
  const t = useNativeTranslationFallback();

  // web L19-22: warmer of the two motor temperatures, null when no motorData.
  const maxMotorTemp = motorData
    ? Math.max(
        motorData.motor_temp_c_front ?? -Infinity,
        motorData.motor_temp_c_rear ?? -Infinity,
      )
    : null;

  // web L24-28: pack-voltage proxy — prefer the rear bus voltage then the front.
  // power_kw / regen_kw have no backing signal, so the two raw inputs (voltage
  // and current) are surfaced rather than a fabricated derived value.
  const vbat = motorData?.vbat_rear ?? motorData?.vbat_front ?? null;

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.header}>
        <AppText style={[styles.headerIcon, {color: NEON_CYAN}]}>
          {COG_GLYPH}
        </AppText>
        <AppText style={styles.headerTitle}>
          {t('vehicles.detail.motor', 'Powertrain')}
        </AppText>
      </View>
      {motorData ? (
        <View style={styles.grid}>
          <View style={styles.cell}>
            <MetricCard
              color="cyan"
              icon={SETTINGS_GLYPH}
              label={t('vehicles.detail.shiftState', 'Shift State')}
              value={motorData.shift_state ?? '—'}
            />
          </View>
          <View style={styles.cell}>
            <MetricCard
              color="purple"
              icon={BATTERY_GLYPH}
              label={t('vehicles.detail.packVoltage', 'Pack Voltage')}
              value={vbat != null ? `${fmtNumber(vbat)} V` : '—'}
            />
          </View>
          <View style={styles.cell}>
            <MetricCard
              color="green"
              icon={BOLT_GLYPH}
              label={t('vehicles.detail.motorCurrentFront', 'Motor Current (F)')}
              value={
                motorData.motor_current_front != null
                  ? `${fmtNumber(motorData.motor_current_front)} A`
                  : '—'
              }
            />
          </View>
          <View style={styles.cell}>
            <MetricCard
              color="cyan"
              icon={ACTIVITY_GLYPH}
              label={t('vehicles.detail.torqueFront', 'Front Torque')}
              value={
                motorData.torque_nm_front != null
                  ? `${fmtNumber(motorData.torque_nm_front)} Nm`
                  : '—'
              }
            />
          </View>
          <View style={styles.cell}>
            <MetricCard
              color="purple"
              icon={ACTIVITY_GLYPH}
              label={t('vehicles.detail.torqueRear', 'Rear Torque')}
              value={
                motorData.torque_nm_rear != null
                  ? `${fmtNumber(motorData.torque_nm_rear)} Nm`
                  : '—'
              }
            />
          </View>
          <View style={styles.cell}>
            <MetricCard
              color="cyan"
              icon={GAUGE_GLYPH}
              label={t('vehicles.detail.rpmFront', 'Front RPM')}
              value={
                motorData.motor_rpm_front != null
                  ? `${fmtInt(motorData.motor_rpm_front)}`
                  : '—'
              }
            />
          </View>
          <View style={styles.cell}>
            <MetricCard
              color="purple"
              icon={GAUGE_GLYPH}
              label={t('vehicles.detail.rpmRear', 'Rear RPM')}
              value={
                motorData.motor_rpm_rear != null
                  ? `${fmtInt(motorData.motor_rpm_rear)}`
                  : '—'
              }
            />
          </View>
          <View style={styles.cell}>
            <MetricCard
              color="green"
              icon={THERMOMETER_GLYPH}
              label={t('vehicles.detail.motorTemp', 'Motor Temp (peak)')}
              value={
                maxMotorTemp != null && isFiniteNumber(maxMotorTemp)
                  ? formatTemperature(maxMotorTemp)
                  : '—'
              }
            />
          </View>
        </View>
      ) : (
        <View style={styles.emptyState}>
          <AppText style={styles.emptyText} tone="muted">
            {t('vehicles.detail.noMotorData', 'No motor data available')}
          </AppText>
        </View>
      )}
    </GlassPanel>
  );
}

MotorSection.displayName = 'MotorSection';

const GRID_GUTTER = 12; // web gap-3

const styles = StyleSheet.create({
  // web GlassPanel `p-6` (L31).
  panel: {
    padding: 24,
  },
  // web header `flex items-center gap-2 mb-4` (L32).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  // web Cog `h-4 w-4 text-[var(--neon-cyan)]` (L33) rendered as a glyph.
  headerIcon: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // web title `text-lg font-bold text-[var(--text-primary)]` (L34).
  headerTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  // web grid `grid grid-cols-2 gap-3 …` (L39) -> a 2-column row-wrap grid; the
  // negative gutters reproduce gap-3 (12) without percentage-vs-gap overflow.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -GRID_GUTTER / 2,
    marginBottom: -GRID_GUTTER,
  },
  cell: {
    width: '50%',
    paddingHorizontal: GRID_GUTTER / 2,
    marginBottom: GRID_GUTTER,
  },
  // web MetricCard root `p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]`.
  card: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  // web inner `flex items-start justify-between gap-2`.
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  // web text column `flex-1 min-w-0`.
  cardText: {
    flex: 1,
    minWidth: 0,
  },
  // web `metric-label mb-1 text-[10px] truncate` (uppercase tracking-wider muted).
  metricLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  // web value `text-xl font-bold tracking-tight text-[var(--text-primary)]`.
  metricValue: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  // web icon chip `flex items-center justify-center rounded-lg p-1.5 ring-1 shrink-0`.
  iconChip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    padding: 6,
    flexShrink: 0,
  },
  // web icon `h-4 w-4` tinted `c.text`; rendered as the SemanticIcon glyph.
  iconGlyph: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // web EmptyState root `flex flex-col items-center justify-center py-16 text-center`.
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  // web EmptyState message `Text variant="bodySm" max-w-md` (centred).
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 448,
    textAlign: 'center',
  },
});
