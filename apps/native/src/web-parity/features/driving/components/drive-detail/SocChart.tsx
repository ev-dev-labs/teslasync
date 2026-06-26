// Native parity port of
// web/src/features/driving/components/drive-detail/SocChart.tsx.
//
// `SocChart` is the "SOC % Over Time" panel of the single-drive deep dive
// (DriveDetailPage). It renders a synced area chart of the per-sample state of
// charge (`battery` data key) over the drive's `time` axis, fixed to a 0-100
// Y domain, with an emerald (#10b981) gradient fill and a synced-cursor
// reference line that appears only while a sibling chart is being hovered
// (`syncedX != null`). When there are one or fewer samples
// (`chartData.length <= 1`) it shows an "No telemetry data available" empty
// state instead of the chart. Every prop, data key, hex colour, i18n key +
// English fallback, the `height={220}`, the `domain={[0, 100]}`, the
// `interval="preserveStartEnd"`, the `ifOverflow="hidden"`/`isFront` cursor
// flags, the synced-cursor wiring (syncId/syncMethod/onMouseMove) and the
// deliberate `chart-a11y:no-table` opt-out (no `data`/`dataColumns` passed to
// ChartContainer — the start/end SOC is surfaced in the drive summary tiles)
// are preserved verbatim.
//
// Web module -> native-safe mapping (contract rules 4-7):
//   - `@/components/charts` (L3-9: ChartContainer, ChartTooltip, AREA_DEFAULTS,
//     areaGradient, AreaChart, Area, ReferenceLine, XAxis, YAxis, CartesianGrid,
//     Tooltip, ResponsiveContainer, useSyncedCursor, useSyncedReferenceLineX)
//     -> the web-parity `components/charts` barrel. ChartContainer + ChartTooltip
//     + AREA_DEFAULTS + areaGradient + useSyncedCursor + useSyncedReferenceLineX
//     are real native ports; ResponsiveContainer/AreaChart/Area/XAxis/YAxis/
//     CartesianGrid/Tooltip/ReferenceLine are the barrel's native chart-primitive
//     stubs. Recharts is a browser DOM/SVG renderer with no native backend, so
//     the recharts JSX shape is preserved 1:1 but the leaf primitives render an
//     accessibility-labelled placeholder and IGNORE every styling prop (stroke,
//     fill, tick, dataKey, name, domain, interval, strokeDasharray, strokeOpacity,
//     ifOverflow, isFront, content, the synced-cursor handlers, and the spread
//     AREA_DEFAULTS) — the same native chart-stub contract the sibling
//     StatorTempChart / DriveDetailPage ports rely on. The inert prop values
//     (incl. the source's `var(--glass-border)` / `var(--text-muted)` CSS-var
//     strings and the `url(#socGrad)` fill reference) are carried over verbatim
//     to document visual intent; they have no runtime effect on native.
//     `areaGradient('socGrad', '#10b981')` returns the native gradient
//     placeholder View (Recharts SVG <defs> gradients are unavailable on native).
//     Visual area-rendering is UNAVAILABLE on native (documented in the sidecar);
//     ChartContainer still renders the title + a11y summary, so the panel intent
//     survives.
//   - `@/lib/tokens` chartTokens (L10) -> only `chartTokens.cursor` is read here;
//     its three fields are inlined verbatim as CURSOR_TOKENS (stroke
//     'rgba(255, 255, 255, 0.3)', strokeWidth 1, strokeDasharray '4 2'). The
//     `@/lib/tokens` module is not a standalone native port yet, so the consumed
//     slice travels with the component (mirroring how the sibling StatorTempChart
//     inlined its constants/converters).
//   - `@/components/motion` FadeIn (L11) -> the ported web-parity components/motion
//     FadeIn; the web-only `className="h-full"` is retained for source parity
//     (ignored on native, which has no className — the FadeIn prop type accepts it).
//   - `./types` ChartDataPoint (L12) -> inlined verbatim (the drive-detail types.ts
//     is not a standalone native port yet; only `time` and `battery` are read by
//     the chart, but the full row shape is carried field-for-field, mirroring the
//     CostSavingsPanel port which inlined DriveStats from the same module).
//   - lucide-react `Activity` (L2, SVG, no native analog) -> a decorative "📈"
//     telemetry-trend glyph rendered in `AppText` and hidden from assistive tech
//     (the adjacent "No telemetry data available" caption carries the meaning).
//     This matches the telemetry-trend glyph used by the sibling SpeedProfilePage
//     / DriveDetailPage ports. The web `h-8 w-8 opacity-20` (32px @ 0.2) maps to
//     fontSize 32 / opacity 0.2.
//   - react-i18next `useTranslation` (L1) -> the standard local key-preserving
//     fallback shim returning the inline English copy while every call site still
//     references the i18n key, so translation intent survives (no react-i18next in
//     the native deps).
//
// DOM -> native element mapping: the empty-state `<div>` -> a centred `View`
// (h-full -> flex:1, gap-2 -> spacing.sm); the `<p>` -> an `AppText`
// (text-xs -> the caption variant, text-[var(--text-muted)] -> tone="muted").
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported into this native output.

import React from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import {
  ChartContainer,
  ChartTooltip,
  AREA_DEFAULTS,
  areaGradient,
  AreaChart,
  Area,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  useSyncedCursor,
  useSyncedReferenceLineX,
} from '../../../../components/charts';
import { FadeIn } from '../../../../components/motion';
import { AppText } from '../../../../../components/ui/AppText';
import { spacing } from '../../../../../theme/tokens';

// ─── chartTokens.cursor (inlined from @/lib/tokens) ───────────
// Only the synced-cursor reference-line styling is read by this chart. Reproduced
// verbatim from the lib's `chartTokens.cursor` so the custom <ReferenceLine>
// documents the same intent the web cursor line carries (inert on native).
const CURSOR_TOKENS = {
  stroke: 'rgba(255, 255, 255, 0.3)',
  strokeWidth: 1,
  strokeDasharray: '4 2',
} as const;

// ─── ChartDataPoint (inlined from ./types) ────────────────────
// The drive-detail types.ts is not a standalone native port yet; the row shape
// is inlined verbatim (only `time` + `battery` are read by this chart). Mirrors
// the web `./types` ChartDataPoint field-for-field.
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

// ─── i18n fallback ────────────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, so intent survives.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(): { t: TFunc } {
  return { t: (_key, fallback) => fallback };
}

// ─── Glyph (lucide Activity substitute) ───────────────────────
// Decorative; the "No telemetry data available" caption carries the meaning, so
// the glyph is hidden from assistive tech.
function Glyph({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  return (
    <AppText
      accessibilityElementsHidden
      allowFontScaling={false}
      importantForAccessibility="no"
      style={style}
    >
      {children}
    </AppText>
  );
}

interface SocChartProps {
  chartData: ChartDataPoint[];
}

export function SocChart({ chartData }: SocChartProps) {
  const { t } = useTranslation();
  const syncProps = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();

  return (
    <FadeIn className="h-full">
      {/* chart-a11y:no-table dense per-sample SOC trace; start/end SOC visible in the drive summary tiles */}
      <ChartContainer
        title={t('driveDetail.socOverTime', 'SOC % Over Time')}
        ariaLabel={t('driveDetail.socOverTime.aria', 'State of charge percent over time area chart')}
        height={220}
        className="h-full"
      >
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              syncId={syncProps.syncId}
              syncMethod={syncProps.syncMethod}
              onMouseMove={syncProps.onMouseMove}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              {areaGradient('socGrad', '#10b981')}
              <Area {...AREA_DEFAULTS} dataKey="battery" stroke="#10b981" fill="url(#socGrad)" name={`${t('driveDetail.soc', 'SOC')} %`} />
              {syncedX != null && (
                <ReferenceLine
                  x={syncedX}
                  stroke={CURSOR_TOKENS.stroke}
                  strokeWidth={CURSOR_TOKENS.strokeWidth}
                  strokeDasharray={CURSOR_TOKENS.strokeDasharray}
                  ifOverflow="hidden"
                  isFront
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <View style={styles.empty}>
            <Glyph style={styles.emptyGlyph}>📈</Glyph>
            <AppText tone="muted" variant="caption">
              {t('driveDetail.noChartData', 'No telemetry data available')}
            </AppText>
          </View>
        )}
      </ChartContainer>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  emptyGlyph: {
    fontSize: 32,
    opacity: 0.2,
  },
});
