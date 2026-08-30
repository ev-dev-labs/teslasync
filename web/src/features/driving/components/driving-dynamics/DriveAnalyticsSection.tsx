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
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from '@/components/charts';
import { RangePicker } from '@/components/forms';
import { FadeIn } from '@/components/motion';
import { formatDateShort } from '@/lib/dateFormat';
import type { Drive } from '@/types/driving';
import { SPEED_BUCKETS_RANGES } from './helpers';

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
  powerMax: number;
  powerMin: number;
}

/** Stable empty reference so `filteredDrives ?? EMPTY_DRIVES` doesn't
 *  invalidate the memoised derives when the prop is briefly undefined. */
const EMPTY_DRIVES: Drive[] = [];

interface DriveAnalyticsSectionProps {
  filteredDrives: Drive[];
  startDate: string;
  endDate: string;
  onRangeChange: (
    range: { start: string; end: string },
    presetId?: string,
  ) => void;
  toDistanceDisplay: (v: number) => number;
  toSpeedDisplay: (v: number) => number;
  distanceUnit: string;
  speedUnit: string;
}

export default function DriveAnalyticsSection({
  filteredDrives,
  startDate,
  endDate,
  onRangeChange,
  toDistanceDisplay,
  toSpeedDisplay,
  distanceUnit,
  speedUnit,
}: DriveAnalyticsSectionProps) {
  const { t } = useTranslation();

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
        distance: Math.round(toDistanceDisplay(d.distanceM ?? 0)),
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
    const recent = drives.slice(-20);
    return recent.map((d, i) => ({
      index: i + 1,
      label: formatDateShort(d.startTs),
      powerMax: (d.avgPowerW ?? 0) / 1000,
      powerMin: 0,
    }));
  }, [drives]);

  // Empty guards — every panel shows a "No data available" placeholder
  // instead of an axis-only blank chart when its series has no points.
  const speedEmpty = speedDistribution.every((b) => b.count === 0);
  const accelEmpty = accelPatterns.length === 0;
  const powerEmpty = powerProfile.length === 0;

  return (
    <>
      {/* Header + date filter */}
      <FadeIn delay={0.45}>
        <div className="mt-2 mb-2">
          <SectionTitle>
            {t('dynamics.driveAnalytics', 'Drive Analytics')}
          </SectionTitle>
        </div>
        <RangePicker
          value={{ start: startDate, end: endDate }}
          onChange={onRangeChange}
        />
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
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="range" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill="url(#speedFill)" radius={[4, 4, 0, 0]} name={t('dynamics.drives', 'Drives')} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>

          {/* chart-a11y:no-table scatter chart of every drive — a per-row table here would be too dense; CSV export available */}
          <ChartContainer
            title={t('dynamics.accelPatterns', 'Acceleration Patterns')}
            subtitle={t('dynamics.accelPatternsDesc', 'Peak power vs trip distance')}
            ariaLabel={t('dynamics.accelPatterns.aria', 'Per-drive scatter chart of peak power versus trip distance')}
            height={300}
            empty={accelEmpty}
            exportable
            exportFilename="acceleration-patterns"
          >
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="distance" type="number" name={t('dynamics.distance', 'Distance')} unit={` ${distanceUnit}`} tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
                <YAxis dataKey="powerMax" type="number" name={t('dynamics.peakPower', 'Peak Power')} unit=" kW" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
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
          subtitle={t('dynamics.powerProfileDesc', 'Peak & regen power for recent drives')}
          ariaLabel={t('dynamics.powerProfile.aria', 'Recent-drives peak and regen power dual-area chart')}
          chartKey="driving-dynamics-power-profile"
          data={powerProfile.map((d) => ({
            label: d.label,
            powerMax: d.powerMax,
            powerMin: d.powerMin,
          }))}
          dataColumns={[
            { key: 'label', label: t('dynamics.col.drive', 'Drive') },
            { key: 'powerMax', label: t('dynamics.col.maxKw', 'Max kW') },
            { key: 'powerMin', label: t('dynamics.col.regenKw', 'Regen kW') },
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
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} unit=" kW" />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
              <Area {...AREA_DEFAULTS} dataKey="powerMax" stroke="#3b82f6" fill="url(#powerMaxGrad)" name={t('dynamics.maxPower', 'Max Power (kW)')} hide={hiddenSeries?.isHidden('powerMax')} />
              <Area {...AREA_DEFAULTS} dataKey="powerMin" stroke="#ef4444" fill="url(#powerMinGrad)" name={t('dynamics.regenPower', 'Regen Power (kW)')} hide={hiddenSeries?.isHidden('powerMin')} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>
      </FadeIn>
    </>
  );
}
