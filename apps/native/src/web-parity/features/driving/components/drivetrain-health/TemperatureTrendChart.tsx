// Native parity port of
// web/src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx.
//
// The Temperature Trend panel plots the outside-temperature recorded across
// recent drives as a single cyan line, with two dashed horizontal threshold
// markers — a "Warm Zone" at 35 C and a "Freezing" marker at 0 C, both converted
// to the user's display unit before placement — over a date X-axis and a
// unit-labelled Y-axis. The web source returns null when there is one point or
// fewer; that guard is preserved verbatim.
//
// React Native has no DOM/SVG Recharts backend, so the whole Recharts tree
// (ResponsiveContainer/LineChart/Line/ReferenceLine/XAxis/YAxis/CartesianGrid/
// Tooltip/Legend/defs+ChartGradient + AREA_DEFAULTS) is reproduced with native
// View/AppText/Pressable layers — the same idiom as the converted sibling
// DriveOverviewChart: a plot frame with grid lines, an evenly-sampled column per
// data point, a cyan dot per non-null sample positioned at its normalised Y, the
// two dashed threshold lines (rendered only when their display value falls inside
// the data domain, matching Recharts' default ifOverflow="discard" for
// ReferenceLine), first/middle/last X-axis date ticks, a left Y-axis carrying the
// unit title + max/mid/min numeric ticks, a single-series legend, and a
// tap-to-select summary reproducing the hover Tooltip's date + value content. The
// shared native ChartContainer still owns the title/subtitle/aria/height frame and
// the accessible fallback data table (the source passes data + dataColumns).
//
// Self-contained native adaptations (documented in the sidecar):
//   - @/components/charts ChartContainer -> the native web-parity charts barrel
//     ChartContainer (title/subtitle/ariaLabel/data/dataColumns/height). The
//     ChartContainer/ChartTooltip/ChartGradient/AREA_DEFAULTS/LineChart/Line/
//     XAxis/YAxis/CartesianGrid/Tooltip/Legend/ResponsiveContainer/ReferenceLine
//     Recharts re-exports are DOM/SVG-coupled, so only ChartContainer is used and
//     the trace itself is hand-drawn (same idiom as DriveOverviewChart).
//   - @/components/motion FadeIn -> a static local FadeIn wrapper (there is no
//     native FadeIn; the web entrance is presentational only). The web delay={0.25}
//     is retained on the wrapper prop for source parity but is a no-op.
//   - @/hooks/useUnits -> an inlined `useUnits` deriving only `unitPrefs.temperature`
//     from the native useSettings `unit_of_temp` exactly as web useUnits'
//     deriveTemperature does ('F' -> 'F' else 'C'); this chart reads only that pref.
//   - @/lib/unitConversion convertTempFromSI -> inlined verbatim ('C' identity,
//     'F' -> *9/5+32). toTemperatureDisplay(35)/toTemperatureDisplay(0) preserved.
//   - ./constants ChartDataPoint -> inlined verbatim (the native drivetrain-health
//     constants module is not yet a converted target; the same idiom the sibling
//     HealthRecommendations used for its inlined types).
//   - react-i18next useTranslation -> a native key/English-default fallback `t`
//     preserving every drivetrain.* key + default verbatim.
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

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import {ChartContainer} from '../../../../components/charts';

// Inlined verbatim from web .../drivetrain-health/constants.ts (ChartDataPoint).
// The native module for that constants file is not yet a converted target; the
// source imports only this type (`import type { ChartDataPoint }`).
export interface ChartDataPoint {
  date: string;
  powerMax: number;
  powerMin: number;
  outsideTemp: number | null;
  distance: number;
}

interface TemperatureTrendChartProps {
  data: ChartDataPoint[];
}

type NativeTFunction = (key: string, fallback: string) => string;

interface Domain {
  min: number;
  max: number;
}

const LINE_COLOR = '#06b6d4';
const WARM_COLOR = '#f59e0b';
const FREEZE_COLOR = '#06b6d4';
const GRID_LINES = [0, 50, 100] as const;
const MAX_COLUMNS = 48;

// react-i18next is not wired in native. i18next returns the supplied default when
// a translation is missing, so the fallback returns the English default and keeps
// every drivetrain.* key verbatim in source.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

type TemperatureUnitPref = '°C' | '°F';

interface UnitPrefs {
  temperature: TemperatureUnitPref;
}

// Pure SI -> display converter, verbatim from web lib/unitConversion.
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

// Mirrors web useUnits: derive the temperature preference from useSettings exactly
// as web's deriveTemperature does (unit_of_temp === 'F' -> °F else °C). This chart
// reads only `unitPrefs.temperature`, so the mirror exposes just it.
function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const temperature: TemperatureUnitPref =
    settings?.unit_of_temp === 'F' ? '°F' : '°C';
  return useMemo(() => ({unitPrefs: {temperature}}), [temperature]);
}

// Mirrors web lib/numberFormat: safeNumber guard + en-US grouping. Axis ticks and
// the tooltip value render as locale-grouped integers.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtInt(v: unknown): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

// Auto Y-domain from the plotted values (Recharts auto [dataMin, dataMax]); pads
// only when every value is identical so the single dot is not edge-clipped.
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

function withinDomain(value: number, domain: Domain): boolean {
  return value >= domain.min && value <= domain.max;
}

// Recharts thins dense traces automatically; native evenly samples to a phone-
// friendly column count (first + last always retained) for the visual layer.
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

function pickDateTicks(data: ChartDataPoint[]): ChartDataPoint[] {
  if (data.length <= 3) {
    return data;
  }
  const last = data.length - 1;
  return [data[0], data[Math.round(last / 2)], data[last]];
}

// Presentation-only entrance animation on web; rendered statically on native (no
// native FadeIn). `delay` is accepted for source parity (web delay={0.25}) but is
// a no-op, matching the converted sibling DriveOverviewChart.
function FadeIn({
  children,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return <View style={styles.fadeIn}>{children}</View>;
}

export function TemperatureTrendChart({data}: TemperatureTrendChartProps) {
  const t = useNativeTranslationFallback();
  const {unitPrefs} = useUnits();
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );
  const tempUnit = unitPrefs.temperature;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const points = useMemo(() => sampleColumns(data, MAX_COLUMNS), [data]);

  const domain = useMemo(() => {
    const values: number[] = [];
    data.forEach(d => {
      if (d.outsideTemp != null && Number.isFinite(d.outsideTemp)) {
        values.push(d.outsideTemp);
      }
    });
    return buildDomain(values);
  }, [data]);

  const dateTicks = useMemo(() => pickDateTicks(points), [points]);
  const yTicks = useMemo(
    () => [domain.max, (domain.max + domain.min) / 2, domain.min],
    [domain],
  );

  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const warmDisplay = toTemperatureDisplay(35);
  const freezeDisplay = toTemperatureDisplay(0);
  const showWarm = withinDomain(warmDisplay, domain);
  const showFreeze = withinDomain(freezeDisplay, domain);

  const activeIndex =
    points.length === 0
      ? 0
      : Math.min(
          Math.max(selectedIndex ?? points.length - 1, 0),
          points.length - 1,
        );
  const selected = points[activeIndex];
  const selectedValue =
    selected && selected.outsideTemp != null && Number.isFinite(selected.outsideTemp)
      ? fmtInt(selected.outsideTemp)
      : '\u2014';

  const ariaLabel = t(
    'drivetrain.tempHistory.aria',
    'Outside temperature trend line chart per recent drive',
  );
  const seriesName = t('drivetrain.outsideTemp', 'Outside Temp');

  if (data.length <= 1) {
    return null;
  }

  return (
    <FadeIn delay={0.25}>
      <ChartContainer
        ariaLabel={ariaLabel}
        data={data.map(d => ({date: d.date, outsideTemp: d.outsideTemp}))}
        dataColumns={[
          {key: 'date', label: t('drivetrain.col.date', 'Date')},
          {
            key: 'outsideTemp',
            label: `${t('drivetrain.col.outside', 'Outside')} (${tempUnit})`,
          },
        ]}
        height={300}
        subtitle={t(
          'drivetrain.tempHistorySub',
          'Outside temperature recorded during recent drives',
        )}
        title={t('drivetrain.tempHistory', 'Temperature Trend')}>
        <View style={styles.content}>
          <View style={styles.chartFrame}>
            <View style={styles.yAxisLeft}>
              <AppText
                numberOfLines={1}
                style={styles.axisUnit}
                variant="caption">
                {tempUnit}
              </AppText>
              <View style={styles.yTicks}>
                {yTicks.map((tick, index) => (
                  <AppText
                    key={`y-${index}`}
                    numberOfLines={1}
                    style={styles.yTickLabel}
                    variant="caption">
                    {fmtInt(tick)}
                  </AppText>
                ))}
              </View>
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

                {showWarm ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.referenceLine,
                      {
                        borderTopColor: WARM_COLOR,
                        bottom: `${pctFor(warmDisplay, domain).toFixed(2)}%` as DimensionValue,
                      },
                    ]}>
                    <AppText
                      numberOfLines={1}
                      style={[styles.referenceLabel, {color: WARM_COLOR}]}
                      variant="caption">
                      {t('drivetrain.warmZone', 'Warm Zone')}
                    </AppText>
                  </View>
                ) : null}

                {showFreeze ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.referenceLine,
                      {
                        borderTopColor: FREEZE_COLOR,
                        bottom: `${pctFor(freezeDisplay, domain).toFixed(2)}%` as DimensionValue,
                      },
                    ]}>
                    <AppText
                      numberOfLines={1}
                      style={[styles.referenceLabel, {color: FREEZE_COLOR}]}
                      variant="caption">
                      {t('drivetrain.freezing', 'Freezing')}
                    </AppText>
                  </View>
                ) : null}

                <View style={styles.columnsRow}>
                  {points.map((point, index) => {
                    const isSelected = index === activeIndex;
                    const value = point.outsideTemp;
                    const hasValue = value != null && Number.isFinite(value);
                    return (
                      <Pressable
                        key={`${point.date}-${index}`}
                        accessibilityLabel={point.date}
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
                        {hasValue ? (
                          <View
                            pointerEvents="none"
                            style={[
                              styles.dotWrap,
                              {
                                bottom: `${pctFor(
                                  value as number,
                                  domain,
                                ).toFixed(2)}%` as DimensionValue,
                              },
                            ]}>
                            <View style={styles.dot} />
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.xAxis}>
                {dateTicks.map((tick, index) => (
                  <AppText
                    key={`${tick.date}-${index}`}
                    numberOfLines={1}
                    style={styles.xAxisLabel}
                    variant="caption">
                    {tick.date}
                  </AppText>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={styles.legendSwatch} />
              <AppText numberOfLines={1} style={styles.legendLabel} variant="caption">
                {seriesName}
              </AppText>
            </View>
          </View>

          {selected ? (
            <View accessibilityRole="summary" style={styles.tooltipSummary}>
              <AppText
                numberOfLines={1}
                style={styles.tooltipHeader}
                variant="caption"
                weight="semibold">
                {selected.date}
              </AppText>
              <View style={styles.tooltipRow}>
                <View style={styles.tooltipChip}>
                  <View style={styles.tooltipChipDot} />
                  <AppText
                    numberOfLines={1}
                    style={styles.tooltipChipText}
                    variant="caption">
                    {`${seriesName}: ${selectedValue}`}
                  </AppText>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </ChartContainer>
    </FadeIn>
  );
}

TemperatureTrendChart.displayName = 'TemperatureTrendChart';

const styles = StyleSheet.create({
  axisUnit: {
    color: colors.textMuted,
    marginBottom: spacing.xs,
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
    backgroundColor: LINE_COLOR,
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
    color: LINE_COLOR,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  legendSwatch: {
    borderTopColor: LINE_COLOR,
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
  referenceLabel: {
    position: 'absolute',
    right: 4,
    top: 1,
  },
  referenceLine: {
    borderStyle: 'dashed',
    borderTopWidth: 1,
    height: 0,
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
    backgroundColor: LINE_COLOR,
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
    paddingBottom: 16,
    width: 44,
  },
  yTickLabel: {
    color: colors.textMuted,
    textAlign: 'left',
  },
  yTicks: {
    flex: 1,
    justifyContent: 'space-between',
  },
});
