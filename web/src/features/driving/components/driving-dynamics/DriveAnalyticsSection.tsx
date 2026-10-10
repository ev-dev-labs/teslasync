import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import { SectionTitle } from '@/components/ui';
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ChartGradient,
  AREA_DEFAULTS,
  areaGradient,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  chartGrid,
  axisTick,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { formatDateShort } from '@/lib/dateFormat';
import type { Drive } from '@/types/driving';
import { SPEED_BUCKETS_RANGES } from './helpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';

interface SpeedBucket {
  range: string;
  count: number;
}

interface AccelPoint {
  distance: number;
  powerMax: number;
}

interface PowerPoint {
  index: number;
  label: string;
  powerMax: number | null;
  powerMin: number | null;
}

/** Stable empty reference so `filteredDrives ?? EMPTY_DRIVES` doesn't
 *  invalidate the memoised derives when the prop is briefly undefined. */
const EMPTY_DRIVES: Drive[] = [];

interface DriveAnalyticsSectionProps {
  filteredDrives: Drive[];
  toDistanceDisplay: (v: number) => number;
  toSpeedDisplay: (v: number) => number;
  distanceUnit: string;
  speedUnit: string;
}

export default function DriveAnalyticsSection({
  filteredDrives,
  toDistanceDisplay,
  toSpeedDisplay,
  distanceUnit,
  speedUnit,
}: DriveAnalyticsSectionProps) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  // Format the accessible table only. Keep chart/export series numeric and
  // unrounded so display precision never changes the underlying evidence.
  const formatMeasurement = (value: unknown) => isFiniteNumber(value) ? fmtNumber(value) : '—';

  const drives = filteredDrives ?? EMPTY_DRIVES;

  const speedDistribution = useMemo<SpeedBucket[]>(() => {
    const buckets = SPEED_BUCKETS_RANGES.map((b) => ({
      range: `${b.label} ${speedUnit}`,
      count: 0,
    }));
    for (const d of drives) {
      if (d.avgSpeedMps == null) continue;
      const spd = toSpeedDisplay(d.avgSpeedMps);
      // `spd` and the bucket bounds are BOTH in display units: the
      // SPEED_BUCKETS_RANGES numbers (0/30/60/90/120) are the same figures
      // the axis label prints ("30–60 mph"), so compare directly. Running
      // the bounds back through toSpeedDisplay bucketed drives in raw m/s
      // while labelling them mph/km/h — a 100 mph drive landed in "30–60".
      for (let i = 0; i < SPEED_BUCKETS_RANGES.length; i++) {
        const r = SPEED_BUCKETS_RANGES[i];
        if (spd >= r.min && spd < r.max) {
          buckets[i].count += 1;
          break;
        }
      }
    }
    return buckets;
  }, [drives, toSpeedDisplay, speedUnit]);

  const accelPatterns = useMemo<AccelPoint[]>(() =>
    drives
      .filter((d) => d.avgPowerW != null)
      .map((d) => ({
        distance: toDistanceDisplay(d.distanceM),
        powerMax: (d.avgPowerW as number) / 1000,
      })),
  [drives, toDistanceDisplay]);

  // Average peak-power reference line for the scatter. Memoised so the
  // reduce doesn't re-run on every render and the ReferenceLine prop stays
  // referentially stable for Recharts.
  const accelAvgPower = useMemo<number | null>(() => {
    if (accelPatterns.length === 0) return null;
    return accelPatterns.reduce((sum, p) => sum + p.powerMax, 0) / accelPatterns.length;
  }, [accelPatterns]);

  const powerProfile = useMemo<PowerPoint[]>(() => {
    const recent = [...drives].sort((a, b) => b.startTs.localeCompare(a.startTs)).slice(0, 20).reverse();
    return recent.map((d, i) => ({
      index: i + 1,
      label: formatDateShort(d.startTs),
      powerMax: d.avgPowerW != null ? d.avgPowerW / 1000 : null,
      powerMin: d.regenEnergyWh != null ? d.regenEnergyWh / 1000 : null,
    }));
  }, [drives]);

  // Empty guards — every panel shows a "No data available" placeholder
  // instead of an axis-only blank chart when its series has no points.
  const speedEmpty = speedDistribution.every((b) => b.count === 0);
  const accelEmpty = accelPatterns.length === 0;
  const powerEmpty = powerProfile.every((point) => point.powerMax == null && point.powerMin == null);

  return (
    <>
      <FadeIn delay={0.45}>
        <div className="mt-2 mb-2">
          <SectionTitle>
            {t('dynamics.driveAnalytics', 'Drive Analytics')}
          </SectionTitle>
        </div>
      </FadeIn>

      {/* Speed Distribution + Acceleration Patterns */}
      <FadeIn delay={0.5}>
        <Grid cols={{ default: 1, lg: 2 }} gap={4}>
          <ChartContainer
            title={t('dynamics.speedDistribution', 'Speed Distribution')}
            subtitle={t('dynamics.speedDistDesc', 'Drives grouped by average speed')}
            ariaLabel={t('dynamics.speedDistribution.aria', 'Speed-bucket drive count distribution bar chart')}
            data={speedDistribution.map((b) => ({ range: b.range, count: b.count }))}
            dataColumns={[
              { key: 'range', label: t('dynamics.col.range', 'Speed range') },
              { key: 'count', label: t('dynamics.col.drives', 'Drives') },
            ]}
            height={300}
            empty={speedEmpty}
            exportable
            exportFilename="speed-distribution"
          >
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={speedDistribution}>
                <defs>
                  <ChartGradient id="speedFill" color="#3b82f6" />
                </defs>
                {chartGrid}
                <XAxis dataKey="range" tick={axisTick} />
                <YAxis tick={axisTick} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill="url(#speedFill)" radius={[4, 4, 0, 0]} name={t('dynamics.drives', 'Drives')} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>

          {/* chart-a11y:no-table scatter chart of every drive — a per-row table here would be too dense; CSV export available */}
          <ChartContainer
            title={t('dynamics.contextCharts.load', 'Trip load comparison')}
            subtitle={t('dynamics.contextCharts.loadDescription', 'Recorded average motor power versus trip distance — not peak power or acceleration')}
            ariaLabel={t('dynamics.contextCharts.loadAria', 'Per-drive scatter chart of average motor power versus trip distance')}
            height={300}
            empty={accelEmpty}
            exportable
            exportFilename="acceleration-patterns"
          >
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart>
                {chartGrid}
                <XAxis dataKey="distance" type="number" name={t('dynamics.distance', 'Distance')} unit={` ${distanceUnit}`} tick={axisTick} />
                <YAxis dataKey="powerMax" type="number" name={t('dynamics.avgPower', 'Avg Power')} unit=" kW" tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Scatter data={accelPatterns} fill="#a855f7" name={t('dynamics.drives', 'Drives')} />
                {accelAvgPower != null && (
                  <ReferenceLine
                    y={accelAvgPower}
                    stroke="#eab308"
                    strokeDasharray="4 4"
                    label={{ value: t('dynamics.avg', 'Avg'), fill: '#eab308', fontSize: 11 }}
                  />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </ChartContainer>
        </Grid>
      </FadeIn>

      {/* Power Profile */}
      <FadeIn delay={0.55}>
        <ChartContainer
          title={t('dynamics.powerProfile', 'Power Profile')}
          subtitle={t('dynamics.contextCharts.profileDescription', 'Average power (left, kW) and recovered energy (right, kWh) for the latest 20 loaded trips')}
          ariaLabel={t('dynamics.contextCharts.profileAria', 'Recent-drives average motor power and recorded recovered energy on separate axes')}
          chartKey="driving-dynamics-power-profile"
          data={powerProfile.map((d) => ({
            label: d.label,
            powerMax: d.powerMax,
            powerMin: d.powerMin,
          }))}
          dataColumns={[
            { key: 'label', label: t('dynamics.col.drive', 'Drive') },
            { key: 'powerMax', label: t('dynamics.contextCharts.averageKw', 'Average power (kW)'), format: formatMeasurement },
            { key: 'powerMin', label: t('dynamics.contextCharts.recoveredKwh', 'Recovered energy (kWh)'), format: formatMeasurement },
          ]}
          height={320}
          empty={powerEmpty}
          exportable
          exportFilename="power-profile"
        >
          {({ hiddenSeries }) => (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={powerProfile}>
              {areaGradient('powerMaxGrad', '#3b82f6')}
              {areaGradient('powerMinGrad', '#ef4444', 0.25)}
              {chartGrid}
              <XAxis dataKey="label" tick={axisTick} />
              <YAxis tick={axisTick} unit=" kW" />
              <YAxis yAxisId="energy" orientation="right" tick={axisTick} unit=" kWh" />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              <ReferenceLine y={0} stroke="var(--border-default)" />
              <Area {...AREA_DEFAULTS} dataKey="powerMax" stroke="#3b82f6" fill="url(#powerMaxGrad)" name={t('dynamics.contextCharts.averageKw', 'Average power (kW)')} hide={hiddenSeries?.isHidden('powerMax')} />
              <Area {...AREA_DEFAULTS} yAxisId="energy" dataKey="powerMin" stroke="#ef4444" fill="url(#powerMinGrad)" name={t('dynamics.contextCharts.recoveredKwh', 'Recovered energy (kWh)')} hide={hiddenSeries?.isHidden('powerMin')} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>
      </FadeIn>
    </>
  );
}
