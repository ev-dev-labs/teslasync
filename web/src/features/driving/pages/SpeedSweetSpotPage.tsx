import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, Gauge, Zap, Leaf } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  ComposedChart, Line, Bar, ReferenceArea,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { convertDistanceToSI } from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import { computeSweetSpot } from '../lib/speedSweetSpot';

/** km per statute mile, derived from the shared conversion lib. */
const KM_PER_MILE = convertDistanceToSI(1, 'mi') / 1000;

export default function SpeedSweetSpotPage() {
  const { t } = useTranslation();
  usePageTitle(t('sweetSpot.title', 'Speed Sweet Spot'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { unitPrefs } = useUnits();

  const { start, end, setRange } = useRangeState({
    persistKey: 'speed-sweetspot.range',
    defaultPresetId: 'all',
  });

  const drivesQuery = useDrives(vehicleIdStr);
  const allDrives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const drives = useMemo<Drive[]>(() => {
    if (!allDrives.length) return [];
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter((d) => {
      if (!d.startTs) return false;
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allDrives, start, end]);

  const result = useMemo(() => computeSweetSpot(drives), [drives]);

  const isMiles = unitPrefs.distance === 'mi';
  const speedUnit = isMiles ? t('sweetSpot.mph', 'mph') : t('sweetSpot.kmh', 'km/h');
  const effUnit = isMiles ? t('sweetSpot.whPerMi', 'Wh/mi') : t('sweetSpot.whPerKm', 'Wh/km');

  const toSpeed = (kph: number) => Math.round(isMiles ? kph / KM_PER_MILE : kph);
  const toEff = (whPerKm: number) => Math.round(isMiles ? whPerKm * KM_PER_MILE : whPerKm);
  const toDistKm = (m: number) => Math.round(isMiles ? m / 1000 / KM_PER_MILE : m / 1000);

  const chartData = useMemo(
    () =>
      result.points.map((p) => ({
        speed: toSpeed(p.speedKph),
        consumption: toEff(p.whPerKm),
        distance: toDistKm(p.distanceM),
        drives: p.drives,
      })),
     
    [result.points, isMiles],
  );

  const sweetLabel = result.sweetSpot
    ? `${toSpeed(result.sweetSpot.fromKph)}–${toSpeed(result.sweetSpot.toKph)} ${speedUnit}`
    : '—';

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('sweetSpot.title', 'Speed Sweet Spot')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('sweetSpot.title', 'Speed Sweet Spot')}
      subtitle={t('sweetSpot.subtitle', 'The cruising speed where your car sips the least energy')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="speed-sweetspot-range"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('sweetSpot.kpis', 'Sweet spot summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('sweetSpot.spot', 'Sweet Spot')}
                value={sweetLabel}
                icon={<Crosshair className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('sweetSpot.atSpot', 'At Sweet Spot')}
                value={result.sweetSpot ? `${toEff(result.sweetSpot.whPerKm)} ${effUnit}` : '—'}
                icon={<Leaf className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('sweetSpot.overall', 'Your Overall')}
                value={result.overallWhPerKm != null ? `${toEff(result.overallWhPerKm)} ${effUnit}` : '—'}
                subtitle={t('sweetSpot.analyzed', '{{count}} drives analyzed', { count: result.analyzed })}
                icon={<Gauge className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('sweetSpot.saving', 'Potential Saving')}
                value={result.savingShare != null ? `${Math.round(result.savingShare * 100)}%` : '—'}
                subtitle={t('sweetSpot.savingHint', 'if all driving hit the spot')}
                icon={<Zap className="h-5 w-5" />}
                color="amber"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Consumption vs speed curve */}
      <FadeIn delay={0.1}>
        <ChartContainer
          title={t('sweetSpot.curve', 'Consumption vs Average Speed')}
          subtitle={t('sweetSpot.curveHint', 'Bars show distance logged per speed band; the shaded band is your sweet spot')}
          ariaLabel={t('sweetSpot.curve.aria', 'Energy consumption per distance across average speed bands, with the most efficient band highlighted')}
          loading={isLoading}
          empty={chartData.length < 2}
          height={360}
          data={chartData}
          dataColumns={[
            { key: 'speed', label: `${t('sweetSpot.col.speed', 'Speed')} (${speedUnit})` },
            { key: 'consumption', label: `${t('sweetSpot.col.consumption', 'Consumption')} (${effUnit})` },
            { key: 'distance', label: t('sweetSpot.col.distance', 'Distance logged') },
            { key: 'drives', label: t('sweetSpot.col.drives', 'Drives') },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis
                dataKey="speed"
                type="number"
                domain={['dataMin', 'dataMax']}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                unit={` ${speedUnit}`}
              />
              <YAxis
                yAxisId="eff"
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                domain={['auto', 'auto']}
              />
              <YAxis yAxisId="dist" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <Tooltip content={<ChartTooltip />} />
              {result.sweetSpot && (
                <ReferenceArea
                  yAxisId="eff"
                  x1={toSpeed(result.sweetSpot.fromKph)}
                  x2={toSpeed(result.sweetSpot.toKph)}
                  fill={chartTokens.series[1]}
                  fillOpacity={0.12}
                  stroke={chartTokens.series[1]}
                  strokeOpacity={0.4}
                />
              )}
              <Bar
                yAxisId="dist"
                dataKey="distance"
                name={t('sweetSpot.distanceLogged', 'Distance logged')}
                fill={chartTokens.series[4]}
                fillOpacity={0.3}
                radius={[4, 4, 0, 0]}
              />
              <Line
                yAxisId="eff"
                type="monotone"
                dataKey="consumption"
                name={t('sweetSpot.consumption', 'Consumption')}
                stroke={chartTokens.series[5]}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartContainer>
      </FadeIn>
    </PageContainer>
  );
}
