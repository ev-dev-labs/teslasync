import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ChartContainer, ChartTooltip, AREA_DEFAULTS,
  LineChart, Line, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { LEGEND_STYLE } from './helpers';
import type { ChartDataPoint, DriveStats } from './types';

type TireKey = 'tireFl' | 'tireFr' | 'tireRl' | 'tireRr';

/**
 * The four corner tire-pressure series, in render order. `key` matches the
 * camelCased {@link ChartDataPoint} field; `color` is shared by the per-wheel
 * summary tile and its chart line so the two read as one series; `abbr` is the
 * compact legend name.
 */
const TIRE_WHEELS = [
  { key: 'tireFl', color: '#3b82f6', abbr: 'FL', labelKey: 'driveDetail.frontLeft', labelDefault: 'Front Left' },
  { key: 'tireFr', color: '#10b981', abbr: 'FR', labelKey: 'driveDetail.frontRight', labelDefault: 'Front Right' },
  { key: 'tireRl', color: '#f59e0b', abbr: 'RL', labelKey: 'driveDetail.rearLeft', labelDefault: 'Rear Left' },
  { key: 'tireRr', color: '#ef4444', abbr: 'RR', labelKey: 'driveDetail.rearRight', labelDefault: 'Rear Right' },
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
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const pressureUnit = unitPrefs.pressure;

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
      {/* chart-a11y:no-table dense per-sample tire pressure trace; min/max stats appear above the chart in the per-wheel tiles */}
      <ChartContainer
        title={t('driveDetail.tirePressure', 'Tire Pressure During Drive')}
        ariaLabel={t('driveDetail.tirePressure.aria', 'Front and rear tire pressure lines over the drive timeline')}
        height={310}
      >
        {stats.hasTirePressure ? (
          <>
            <div className="grid grid-cols-4 gap-3 mb-3">
              {wheels.map((tp) => (
                <div key={tp.key} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 text-center">
                  <p className="text-2xs text-[var(--text-muted)]">{tp.label}</p>
                  <p className="text-sm font-bold" style={{ color: tp.color }}>
                    {tp.min != null && tp.max != null
                      ? `${fmtNumber(tp.min)}–${fmtNumber(tp.max)} ${pressureUnit}`
                      : '—'}
                  </p>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                {wheels
                  .filter((w) => w.present)
                  .map((w) => (
                    <Line
                      key={w.key}
                      {...AREA_DEFAULTS}
                      dataKey={w.key}
                      stroke={w.color}
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
      </ChartContainer>
    </FadeIn>
  );
}
