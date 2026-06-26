// Native parity port of
// web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx.
//
// Renders the "Session Comparison" panel: the power-vs-SOC charging curves of
// the last (up to) 10 charging sessions overlaid on a single chart, with a
// per-session date legend underneath. The web file leans on browser-only
// dependencies that are absent from the native parity manifest (contract rules
// 4, 5 & 7); each is replaced with a React Native-safe equivalent and
// documented in the sidecar:
//
//   - react-i18next `useTranslation` (web L2, L28) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('key', 'English') call keeps its English default and translation-key
//     intent at each call site (charging.curve.sessionComparison[/Desc/.aria],
//     charging.curve.socPercent, charging.curve.powerKw, charging.curve.noData).
//   - `@/api/types` ChargingSession (web L3) -> the ported native parity type
//     from ../../../../api/types (unchanged snake_case SI shape).
//   - `@/lib/dateFormat` formatDateShort (web L4, L98, L113) -> an inline
//     native-safe "MMM d" Intl formatter with the same null/invalid -> em-dash
//     guards as the web helper.
//   - `@/components/charts` Recharts ResponsiveContainer/LineChart/Line/XAxis/
//     YAxis/CartesianGrid/Tooltip + ChartTooltip/chartGrid/axisTickSm/
//     AREA_DEFAULTS (web L5-18, L70-104) -> the native ChartContainer parity
//     component wraps a custom overlay plot built from View primitives. Recharts
//     depends on browser DOM/SVG and is unavailable on native, so each session's
//     curve is projected into the plot area and drawn as rounded, rotated
//     absolute-positioned line segments (the shared MiniChart technique), one
//     palette colour per session, with faint horizontal gridlines (chartGrid),
//     0/peak y-axis ticks + "Power (kW)" label, and min/max SOC x-axis ticks +
//     "SOC (%)" label (axisTickSm). strokeWidth 1.5 is preserved; AREA_DEFAULTS
//     (Recharts dot/animation config) has no native segment equivalent. Hover
//     tooltips (`Tooltip`/ChartTooltip) require a DOM pointer and are
//     unavailable on native -- the values are instead conveyed by the axis
//     ticks, the legend, and per-series accessibility labels.
//   - `@/hooks/useChartPalette` (web L19, L29) -> inlined useChartPalette()
//     reading chart_palette from the ported useSettings (resolveChartPalette:
//     'neon' -> neon, else the Okabe-Ito cb-safe default), matching the web
//     hook + @/lib/colors palettes byte-for-byte.
//   - `@/components/motion` FadeIn delay={0.15} (web L20, L54, L118) -> an
//     Animated.View opacity 0->1 mount fade with a 150ms delay.
//   - `./helpers` generateChargingCurve + getChargerLabel (web L21) -> ported
//     inline (with their isDcSession dependency and the CurvePoint type),
//     because the native charging-curve helpers are not yet ported; the logic
//     mirrors the web helpers exactly.
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, or web UI components
// are imported -- only react, react-native primitives, and existing apps/native
// ChartContainer / AppText / theme tokens + ported parity hooks/types.

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {ChartContainer} from '../../../../components/charts';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {ChargingSession} from '../../../../api/types';

type NativeTFunction = (key: string, fallback: string) => string;

/** Mirrors the web `CurvePoint` from ./helpers (not yet ported native). */
interface CurvePoint {
  soc: number;
  power: number;
}

interface SessionComparisonChartProps {
  sessions: ChargingSession[];
}

const MAX_SESSIONS = 10;
const CONTAINER_HEIGHT = 300;
const PLOT_HEIGHT = 212;
const PLOT_PADDING = 4;
const STROKE_WIDTH = 1.5;
const FADE_DELAY_MS = 150;
const FADE_DURATION_MS = 300;
const EM_DASH = '\u2014';

// @/lib/colors: the color-blind-safe Okabe-Ito palette (cb-safe default).
const CHART_COLORS_CB_SAFE = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
] as const;

// @/lib/colors: the opt-in neon palette (chart_palette === 'neon').
const CHART_COLORS_NEON = [
  '#00f0ff',
  '#10b981',
  '#a855f7',
  '#f59e0b',
  '#4f46e5',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
] as const;

function resolveChartPalette(pref: string | null | undefined): readonly string[] {
  return pref === 'neon' ? CHART_COLORS_NEON : CHART_COLORS_CB_SAFE;
}

// @/hooks/useChartPalette: reads chart_palette from the server-persisted
// settings and resolves to the matching palette (cb-safe default).
function useChartPalette(): readonly string[] {
  const {data} = useSettings();
  return resolveChartPalette(data?.chart_palette);
}

// react-i18next useTranslation replacement: returns the English fallback so the
// translation key intent is preserved at every call site.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// Native-safe port of @/lib/dateFormat formatDateShort: "MMM d" with the same
// null / invalid -> em-dash guards.
function formatDateShort(value: string | null | undefined): string {
  if (!value) {
    return EM_DASH;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return EM_DASH;
  }
  return date.toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
}

// ── ./helpers (ported inline; native helpers not yet present) ──

function isDcSession(s: ChargingSession): boolean {
  return !!(s.charger_type || (s.peak_power_w && s.peak_power_w > 20_000));
}

function getChargerLabel(s: ChargingSession): string {
  if (s.charger_type === 'Tesla' || (s.charger_type ?? '').toLowerCase().includes('tesla')) {
    return 'Supercharger';
  }
  if (s.charger_type) {
    return 'DC Fast';
  }
  if (s.peak_power_w && s.peak_power_w > 20_000) {
    return 'DC Fast';
  }
  return 'Home / AC';
}

/** Simulate a power-vs-SOC curve based on session metadata. */
function generateChargingCurve(session: ChargingSession): CurvePoint[] {
  const points: CurvePoint[] = [];
  const startSoc = session.start_soc_pct ?? 0;
  const endSoc = session.end_soc_pct ?? 100;
  const peakPower = (session.peak_power_w ?? 11_000) / 1000;
  const dc = isDcSession(session);

  for (let soc = startSoc; soc <= endSoc; soc += 1) {
    let power: number;
    if (dc) {
      if (soc <= 50) {
        power = peakPower;
      } else if (soc <= 80) {
        const taper = 1 - ((soc - 50) / 30) * 0.5;
        power = peakPower * taper;
      } else {
        const drop = 1 - ((soc - 80) / 20) * 0.7;
        power = peakPower * 0.5 * drop;
      }
    } else {
      power = peakPower;
    }
    points.push({soc, power: Math.max(power, 0)});
  }
  return points;
}

interface OverlaySeries {
  key: string;
  color: string;
  date: string;
  label: string;
  points: CurvePoint[];
}

interface PlotSegment {
  key: string;
  left: number;
  top: number;
  width: number;
  angle: string;
}

interface PlotDomain {
  socMin: number;
  socMax: number;
  powerMax: number;
}

function projectPoint(
  point: CurvePoint,
  domain: PlotDomain,
  plotWidth: number,
): {x: number; y: number} {
  const socRange = domain.socMax - domain.socMin || 1;
  const powerRange = domain.powerMax || 1;
  const x =
    ((point.soc - domain.socMin) / socRange) * (plotWidth - PLOT_PADDING * 2) +
    PLOT_PADDING;
  const y =
    PLOT_HEIGHT -
    PLOT_PADDING -
    (point.power / powerRange) * (PLOT_HEIGHT - PLOT_PADDING * 2);
  return {x, y};
}

function buildSegments(
  series: OverlaySeries,
  domain: PlotDomain,
  plotWidth: number,
): PlotSegment[] {
  if (plotWidth <= 0 || series.points.length < 2) {
    return [];
  }
  const projected = series.points.map(point =>
    projectPoint(point, domain, plotWidth),
  );
  return projected.slice(1).map((point, index) => {
    const previous = projected[index];
    const deltaX = point.x - previous.x;
    const deltaY = point.y - previous.y;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const midpointX = previous.x + deltaX / 2;
    const midpointY = previous.y + deltaY / 2;
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    return {
      angle: `${angle}deg`,
      key: `${series.key}-${index}`,
      left: midpointX - length / 2,
      top: midpointY - STROKE_WIDTH / 2,
      width: length,
    };
  });
}

function LegendItem({color, label, date}: {color: string; label: string; date: string}) {
  return (
    <View accessibilityLabel={label} accessible style={styles.legendItem}>
      <View style={[styles.legendSwatch, {backgroundColor: color}]} />
      <AppText tone="secondary" variant="caption">
        {date}
      </AppText>
    </View>
  );
}

export default function SessionComparisonChart({sessions}: SessionComparisonChartProps) {
  const t = useNativeTranslation();
  const palette = useChartPalette();
  const opacity = useRef(new Animated.Value(0)).current;
  const [plotWidth, setPlotWidth] = useState(0);

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      delay: FADE_DELAY_MS,
      duration: FADE_DURATION_MS,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  const comparisonSessions = useMemo(
    () => (Array.isArray(sessions) ? sessions.slice(0, MAX_SESSIONS) : []),
    [sessions],
  );

  const comparisonData = useMemo(() => {
    if (!comparisonSessions.length) {
      return [];
    }
    const curves = comparisonSessions.map((s, i) => ({
      curve: generateChargingCurve(s),
      key: `s${i}`,
    }));
    const allSocs = new Set<number>();
    curves.forEach(c => c.curve.forEach(p => allSocs.add(p.soc)));
    const socValues = Array.from(allSocs).sort((a, b) => a - b);

    return socValues.map(soc => {
      const point: Record<string, number> = {soc};
      curves.forEach(({curve, key}) => {
        const match = curve.find(p => p.soc === soc);
        if (match) {
          point[key] = Math.round(match.power * 10) / 10;
        }
      });
      return point;
    });
  }, [comparisonSessions]);

  const series = useMemo<OverlaySeries[]>(
    () =>
      comparisonSessions.map((s, i) => {
        const key = `s${i}`;
        const date = formatDateShort(s.started_at);
        const points = comparisonData
          .filter(row => typeof row[key] === 'number')
          .map(row => ({power: row[key], soc: row.soc}));
        return {
          color: palette[i % palette.length] ?? colors.accent,
          date,
          key,
          label: `${date} (${getChargerLabel(s)})`,
          points,
        };
      }),
    [comparisonData, comparisonSessions, palette],
  );

  const domain = useMemo<PlotDomain>(() => {
    let socMin = Infinity;
    let socMax = -Infinity;
    let powerMax = 0;
    for (const row of comparisonData) {
      if (row.soc < socMin) {
        socMin = row.soc;
      }
      if (row.soc > socMax) {
        socMax = row.soc;
      }
      for (const item of series) {
        const value = row[item.key];
        if (typeof value === 'number' && value > powerMax) {
          powerMax = value;
        }
      }
    }
    if (!Number.isFinite(socMin) || !Number.isFinite(socMax)) {
      socMin = 0;
      socMax = 100;
    }
    return {powerMax, socMax, socMin};
  }, [comparisonData, series]);

  const segmentsBySeries = useMemo(
    () =>
      series.map(item => ({
        color: item.color,
        key: item.key,
        label: item.label,
        segments: buildSegments(item, domain, plotWidth),
      })),
    [series, domain, plotWidth],
  );

  const handlePlotLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setPlotWidth(previous => (Math.abs(previous - width) > 1 ? width : previous));
  };

  const isEmpty = comparisonSessions.length === 0;
  const powerLabel = t('charging.curve.powerKw', 'Power (kW)');
  const socLabel = t('charging.curve.socPercent', 'SOC (%)');

  return (
    <Animated.View style={{opacity}}>
      <ChartContainer
        ariaLabel={t(
          'charging.curve.sessionComparison.aria',
          'Overlaid power-vs-SOC line chart comparing the last several charging sessions',
        )}
        empty={isEmpty}
        exportable
        exportFilename="session-comparison"
        height={CONTAINER_HEIGHT}
        subtitle={t(
          'charging.curve.sessionComparisonDesc',
          'Power curves overlaid from last 10 sessions',
        )}
        title={t('charging.curve.sessionComparison', 'Session Comparison')}>
        <View style={styles.chart}>
          <View style={styles.plotRow}>
            <View style={styles.yAxis}>
              <AppText style={styles.axisTick} variant="caption">
                {String(Math.round(domain.powerMax))}
              </AppText>
              <AppText style={styles.yAxisLabel} tone="muted" variant="caption">
                {powerLabel}
              </AppText>
              <AppText style={styles.axisTick} variant="caption">
                0
              </AppText>
            </View>
            <View
              accessibilityLabel={t(
                'charging.curve.sessionComparison.aria',
                'Overlaid power-vs-SOC line chart comparing the last several charging sessions',
              )}
              accessibilityRole="image"
              accessible
              onLayout={handlePlotLayout}
              style={styles.plot}>
              <View pointerEvents="none" style={[styles.gridLine, styles.gridLineTop]} />
              <View pointerEvents="none" style={[styles.gridLine, styles.gridLineMid]} />
              <View pointerEvents="none" style={[styles.gridLine, styles.gridLineBottom]} />
              {segmentsBySeries.map(item =>
                item.segments.map(segment => (
                  <View
                    key={segment.key}
                    pointerEvents="none"
                    style={[
                      styles.segment,
                      {
                        backgroundColor: item.color,
                        left: segment.left,
                        top: segment.top,
                        transform: [{rotateZ: segment.angle}],
                        width: segment.width,
                      },
                    ]}
                  />
                )),
              )}
            </View>
          </View>
          <View style={styles.xAxisRow}>
            <AppText style={styles.axisTick} variant="caption">
              {String(Math.round(domain.socMin))}
            </AppText>
            <AppText style={styles.xAxisLabel} tone="muted" variant="caption">
              {socLabel}
            </AppText>
            <AppText style={styles.axisTick} variant="caption">
              {String(Math.round(domain.socMax))}
            </AppText>
          </View>
          <View style={styles.legend}>
            {series.map(item => (
              <LegendItem
                key={item.key}
                color={item.color}
                date={item.date}
                label={item.label}
              />
            ))}
          </View>
        </View>
      </ChartContainer>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  axisTick: {
    color: colors.textMuted,
    fontSize: 10,
  },
  chart: {
    flex: 1,
  },
  gridLine: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  gridLineBottom: {
    bottom: PLOT_PADDING,
  },
  gridLineMid: {
    top: PLOT_HEIGHT / 2,
  },
  gridLineTop: {
    top: PLOT_PADDING,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendSwatch: {
    borderRadius: 2,
    height: 8,
    width: 12,
  },
  plot: {
    flex: 1,
    height: PLOT_HEIGHT,
    overflow: 'hidden',
    position: 'relative',
  },
  plotRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segment: {
    borderRadius: STROKE_WIDTH / 2,
    height: STROKE_WIDTH,
    position: 'absolute',
  },
  xAxisLabel: {
    flex: 1,
    textAlign: 'center',
  },
  xAxisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingLeft: 36,
  },
  yAxis: {
    alignItems: 'flex-end',
    height: PLOT_HEIGHT,
    justifyContent: 'space-between',
    width: 32,
  },
  yAxisLabel: {
    textAlign: 'right',
  },
});
