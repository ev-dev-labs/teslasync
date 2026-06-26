// Native parity port of
// web/src/features/driving/components/driving-dynamics/MotorHistoryCharts.tsx.
//
// The web module renders the driving-dynamics motor-telemetry history block:
// three FadeIn-wrapped, exportable <ChartContainer>s — a "Motor Power Over Time"
// Recharts <AreaChart> (drive #06b6d4 + regen #22c55e power areas with a URL-
// persisted <ChartLegend> toggle), a "Motor Torque History" Recharts <LineChart>
// (front #3b82f6 / rear #a855f7 torque), and a "Motor RPM History" Recharts
// <LineChart> (front #06b6d4 / rear #a855f7 rpm). Each chart falls back to an
// <EmptyState> placeholder when its series have no samples.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?) returns the English fallback (or the key), preserving
//     every translation key verbatim at the call site (the parity bundle ships
//     no i18n runtime) — the DriveAnalyticsSection / MotorHistoryWidget precedent.
//   • @/hooks/useDateFormat formatTime -> a local useDateFormat() returning a
//     formatTime that maps a timestamp to a locale-aware "12:00 PM" via
//     toLocaleTimeString({hour:'2-digit',minute:'2-digit'}) with a "—" guard,
//     mirroring @/lib/dateFormat formatTime. The web hook also binds an IANA
//     timezone; RN ships no ported useTimezone, so the device zone/locale is
//     used (the same-directory DriveAnalyticsSection date convention).
//   • @/hooks/useHiddenSeries (URL-search-param backed) -> a local in-memory
//     useHiddenSeries keeping the HiddenSeriesState API (hidden/toggle/isHidden/
//     reset); React Native has no browser URL state, so the toggle is retained
//     in component state (the ChartHiddenSeriesContext native-port convention).
//     The `powerHidden` state name and 'motor-power-history' key are preserved.
//   • the Motor Power Recharts ResponsiveContainer/AreaChart/Area×2/XAxis/YAxis/
//     CartesianGrid/Tooltip/ChartGradient/ChartLegend(+AREA_DEFAULTS) -> the
//     already-ported native <AreaChartWrapper> (the DriveAnalyticsSection /
//     PowerOutputChart convention) drawing the power/regen series over the
//     formatted 'time' axis with native grid/axes + an always-visible latest-
//     value summary (RN has no hover tooltip), plus the interactive native
//     <ChartLegend state={powerHidden}> whose tap-to-hide drives both the legend
//     dimming and the AreaChartWrapper series filter (reproducing the web
//     `hide={powerHidden.isHidden(...)}` behaviour). The YAxis " kW" unit maps to
//     the yFormatter suffix.
//   • the Motor Torque / Motor RPM Recharts ResponsiveContainer/LineChart/Line×2/
//     XAxis/YAxis/CartesianGrid/Tooltip/Legend(+AREA_DEFAULTS) -> the same native
//     <AreaChartWrapper> (no LineChartWrapper exists; the area fill is the
//     established native-safe substitute for a Recharts line series), drawing the
//     front/rear series over the 'time' axis; the YAxis " Nm" / " RPM" units map
//     to the yFormatter suffix and the static Legend folds into the wrapper's
//     latest-value summary.
//   • @/components/feedback <EmptyState> + lucide <Activity> icon -> the already-
//     ported native <EmptyState> with the SemanticIcon "activity" glyph (lucide
//     is DOM-only).
//   • @/components/motion <FadeIn delay> -> the already-ported native FadeIn (same
//     opacity/slide entry + reduced-motion fallback) at delays 0.2 / 0.25 / 0.3.
// No DOM elements, react-i18next, Recharts, Leaflet, react-dom, or web UI-kit
// modules are imported into the native output.

import React, {useCallback, useMemo, useState} from 'react';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import type {MotorSnapshot} from '../../../../api/types';
import {
  AreaChartWrapper,
  ChartContainer,
  ChartLegend,
} from '../../../../components/charts';
import type {HiddenSeriesState} from '../../../../components/charts/ChartHiddenSeriesContext';
import {EmptyState} from '../../../../components/feedback/EmptyState';
import {FadeIn} from '../../../../components/motion/FadeIn';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site. A stable useCallback identity keeps the hook honest.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/hooks/useDateFormat formatTime ─────────────────────────── */

type DateInput = string | Date | null | undefined;

// web @/lib/dateFormat formatTime: locale-aware "12:00 PM"
// ({hour:'2-digit',minute:'2-digit'}); "—" for nullish / invalid input. The web
// useDateFormat also binds an IANA timezone; RN ships no ported useTimezone, so
// the host device zone/locale is used (undefined), matching the same-directory
// DriveAnalyticsSection date convention.
function libFormatTime(value: DateInput): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
}

// Native bridge mirroring the web useDateFormat().formatTime call site.
function useDateFormat(): {formatTime: (value: DateInput) => string} {
  const formatTime = useCallback((value: DateInput) => libFormatTime(value), []);
  return {formatTime};
}

/* ─── inlined @/hooks/useHiddenSeries (URL state -> in-memory) ──────────── */

// Native stand-in for the web URL-search-param hidden-series hook. React Native
// has no browser URL state, so the hidden set is retained in component state
// while preserving the HiddenSeriesState API (hidden/toggle/isHidden/reset) and
// the canonical alphabetically-sorted toggle order, matching the native
// ChartHiddenSeriesContext port. `chartKey` is accepted for call-site parity.
function useHiddenSeries(_chartKey: string): HiddenSeriesState {
  const [hiddenValues, setHiddenValues] = useState<readonly string[]>([]);

  const hidden = useMemo(() => new Set(hiddenValues), [hiddenValues]);

  const isHidden = useCallback(
    (seriesKey: string) => hidden.has(seriesKey),
    [hidden],
  );

  const toggle = useCallback((seriesKey: string) => {
    setHiddenValues(prev => {
      const next = new Set(prev);
      if (next.has(seriesKey)) {
        next.delete(seriesKey);
      } else {
        next.add(seriesKey);
      }
      return Array.from(next).sort();
    });
  }, []);

  const reset = useCallback(() => {
    setHiddenValues([]);
  }, []);

  return useMemo(
    () => ({hidden, toggle, isHidden, reset}),
    [hidden, isHidden, reset, toggle],
  );
}

/* ─── series colors (ported verbatim from the source) ──────────────────── */

// web ChartGradient/Area power stroke="#06b6d4" / regen stroke="#22c55e".
const POWER_COLOR = '#06b6d4';
const REGEN_COLOR = '#22c55e';
// web Line torque front stroke="#3b82f6" / rear stroke="#a855f7".
const TORQUE_FRONT_COLOR = '#3b82f6';
const TORQUE_REAR_COLOR = '#a855f7';
// web Line rpm front stroke="#06b6d4" / rear stroke="#a855f7".
const RPM_FRONT_COLOR = '#06b6d4';
const RPM_REAR_COLOR = '#a855f7';

const CHART_HEIGHT = 280;

// web ChartLegend/Legend wrapperStyle={{ color: 'rgba(255,255,255,0.6)' }}.
const LEGEND_WRAPPER_STYLE = {color: 'rgba(255,255,255,0.6)'} as const;

interface MotorHistoryChartsProps {
  motorHistory: MotorSnapshot[] | undefined;
  toSpeedDisplay: (v: number) => number;
  speedUnit: string;
}

export default function MotorHistoryCharts({
  motorHistory,
}: MotorHistoryChartsProps) {
  const {t} = useTranslation();
  const {formatTime} = useDateFormat();

  // URL-persisted hidden-series state for the
  // power-vs-regen trace; users often want to isolate one or the other
  // when looking at a regen-heavy descent or a sustained throttle pull.
  const powerHidden = useHiddenSeries('motor-power-history');

  const powerChartData = useMemo(
    () =>
      (motorHistory ?? []).map(s => ({
        time: formatTime(s.ts),
        power: s.power_kw ?? null,
        regen: s.regen_kw ?? null,
      })),
    [motorHistory, formatTime],
  );

  const torqueChartData = useMemo(
    () =>
      (motorHistory ?? []).map(s => ({
        time: formatTime(s.ts),
        front: s.torque_nm_front ?? null,
        rear: s.torque_nm_rear ?? null,
      })),
    [motorHistory, formatTime],
  );

  const rpmChartData = useMemo(
    () =>
      (motorHistory ?? []).map(s => ({
        time: formatTime(s.ts),
        front: s.motor_rpm_front ?? null,
        rear: s.motor_rpm_rear ?? null,
      })),
    [motorHistory, formatTime],
  );

  // web ChartLegend payload + Area hide={powerHidden.isHidden(...)}: the toggle
  // drives both the legend dimming and the AreaChartWrapper series filter.
  const powerSeries = useMemo(
    () => [
      {key: 'power', label: t('dynamics.power', 'Power'), color: POWER_COLOR},
      {key: 'regen', label: t('dynamics.regen', 'Regen'), color: REGEN_COLOR},
    ],
    [t],
  );
  const visiblePowerSeries = useMemo(
    () => powerSeries.filter(s => !powerHidden.isHidden(s.key)),
    [powerSeries, powerHidden],
  );
  const powerLegendPayload = useMemo(
    () => powerSeries.map(s => ({value: s.label, dataKey: s.key, color: s.color})),
    [powerSeries],
  );

  const torqueSeries = useMemo(
    () => [
      {
        key: 'front',
        label: t('dynamics.torqueFront', 'Front Torque'),
        color: TORQUE_FRONT_COLOR,
      },
      {
        key: 'rear',
        label: t('dynamics.torqueRear', 'Rear Torque'),
        color: TORQUE_REAR_COLOR,
      },
    ],
    [t],
  );

  const rpmSeries = useMemo(
    () => [
      {
        key: 'front',
        label: t('dynamics.rpmFront', 'Front RPM'),
        color: RPM_FRONT_COLOR,
      },
      {
        key: 'rear',
        label: t('dynamics.rpmRear', 'Rear RPM'),
        color: RPM_REAR_COLOR,
      },
    ],
    [t],
  );

  const noData = (
    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
      icon={<SemanticIcon decorative name="activity" size="sm" />}
      message={t('dynamics.awaitingData', 'Awaiting motor telemetry data...')}
    />
  );

  return (
    <>
      {/* Motor Power Over Time */}
      <FadeIn delay={0.2}>
        {/* chart-a11y:no-table dense per-sample telemetry trace; CSV export available */}
        <ChartContainer
          title={t('dynamics.powerOverTime', 'Motor Power Over Time')}
          subtitle={t(
            'dynamics.powerOverTimeDesc',
            'Drive and regen power from motor telemetry',
          )}
          ariaLabel={t(
            'dynamics.powerOverTime.aria',
            'Motor power and regen over time area chart',
          )}
          height={CHART_HEIGHT}
          chartKey="motor-power-history"
          exportable
          exportFilename="motor-power">
          {powerChartData.length > 0 ? (
            <>
              <ChartLegend
                payload={powerLegendPayload}
                state={powerHidden}
                wrapperStyle={LEGEND_WRAPPER_STYLE}
              />
              <AreaChartWrapper
                data={powerChartData}
                height={CHART_HEIGHT}
                series={visiblePowerSeries}
                xKey="time"
                yFormatter={(v: number) => `${Math.round(v)} kW`}
              />
            </>
          ) : (
            noData
          )}
        </ChartContainer>
      </FadeIn>

      {/* Motor Torque History */}
      <FadeIn delay={0.25}>
        {/* chart-a11y:no-table dense per-sample telemetry trace; CSV export available */}
        <ChartContainer
          title={t('dynamics.torqueHistory', 'Motor Torque History')}
          subtitle={t(
            'dynamics.torqueHistoryDesc',
            'Front and rear motor torque over time',
          )}
          ariaLabel={t(
            'dynamics.torqueHistory.aria',
            'Front and rear motor torque over time line chart',
          )}
          height={CHART_HEIGHT}
          exportable
          exportFilename="torque-history">
          {torqueChartData.length > 0 ? (
            <AreaChartWrapper
              data={torqueChartData}
              height={CHART_HEIGHT}
              series={torqueSeries}
              xKey="time"
              yFormatter={(v: number) => `${Math.round(v)} Nm`}
            />
          ) : (
            noData
          )}
        </ChartContainer>
      </FadeIn>

      {/* Motor RPM History */}
      <FadeIn delay={0.3}>
        {/* chart-a11y:no-table dense per-sample telemetry trace; CSV export available */}
        <ChartContainer
          title={t('dynamics.rpmHistory', 'Motor RPM History')}
          subtitle={t(
            'dynamics.rpmHistoryDesc',
            'Front and rear motor RPM over time',
          )}
          ariaLabel={t(
            'dynamics.rpmHistory.aria',
            'Front and rear motor RPM over time line chart',
          )}
          height={CHART_HEIGHT}
          exportable
          exportFilename="motor-rpm">
          {rpmChartData.length > 0 ? (
            <AreaChartWrapper
              data={rpmChartData}
              height={CHART_HEIGHT}
              series={rpmSeries}
              xKey="time"
              yFormatter={(v: number) => `${Math.round(v)} RPM`}
            />
          ) : (
            noData
          )}
        </ChartContainer>
      </FadeIn>
    </>
  );
}
