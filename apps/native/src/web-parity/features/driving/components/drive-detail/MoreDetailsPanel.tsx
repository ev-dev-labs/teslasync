// Native parity port of
// web/src/features/driving/components/drive-detail/MoreDetailsPanel.tsx.
//
// The web component is the Drive Detail "More Details" card: a FadeIn-wrapped
// GlassPanel (p-5) with an Activity-iconed "More Details" title, followed by two
// grids of centered metric tiles —
//   Grid 1 (grid-cols-2 → 7, gap-4): Odometer (From → To), Range (Start → End),
//     Elevation Summary (gain ↗ / loss ↘), Energy Consumed, Energy Recovered,
//     Consumption.
//   Grid 2 (border-top divider, grid-cols-2 → 4, gap-4): Avg Power, Avg Outside
//     Temp (only when non-null), Avg Inside Temp (only when non-null), Min Speed,
//     Battery Used, Net Consumption.
// This native port preserves that contract 1:1 using React Native primitives +
// the existing native GlassPanel / AppText / theme tokens. No DOM element,
// Recharts, Leaflet, lucide DOM SVG, framer-motion, or old web @/components
// import appears in the output.
//
// Unit handling is preserved exactly as the web does it: the ONLY value the web
// actually converts is Consumption (Wh/km → Wh/mi via *1.609344 when distance is
// 'mi'); odometer / range / speed / temperature values are rendered verbatim with
// only their unit *label* appended (distanceUnit / speedUnit / tempUnit), so no
// new unit math (and therefore no unit drift) is introduced.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next `useTranslation` (web L1): no native i18next runtime, so an
//     inline `useNativeTranslation()` returns `t(key, fallback) = fallback ?? key`
//     — every i18n key + English default is preserved verbatim.
//   - lucide-react `Activity` / `ArrowUpRight` / `ArrowDownRight` (web L2): DOM
//     SVG icons → text glyphs. `Activity` → 📈 (the established native Activity
//     stand-in used by SummaryHeroCards / QuickNav / ChargingSection). The two
//     arrows → the colour-inheriting diagonal glyphs ↗ (U+2197) / ↘ (U+2198) so
//     the web `text-green-400` / `text-red-400` currentColor is preserved (sized
//     12px to match the web `h-3 w-3`).
//   - `@/components/ui` GlassPanel (web L3): GlassPanel → native GlassPanel.
//   - `@/components/motion` FadeIn (web L4): framer-motion entrance → a native
//     Animated fade/translate entry honouring the reduce-motion preference (the
//     established DriveTimeline / SummaryHeroCards convention).
//   - `useUnits` (web L5): no native useUnits hook is ported yet, so an inline
//     native-safe hook derives the same {distance, speed, temperature} prefs from
//     the web-parity `useSettings()` query exactly as the web hook does
//     (unit_of_length 'mi' → 'mi'/'mph', else 'km'/'km/h'; unit_of_temp 'F' →
//     '°F', else '°C').
//   - `fmtNumber` / `fmtInt` / `fmtWithUnit` (web L6): ported from
//     web/src/lib/numberFormat.ts (safeNumber → 0, min=max fraction digits). The
//     web globals (precision + locale, set elsewhere by useSettings) are
//     approximated by the en-US / precision-2 default — the established native
//     numberFormat convention (DrivingPerformanceCards / LifetimeSummary).
//   - `@/types/driving` `DriveDetail` (web L7) + `./types` `DriveStats` (web L8):
//     those type modules are not yet ported, so the consumed subset of each is
//     mirrored as a local interface (field names + SI semantics byte-for-byte).

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

import {useSettings} from '../../../../api/hooks/useSettings';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

/* ── ported: ./types DriveStats (consumed subset) ─────────────────────────── */

interface DriveStats {
  /** Average power in kW (display unit, kept verbatim from web). */
  avgPower: number;
  /** Energy consumed in watt-hours (Wh, SI canonical). */
  energyWh: number;
  /** Energy recovered via regen in watt-hours (Wh, SI canonical). */
  regenWh: number;
  /** Consumption in watt-hours per kilometre (Wh/km, SI floor). */
  consumptionWhKm: number;
  /** Elevation gained over the drive, in metres. */
  elevGain: number;
  /** Elevation lost over the drive, in metres. */
  elevLoss: number;
  /** Average outside temperature (already in the display unit), or null. */
  avgOutsideTemp: number | null;
  /** Average inside temperature (already in the display unit), or null. */
  avgInsideTemp: number | null;
  /** Minimum speed (already in the display unit). */
  minSpd: number;
  /** Range at drive start (display unit), or null. */
  startRange: number | null;
  /** Range at drive end (display unit), or null. */
  endRange: number | null;
  /** Odometer reading at drive start (display unit). */
  odometerStart: number;
  /** Odometer reading at drive end (display unit). */
  odometerEnd: number;
}

/* ── ported: @/types/driving DriveDetail (consumed subset) ────────────────── */

interface MoreDetailsPanelDrive {
  /** Battery state-of-charge % at drive start, or null. */
  startBatteryPct: number | null;
  /** Battery state-of-charge % at drive end, or null. */
  endBatteryPct: number | null;
}

interface MoreDetailsPanelProps {
  drive: MoreDetailsPanelDrive;
  stats: DriveStats;
}

/* ── native-safe useTranslation (react-i18next has no native runtime) ─────── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ── native-safe useUnits (web useUnits → useSettings derivation, inlined) ── */

type DistanceUnitPref = 'km' | 'mi';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '\u00b0C' | '\u00b0F';

interface UnitPrefs {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  temperature: TemperatureUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const unitOfLength = settings?.unit_of_length;
  const unitOfTemp = settings?.unit_of_temp;
  const unitPrefs = useMemo<UnitPrefs>(
    () => ({
      distance: unitOfLength === 'mi' ? 'mi' : 'km',
      speed: unitOfLength === 'mi' ? 'mph' : 'km/h',
      temperature: unitOfTemp === 'F' ? '\u00b0F' : '\u00b0C',
    }),
    [unitOfLength, unitOfTemp],
  );
  return {unitPrefs};
}

/* ── number formatters (ported from web/src/lib/numberFormat.ts) ──────────── */

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = 2): string {
  const n = safeNumber(value);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

function fmtWithUnit(value: unknown, unit: string, decimals = 2): string {
  return `${fmtNumber(value, decimals)} ${unit}`;
}

/* ── reduce-motion preference (drives the FadeIn entry animation) ─────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

/* ── FadeIn (native-safe port of @/components/motion framer-motion entry) ─── */

function FadeIn({children, delay = 0}: {children: ReactNode; delay?: number}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 400,
      delay: delay * 1000,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion, delay]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

/* ── glyph + colour constants ─────────────────────────────────────────────── */

// lucide-react `Activity` → 📈 (the established native Activity stand-in).
const GLYPH_ACTIVITY = '📈';
// lucide-react `ArrowUpRight` / `ArrowDownRight` → colour-inheriting diagonal
// arrows, sized to the web `h-3 w-3`.
const GLYPH_ARROW_UP_RIGHT = '\u2197'; // ↗
const GLYPH_ARROW_DOWN_RIGHT = '\u2198'; // ↘
// Inline glyphs used inside i18n defaults / value strings.
const ARROW_RIGHT = '\u2192'; // →
const DASH = '\u2014'; // —

// Tailwind text-{colour}-400 hex values (the established native mappings).
const CYAN_400 = '#22d3ee';
const GREEN_400 = '#4ade80';
const RED_400 = '#f87171';
const AMBER_400 = '#fbbf24';
const PURPLE_400 = '#c084fc';
const BLUE_400 = '#60a5fa';
const ORANGE_400 = '#fb923c';
// var(--border-subtle) dark-theme value (web/src/index.css L32).
const BORDER_SUBTLE = 'rgba(255, 255, 255, 0.06)';

/* ── ported: MoreDetailsPanel (web L15-124) ───────────────────────────────── */

export function MoreDetailsPanel({drive, stats}: MoreDetailsPanelProps) {
  const t = useNativeTranslation();
  const {unitPrefs} = useUnits();
  const toEfficiencyDisplay = (whPerKm: number) =>
    unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const odometerText =
    stats.odometerStart && stats.odometerEnd
      ? `${fmtNumber(stats.odometerStart)} ${ARROW_RIGHT} ${fmtNumber(
          stats.odometerEnd,
        )}`
      : DASH;

  const rangeText =
    stats.startRange != null
      ? `${fmtNumber(stats.startRange)} ${ARROW_RIGHT} ${
          stats.endRange != null ? fmtNumber(stats.endRange) : '?'
        }`
      : DASH;

  const energyConsumedText =
    stats.energyWh > 1000
      ? fmtWithUnit(stats.energyWh / 1000, 'kWh')
      : `${fmtNumber(stats.energyWh)} Wh`;

  const energyRecoveredText =
    stats.regenWh > 1000
      ? fmtWithUnit(stats.regenWh / 1000, 'kWh')
      : `${fmtNumber(stats.regenWh)} Wh`;

  const netEnergyWh = stats.energyWh - stats.regenWh;
  const netEnergyText =
    netEnergyWh > 1000
      ? fmtWithUnit(netEnergyWh / 1000, 'kWh')
      : `${fmtNumber(netEnergyWh)} Wh`;

  const batteryUsedText =
    drive.startBatteryPct != null && drive.endBatteryPct != null
      ? `${drive.startBatteryPct - drive.endBatteryPct}%`
      : DASH;

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <View style={styles.titleRow}>
          <AppText style={styles.titleIcon}>{GLYPH_ACTIVITY}</AppText>
          <AppText style={styles.titleText}>
            {t('driveDetail.moreDetails', 'More Details')}
          </AppText>
        </View>

        <View style={styles.grid}>
          {/* Odometer (From → To) */}
          <View style={styles.tile}>
            <AppText style={styles.tileLabel}>
              {t('driveDetail.odometer', `Odometer (From ${ARROW_RIGHT} To)`)}
            </AppText>
            <AppText style={[styles.tileValue, styles.cyanText]}>
              {odometerText}{' '}
              <AppText style={styles.unitSuffix}>{distanceUnit}</AppText>
            </AppText>
          </View>

          {/* Range (Start → End) */}
          <View style={styles.tile}>
            <AppText style={styles.tileLabel}>
              {t('driveDetail.rangeStartEnd', `Range (Start ${ARROW_RIGHT} End)`)}
            </AppText>
            <AppText style={[styles.tileValue, styles.greenText]}>
              {rangeText}{' '}
              <AppText style={styles.unitSuffix}>{distanceUnit}</AppText>
            </AppText>
          </View>

          {/* Elevation Summary */}
          <View style={styles.tile}>
            <AppText style={styles.tileLabel}>
              {t('driveDetail.elevSummary', 'Elevation Summary')}
            </AppText>
            <View style={styles.elevBlock}>
              <View style={styles.elevRow}>
                <AppText style={[styles.elevArrow, styles.greenText]}>
                  {GLYPH_ARROW_UP_RIGHT}
                </AppText>
                <AppText style={[styles.elevValue, styles.greenText]}>
                  {`${fmtNumber(stats.elevGain)} m`}
                </AppText>
              </View>
              <View style={styles.elevRow}>
                <AppText style={[styles.elevArrow, styles.redText]}>
                  {GLYPH_ARROW_DOWN_RIGHT}
                </AppText>
                <AppText style={[styles.elevValue, styles.redText]}>
                  {`${fmtNumber(stats.elevLoss)} m`}
                </AppText>
              </View>
            </View>
          </View>

          {/* Energy Consumed */}
          <View style={styles.tile}>
            <AppText style={styles.tileLabel}>
              {t('driveDetail.energyConsumed', 'Energy Consumed')}
            </AppText>
            <AppText style={[styles.tileValue, styles.amberText]}>
              {energyConsumedText}
            </AppText>
          </View>

          {/* Energy Recovered */}
          <View style={styles.tile}>
            <AppText style={styles.tileLabel}>
              {t('driveDetail.energyRecovered', 'Energy Recovered')}
            </AppText>
            <AppText style={[styles.tileValue, styles.greenText]}>
              {energyRecoveredText}
            </AppText>
          </View>

          {/* Consumption */}
          <View style={styles.tile}>
            <AppText style={styles.tileLabel}>
              {t('driveDetail.consumptionRate', 'Consumption')}
            </AppText>
            <AppText style={[styles.tileValue, styles.purpleText]}>
              {stats.consumptionWhKm > 0
                ? `${fmtNumber(toEfficiencyDisplay(stats.consumptionWhKm))}`
                : DASH}{' '}
              <AppText style={styles.unitSuffix}>{efficiencyUnit}</AppText>
            </AppText>
          </View>
        </View>

        <View style={styles.dividerGrid}>
          {/* Avg Power */}
          <View style={styles.tile}>
            <AppText style={styles.tileLabel}>
              {t('driveDetail.avgPower', 'Avg Power')}
            </AppText>
            <AppText style={[styles.tileValue, styles.amberText]}>
              {fmtNumber(stats.avgPower)}{' '}
              <AppText style={styles.unitSuffix}>kW</AppText>
            </AppText>
          </View>

          {/* Avg Outside Temp (only when non-null) */}
          {stats.avgOutsideTemp !== null && (
            <View style={styles.tile}>
              <AppText style={styles.tileLabel}>
                {t('driveDetail.avgOutsideTemp', 'Avg Outside Temp')}
              </AppText>
              <AppText style={[styles.tileValue, styles.blueText]}>
                {`${fmtNumber(stats.avgOutsideTemp)}${tempUnit}`}
              </AppText>
            </View>
          )}

          {/* Avg Inside Temp (only when non-null) */}
          {stats.avgInsideTemp !== null && (
            <View style={styles.tile}>
              <AppText style={styles.tileLabel}>
                {t('driveDetail.avgInsideTemp', 'Avg Inside Temp')}
              </AppText>
              <AppText style={[styles.tileValue, styles.orangeText]}>
                {`${fmtNumber(stats.avgInsideTemp)}${tempUnit}`}
              </AppText>
            </View>
          )}

          {/* Min Speed */}
          <View style={styles.tile}>
            <AppText style={styles.tileLabel}>
              {t('driveDetail.minSpeed', 'Min Speed')}
            </AppText>
            <AppText style={[styles.tileValue, styles.secondaryText]}>
              {`${fmtInt(stats.minSpd)} ${speedUnit}`}
            </AppText>
          </View>

          {/* Battery Used */}
          <View style={styles.tile}>
            <AppText style={styles.tileLabel}>
              {t('driveDetail.batteryUsed', 'Battery Used')}
            </AppText>
            <AppText style={[styles.tileValue, styles.amberText]}>
              {batteryUsedText}
            </AppText>
          </View>

          {/* Net Consumption */}
          <View style={styles.tile}>
            <AppText style={styles.tileLabel}>
              {t('driveDetail.netEnergy', 'Net Consumption')}
            </AppText>
            <AppText style={[styles.tileValue, styles.cyanText]}>
              {netEnergyText}
            </AppText>
          </View>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

MoreDetailsPanel.displayName = 'MoreDetailsPanel';

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg, // p-5 (20px)
  },
  titleRow: {
    alignItems: 'center',
    columnGap: spacing.sm, // gap-2 (8px)
    flexDirection: 'row',
    marginBottom: spacing.md + 4, // mb-4 (16px)
  },
  titleIcon: {
    color: CYAN_400, // text-cyan-400
    fontSize: 16, // h-4 w-4
  },
  titleText: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between', // grid-cols-2 with gap-4 between columns
    rowGap: spacing.md + 4, // gap-4 (16px) between wrapped rows
  },
  dividerGrid: {
    borderTopColor: BORDER_SUBTLE, // border-[var(--border-subtle)]
    borderTopWidth: 1, // border-t
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: spacing.md + 4, // mt-4 (16px)
    paddingTop: spacing.md + 4, // pt-4 (16px)
    rowGap: spacing.md + 4, // gap-4 (16px)
  },
  tile: {
    alignItems: 'center', // text-center
    width: '48%', // grid-cols-2 (two columns on the mobile breakpoint)
  },
  tileLabel: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 10, // text-[10px]
    marginBottom: spacing.xs, // mb-1 (4px)
    textAlign: 'center',
  },
  tileValue: {
    fontSize: 18, // text-lg
    fontWeight: '700', // font-bold
    textAlign: 'center',
  },
  unitSuffix: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    fontWeight: '700', // inherits the parent font-bold
  },
  elevBlock: {
    alignItems: 'center',
  },
  elevRow: {
    alignItems: 'center',
    columnGap: spacing.xs, // gap-1 (4px)
    flexDirection: 'row',
    justifyContent: 'center', // justify-center
  },
  elevArrow: {
    fontSize: 12, // h-3 w-3
  },
  elevValue: {
    fontSize: 16, // text-base
    fontWeight: '700', // font-bold
  },
  cyanText: {
    color: CYAN_400, // text-cyan-400
  },
  greenText: {
    color: GREEN_400, // text-green-400
  },
  redText: {
    color: RED_400, // text-red-400
  },
  amberText: {
    color: AMBER_400, // text-amber-400
  },
  purpleText: {
    color: PURPLE_400, // text-purple-400
  },
  blueText: {
    color: BLUE_400, // text-blue-400
  },
  orangeText: {
    color: ORANGE_400, // text-orange-400
  },
  secondaryText: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
  },
});
