// Native parity port of
// web/src/features/driving/components/drive-detail/TirePressureSection.tsx.
//
// The Tire Pressure section renders, when the drive carries tire-pressure
// telemetry, four per-wheel min/max summary tiles (Front Left / Front Right /
// Rear Left / Rear Right) above a multi-line trace of the four tire pressures
// over the drive timeline; otherwise it shows the shared "No telemetry data
// available" empty state inside the chart frame.
//
// React Native has no DOM/SVG Recharts backend, so the Recharts tree
// (ResponsiveContainer/LineChart/Line/XAxis/YAxis/CartesianGrid/Tooltip/Legend +
// AREA_DEFAULTS + ChartTooltip) is reproduced with native View/AppText/Pressable
// layers — the same idiom as the already-converted sibling DriveOverviewChart: a
// plot frame with grid lines, an evenly-sampled column per data point, colour-
// coded dots for each active wheel positioned at their normalised Y, a left-hand
// pressure axis, first/middle/last X-axis time ticks, a per-wheel legend, and a
// tap-to-select summary that reproduces the hover Tooltip's per-series value
// content. The shared native ChartContainer still owns the title/aria/height
// frame.
//
// Self-contained native adaptations (documented in the sidecar):
//   - @/components/charts ChartContainer -> the native web-parity charts barrel
//     ChartContainer (title/ariaLabel/height only). Honouring the source's
//     `chart-a11y:no-table` comment, no fallback data table is supplied — the
//     per-wheel min/max tiles carry the tabular summary, exactly as the web
//     intends.
//   - The Recharts ChartTooltip hover affordance has no native equivalent; its
//     intent is preserved by a local tap-to-select cursor + per-wheel summary.
//   - @/hooks/useUnits -> an inlined `useUnits` deriving only `unitPrefs.pressure`
//     from the native useSettings `unit_of_pressure` exactly as web useUnits'
//     derivePressure does ('psi' -> 'psi', else 'bar').
//   - @/lib/numberFormat fmtNumber -> inlined with the same safeNumber
//     (nullish/NaN -> 0), en-US grouping and default-precision-2 semantics; the
//     web's settings-driven global precision/locale wiring is not ported, so the
//     unconfigured en-US/precision-2 default is used.
//   - ./helpers LEGEND_STYLE ({ fontSize: 10, color: '#9ca3af' }) -> the native
//     legend label style (muted 10px) preserving the same intent.
//   - The FadeIn entrance motion + the lucide-react Activity empty glyph have no
//     native equivalent; FadeIn renders statically and the empty state uses the
//     shared native EmptyState with the verbatim "No telemetry data available"
//     copy.
//   - ./types ChartDataPoint + DriveStats are inlined verbatim (their native
//     module is not yet a converted target). The component reads only chartData
//     and stats.hasTirePressure, matching the web source.
//   - react-i18next useTranslation -> a native key/English-default fallback `t`
//     preserving every driveDetail.* key + default verbatim.
//
// No DOM, Recharts, Leaflet, framer-motion, lucide-react, or old web UI
// components are imported.

import React, {useCallback, useMemo, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import {ChartContainer} from '../../../../components/charts';

// Inlined verbatim from web .../drive-detail/types.ts (ChartDataPoint). The
// native module for that types file is not yet a converted target.
export interface ChartDataPoint {
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

// Inlined verbatim from web .../drive-detail/types.ts (DriveStats). The
// component reads only `hasTirePressure`, but the full shape is preserved so the
// prop contract matches the web source.
export interface DriveStats {
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

interface TirePressureSectionProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
}

type NativeTFunction = (key: string, fallback: string) => string;

type PressureUnitPref = 'psi' | 'bar';

type WheelKey = 'tireFl' | 'tireFr' | 'tireRl' | 'tireRr';

interface WheelDef {
  key: WheelKey;
  label: string;
  short: string;
  color: string;
}

interface WheelStat {
  min: number | null;
  max: number | null;
}

interface Domain {
  min: number;
  max: number;
}

const GRID_LINES = [0, 50, 100] as const;
const MAX_COLUMNS = 48;
// web ./helpers LEGEND_STYLE = { fontSize: 10, color: '#9ca3af' }.
const LEGEND_COLOR = '#9ca3af';

// react-i18next is not wired in native. i18next returns the supplied default when
// a translation is missing, so the fallback returns the English default and keeps
// every driveDetail.* key verbatim in source.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Mirror of web @/hooks/useUnits: derive the pressure display pref from the
// user's unit_of_pressure setting. This section reads only that pref.
function useUnits(): {unitPrefs: {pressure: PressureUnitPref}} {
  const {data: settings} = useSettings();
  const pressure: PressureUnitPref =
    settings?.unit_of_pressure === 'psi' ? 'psi' : 'bar';
  return useMemo(() => ({unitPrefs: {pressure}}), [pressure]);
}

// Mirrors web lib/numberFormat: safeNumber guard, en-US grouping, default
// precision 2 (the web global-precision default before useSettings overrides it).
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

// Four wheels in web order with their exact line colours + per-wheel tile labels.
function buildWheels(t: NativeTFunction): WheelDef[] {
  return [
    {
      key: 'tireFl',
      label: t('driveDetail.frontLeft', 'Front Left'),
      short: 'FL',
      color: '#3b82f6',
    },
    {
      key: 'tireFr',
      label: t('driveDetail.frontRight', 'Front Right'),
      short: 'FR',
      color: '#10b981',
    },
    {
      key: 'tireRl',
      label: t('driveDetail.rearLeft', 'Rear Left'),
      short: 'RL',
      color: '#f59e0b',
    },
    {
      key: 'tireRr',
      label: t('driveDetail.rearRight', 'Rear Right'),
      short: 'RR',
      color: '#ef4444',
    },
  ];
}

// Ported verbatim from the web tpVals closure: min/max over the non-null,
// strictly-positive samples for a wheel; null/null when no valid sample exists.
function tpVals(data: ChartDataPoint[], key: WheelKey): WheelStat {
  const vals = data
    .map(d => d[key])
    .filter((v): v is number => v != null && v > 0);
  return {
    max: vals.length > 0 ? Math.max(...vals) : null,
    min: vals.length > 0 ? Math.min(...vals) : null,
  };
}

function buildDomain(values: number[]): Domain {
  if (values.length === 0) {
    return {max: 1, min: 0};
  }
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < min) {
      min = values[i];
    }
    if (values[i] > max) {
      max = values[i];
    }
  }
  if (min === max) {
    const pad = Math.max(Math.abs(max) * 0.05, 1);
    min -= pad;
    max += pad;
  }
  return {max, min};
}

function pctFor(value: number, domain: Domain): number {
  const span = domain.max - domain.min || 1;
  const percent = ((value - domain.min) / span) * 100;
  return Math.min(Math.max(percent, 0), 100);
}

// Recharts thins dense traces automatically; native evenly samples to a phone-
// friendly column count (first + last always retained) for the visual layer while
// the per-wheel min/max tiles still consume the full dataset.
function sampleColumns(data: ChartDataPoint[], max: number): ChartDataPoint[] {
  if (data.length <= max) {
    return data;
  }
  const step = (data.length - 1) / (max - 1);
  const out: ChartDataPoint[] = [];
  for (let i = 0; i < max; i++) {
    out.push(data[Math.round(i * step)]);
  }
  return out;
}

function pickTimeTicks(data: ChartDataPoint[]): ChartDataPoint[] {
  if (data.length <= 3) {
    return data;
  }
  const last = data.length - 1;
  return [data[0], data[Math.round(last / 2)], data[last]];
}

// Presentation-only entrance animation on web; rendered statically on native.
function FadeIn({children}: {children: React.ReactNode}) {
  return <View style={styles.fadeIn}>{children}</View>;
}

export function TirePressureSection({
  chartData,
  stats,
}: TirePressureSectionProps) {
  const t = useNativeTranslationFallback();
  const {unitPrefs} = useUnits();
  const pressureUnit = unitPrefs.pressure;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const data = useMemo(
    () => (Array.isArray(chartData) ? chartData : []),
    [chartData],
  );
  const wheels = useMemo(() => buildWheels(t), [t]);

  // Per-wheel min/max tiles — always all four, matching the web tpStats list.
  const tpStats = useMemo(
    () => wheels.map(w => ({...w, ...tpVals(data, w.key)})),
    [wheels, data],
  );

  // A wheel line/legend/tooltip entry appears only when any sample is non-null,
  // exactly as the web `chartData.some(d => d.tireXx !== null)` guards do.
  const activeWheels = useMemo(
    () => wheels.filter(w => data.some(d => d[w.key] !== null)),
    [wheels, data],
  );

  const domain = useMemo(() => {
    const values: number[] = [];
    activeWheels.forEach(w => {
      data.forEach(d => {
        const v = d[w.key];
        if (v != null && Number.isFinite(v)) {
          values.push(v);
        }
      });
    });
    return buildDomain(values);
  }, [activeWheels, data]);

  const sampled = useMemo(() => sampleColumns(data, MAX_COLUMNS), [data]);
  const xTicks = useMemo(() => pickTimeTicks(sampled), [sampled]);
  const yTicks = useMemo(
    () => [domain.max, (domain.max + domain.min) / 2, domain.min],
    [domain],
  );
  const axisDecimals = domain.max < 20 ? 1 : 0;

  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const activeIndex =
    sampled.length === 0
      ? 0
      : Math.min(
          Math.max(selectedIndex ?? sampled.length - 1, 0),
          sampled.length - 1,
        );
  const selected = sampled[activeIndex];

  const ariaLabel = t(
    'driveDetail.tirePressure.aria',
    'Front and rear tire pressure lines over the drive timeline',
  );

  return (
    <FadeIn>
      <ChartContainer
        ariaLabel={ariaLabel}
        height={310}
        title={t('driveDetail.tirePressure', 'Tire Pressure During Drive')}>
        {stats.hasTirePressure ? (
          <View style={styles.content}>
            <View style={styles.tilesRow}>
              {tpStats.map(tp => (
                <View key={tp.label} style={styles.tile}>
                  <AppText
                    numberOfLines={1}
                    style={styles.tileLabel}
                    variant="caption">
                    {tp.label}
                  </AppText>
                  <AppText
                    numberOfLines={1}
                    style={[styles.tileValue, {color: tp.color}]}
                    variant="caption"
                    weight="bold">
                    {tp.min != null
                      ? `${fmtNumber(tp.min)}\u2013${fmtNumber(
                          tp.max as number,
                        )} ${pressureUnit}`
                      : '\u2014'}
                  </AppText>
                </View>
              ))}
            </View>

            <View style={styles.chartFrame}>
              <View style={styles.yAxisLeft}>
                {yTicks.map((tick, index) => (
                  <AppText
                    key={`y-${index}`}
                    numberOfLines={1}
                    style={styles.axisLeftLabel}
                    variant="caption">
                    {fmtNumber(tick, axisDecimals)}
                  </AppText>
                ))}
              </View>

              <View style={styles.plotColumn}>
                <View
                  accessible
                  accessibilityLabel={ariaLabel}
                  accessibilityRole="image"
                  style={styles.plotArea}>
                  {GRID_LINES.map(line => (
                    <View
                      key={`grid-${line}`}
                      pointerEvents="none"
                      style={[styles.gridLine, {top: `${line}%` as DimensionValue}]}
                    />
                  ))}

                  <View style={styles.columnsRow}>
                    {sampled.map((point, index) => {
                      const isSelected = index === activeIndex;
                      return (
                        <Pressable
                          key={`${point.time}-${index}`}
                          accessibilityLabel={point.time}
                          accessibilityRole="button"
                          accessibilityState={{selected: isSelected}}
                          onPress={() => handleSelect(index)}
                          style={styles.sampleColumn}>
                          {isSelected ? (
                            <View
                              pointerEvents="none"
                              style={styles.selectedColumn}
                            />
                          ) : null}
                          {activeWheels.map(w => {
                            const v = point[w.key];
                            if (v == null || !Number.isFinite(v)) {
                              return null;
                            }
                            const percent = pctFor(v, domain);
                            return (
                              <View
                                key={w.key}
                                pointerEvents="none"
                                style={[
                                  styles.dotWrap,
                                  {
                                    bottom: `${percent.toFixed(
                                      2,
                                    )}%` as DimensionValue,
                                  },
                                ]}>
                                <View
                                  style={[styles.dot, {backgroundColor: w.color}]}
                                />
                              </View>
                            );
                          })}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.xAxis}>
                  {xTicks.map((tick, index) => (
                    <AppText
                      key={`${tick.time}-${index}`}
                      numberOfLines={1}
                      style={styles.xAxisLabel}
                      variant="caption">
                      {tick.time}
                    </AppText>
                  ))}
                </View>
              </View>
            </View>

            {activeWheels.length > 0 ? (
              <View style={styles.legendRow}>
                {activeWheels.map(w => (
                  <View key={w.key} style={styles.legendItem}>
                    <View
                      style={[styles.legendSwatch, {borderTopColor: w.color}]}
                    />
                    <AppText
                      numberOfLines={1}
                      style={styles.legendLabel}
                      variant="caption">
                      {`${w.short} (${pressureUnit})`}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}

            {selected ? (
              <View accessibilityRole="summary" style={styles.tooltipSummary}>
                <AppText
                  numberOfLines={1}
                  style={styles.tooltipHeader}
                  variant="caption"
                  weight="semibold">
                  {selected.time}
                </AppText>
                <View style={styles.tooltipRow}>
                  {activeWheels.map(w => {
                    const raw = selected[w.key];
                    const text =
                      raw == null || !Number.isFinite(raw)
                        ? '\u2014'
                        : fmtNumber(raw);
                    return (
                      <View key={w.key} style={styles.tooltipChip}>
                        <View
                          style={[
                            styles.tooltipChipDot,
                            {backgroundColor: w.color},
                          ]}
                        />
                        <AppText
                          numberOfLines={1}
                          style={styles.tooltipChipText}
                          variant="caption">
                          {`${w.short} (${pressureUnit}): ${text}`}
                        </AppText>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <EmptyState
            message={t('driveDetail.noChartData', 'No telemetry data available')}
            title={t('driveDetail.tirePressure', 'Tire Pressure During Drive')}
          />
        )}
      </ChartContainer>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  axisLeftLabel: {
    color: colors.textMuted,
    textAlign: 'right',
  },
  chartFrame: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  columnsRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    gap: 1,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  content: {
    gap: spacing.sm,
    width: '100%',
  },
  dot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  dotWrap: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  fadeIn: {
    gap: spacing.md,
    width: '100%',
  },
  gridLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.4,
    position: 'absolute',
    right: 0,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendLabel: {
    color: LEGEND_COLOR,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  legendSwatch: {
    borderTopColor: colors.border,
    borderTopWidth: 2,
    width: 16,
  },
  plotArea: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    height: 220,
    overflow: 'hidden',
    position: 'relative',
  },
  plotColumn: {
    flex: 1,
    gap: spacing.xs,
  },
  sampleColumn: {
    flex: 1,
    minWidth: 2,
    position: 'relative',
  },
  selectedColumn: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.accentSoft,
  },
  tile: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  tileLabel: {
    color: colors.textMuted,
    textAlign: 'center',
  },
  tileValue: {
    textAlign: 'center',
  },
  tilesRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  tooltipChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tooltipChipDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  tooltipChipText: {
    color: colors.textSecondary,
  },
  tooltipHeader: {
    color: colors.textSecondary,
  },
  tooltipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  tooltipSummary: {
    marginTop: spacing.sm,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 16,
  },
  xAxisLabel: {
    color: colors.textMuted,
    flex: 1,
    textAlign: 'center',
  },
  yAxisLeft: {
    justifyContent: 'space-between',
    paddingBottom: 22,
    width: 44,
  },
});
