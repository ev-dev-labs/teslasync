// TemperatureSection — native parity port of
// web/src/features/driving/components/drive-detail/TemperatureSection.tsx.
//
// The web component is a drive-detail chart card: up to six summary stat tiles
// (outside / inside / driver / passenger temperature, climate status, fan
// status) above a multi-line Recharts temperature trace (outside / inside /
// driver / passenger lines over the drive timeline), or a centred empty state
// when there is < 2 samples / no temperature telemetry. It is wrapped in
// `FadeIn` and a `ChartContainer` (height 310, ariaLabel, chart-a11y:no-table).
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - react-i18next useTranslation (web L1) -> native-safe t(key, fallback)
//     keeping every driveDetail.* key + English fallback verbatim.
//   - lucide-react Activity (web L2): lucide is browser-only SVG and forbidden
//     in native output (rule 4). The empty-state Activity glyph -> the native
//     SemanticIcon 'activity' (its `AC` glyph), kept faint via opacity 0.2 to
//     mirror the web `opacity-20`.
//   - `@/components/charts` Recharts stack (web L3-10): ChartContainer comes
//     from the native charts barrel (a real native impl). The Recharts
//     LineChart/Line/Legend/ReferenceLine/XAxis/YAxis/CartesianGrid/Tooltip/
//     ResponsiveContainer + ChartTooltip + AREA_DEFAULTS SVG stack is
//     re-expressed through the native AreaChartWrapper (multi-series native
//     chart with per-series colour, null gaps, latest-value legend) because
//     React Native has no SVG cartesian backend. The cursor-sync hooks
//     (useSyncedCursor / useSyncedReferenceLineX) drive a cross-chart hover
//     ReferenceLine — a browser pointer interaction that is unavailable in RN,
//     so it is dropped (documented in the .parity.json capabilities).
//   - `@/lib/tokens` chartTokens (web L11): only fed the dropped cursor
//     ReferenceLine styling -> dropped with the cursor sync.
//   - `@/components/motion` FadeIn (web L12) -> a local reduced-motion-aware
//     FadeIn (Animated.View), the SummaryStatsGrid precedent.
//   - `@/hooks/useUnits` useUnits().unitPrefs.temperature (web L13/25-26): the
//     temperature display suffix. This parity tree has no settings wiring, so
//     the web SI-floor default ('°C', deriveTemperature() when unit_of_temp is
//     not 'F') is used directly as `tempUnit`.
//   - `@/lib/numberFormat` fmtNumber/fmtInt (web L14) -> ported inline with the
//     web global defaults (precision 2 / locale en-US; fmtInt == precision 0).
//   - `./helpers` LEGEND_STYLE (web L15): only styled the dropped Recharts
//     Legend wrapper -> dropped (AreaChartWrapper ships its own legend).
//   - `./types` ChartDataPoint / DriveStats (web L16) -> reproduced inline
//     (the sibling native types.ts is owned by its own conversion turn).
// No DOM / lucide-react / Recharts / Leaflet / old web-UI imports — RN
// primitives only. See the .parity.json sidecar for the line-by-line map.

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {ChartContainer} from '../../../../components/charts';
import {AreaChartWrapper} from '../../../../components/charts/AreaChartWrapper';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key, fallback) => fallback;
}

// ---- Native-safe temperature unit suffix (web useUnits().unitPrefs.temperature)
// The web hook derives the suffix from settings.unit_of_temp ('F' -> '°F', else
// '°C'). With no settings wiring in this parity tree, the SI-floor default '°C'
// is used directly. The chartData/stats values are already in display units
// upstream (useDriveDetailData), so this is purely the display suffix.

const DEFAULT_TEMP_UNIT = '°C';

// ---- Native-safe number formatting (web @/lib/numberFormat) ------------------
// fmtNumber/fmtInt ported with the web global defaults: precision 2, locale
// en-US (fmtInt == precision 0). The parity tree has no useSettings overrides.

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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

// ---- Types (reproduced from ./types.ts) ------------------------------------
// ChartDataPoint + DriveStats reproduced field-for-field so the prop contract
// matches the web source exactly (sibling native types.ts is its own turn).

interface ChartDataPoint {
  time: string;
  speed: number;
  battery: number;
  elevation: number;
  power: number;
  outsideTemp: number | null;
  insideTemp: number | null;
  driverTemp: number | null;
  passengerTemp: number | null;
  idealRange: number | null;
  ratedRange: number | null;
  estRange: number | null;
  odometer: number | null;
  soc: number | null;
  usableSoc: number | null;
  tireFl: number | null;
  tireFr: number | null;
  tireRl: number | null;
  tireRr: number | null;
  climateOn: boolean | null;
  fanStatus: number | null;
}

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

// ---- Stat-tile + chart colours (web Tailwind / Recharts strokes) -----------

const TILE_COLOR_OUTSIDE = '#60a5fa'; // text-blue-400
const TILE_COLOR_INSIDE = '#fb923c'; // text-orange-400
const TILE_COLOR_DRIVER = '#fb7185'; // text-rose-400
const TILE_COLOR_PASSENGER = '#c084fc'; // text-purple-400
const TILE_COLOR_CLIMATE_ON = '#4ade80'; // text-green-400
const TILE_COLOR_FAN = '#22d3ee'; // text-cyan-400

const LINE_COLOR_OUTSIDE = '#3b82f6'; // Recharts outsideTemp stroke
const LINE_COLOR_INSIDE = '#f97316'; // Recharts insideTemp stroke
const LINE_COLOR_DRIVER = '#fb7185'; // Recharts driverTemp stroke
const LINE_COLOR_PASSENGER = '#a855f7'; // Recharts passengerTemp stroke

// ---- Layout constants ------------------------------------------------------
// Web ChartContainer height={310} sized the card body (stat tiles + the 220-tall
// Recharts ResponsiveContainer) and grew via h-full. The native ChartContainer
// body is a fixed-height clip, so the height is computed from the visible tile
// rows + chart so no content is clipped (the faithful analog of web h-full).

const CHART_PLOT_HEIGHT = 220; // web ResponsiveContainer height={220}
const EMPTY_CONTAINER_HEIGHT = 310; // web ChartContainer height={310}
const TILE_ROW_HEIGHT = 56;
const TILE_ROW_GAP = 12; // gap-3
const TILES_MARGIN_BOTTOM = 12; // mb-3
const TILES_PER_ROW = 3; // grid-cols-3

// ---- Reduced-motion awareness (web prefers-reduced-motion) ------------------

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

// ---- Reduced-motion-aware FadeIn (web @/components/motion FadeIn) ------------
// Reproduces the web initial {opacity:0, y:12} -> animate {opacity:1, y:0}
// easeOut entrance; reduced motion collapses to the final state (web no-op).

const FADE_IN_DURATION_MS = 400;
const FADE_IN_TRANSLATE_Y = 12;

function FadeIn({
  children,
  reduceMotion,
}: {
  children: React.ReactNode;
  reduceMotion: boolean;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      duration: FADE_IN_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [FADE_IN_TRANSLATE_Y, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

// ---- Stat tile (web `rounded-lg bg-white/[0.03] border ... p-2 text-center`) -

function StatTile({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor: string;
}): React.ReactElement {
  return (
    <View style={styles.tile}>
      <AppText numberOfLines={1} style={styles.tileLabel} tone="muted">
        {label}
      </AppText>
      <AppText numberOfLines={1} style={[styles.tileValue, {color: valueColor}]}>
        {value}
      </AppText>
    </View>
  );
}

interface TemperatureSectionProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
}

export function TemperatureSection({
  chartData,
  stats,
}: TemperatureSectionProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const reduceMotion = useReduceMotion();
  const tempUnit = DEFAULT_TEMP_UNIT;

  // web L30-35: driver / passenger averages, null when there are no samples.
  const driverAvg =
    stats.driverTemps.length > 0
      ? stats.driverTemps.reduce((a, b) => a + b, 0) / stats.driverTemps.length
      : null;
  const passengerAvg =
    stats.passengerTemps.length > 0
      ? stats.passengerTemps.reduce((a, b) => a + b, 0) /
        stats.passengerTemps.length
      : null;

  // web L46: render the chart only with >1 sample and at least one temp series.
  const hasChart = chartData.length > 1 && stats.hasAnyTemp;

  // web L98-109: one chart series per non-empty temperature array, named
  // `${label} ${tempUnit}` exactly like the Recharts Line `name`.
  const series = useMemo(() => {
    const built: {key: string; label: string; color: string}[] = [];
    if (stats.outsideTemps.length > 0) {
      built.push({
        key: 'outsideTemp',
        label: `${t('driveDetail.outside', 'Outside')} ${tempUnit}`,
        color: LINE_COLOR_OUTSIDE,
      });
    }
    if (stats.insideTemps.length > 0) {
      built.push({
        key: 'insideTemp',
        label: `${t('driveDetail.inside', 'Inside')} ${tempUnit}`,
        color: LINE_COLOR_INSIDE,
      });
    }
    if (stats.driverTemps.length > 0) {
      built.push({
        key: 'driverTemp',
        label: `${t('driveDetail.driver', 'Driver')} ${tempUnit}`,
        color: LINE_COLOR_DRIVER,
      });
    }
    if (stats.passengerTemps.length > 0) {
      built.push({
        key: 'passengerTemp',
        label: `${t('driveDetail.passenger', 'Passenger')} ${tempUnit}`,
        color: LINE_COLOR_PASSENGER,
      });
    }
    return built;
  }, [
    stats.outsideTemps.length,
    stats.insideTemps.length,
    stats.driverTemps.length,
    stats.passengerTemps.length,
    t,
    tempUnit,
  ]);

  // web L48-85: the up-to-six summary stat tiles, each conditional on its value.
  const tiles = useMemo(() => {
    const built: {key: string; label: string; value: string; color: string}[] =
      [];
    if (stats.avgOutsideTemp != null) {
      built.push({
        key: 'outside',
        label: t('driveDetail.outsideTemp', 'Outside Temperature'),
        value: `${fmtNumber(stats.avgOutsideTemp)}${tempUnit}`,
        color: TILE_COLOR_OUTSIDE,
      });
    }
    if (stats.avgInsideTemp != null) {
      built.push({
        key: 'inside',
        label: t('driveDetail.insideTemp', 'Inside Temperature'),
        value: `${fmtNumber(stats.avgInsideTemp)}${tempUnit}`,
        color: TILE_COLOR_INSIDE,
      });
    }
    if (driverAvg != null) {
      built.push({
        key: 'driver',
        label: t('driveDetail.driverTemp', 'Driver Temperature'),
        value: `${fmtNumber(driverAvg)}${tempUnit}`,
        color: TILE_COLOR_DRIVER,
      });
    }
    if (passengerAvg != null) {
      built.push({
        key: 'passenger',
        label: t('driveDetail.passengerTemp', 'Passenger Temperature'),
        value: `${fmtNumber(passengerAvg)}${tempUnit}`,
        color: TILE_COLOR_PASSENGER,
      });
    }
    if (stats.climateStatus != null) {
      built.push({
        key: 'climate',
        label: t('driveDetail.climate', 'Climate'),
        value: stats.climateStatus,
        color:
          stats.climateStatus === 'On' ? TILE_COLOR_CLIMATE_ON : colors.textMuted,
      });
    }
    if (stats.maxFanSpeed != null) {
      built.push({
        key: 'fan',
        label: t('driveDetail.fanStatus', 'Fan Status'),
        value: `${t('driveDetail.avg', 'Avg')} ${fmtInt(
          stats.avgFanSpeed,
        )} · Max ${stats.maxFanSpeed}`,
        color: TILE_COLOR_FAN,
      });
    }
    return built;
  }, [
    stats.avgOutsideTemp,
    stats.avgInsideTemp,
    stats.climateStatus,
    stats.avgFanSpeed,
    stats.maxFanSpeed,
    driverAvg,
    passengerAvg,
    t,
    tempUnit,
  ]);

  // Native chartBody clips overflow, so size the container to fit the tile rows
  // + chart (the analog of the web h-full growth). Empty state keeps web 310.
  const tileRows = Math.ceil(tiles.length / TILES_PER_ROW);
  const tilesBlockHeight =
    tileRows > 0
      ? tileRows * TILE_ROW_HEIGHT +
        (tileRows - 1) * TILE_ROW_GAP +
        TILES_MARGIN_BOTTOM
      : 0;
  const containerHeight = hasChart
    ? tilesBlockHeight + CHART_PLOT_HEIGHT
    : EMPTY_CONTAINER_HEIGHT;

  return (
    <FadeIn reduceMotion={reduceMotion}>
      {/* chart-a11y:no-table dense per-sample temperature trace; min/avg stats
          appear above the chart in the stat tiles (no data table passed). */}
      <ChartContainer
        ariaLabel={t(
          'driveDetail.temperatures.aria',
          'Inside, outside, driver and passenger temperature lines over the drive timeline',
        )}
        height={containerHeight}
        title={t('driveDetail.temperatures', 'Temperatures')}>
        {hasChart ? (
          <View style={styles.chartContent}>
            <View style={styles.tilesGrid}>
              {tiles.map(tile => (
                <StatTile
                  key={tile.key}
                  label={tile.label}
                  value={tile.value}
                  valueColor={tile.color}
                />
              ))}
            </View>
            <AreaChartWrapper
              data={chartData as unknown as Record<string, unknown>[]}
              height={CHART_PLOT_HEIGHT}
              series={series}
              xKey="time"
              yFormatter={value => fmtNumber(value, 1)}
            />
          </View>
        ) : (
          <View style={styles.emptyState}>
            <SemanticIcon decorative name="activity" style={styles.emptyIcon} />
            <AppText style={styles.emptyText} tone="muted">
              {t(
                'driveDetail.noTemperatureData',
                'No temperature telemetry is available for this drive.',
              )}
            </AppText>
          </View>
        )}
      </ChartContainer>
    </FadeIn>
  );
}

TemperatureSection.displayName = 'TemperatureSection';

const styles = StyleSheet.create({
  chartContent: {
    flex: 1,
  },
  tilesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TILE_ROW_GAP,
    marginBottom: TILES_MARGIN_BOTTOM,
  },
  tile: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 90,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    padding: spacing.sm,
  },
  tileLabel: {
    fontSize: 9,
    lineHeight: 12,
    textAlign: 'center',
  },
  tileValue: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptyIcon: {
    opacity: 0.2,
  },
  emptyText: {
    fontSize: 12,
    textAlign: 'center',
  },
});
