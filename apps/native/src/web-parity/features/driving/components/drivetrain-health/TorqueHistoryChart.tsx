// Native parity port of
// web/src/features/driving/components/drivetrain-health/TorqueHistoryChart.tsx.
//
// The web component is the drivetrain-health "Motor Torque" panel: a FadeIn
// (delay 0.24) wrapping a ChartContainer whose Recharts ResponsiveContainer ->
// AreaChart plots a single `torque` Area (cyan #00f0ff gradient fill), with a
// CartesianGrid, time XAxis, value YAxis, a hover Tooltip, a Legend, and a
// ReferenceLine at y=0. It renders nothing when there is one-or-fewer points or
// no non-null torque sample.
//
// Native adaptations (each documented in the .parity.json sidecar):
//   - react-i18next `useTranslation` (web L1) -> local native-safe
//     `useNativeTranslation()` returning t(key, fallback) = fallback (the
//     established YearlyTrendChart convention); every i18n key + English default
//     is preserved verbatim.
//   - `@/components/charts` (web L3-17): ChartContainer is the native parity
//     export; the Recharts primitives (ResponsiveContainer/AreaChart/Area/
//     XAxis/YAxis/CartesianGrid/Tooltip/Legend/ReferenceLine) and the
//     ChartTooltip/ChartGradient/AREA_DEFAULTS helpers depend on browser DOM/SVG
//     and have no native renderer, so the single-series area chart is rendered
//     with the native `AreaChartWrapper` (the parity port of AreaChartWrapper):
//     it draws the same translucent cyan area + grid + time/value axes and, in
//     place of the unavailable hover Tooltip + Recharts <Legend/>, a latest-value
//     legend. The exact numbers stay reachable through ChartContainer's
//     accessible data table (fed by the same `data` + `dataColumns`).
//   - `@/components/motion` FadeIn (web L18): framer-motion entrance -> a native
//     Animated fade/translate entry honouring the reduce-motion preference (the
//     established MoreDetailsPanel / DriveTimeline / SummaryHeroCards
//     convention); the web `delay={0.24}` seconds is preserved.
//   - `./constants` MotorChartDataPoint (web L20): the native constants module is
//     not ported yet, so the consumed type is mirrored verbatim locally (the
//     index.ts barrel / DriveTimeline "mirror the consumed subset" convention).
//   - ChartGradient id="dtTorqueGrad" color="#00f0ff" + Area stroke="#00f0ff"
//     (web L47/L58-59) -> the single TORQUE_COLOR '#00f0ff' passed as the series
//     colour; AreaChartWrapper fills the area with that colour at reduced alpha,
//     approximating the SVG gradient. AREA_DEFAULTS (web L55, Recharts stroke/
//     dot/type) is SVG-line styling with no native prop and is not applicable.
//   - ReferenceLine y={0} (web L61): a Recharts visual zero marker with no direct
//     native analog; AreaChartWrapper's domain always spans zero (it clamps
//     min/max through 0), so the zero baseline is implicitly represented, and the
//     precise values remain in the data table. Documented in the sidecar.
//
// No DOM module, browser HTML element, Recharts, Leaflet, or web @/components/ui
// import appears in the native output.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {AccessibilityInfo, Animated, Easing} from 'react-native';

import {AreaChartWrapper, ChartContainer} from '../../../../components/charts';

/* ── ported: ./constants MotorChartDataPoint (native constants not yet ported) ─ */

interface MotorChartDataPoint {
  time: string;
  stator: number | null;
  statorRel: number | null;
  statorRer: number | null;
  torque: number | null;
  speed: number | null;
  axle: number | null;
}

interface TorqueHistoryChartProps {
  data: MotorChartDataPoint[];
}

/* ── i18n: react-i18next useTranslation -> native-safe fallback shim ───────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (_key, fallback) => fallback, []);
}

/* ── reduce-motion preference (drives the FadeIn entry animation) ──────────── */

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

/* ── FadeIn (native-safe port of @/components/motion framer-motion entry) ──── */

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

// web ChartGradient id="dtTorqueGrad" color="#00f0ff" + Area stroke="#00f0ff".
const TORQUE_COLOR = '#00f0ff';

export function TorqueHistoryChart({data}: TorqueHistoryChartProps) {
  const t = useNativeTranslation();

  // web L29: render nothing without enough data or any non-null torque sample.
  if (data.length <= 1 || !data.some(d => d.torque !== null)) {
    return null;
  }

  // web L37: the AreaChart/table projection — only `time` + `torque` are plotted.
  const chartData = data.map(d => ({time: d.time, torque: d.torque}));
  const series = [
    {
      key: 'torque',
      // web L57: Area name={`${t('drivetrain.torque','Torque')} (Nm)`}.
      label: `${t('drivetrain.torque', 'Torque')} (Nm)`,
      color: TORQUE_COLOR,
    },
  ];

  return (
    <FadeIn delay={0.24}>
      <ChartContainer
        title={t('drivetrain.torqueHistory', 'Motor Torque')}
        subtitle={t(
          'drivetrain.torqueHistorySub',
          'Drive inverter torque output over time',
        )}
        ariaLabel={t(
          'drivetrain.torqueHistory.aria',
          'Motor inverter torque output history area chart',
        )}
        data={chartData}
        dataColumns={[
          {key: 'time', label: t('drivetrain.col.time', 'Time')},
          {key: 'torque', label: t('drivetrain.col.torque', 'Torque (Nm)')},
        ]}
        height={280}>
        {/* web L44-62: ResponsiveContainer/AreaChart torque Area -> native area
            renderer; height 220 fits the frame + latest-value legend inside the
            ChartContainer 280px body (web ResponsiveContainer height="100%"). */}
        <AreaChartWrapper
          data={chartData}
          xKey="time"
          series={series}
          height={220}
        />
      </ChartContainer>
    </FadeIn>
  );
}
