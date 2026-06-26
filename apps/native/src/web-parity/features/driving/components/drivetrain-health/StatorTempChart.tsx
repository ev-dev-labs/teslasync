// Native parity port of
// web/src/features/driving/components/drivetrain-health/StatorTempChart.tsx.
//
// `StatorTempChart` renders the Drivetrain Health "Stator Temperature History"
// line chart: three motor-stator series (front / rear-left / rear-right) plotted
// over recent telemetry snapshots, with two horizontal reference lines marking
// the "Normal" (60 °C) and "Warm" (80 °C) thresholds. The whole surface is hidden
// when there are one or fewer data points (`data.length <= 1` -> `null`) — every
// guard, prop, series name, hex stroke, i18n key + English fallback, the unit
// suffix on the column/series labels, the export `dataColumns` projection, and the
// `height={280}` / `delay={0.23}` values are preserved verbatim.
//
// Web module -> native-safe mapping (contract rules 4-7):
//   - `@/components/charts` (L3-16: ChartContainer, ChartTooltip, LineChart, Line,
//     XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
//     ReferenceLine, AREA_DEFAULTS) -> the web-parity `components/charts` barrel.
//     ChartContainer + ChartTooltip + AREA_DEFAULTS are real native ports;
//     ResponsiveContainer/LineChart/Line/XAxis/YAxis/CartesianGrid/Tooltip/Legend/
//     ReferenceLine are the barrel's native chart-primitive stubs. Recharts is a
//     browser DOM/SVG renderer with no native backend, so the recharts JSX shape
//     is preserved 1:1 but the leaf primitives render an accessibility-labelled
//     "unavailable" placeholder and IGNORE every styling prop (stroke, tick,
//     strokeDasharray, strokeOpacity, dataKey, name, label, y, content, and the
//     spread AREA_DEFAULTS) — the same native chart-stub contract the sibling
//     SleepEfficiencyPage / ElevationProfile ports rely on. The inert prop values
//     (incl. the source's `var(--glass-border)` / `var(--text-muted)` CSS-var
//     strings) are carried over verbatim to document visual intent; they have no
//     runtime effect on native. Visual line-rendering is UNAVAILABLE on native
//     (documented in the sidecar); ChartContainer still renders the title,
//     subtitle, a11y summary and the accessible data table from `data`/
//     `dataColumns`, so the numeric content survives.
//   - `@/components/motion` FadeIn (L17) -> the ported web-parity components/motion
//     FadeIn; the `delay={0.23}` seconds is preserved (the native FadeIn delay is
//     likewise expressed in seconds).
//   - `@/hooks/useUnits` useUnits (L18) -> a local shim wired to the native
//     `api/hooks/useSettings` port: it derives `unitPrefs.temperature` from the
//     user's `unit_of_temp` setting exactly as the web hook does (deriveTemperature:
//     'F' -> '°F', else '°C') and memoises the `unitPrefs` bag for reference
//     stability. Only `unitPrefs` is consumed here, so the shim exposes only that
//     (the web component destructures `{ unitPrefs }` and nothing else). User
//     preference now flows through real settings — full unit parity, not an
//     SI-only floor.
//   - `./constants` `MotorChartDataPoint` (L20) -> inlined verbatim (the sibling
//     drivetrain-health `constants` module is not a standalone native port yet, so
//     the type travels with the component, mirroring how the DetailCards port
//     inlined its `./helpers` dep).
//   - `@/lib/unitConversion` `convertTempFromSI` (L21) -> inlined verbatim
//     (SI Celsius -> display: '°C' is identity, '°F' is `(c*9)/5+32`), matching the
//     lib switch exactly; the `@/lib/unitConversion` module has no native port yet.
//   - react-i18next `useTranslation` (L1) -> the standard local key-preserving
//     fallback shim returning the inline English copy while every call site still
//     references the i18n key, so translation intent survives (no react-i18next in
//     the native deps).
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported into this native output.

import React, {useMemo} from 'react';

import {
  ChartContainer,
  ChartTooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  AREA_DEFAULTS,
} from '../../../../components/charts';
import {FadeIn} from '../../../../components/motion';
import {useSettings} from '../../../../api/hooks/useSettings';

// ─── Inlined `./constants` (MotorChartDataPoint) ──────────────
// The sibling drivetrain-health constants module is not a standalone native port
// yet, so the row shape travels with the component. Carried over field-for-field.
interface MotorChartDataPoint {
  time: string;
  stator: number | null;
  statorRel: number | null;
  statorRer: number | null;
  torque: number | null;
  speed: number | null;
  axle: number | null;
}

// ─── Inlined `@/lib/unitConversion` (convertTempFromSI) ───────
// SI Celsius -> the user's display unit. '°C' is identity; '°F' is the standard
// `(c*9)/5+32`. Reproduced verbatim from the lib switch.
type TemperatureUnitPref = '°C' | '°F';

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

// ─── `useUnits` shim (web @/hooks/useUnits — temperature surface) ──
// Wired to the native useSettings port: derive the temperature pref from
// `unit_of_temp` exactly as the web hook does and expose a stable `unitPrefs`.
// Only `unitPrefs` is consumed by this chart, so that is all the shim returns.
function deriveTemperature(unitOfTemp: string | undefined): TemperatureUnitPref {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

function useUnits(): {unitPrefs: {temperature: TemperatureUnitPref}} {
  const {data: settings} = useSettings();
  const temperature = deriveTemperature(settings?.unit_of_temp);
  return useMemo(() => ({unitPrefs: {temperature}}), [temperature]);
}

// ─── i18n fallback ────────────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, so intent survives.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

interface StatorTempChartProps {
  data: MotorChartDataPoint[];
}

export function StatorTempChart({data}: StatorTempChartProps) {
  const {t} = useTranslation();
  const {unitPrefs} = useUnits();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;

  if (data.length <= 1) return null;

  return (
    <FadeIn delay={0.23}>
      <ChartContainer
        title={t('drivetrain.statorTempHistory', 'Stator Temperature History')}
        subtitle={t(
          'drivetrain.statorTempSub',
          'Motor stator temperature over recent snapshots',
        )}
        ariaLabel={t(
          'drivetrain.statorTempHistory.aria',
          'Front, rear-left and rear-right motor stator temperature history line chart',
        )}
        data={data.map(d => ({
          time: d.time,
          stator: d.stator,
          statorRel: d.statorRel,
          statorRer: d.statorRer,
        }))}
        dataColumns={[
          {key: 'time', label: t('drivetrain.col.time', 'Time')},
          {
            key: 'stator',
            label: `${t('drivetrain.col.stator', 'Stator')} (${tempUnit})`,
          },
          {
            key: 'statorRel',
            label: `${t('drivetrain.col.statorRel', 'Rear-Left')} (${tempUnit})`,
          },
          {
            key: 'statorRer',
            label: `${t('drivetrain.col.statorRer', 'Rear-Right')} (${tempUnit})`,
          },
        ]}
        height={280}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--glass-border)"
              strokeOpacity={0.4}
            />
            <XAxis dataKey="time" tick={{fill: 'var(--text-muted)', fontSize: 10}} />
            <YAxis tick={{fill: 'var(--text-muted)', fontSize: 10}} />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Line
              {...AREA_DEFAULTS}
              dataKey="stator"
              name={`${t('drivetrain.statorTemp', 'Stator Temp')} (${tempUnit})`}
              stroke="#ef4444"
            />
            <Line
              {...AREA_DEFAULTS}
              dataKey="statorRel"
              name={`${t(
                'drivetrain.statorTempRearLeft',
                'Rear-Left Stator Temp',
              )} (${tempUnit})`}
              stroke="#a855f7"
            />
            <Line
              {...AREA_DEFAULTS}
              dataKey="statorRer"
              name={`${t(
                'drivetrain.statorTempRearRight',
                'Rear-Right Stator Temp',
              )} (${tempUnit})`}
              stroke="#06b6d4"
            />
            <ReferenceLine
              y={toTemperatureDisplay(60)}
              stroke="#4ade80"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{
                value: t('drivetrain.normal', 'Normal'),
                position: 'right',
                fill: '#4ade80',
                fontSize: 10,
              }}
            />
            <ReferenceLine
              y={toTemperatureDisplay(80)}
              stroke="#fbbf24"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{
                value: t('drivetrain.warm', 'Warm'),
                position: 'right',
                fill: '#fbbf24',
                fontSize: 10,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
    </FadeIn>
  );
}
