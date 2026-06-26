// Native parity port of
// web/src/features/driving/components/drivetrain-health/PowerOutputChart.tsx.
//
// The web module renders the drivetrain-health "Power Output History" panel: a
// FadeIn-wrapped shared <ChartContainer> (title + subtitle + aria label + an
// exportable Date / Peak (kW) / Regen (kW) data table, keyed to chartKey
// 'drivetrain-power-output' so its URL-persisted hidden-series toggles survive
// deep-links) wrapping a 300px Recharts <AreaChart> that plots two per-drive
// motor-power series over time -- "Peak Power (kW)" (#8b5cf6, gradient
// dtPwrMaxGrad) and "Regen Power (kW)" (#ef4444, gradient dtPwrMinGrad) -- against
// the date XAxis, with a CartesianGrid, a "kW" YAxis label, a hover ChartTooltip,
// a click-to-hide <ChartLegend state={hidden}>, a ReferenceLine at y=0 separating
// peak from regen, and each Area hidden via hide={hidden.isHidden(dataKey)}. The
// panel renders nothing until there are at least two points (data.length <= 1
// returns null).
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?) returns the English fallback (or the key), preserving
//     every translation key verbatim at the call site (the parity bundle ships
//     no i18n runtime).
//   • @/hooks/useHiddenSeries (URL-persisted) -> an inlined in-memory
//     HiddenSeriesState (the same hidden/toggle/isHidden/reset contract the
//     ported ChartHiddenSeriesContext uses) because React Native has no browser
//     URL/search-param state; the chartKey 'drivetrain-power-output' is preserved.
//   • the @/components/motion <FadeIn delay={0.3}> -> the already-ported native
//     FadeIn (same opacity/slide entry + reduced-motion fallback) at delay 0.3.
//   • the shared web <ChartContainer> -> the already-ported native ChartContainer
//     (same title/subtitle/ariaLabel/chartKey/data/dataColumns/height API),
//     keeping the exportable Date / Peak (kW) / Regen (kW) table and the
//     'drivetrain-power-output' chartKey.
//   • the Recharts ResponsiveContainer/AreaChart/Area/XAxis/YAxis/CartesianGrid/
//     Tooltip/ReferenceLine stack (+ areaGradient/AREA_DEFAULTS/ChartTooltip)
//     -> the already-ported native <AreaChartWrapper> (the same convention as the
//     ported SessionCurveChart / MonthlyCostChart), drawing the two powerMax /
//     powerMin series (xKey 'date', stroke/fill #8b5cf6 / #ef4444) with native
//     grid/axes plus an always-visible latest-value summary because RN has no
//     hover tooltip; the YAxis "kW" label maps to the yFormatter unit suffix, the
//     two areaGradient fills fold into the wrapper's own alpha area fill, and the
//     ReferenceLine y={0} has no RN equivalent (the wrapper's domain is already
//     zero-anchored so 0 sits on the baseline).
//   • the in-chart <ChartLegend state={hidden}> (Recharts auto-injects payload on
//     web) -> the already-ported native <ChartLegend> rendered as a sibling with
//     an explicit payload of both series + state={hidden}; each Area's
//     hide={hidden.isHidden(dataKey)} maps to filtering the hidden series out of
//     the AreaChartWrapper `series` array (the same convention as the ported
//     StatisticsPage vehicle-comparison toggle).
//   • `import type { ChartDataPoint } from './constants'` -> the already-ported
//     native ./constants ChartDataPoint, mapped to fresh object-literal rows
//     before AreaChartWrapper so they stay assignable to its
//     Record<string, unknown>[] data prop (interface types lack an index
//     signature).
// No DOM elements, react-i18next, Recharts, Leaflet, react-dom, or web UI-kit
// modules are imported into the native output.

import React, {useCallback, useMemo, useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {spacing} from '../../../../../theme/tokens';
import {
  AreaChartWrapper,
  ChartContainer,
  ChartLegend,
} from '../../../../components/charts';
import {type LegendPayloadEntry} from '../../../../components/charts/ChartLegend';
import {FadeIn} from '../../../../components/motion/FadeIn';

import type {ChartDataPoint} from './constants';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site. A stable useCallback identity keeps the hook honest.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/hooks/useHiddenSeries (in-memory) ───────────────────────── */

interface HiddenSeriesState {
  hidden: Set<string>;
  toggle: (seriesKey: string) => void;
  isHidden: (seriesKey: string) => boolean;
  reset: () => void;
}

// web useHiddenSeries persists the hidden dataKeys in the URL; RN has no URL, so
// the hidden set is retained in component state with the same contract.
function useHiddenSeries(_chartKey: string): HiddenSeriesState {
  const [values, setValues] = useState<readonly string[]>([]);
  const hidden = useMemo(() => new Set(values), [values]);

  const isHidden = useCallback(
    (seriesKey: string) => hidden.has(seriesKey),
    [hidden],
  );
  const toggle = useCallback((seriesKey: string) => {
    setValues(prev => {
      const next = new Set(prev);
      if (next.has(seriesKey)) {
        next.delete(seriesKey);
      } else {
        next.add(seriesKey);
      }
      return Array.from(next).sort();
    });
  }, []);
  const reset = useCallback(() => setValues([]), []);

  return useMemo(
    () => ({hidden, toggle, isHidden, reset}),
    [hidden, toggle, isHidden, reset],
  );
}

// web areaGradient('dtPwrMaxGrad', '#8b5cf6') / Area stroke -> peak power colour.
const POWER_MAX_COLOR = '#8b5cf6';
// web areaGradient('dtPwrMinGrad', '#ef4444') / Area stroke -> regen power colour.
const POWER_MIN_COLOR = '#ef4444';

interface PowerOutputChartProps {
  data: ChartDataPoint[];
}

export function PowerOutputChart({data}: PowerOutputChartProps) {
  const {t} = useTranslation();

  // URL-persisted hidden-series state lets users declutter to one trace.
  const hidden = useHiddenSeries('drivetrain-power-output');

  const allSeries = useMemo(
    () => [
      {
        key: 'powerMax',
        label: t('drivetrain.powerMax', 'Peak Power (kW)'),
        color: POWER_MAX_COLOR,
      },
      {
        key: 'powerMin',
        label: t('drivetrain.powerMin', 'Regen Power (kW)'),
        color: POWER_MIN_COLOR,
      },
    ],
    [t],
  );

  // web Area hide={hidden.isHidden('powerMax'|'powerMin')} -> drop hidden series
  // from the rendered AreaChartWrapper while the legend keeps them re-enableable.
  const visibleSeries = useMemo(
    () => allSeries.filter(series => !hidden.isHidden(series.key)),
    [allSeries, hidden],
  );

  // The interactive <ChartLegend> always lists both series so a hidden trace can
  // be toggled back on; Recharts auto-injects this payload on web.
  const legendPayload = useMemo<LegendPayloadEntry[]>(
    () =>
      allSeries.map(series => ({
        value: series.label,
        dataKey: series.key,
        color: series.color,
      })),
    [allSeries],
  );

  // web AreaChart data -> fresh object-literal rows (xKey 'date' + the two power
  // series) assignable to AreaChartWrapper's Record<string, unknown>[] prop.
  const chartRows = useMemo(
    () =>
      data.map(point => ({
        date: point.date,
        powerMax: point.powerMax,
        powerMin: point.powerMin,
      })),
    [data],
  );

  if (data.length <= 1) {
    return null;
  }

  return (
    <FadeIn delay={0.3}>
      <ChartContainer
        title={t('drivetrain.powerOutput', 'Power Output History')}
        subtitle={t(
          'drivetrain.powerOutputSub',
          'Peak and regen power per drive over time',
        )}
        ariaLabel={t(
          'drivetrain.powerOutput.aria',
          'Per-drive peak and regen motor power output history area chart',
        )}
        chartKey="drivetrain-power-output"
        data={data.map(point => ({
          date: point.date,
          power_max_kw: point.powerMax,
          power_min_kw: point.powerMin,
        }))}
        dataColumns={[
          {key: 'date', label: t('drivetrain.col.date', 'Date')},
          {key: 'power_max_kw', label: t('drivetrain.col.powerMax', 'Peak (kW)')},
          {key: 'power_min_kw', label: t('drivetrain.col.powerMin', 'Regen (kW)')},
        ]}
        height={300}>
        <View style={styles.chartLayer}>
          <AreaChartWrapper
            data={chartRows}
            xKey="date"
            series={visibleSeries}
            height={300}
            yFormatter={(value: number) => `${Math.round(value)} kW`}
          />
          <ChartLegend payload={legendPayload} state={hidden} />
        </View>
      </ChartContainer>
    </FadeIn>
  );
}

PowerOutputChart.displayName = 'PowerOutputChart';

const styles = StyleSheet.create({
  chartLayer: {
    gap: spacing.sm,
    width: '100%',
  },
});
