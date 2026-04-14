import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Gauge, TrendingUp, Thermometer, Wind, Mountain,
  Car, Lightbulb, Zap, BatteryFull,
} from 'lucide-react';
import clsx from 'clsx';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { MetricCard } from '@/components/data-display/MetricCard';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { chartMargin, axisTick } from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';
import { request } from '@/api/client';

/* ── Types ── */

interface RangeFactor { name: string; impact_pct: number; description: string }
interface CurvePoint { battery_pct: number; rated_range: number; projected_range: number }
interface RangeProjection {
  current_range_km: number;
  projected_range_km: number;
  battery_level: number;
  efficiency_factor: number;
  factors: RangeFactor[];
  projection_curve: CurvePoint[];
}
interface Vehicle { id: number; vin: string; display_name: string }

const FACTOR_ICONS: Record<string, React.ReactNode> = {
  temperature: <Thermometer className="h-4 w-4" />,
  speed: <Car className="h-4 w-4" />,
  hvac: <Wind className="h-4 w-4" />,
  elevation: <Mountain className="h-4 w-4" />,
  driving_style: <Gauge className="h-4 w-4" />,
};

/* ── Component ── */

export default function ProjectedRangePage() {
  const { t } = useTranslation();
  usePageTitle(t('Projected Range'));

  const [vehicleId, setVehicleId] = useState<string>('');

  const { data: vehicles } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  const { data, isLoading, error } = useQuery<RangeProjection>({
    queryKey: ['range-projection', activeId],
    queryFn: () => request<RangeProjection>(`/analytics/range-projection?vehicle_id=${activeId}`),
    enabled: activeId !== '',
  });

  const efficiencyColor = (data?.efficiency_factor ?? 0) >= 0.9
    ? CHART_COLORS[1] : (data?.efficiency_factor ?? 0) >= 0.7 ? CHART_COLORS[3] : CHART_COLORS[5];

  const tips = useMemo(() => [
    { icon: <Zap className="h-4 w-4" />, text: t('Keep speed under 110 km/h for optimal efficiency.') },
    { icon: <Thermometer className="h-4 w-4" />, text: t('Pre-condition the cabin while still plugged in.') },
    { icon: <Wind className="h-4 w-4" />, text: t('Use seat heaters instead of cabin heat in cold weather.') },
    { icon: <TrendingUp className="h-4 w-4" />, text: t('Plan routes to minimize elevation changes.') },
  ], [t]);

  return (
    <PageContainer
      title={t('Projected Range')}
      subtitle={t('Real-world range estimation based on driving conditions')}
      loading={isLoading}
      error={error instanceof Error ? error : null}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={vehicles.map((v) => ({ value: String(v.id), label: v.display_name || v.vin }))}
            value={activeId}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      {/* Summary Stats */}
      <FadeIn>
        <div className={clsx('grid gap-4 grid-cols-2 lg:grid-cols-4')}>
          <MetricCard label={t('Current Range')} value={`${fmtNumber(data?.current_range_km, 0)} km`} icon={<BatteryFull className="h-4 w-4" />} color="cyan" />
          <MetricCard label={t('Projected Range')} value={`${fmtNumber(data?.projected_range_km, 0)} km`} icon={<TrendingUp className="h-4 w-4" />} color="green" />
          <MetricCard label={t('Efficiency Factor')} value={fmtNumber((data?.efficiency_factor ?? 0) * 100, 1) + '%'} icon={<Gauge className="h-4 w-4" />} color="purple" />
          <MetricCard label={t('Battery Level')} value={`${fmtNumber(data?.battery_level, 0)}%`} icon={<BatteryFull className="h-4 w-4" />} color="cyan" />
        </div>
      </FadeIn>

      {/* Gauge + Projection Chart */}
      <FadeIn delay={0.1}>
        <div className={clsx('grid gap-4 grid-cols-1 md:grid-cols-3')}>
          <GlassPanel className="flex flex-col items-center justify-center p-6">
            {data ? (
              <RadialGauge
                value={Math.round(data.efficiency_factor * 100)}
                max={100}
                label={t('Efficiency')}
                unit="%"
                color={efficiencyColor}
                size={160}
              />
            ) : (
              <Skeleton width="160px" height={160} rounded />
            )}
          </GlassPanel>

          <GlassPanel className="col-span-1 md:col-span-2 p-4">
            <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">{t('Range Projection Curve')}</span>
            {data?.projection_curve && data.projection_curve.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data.projection_curve} margin={chartMargin}>
                  <defs>
                    <linearGradient id="ratedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="projectedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS[1]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS[1]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="battery_pct" tick={axisTick} unit="%" />
                  <YAxis tick={axisTick} unit=" km" width={55} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <ReferenceLine x={data.battery_level} stroke={CHART_COLORS[3]} strokeDasharray="4 4" label={t('Current')} />
                  <Area type="monotone" dataKey="rated_range" name={t('Rated Range')} stroke={CHART_COLORS[0]} fill="url(#ratedFill)" strokeWidth={2} />
                  <Area type="monotone" dataKey="projected_range" name={t('Projected Range')} stroke={CHART_COLORS[1]} fill="url(#projectedFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton height={260} />
            )}
          </GlassPanel>
        </div>
      </FadeIn>

      {/* Range Factors */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-5">
          <span className="mb-3 block text-sm font-semibold text-[var(--text-primary)]">{t('Range Factors')}</span>
          <div className={clsx('grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
            {(data?.factors ?? []).map((f) => (
              <GlassPanel key={f.name} hover className="flex items-start gap-3 p-4">
                <span className="mt-0.5 shrink-0 text-[var(--text-muted)]">
                  {FACTOR_ICONS[(f.name ?? '').toLowerCase().replace(/\s+/g, '_')] ?? <Gauge className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={clsx('flex items-center gap-2')}>
                    <span className="text-sm font-medium text-[var(--text-primary)]">{t(f.name)}</span>
                    <Badge variant={f.impact_pct >= 0 ? 'success' : 'danger'} size="sm">
                      {f.impact_pct >= 0 ? '+' : ''}{fmtNumber(f.impact_pct, 1)}%
                    </Badge>
                  </div>
                  <span className="mt-1 block text-xs text-[var(--text-secondary)]">{t(f.description)}</span>
                </div>
              </GlassPanel>
            ))}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Tips */}
      <FadeIn delay={0.3}>
        <GlassPanel glow="green" className="p-5">
          <div className={clsx('mb-3 flex items-center gap-2')}>
            <Lightbulb className="h-5 w-5 text-neon-green" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">{t('Tips to Maximize Range')}</span>
          </div>
          <ul className="space-y-2">
            {tips.map((tip, i) => (
              <li key={i} className={clsx('flex items-start gap-2 text-sm text-[var(--text-secondary)]')}>
                <span className="mt-0.5 shrink-0 text-[var(--text-muted)]">{tip.icon}</span>
                <span>{tip.text}</span>
              </li>
            ))}
          </ul>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
