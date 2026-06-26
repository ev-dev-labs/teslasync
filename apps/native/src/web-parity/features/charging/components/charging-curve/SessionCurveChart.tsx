// Native parity port of
// web/src/features/charging/components/charging-curve/SessionCurveChart.tsx.
//
// The web module renders the "Power vs SOC" charging-curve panel: a shared
// <ChartContainer> (title + subtitle + aria label + an exportable SOC/Power
// data table) wrapping a Recharts <AreaChart> that plots charging power (kW)
// against state-of-charge (%) as one gradient-filled area series in
// CHART_COLORS[0].
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?) returns the English fallback (or the key), preserving
//     every translation key verbatim at the call site.
//   • The Recharts ResponsiveContainer/AreaChart/Area/XAxis/YAxis/CartesianGrid/
//     Tooltip stack (+ areaGradient/chartGrid/axisTickSm/ChartTooltip/
//     AREA_DEFAULTS) -> the already-ported native <AreaChartWrapper>, which draws
//     the same single power-vs-soc series (xKey 'soc', CHART_COLORS[0] fill) with
//     native grid/axes plus an always-visible latest-value summary (RN has no
//     hover tooltip). The Area `unit=" kW"` and the data-table 0.1 kW rounding
//     are preserved by the yFormatter; the "Power" series name maps to the
//     series label.
//   • The shared web <ChartContainer> -> the already-ported native ChartContainer
//     (same title/subtitle/ariaLabel/data/dataColumns/height/exportable/
//     exportFilename API), keeping the exportable SOC %/Power (kW) table.
//   • `import type { CurvePoint } from './types'` -> inlined locally because the
//     charging-curve ./types module is not yet ported into the native bundle;
//     it is declared as an equivalent object-literal `type` (carrying an implicit
//     index signature) so it stays assignable to the AreaChartWrapper data prop.
// No DOM elements, react-i18next, Recharts, or web UI-kit modules are imported.

import React, {useCallback} from 'react';

import {
  AreaChartWrapper,
  CHART_COLORS,
  ChartContainer,
} from '../../../../components/charts';

// Inlined from web/src/features/charging/components/charging-curve/types.ts
// (CurvePoint), which is not yet ported into the native web-parity bundle.
type CurvePoint = {
  soc: number;
  power: number;
};

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

interface SessionCurveChartProps {
  curveData: CurvePoint[];
}

export default function SessionCurveChart({curveData}: SessionCurveChartProps) {
  const {t} = useTranslation();

  return (
    <ChartContainer
      title={t('charging.curve.powerVsSoc', 'Power vs SOC')}
      subtitle={t(
        'charging.curve.powerVsSocDesc',
        'Charging power curve for selected session',
      )}
      ariaLabel={t(
        'charging.curve.powerVsSoc.aria',
        'Charging power versus state-of-charge area chart for the selected session',
      )}
      data={curveData.map(p => ({soc: p.soc, power: Math.round(p.power * 10) / 10}))}
      dataColumns={[
        {key: 'soc', label: t('charging.curve.col.soc', 'SOC %')},
        {key: 'power', label: t('charging.curve.col.power', 'Power (kW)')},
      ]}
      height={320}
      exportable
      exportFilename="power-vs-soc">
      <AreaChartWrapper
        data={curveData}
        xKey="soc"
        series={[
          {
            key: 'power',
            label: t('charging.curve.power', 'Power'),
            color: CHART_COLORS[0],
          },
        ]}
        height={320}
        yFormatter={(value: number) => `${Math.round(value * 10) / 10} kW`}
      />
    </ChartContainer>
  );
}
