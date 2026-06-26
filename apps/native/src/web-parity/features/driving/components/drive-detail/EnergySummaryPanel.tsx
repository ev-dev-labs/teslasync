// Native parity port of
// web/src/features/driving/components/drive-detail/EnergySummaryPanel.tsx.
//
// Replaces the DOM <h3>/<div>/<p>/<span> grid, the lucide-react
// <BatteryCharging /> header icon, the shared web GlassPanel/FadeIn, the
// useUnits hook, and the @/lib/numberFormat fmtNumber/fmtWithUnit helpers with
// React Native primitives (View/AppText), the native GlassPanel + parity FadeIn,
// the canonical "batteryCharging" SemanticIcon glyph, and inlined unit/format
// helpers derived from the native useSettings query (matching the self-contained
// native-parity convention used across this layer).
//
// Behavior preserved verbatim:
//   • Energy Consumed / Recovered / Net Consumption switch to kWh above 1000 Wh,
//     otherwise render whole-Wh values, exactly like the source ternaries.
//   • Efficiency converts SI Wh/km to Wh/mi (× 1.609344) only when the user's
//     distance preference is miles, falling back to an em-dash for ≤ 0 values.
//   • Battery Used shows the start→end delta plus the raw start/end percentages;
//     Range Used shows the SI range delta in the user's distance unit.
//
// Unit handling: web useUnits.unitPrefs.distance === deriveDistance(unit_of_length)
// ('mi' selects miles, everything else km). web fmtNumber/fmtWithUnit read the
// global precision (default 2) + locale set by useSettings; those globals are
// reproduced here by reading settings.decimal_precision / settings.locale.
//
// Type sourcing:
//   • DriveDetail -> imported from the already-ported native useDriving hook
//     (the canonical native home of the web @/types/driving DriveDetail; its
//     Drive base supplies startBatteryPct / endBatteryPct). No type duplication.
//   • DriveStats -> the sibling ./types module is not yet ported, so the shape
//     is inlined locally (mirrored verbatim from the web drive-detail types.ts),
//     matching the inlined-sibling-type precedent (MonthlyCostChart/SessionCurve).
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback} from 'react';
import {StyleSheet, View} from 'react-native';

import {useSettings} from '../../../../api/hooks/useSettings';
import type {DriveDetail} from '../../../../api/hooks/useDriving';
import {FadeIn} from '../../../../components/motion/FadeIn';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../../theme/tokens';

const EM_DASH = '\u2014';
const ARROW = '\u2192';
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;
// web toEfficiencyDisplay: Wh/km -> Wh/mi (1 mi = 1.609344 km) when miles.
const KM_PER_MILE = 1.609344;
// Above this many watt-hours the source promotes the value to kWh.
const KWH_THRESHOLD_WH = 1000;
const WH_PER_KWH = 1000;

// web @/lib/unitConversion DistanceUnitPref (km / mi branches this caller hits).
type DistanceUnit = 'km' | 'mi';

// Inlined sibling ./types DriveStats (module not yet ported). Mirrored verbatim
// from web/src/features/driving/components/drive-detail/types.ts so a real
// DriveStats stays structurally assignable to this panel's prop.
interface DriveStats {
  maxSpd: number;
  avgSpd: number;
  minSpd: number;
  powerMax: number;
  powerMin: number;
  avgPower: number;
  energyWh: number;
  regenWh: number;
  consumptionWhKm: number;
  elevGain: number;
  elevLoss: number;
  avgOutsideTemp: number | null;
  avgInsideTemp: number | null;
  hasAnyTemp: boolean;
  insideTemps: number[];
  outsideTemps: number[];
  driverTemps: number[];
  passengerTemps: number[];
  climateStatus: string | null;
  avgFanSpeed: number | null;
  maxFanSpeed: number | null;
  startRange: number | null;
  endRange: number | null;
  odometerStart: number;
  odometerEnd: number;
  hasTirePressure: boolean;
  efficiencyPctPer100: number | null;
}

export interface EnergySummaryPanelProps {
  drive: DriveDetail;
  stats: DriveStats;
}

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while keeping
// every key at the call site. Every call here uses the t(key, fallback) shape.
type TFunc = (key: string, fallback?: string) => string;

function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/hooks/useUnits + @/lib/numberFormat ────────────────────── */

// web useUnits deriveDistance: 'mi' selects miles, everything else km.
function deriveDistance(unitOfLength: string | undefined): DistanceUnit {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

// web numberFormat global locale: settings.locale when non-empty, else en-US.
function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

// web numberFormat global precision (set by useSettings, default 2).
function derivePrecision(decimalPrecision: unknown): number {
  if (
    typeof decimalPrecision !== 'number' ||
    !Number.isFinite(decimalPrecision) ||
    decimalPrecision < 0
  ) {
    return DEFAULT_PRECISION;
  }
  return Math.floor(decimalPrecision);
}

// web @/lib/numberFormat safeNumber: nullish/NaN -> 0.
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web @/lib/numberFormat fmtNumber: locale-aware separators with a fixed
// fraction-digit count (min === max), falling back to en-US for bad locales.
function fmtNumber(value: unknown, decimals: number, locale: string): string {
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
}

// web @/lib/numberFormat fmtWithUnit: `${fmtNumber(v)} ${unit}`.
function fmtWithUnit(
  value: unknown,
  unit: string,
  decimals: number,
  locale: string,
): string {
  return `${fmtNumber(value, decimals, locale)} ${unit}`;
}

const BATTERY_GLYPH = getSemanticIconDefinition('batteryCharging').glyph;

/**
 * EnergySummaryPanel — drive-detail energy KPIs (consumed / recovered / net /
 * efficiency / battery used / range used) rendered in a responsive tile grid.
 */
export function EnergySummaryPanel({drive, stats}: EnergySummaryPanelProps) {
  const {t} = useTranslation();
  const {data: settings} = useSettings();

  const distanceUnit = deriveDistance(settings?.unit_of_length);
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);

  const toEfficiencyDisplay = (whPerKm: number) =>
    distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const energyConsumed =
    stats.energyWh > KWH_THRESHOLD_WH
      ? fmtWithUnit(stats.energyWh / WH_PER_KWH, 'kWh', precision, locale)
      : `${fmtNumber(stats.energyWh, precision, locale)} Wh`;

  const energyRecovered =
    stats.regenWh > KWH_THRESHOLD_WH
      ? fmtWithUnit(stats.regenWh / WH_PER_KWH, 'kWh', precision, locale)
      : `${fmtNumber(stats.regenWh, precision, locale)} Wh`;

  const net = stats.energyWh - stats.regenWh;
  const netConsumption =
    net > KWH_THRESHOLD_WH
      ? fmtWithUnit(net / WH_PER_KWH, 'kWh', precision, locale)
      : `${fmtNumber(net, precision, locale)} Wh`;

  const efficiency =
    stats.consumptionWhKm > 0
      ? `${fmtNumber(
          toEfficiencyDisplay(stats.consumptionWhKm),
          precision,
          locale,
        )} ${efficiencyUnit}`
      : EM_DASH;

  const batteryUsedMain =
    drive.startBatteryPct != null && drive.endBatteryPct != null
      ? `${drive.startBatteryPct - drive.endBatteryPct}%`
      : EM_DASH;
  const batterySub = `${drive.startBatteryPct ?? '?'}% ${ARROW} ${
    drive.endBatteryPct ?? '?'
  }%`;

  const rangeUsed =
    stats.startRange != null && stats.endRange != null
      ? fmtWithUnit(
          stats.startRange - stats.endRange,
          distanceUnit,
          precision,
          locale,
        )
      : EM_DASH;

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <View style={styles.header}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.headerIcon}
            weight="bold">
            {BATTERY_GLYPH}
          </AppText>
          <AppText style={styles.headerTitle} weight="semibold">
            {t('driveDetail.energySummary', 'Energy Summary')}
          </AppText>
        </View>

        <View style={styles.grid}>
          <View style={styles.cell}>
            <AppText style={styles.cellLabel}>
              {t('driveDetail.energyConsumed', 'Energy Consumed')}
            </AppText>
            <AppText style={[styles.cellValue, styles.amber]}>
              {energyConsumed}
            </AppText>
          </View>

          <View style={styles.cell}>
            <AppText style={styles.cellLabel}>
              {t('driveDetail.energyRecovered', 'Energy Recovered')}
            </AppText>
            <AppText style={[styles.cellValue, styles.green]}>
              {energyRecovered}
            </AppText>
          </View>

          <View style={styles.cell}>
            <AppText style={styles.cellLabel}>
              {t('driveDetail.netConsumption', 'Net Consumption')}
            </AppText>
            <AppText style={[styles.cellValue, styles.cyan]}>
              {netConsumption}
            </AppText>
          </View>

          <View style={styles.cell}>
            <AppText style={styles.cellLabel}>
              {t('driveDetail.efficiency', 'Efficiency')}
            </AppText>
            <AppText style={[styles.cellValue, styles.purple]}>
              {efficiency}
            </AppText>
          </View>

          <View style={styles.cell}>
            <AppText style={styles.cellLabel}>
              {t('driveDetail.batteryUsed', 'Battery Used')}
            </AppText>
            <AppText style={[styles.cellValue, styles.amber]}>
              {batteryUsedMain}
              <AppText style={styles.batterySub}>{` ${batterySub}`}</AppText>
            </AppText>
          </View>

          <View style={styles.cell}>
            <AppText style={styles.cellLabel}>
              {t('driveDetail.rangeUsed', 'Range Used')}
            </AppText>
            <AppText style={[styles.cellValue, styles.green]}>
              {rangeUsed}
            </AppText>
          </View>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

EnergySummaryPanel.displayName = 'EnergySummaryPanel';

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerIcon: {
    color: colors.success,
    fontSize: 14,
    lineHeight: 18,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  cell: {
    alignItems: 'center',
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 96,
  },
  cellLabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  cellValue: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    textAlign: 'center',
  },
  batterySub: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
  },
  amber: {
    color: colors.warning,
  },
  green: {
    color: colors.success,
  },
  cyan: {
    color: colors.accent,
  },
  purple: {
    color: colors.violet,
  },
});
