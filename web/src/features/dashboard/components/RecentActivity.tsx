import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, Route, Zap, Clock, BatteryCharging, TrendingUp } from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Timeline } from '@/components/data-display/Timeline';
import { AreaChartWrapper } from '@/components/charts/AreaChartWrapper';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { formatDateShort } from '@/lib/dateFormat';
import type { FleetAnalytics, Drive, ChargingSession } from '../types';

/* Relative time helper */
function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateShort(date);
}

interface RecentActivityProps {
  recentDrives: Drive[] | undefined;
  recentCharges: ChargingSession[] | undefined;
  analytics: FleetAnalytics | undefined;
  convertDistance: (km: number) => number;
  convertEfficiency: (whKm: number) => number;
  distanceUnit: string;
  efficiencyUnit: string;
}

export function RecentActivity({
  recentDrives, recentCharges, analytics,
  convertDistance, convertEfficiency, distanceUnit, efficiencyUnit,
}: RecentActivityProps) {
  const { t } = useTranslation('dashboard');

  // Build unified activity timeline
  const activityItems: { type: string; title: string; subtitle: string; time: Date }[] = [];
  recentDrives?.forEach((d) =>
    activityItems.push({
      type: 'drive',
      title: `${fmtNumber(convertDistance(d.distance_mi ?? 0), 1)} ${distanceUnit} ${t('activity.drive', 'drive')}`,
      subtitle: `${Math.floor((d.duration_min ?? 0) / 60)}h ${fmtInt((d.duration_min ?? 0) % 60)}m · ${d.start_battery_pct ?? '?'}% → ${d.end_battery_pct ?? '?'}%`,
      time: new Date(d.start_ts),
    }),
  );
  recentCharges?.forEach((s) =>
    activityItems.push({
      type: 'charge',
      title: `${fmtNumber(s.energy_added_kwh ?? 0, 1)} kWh ${t('activity.charged', 'charged')}`,
      subtitle: `${s.start_battery_pct ?? '?'}% → ${s.end_battery_pct ?? '?'}%${typeof s.cost === 'number' ? ` · $${fmtNumber(s.cost, 2)}` : ''}`,
      time: new Date(s.start_ts),
    }),
  );
  activityItems.sort((a, b) => b.time.getTime() - a.time.getTime());

  // Battery trend for chart
  const batteryTrend = recentDrives?.map((d, i) => ({
    i: String(i),
    v: d.end_battery_pct ?? 50,
  })).reverse() ?? [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Activity Feed */}
      <GlassPanel className="p-5 lg:col-span-1 h-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title flex items-center gap-2">
            <Activity className="h-4 w-4 text-neon-cyan" /> {t('activity.title', 'Recent Activity')}
          </h3>
          <Link to="/drives" className="text-[10px] text-[var(--text-muted)] hover:text-neon-cyan transition-colors">
            {t('activity.viewAll', 'View all')}
          </Link>
        </div>
        {activityItems.length > 0 ? (
          <div className="max-h-[320px] overflow-y-auto pr-1">
            <Timeline
              items={activityItems.slice(0, 8).map((item) => ({
                icon: item.type === 'drive'
                  ? <Route className="h-3.5 w-3.5" />
                  : <Zap className="h-3.5 w-3.5" />,
                title: item.title,
                subtitle: item.subtitle,
                time: formatTimeAgo(item.time),
                color: item.type === 'drive' ? '#00f0ff' : '#10b981',
              }))}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Clock className="h-6 w-6 text-gray-600 mb-2" />
            <p className="text-xs text-[var(--text-muted)]">{t('activity.empty', 'No activity yet. Start driving!')}</p>
          </div>
        )}
      </GlassPanel>

      {/* Battery Trend + Fleet Performance */}
      <div className="lg:col-span-2 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Battery Trend Chart */}
        <GlassPanel className="p-5">
          <h3 className="section-title flex items-center gap-2 mb-4">
            <BatteryCharging className="h-4 w-4 text-neon-green" /> {t('battery.title', 'Battery Trend')}
          </h3>
          {batteryTrend.length > 1 ? (
            <div className="h-36 sm:h-48">
              <AreaChartWrapper
                data={batteryTrend}
                xKey="i"
                series={[{ key: 'v', label: 'Battery %', color: '#10b981' }]}
                height={180}
                yFormatter={(v) => `${v}%`}
              />
            </div>
          ) : (
            <div className="h-36 sm:h-48 flex items-center justify-center">
              <p className="text-xs text-gray-600">{t('battery.empty', 'Charge data will appear here')}</p>
            </div>
          )}
        </GlassPanel>

        {/* Fleet Performance */}
        <GlassPanel className="p-5">
          <h3 className="section-title flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-neon-purple" /> {t('perf.title', 'Fleet Performance')}
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">{t('perf.drives', 'Total Drives (30d)')}</span>
              <span className="text-sm font-bold text-[var(--text-primary)]">{analytics?.total_drives ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">{t('perf.charges', 'Charge Sessions')}</span>
              <span className="text-sm font-bold text-[var(--text-primary)]">{analytics?.total_charging_sessions ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">{t('perf.cost', 'Total Cost')}</span>
              <span className="text-sm font-bold text-neon-amber">${fmtNumber(analytics?.total_cost ?? 0, 2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">{t('perf.co2', 'CO₂ Saved')}</span>
              <span className="text-sm font-bold text-neon-green">{fmtInt((analytics?.total_energy_kwh ?? 0) * 0.42)} kg</span>
            </div>
            {analytics?.most_efficient_vehicle && (
              <div className="mt-3 p-3 rounded-xl bg-neon-green/5 border border-neon-green/10">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{t('perf.mostEfficient', 'Most Efficient')}</p>
                <p className="text-sm font-semibold text-neon-green">{analytics.most_efficient_vehicle.name}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {fmtInt(convertEfficiency(analytics.most_efficient_vehicle.efficiency ?? 0))} {efficiencyUnit}
                </p>
              </div>
            )}
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}
