import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartLegend, ChartTooltip, AREA_DEFAULTS,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { ChartCard, ChartSummary } from '@/components/layout';
import { chartTokens } from '@/lib/tokens';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';

import { DETAIL_SERIES_DASHES, LEGEND_STYLE } from './helpers';
import type { ChartDataPoint, DriveStats } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

type TireKey = 'tireFl' | 'tireFr' | 'tireRl' | 'tireRr';

/**
 * The four corner tire-pressure series, in render order. `key` matches the
 * camelCased {@link ChartDataPoint} field; `color` is shared by the per-wheel
 * summary tile and its chart line so the two read as one series; `abbr` is the
 * compact legend name.
 */
const TIRE_WHEELS = [
  { key: 'tireFl', color: chartTokens.series[0], abbr: 'FL', labelKey: 'driveDetail.frontLeft', labelDefault: 'Front left' },
  { key: 'tireFr', color: chartTokens.series[1], abbr: 'FR', labelKey: 'driveDetail.frontRight', labelDefault: 'Front right' },
  { key: 'tireRl', color: chartTokens.series[2], abbr: 'RL', labelKey: 'driveDetail.rearLeft', labelDefault: 'Rear left' },
  { key: 'tireRr', color: chartTokens.series[4], abbr: 'RR', labelKey: 'driveDetail.rearRight', labelDefault: 'Rear right' },
] as const satisfies ReadonlyArray<{
  key: TireKey; color: string; abbr: string; labelKey: string; labelDefault: string;
}>;

interface TirePressureSectionProps {
  chartData: ChartDataPoint[];
  stats: DriveStats;
}

interface WheelSummary {
  key: TireKey;
  color: string;
  abbr: string;
  label: string;
  /** Lowest positive reading in the user's pressure unit, or null when none. */
  min: number | null;
  /** Highest positive reading in the user's pressure unit, or null when none. */
  max: number | null;
  /** True when the wheel has at least one non-null sample → it gets a line. */
  present: boolean;
}

export function TirePressureSection({ chartData, stats }: TirePressureSectionProps) {
  const { fmtRange } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const pressureUnit = unitPrefs.pressure;
  const hidden = useHiddenSeries('drive-detail-tire-pressure');

  // The page always passes an array, but a defensive `?? []` keeps a future
  // caller — or a partially-hydrated error-boundary retry — from crashing the
  // panel on a `.map` / `for…of` over an undefined `chartData`.
  const data = chartData ?? [];

  // Summarise every wheel in a single pass. Folding min/max into the loop —
  // rather than `Math.min(...vals)` — stops a multi-thousand-sample drive from
  // overflowing the argument stack with a RangeError (the same hardening the
  // sibling DriveOverviewChart carries). Non-finite / non-positive readings are
  // skipped so a spurious 0 or NaN never drags the range to a bogus value.
  const wheels = useMemo<WheelSummary[]>(
    () =>
      TIRE_WHEELS.map((w) => {
        let min: number | null = null;
        let max: number | null = null;
        let present = false;
        for (const d of data) {
          const v = d[w.key];
          if (v == null) continue;
          present = true;
          if (!Number.isFinite(v) || v <= 0) continue;
          if (min === null || v < min) min = v;
          if (max === null || v > max) max = v;
        }
        return { key: w.key, color: w.color, abbr: w.abbr, label: t(w.labelKey, w.labelDefault), min, max, present };
      }),
    [data, t],
  );

  return (
    <FadeIn>
      {/* chart-a11y:no-table dense per-sample tire pressure trace; per-wheel min-max ranges appear in the card summary */}
      <ChartCard
        summary={(
          <ChartSummary
            label={t('driveDetail.tirePressure', 'Tire pressure during drive')}
            items={wheels.map(wheel => ({
              id: wheel.key,
              label: t('driveDetail.tirePressureRange', '{{wheel}} pressure range', { wheel: wheel.label }),
              unit: pressureUnit,
              value: fmtRange(wheel.min, wheel.max),
            }))}
          />
        )}
        title={t('driveDetail.tirePressure', 'Tire pressure during drive')}
        chartKey="drive-detail-tire-pressure"
        ariaLabel={t('driveDetail.tirePressureAria', 'Front and rear tire pressure lines over the drive timeline')}
        height={310}
        size="standard"
        toolbar
        exportable
        empty={!stats.hasTirePressure}
        emptyMessage={t('driveDetail.noChartData', 'No telemetry data available')}
      >
        {stats.hasTirePressure ? (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: chartTokens.axisStroke, fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis domain={['dataMin', 'dataMax']} tick={{ fill: chartTokens.axisStroke, fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={hidden} wrapperStyle={LEGEND_STYLE} />
                {wheels
                  .filter((w) => w.present)
                  .map((w) => (
                    <Line
                      key={w.key}
                      {...AREA_DEFAULTS}
                      dataKey={w.key}
                      stroke={w.color}
                      strokeDasharray={DETAIL_SERIES_DASHES[TIRE_WHEELS.findIndex(wheel => wheel.key === w.key)]}
                      hide={hidden.isHidden(w.key)}
                      name={`${w.abbr} (${pressureUnit})`}
                    />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
            <Activity className="h-8 w-8 opacity-20" />
            <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
          </div>
        )}
      </ChartCard>
    </FadeIn>
  );
}
