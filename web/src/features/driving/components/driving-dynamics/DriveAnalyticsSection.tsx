import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  ChartContainer,
  ChartTooltip,
  ChartGradient,
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
  Legend,
} from '@/components/charts';
import { DateRangeFilter } from '@/components/forms';
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

interface DriveAnalyticsSectionProps {
  filteredDrives: Drive[];
  startDate: string;
  endDate: string;
  onStartDateChange: (d: string) => void;
  onEndDateChange: (d: string) => void;
  convertDistance: (v: number) => number;
  convertSpeed: (v: number) => number;
  distanceUnit: string;
  speedUnit: string;
}

export default function DriveAnalyticsSection({
  filteredDrives,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  convertDistance,
  convertSpeed,
  distanceUnit,
  speedUnit,
}: DriveAnalyticsSectionProps) {
  const { t } = useTranslation();

  const speedDistribution = useMemo<SpeedBucket[]>(() => {
    const buckets = SPEED_BUCKETS_RANGES.map((b) => ({
      range: `${b.label} ${speedUnit}`,
      count: 0,
    }));
    for (const d of filteredDrives) {
      const spd = d.speedAvg != null ? convertSpeed(d.speedAvg) : null;
      if (spd == null) continue;
      for (let i = 0; i < SPEED_BUCKETS_RANGES.length; i++) {
        const r = SPEED_BUCKETS_RANGES[i];
        const hi = r.max === Infinity ? Infinity : convertSpeed(r.max);
        const lo = convertSpeed(r.min);
        if (spd >= lo && spd < hi) {
          buckets[i].count += 1;
          break;
        }
      }
    }
    return buckets;
  }, [filteredDrives, convertSpeed, speedUnit]);

  const accelPatterns = useMemo<AccelPoint[]>(() =>
    filteredDrives
      .filter((d) => d.powerMax != null)
      .map((d) => ({
        distance: Math.round(convertDistance(d.distance)),
        powerMax: d.powerMax as number,
      })),
  [filteredDrives, convertDistance]);

  const powerProfile = useMemo<PowerPoint[]>(() => {
    const recent = filteredDrives.slice(-20);
    return recent.map((d, i) => ({
      index: i + 1,
      label: formatDateShort(d.startDate),
      powerMax: d.powerMax ?? 0,
      powerMin: d.powerMin ?? 0,
    }));
  }, [filteredDrives]);

  return (
    <>
      {/* Header + date filter */}
      <FadeIn delay={0.45}>
        <div className="mt-2 mb-2">
          <h2 className="text-lg font-semibold text-white/80">
            {t('dynamics.driveAnalytics', 'Drive Analytics')}
          </h2>
        </div>
        <DateRangeFilter
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={onStartDateChange}
          onEndDateChange={onEndDateChange}
          presets
        />
      </FadeIn>

      {/* Speed Distribution + Acceleration Patterns */}
      <FadeIn delay={0.5}>
        <Grid cols={{ default: 1, lg: 2 }} gap={4}>
          <ChartContainer
            title={t('dynamics.speedDistribution', 'Speed Distribution')}
            subtitle={t('dynamics.speedDistDesc', 'Drives grouped by average speed')}
            height={300}
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

          <ChartContainer
            title={t('dynamics.accelPatterns', 'Acceleration Patterns')}
            subtitle={t('dynamics.accelPatternsDesc', 'Peak power vs trip distance')}
            height={300}
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
                {accelPatterns.length > 0 && (
                  <ReferenceLine
                    y={accelPatterns.reduce((sum, p) => sum + p.powerMax, 0) / accelPatterns.length}
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
          height={320}
          exportable
          exportFilename="power-profile"
        >
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={powerProfile}>
              <defs>
                <ChartGradient id="powerMaxGrad" color="#3b82f6" />
                <ChartGradient id="powerMinGrad" color="#ef4444" opacity={0.25} />
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} unit=" kW" />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ color: 'rgba(255,255,255,0.6)' }} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
              <Area type="monotone" dataKey="powerMax" stroke="#3b82f6" fill="url(#powerMaxGrad)" name={t('dynamics.maxPower', 'Max Power (kW)')} />
              <Area type="monotone" dataKey="powerMin" stroke="#ef4444" fill="url(#powerMinGrad)" name={t('dynamics.regenPower', 'Regen Power (kW)')} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </FadeIn>
    </>
  );
}
