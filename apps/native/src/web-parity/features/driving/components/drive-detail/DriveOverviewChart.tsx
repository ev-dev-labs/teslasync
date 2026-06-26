// Native parity port of
// web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx.
//
// The Drive Overview composed chart: a dense per-sample drive trace that
// overlays a Speed area, Range (ideal) + Range (est./rated) dashed lines, an SOC
// line, a Usable SOC line, and a Power line on a dual-axis plot — Speed/Range/SOC
// share the (hidden) left "speed" axis while Power reads against the right kW
// axis with a 0-baseline ReferenceLine. Below the chart a rich legend lists the
// Mean/Max/Min of every active series.
//
// React Native has no DOM/SVG Recharts backend, so the whole Recharts tree
// (ResponsiveContainer/ComposedChart/Area/Line/ReferenceLine/XAxis/YAxis/
// CartesianGrid/Tooltip + AREA_DEFAULTS/areaGradient) is reproduced with native
// View/AppText/Pressable layers — the same idiom as the converted ElevationProfile
// and AreaChartWrapper charts: a plot frame with grid lines, an evenly-sampled
// column per data point, a bottom-anchored translucent fill for the Speed area,
// colour-coded dots for each line series positioned at their normalised Y, a
// faint Power 0-baseline, a right-hand kW axis, first/middle/last X-axis time
// ticks, and a tap-to-select summary that reproduces the hover Tooltip's
// per-series time + value content. The shared native ChartContainer still owns
// the title/aria/height frame.
//
// Self-contained native adaptations (documented in the sidecar):
//   - @/components/charts ChartContainer -> the native web-parity charts barrel
//     ChartContainer (title/ariaLabel/height only). Honouring the source's
//     `chart-a11y:no-table` comment, no fallback data table is supplied — the
//     Mean/Max/Min legend carries the tabular summary, exactly as the web intends.
//   - The Recharts cross-chart sync features (useSyncedCursor / syncId /
//     syncMethod / onMouseMove, useSyncedReferenceLineX cursor ReferenceLine, and
//     the bottom ChartBrush time-window scrubber) are DOM/Recharts-coupled and
//     have no native equivalent; they are omitted. The synced cursor's intent is
//     preserved by the local tap-to-select cursor + summary.
//   - @/hooks/useUnits -> an inlined `useUnits` deriving `unitPrefs.speed` and
//     `unitPrefs.distance` from the native useSettings `unit_of_length` exactly as
//     web useUnits' deriveSpeed/deriveDistance do (mi -> mph/'mi', else km/h/'km').
//   - @/lib/numberFormat fmtNumber/fmtInt/fmtPercent/fmtWithUnit -> inlined with
//     the same safeNumber (nullish/NaN -> 0), en-US grouping and default-precision-2
//     semantics; the web's settings-driven global precision/locale wiring is not
//     ported, so the unconfigured en-US/precision-2 default is used.
//   - @/lib/tokens chartTokens.cursor + the FadeIn entrance motion + the
//     lucide-react Activity empty glyph have no native equivalent; FadeIn renders
//     statically and the empty state uses the shared native EmptyState with the
//     verbatim "No telemetry data available" copy.
//   - @/types/driving DriveDetail -> the native useDriving DriveDetail (the prop
//     contract type; the body reads only chartData, matching the web source).
//     ./types ChartDataPoint is inlined verbatim (its native module is not yet a
//     converted target).
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
import type {DriveDetail} from '../../../../api/hooks/useDriving';

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

interface DriveOverviewChartProps {
  drive: DriveDetail;
  chartData: ChartDataPoint[];
}

type NativeTFunction = (key: string, fallback: string) => string;

type SeriesAxis = 'shared' | 'power';

interface SeriesDef {
  key: string;
  name: string;
  color: string;
  dash: boolean;
  axis: SeriesAxis;
  area: boolean;
  accessor: (d: ChartDataPoint) => number | null;
}

interface Domain {
  min: number;
  max: number;
}

interface Stat {
  mean: number;
  max: number;
  min: number;
}

interface LegendItem {
  color: string;
  dash?: boolean;
  label: string;
  mean: string;
  max: string;
  min: string;
}

const GRID_LINES = [0, 50, 100] as const;
const MAX_COLUMNS = 48;

// react-i18next is not wired in native. i18next returns the supplied default when
// a translation is missing, so the fallback returns the English default and keeps
// every driveDetail.* key verbatim in source.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

type SpeedUnitPref = 'mph' | 'km/h';
type DistanceUnitPref = 'mi' | 'km';

// Mirror of web @/hooks/useUnits: derive the speed + distance display prefs from
// the user's unit_of_length setting. This chart reads only those two prefs.
function useUnits(): {unitPrefs: {speed: SpeedUnitPref; distance: DistanceUnitPref}} {
  const {data: settings} = useSettings();
  const speed: SpeedUnitPref = settings?.unit_of_length === 'mi' ? 'mph' : 'km/h';
  const distance: DistanceUnitPref = settings?.unit_of_length === 'mi' ? 'mi' : 'km';
  return useMemo(() => ({unitPrefs: {speed, distance}}), [speed, distance]);
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

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

function fmtPercent(v: unknown, decimals = 2): string {
  return `${fmtNumber(v, decimals)}%`;
}

function fmtWithUnit(v: unknown, unit: string, decimals = 2): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

// Mirror of the web series set + conditional inclusion / dataKey logic, ported
// verbatim: Speed area + the SOC + Power lines always render; the Range (ideal),
// Range (est./rated) and Usable SOC lines appear only when any sample carries a
// value, and the Range (est.) line falls back to ratedRange when no estRange
// exists — exactly as the source's chartData.some(...) guards do.
function buildSeries(
  data: ChartDataPoint[],
  speedUnit: SpeedUnitPref,
  distanceUnit: DistanceUnitPref,
  t: NativeTFunction,
): SeriesDef[] {
  const series: SeriesDef[] = [];

  series.push({
    key: 'speed',
    name: `${t('driveDetail.speed', 'Speed')} (${speedUnit})`,
    color: '#3b82f6',
    dash: false,
    axis: 'shared',
    area: true,
    accessor: d => d.speed,
  });

  if (data.some(d => d.idealRange !== null)) {
    series.push({
      key: 'idealRange',
      name: `${t('driveDetail.rangeIdeal', 'Range ideal')} (${distanceUnit})`,
      color: '#c084fc',
      dash: true,
      axis: 'shared',
      area: false,
      accessor: d => d.idealRange,
    });
  }

  const hasEst = data.some(d => d.estRange !== null);
  if (hasEst || data.some(d => d.ratedRange !== null)) {
    series.push({
      key: 'estRange',
      name: `${t('driveDetail.rangeEst', 'Range est.')} (${distanceUnit})`,
      color: '#a855f7',
      dash: true,
      axis: 'shared',
      area: false,
      accessor: hasEst ? d => d.estRange : d => d.ratedRange,
    });
  }

  series.push({
    key: 'battery',
    name: `${t('driveDetail.soc', 'SOC')} %`,
    color: '#84cc16',
    dash: false,
    axis: 'shared',
    area: false,
    accessor: d => d.battery,
  });

  if (data.some(d => d.usableSoc !== null)) {
    series.push({
      key: 'usableSoc',
      name: `${t('driveDetail.usableSoc', 'Usable SOC')} %`,
      color: '#22d3ee',
      dash: false,
      axis: 'shared',
      area: false,
      accessor: d => d.usableSoc,
    });
  }

  series.push({
    key: 'power',
    name: `${t('driveDetail.power', 'Power')} kW`,
    color: '#f59e0b',
    dash: false,
    axis: 'power',
    area: false,
    accessor: d => d.power,
  });

  return series;
}

function buildDomain(values: number[], includeZero: boolean): Domain {
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
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
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
// the legend stats below still consume the full dataset.
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

export function DriveOverviewChart({chartData}: DriveOverviewChartProps) {
  const t = useNativeTranslationFallback();
  const {unitPrefs} = useUnits();
  const speedUnit = unitPrefs.speed;
  const distanceUnit = unitPrefs.distance;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const data = useMemo(() => (Array.isArray(chartData) ? chartData : []), [chartData]);
  const hasChart = data.length > 1;

  const series = useMemo(
    () => buildSeries(data, speedUnit, distanceUnit, t),
    [data, speedUnit, distanceUnit, t],
  );

  const {sharedDomain, powerDomain} = useMemo(() => {
    const sharedValues: number[] = [];
    const powerValues: number[] = [];
    series.forEach(s => {
      data.forEach(d => {
        const v = s.accessor(d);
        if (v != null && Number.isFinite(v)) {
          (s.axis === 'power' ? powerValues : sharedValues).push(v);
        }
      });
    });
    return {
      powerDomain: buildDomain(powerValues, true),
      sharedDomain: buildDomain(sharedValues, false),
    };
  }, [data, series]);

  const sampled = useMemo(() => sampleColumns(data, MAX_COLUMNS), [data]);
  const xTicks = useMemo(() => pickTimeTicks(sampled), [sampled]);
  const powerTicks = useMemo(
    () => [powerDomain.max, (powerDomain.max + powerDomain.min) / 2, powerDomain.min],
    [powerDomain],
  );
  const showZero = powerDomain.min <= 0 && powerDomain.max >= 0;
  const zeroPct = pctFor(0, powerDomain);

  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const activeIndex =
    sampled.length === 0
      ? 0
      : Math.min(Math.max(selectedIndex ?? sampled.length - 1, 0), sampled.length - 1);
  const selected = sampled[activeIndex];

  return (
    <FadeIn>
      <ChartContainer
        ariaLabel={t(
          'driveDetail.driveChart.aria',
          'Drive overview composed chart of speed, range, SOC and power over time',
        )}
        height={360}
        title={t('driveDetail.driveChart', 'Drive Overview')}>
        {hasChart ? (
          <View style={styles.content}>
            <View style={styles.chartFrame}>
              <View style={styles.plotColumn}>
                <View
                  accessible
                  accessibilityLabel={t(
                    'driveDetail.driveChart.aria',
                    'Drive overview composed chart of speed, range, SOC and power over time',
                  )}
                  accessibilityRole="image"
                  style={styles.plotArea}>
                  {GRID_LINES.map(line => (
                    <View
                      key={`grid-${line}`}
                      pointerEvents="none"
                      style={[styles.gridLine, {top: `${line}%` as DimensionValue}]}
                    />
                  ))}

                  {showZero ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.referenceZero,
                        {bottom: `${zeroPct.toFixed(2)}%` as DimensionValue},
                      ]}
                    />
                  ) : null}

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
                            <View pointerEvents="none" style={styles.selectedColumn} />
                          ) : null}
                          {series.map(s => {
                            const v = s.accessor(point);
                            if (v == null || !Number.isFinite(v)) {
                              return null;
                            }
                            const domain =
                              s.axis === 'power' ? powerDomain : sharedDomain;
                            const percent = pctFor(v, domain);
                            if (s.area) {
                              return (
                                <View
                                  key={s.key}
                                  pointerEvents="none"
                                  style={[
                                    styles.areaFill,
                                    {height: `${percent.toFixed(2)}%` as DimensionValue},
                                  ]}
                                />
                              );
                            }
                            return (
                              <View
                                key={s.key}
                                pointerEvents="none"
                                style={[
                                  styles.dotWrap,
                                  {bottom: `${percent.toFixed(2)}%` as DimensionValue},
                                ]}>
                                <View
                                  style={[styles.dot, {backgroundColor: s.color}]}
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

              <View style={styles.yAxisRight}>
                {powerTicks.map((tick, index) => (
                  <AppText
                    key={`power-${index}`}
                    numberOfLines={1}
                    style={styles.axisRightLabel}
                    variant="caption">
                    {`${fmtNumber(tick, 0)} kW`}
                  </AppText>
                ))}
              </View>
            </View>

            {selected ? (
              <View
                accessibilityRole="summary"
                style={styles.tooltipSummary}>
                <AppText
                  numberOfLines={1}
                  style={styles.tooltipHeader}
                  variant="caption"
                  weight="semibold">
                  {selected.time}
                </AppText>
                <View style={styles.tooltipRow}>
                  {series.map(s => {
                    const raw = s.accessor(selected);
                    const text =
                      raw == null || !Number.isFinite(raw) ? '\u2014' : fmtNumber(raw);
                    return (
                      <View key={s.key} style={styles.tooltipChip}>
                        <View
                          style={[styles.tooltipChipDot, {backgroundColor: s.color}]}
                        />
                        <AppText
                          numberOfLines={1}
                          style={styles.tooltipChipText}
                          variant="caption">
                          {`${s.name}: ${text}`}
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
            title={t('driveDetail.driveChart', 'Drive Overview')}
          />
        )}
      </ChartContainer>

      {hasChart ? <ChartLegend chartData={data} /> : null}
    </FadeIn>
  );
}

function statFn(vals: (number | null)[]): Stat | null {
  const v = vals.filter((x): x is number => x != null);
  if (v.length === 0) {
    return null;
  }
  return {
    max: Math.max(...v),
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    min: Math.min(...v),
  };
}

function ChartLegend({chartData}: {chartData: ChartDataPoint[]}) {
  const t = useNativeTranslationFallback();
  const {unitPrefs} = useUnits();
  const speedUnit = unitPrefs.speed;
  const distanceUnit = unitPrefs.distance;

  const speedS = statFn(chartData.map(d => d.speed));
  const idealRangeS = statFn(chartData.map(d => d.idealRange));
  const estRangeS = statFn(chartData.map(d => d.estRange ?? d.ratedRange));
  const powerS = statFn(chartData.map(d => d.power));
  const socS = statFn(chartData.map(d => (d.battery > 0 ? d.battery : null)));
  const usableSocS = statFn(chartData.map(d => d.usableSoc));

  const items: LegendItem[] = [];
  if (speedS) {
    items.push({
      color: '#3b82f6',
      label: t('driveDetail.speed', 'Speed'),
      mean: `${fmtNumber(speedS.mean)} ${speedUnit}`,
      max: `${fmtNumber(speedS.max)} ${speedUnit}`,
      min: `${fmtInt(speedS.min)} ${speedUnit}`,
    });
  }
  if (idealRangeS) {
    items.push({
      color: '#c084fc',
      dash: true,
      label: t('driveDetail.rangeIdeal', 'Range (ideal)'),
      mean: `${fmtInt(idealRangeS.mean)} ${distanceUnit}`,
      max: `${fmtInt(idealRangeS.max)} ${distanceUnit}`,
      min: `${fmtInt(idealRangeS.min)} ${distanceUnit}`,
    });
  }
  if (estRangeS) {
    items.push({
      color: '#a855f7',
      dash: true,
      label: t('driveDetail.rangeEst', 'Range (est.)'),
      mean: `${fmtInt(estRangeS.mean)} ${distanceUnit}`,
      max: `${fmtInt(estRangeS.max)} ${distanceUnit}`,
      min: `${fmtInt(estRangeS.min)} ${distanceUnit}`,
    });
  }
  if (socS) {
    items.push({
      color: '#84cc16',
      label: t('driveDetail.soc', 'SOC'),
      mean: fmtPercent(socS.mean),
      max: fmtPercent(socS.max),
      min: fmtPercent(socS.min),
    });
  }
  if (usableSocS) {
    items.push({
      color: '#22d3ee',
      label: t('driveDetail.usableSoc', 'Usable SOC'),
      mean: fmtPercent(usableSocS.mean),
      max: fmtPercent(usableSocS.max),
      min: fmtPercent(usableSocS.min),
    });
  }
  if (powerS) {
    items.push({
      color: '#f59e0b',
      label: t('driveDetail.power', 'Power'),
      mean: fmtWithUnit(powerS.mean, 'kW'),
      max: fmtWithUnit(powerS.max, 'kW'),
      min: fmtWithUnit(powerS.min, 'kW'),
    });
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={styles.legendRow}>
      {items.map(item => (
        <View key={item.label} style={styles.legendItem}>
          <View
            style={[
              styles.legendSwatch,
              {
                borderStyle: item.dash ? 'dashed' : 'solid',
                borderTopColor: item.color,
              },
            ]}
          />
          <AppText
            numberOfLines={1}
            style={{color: item.color}}
            variant="caption"
            weight="bold">
            {item.label}
          </AppText>
          <AppText numberOfLines={1} style={styles.legendStat} variant="caption">
            {`Mean: ${item.mean}`}
          </AppText>
          <AppText numberOfLines={1} style={styles.legendStat} variant="caption">
            {`Max: ${item.max}`}
          </AppText>
          <AppText numberOfLines={1} style={styles.legendStat} variant="caption">
            {`Min: ${item.min}`}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  areaFill: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderTopColor: '#3b82f6',
    borderTopWidth: 1.5,
    bottom: 0,
    left: 0,
    minHeight: 1,
    position: 'absolute',
    right: 0,
  },
  axisRightLabel: {
    color: colors.textMuted,
    textAlign: 'left',
  },
  chartFrame: {
    flex: 1,
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
    flex: 1,
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
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  legendStat: {
    color: colors.textMuted,
  },
  legendSwatch: {
    borderTopWidth: 2,
    width: 16,
  },
  plotArea: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  plotColumn: {
    flex: 1,
    gap: spacing.xs,
  },
  referenceZero: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    height: 1,
    left: 0,
    position: 'absolute',
    right: 0,
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
  yAxisRight: {
    justifyContent: 'space-between',
    paddingBottom: 22,
    width: 52,
  },
});
