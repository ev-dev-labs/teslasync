import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { Activity, Route, Zap, Clock, BatteryCharging, TrendingUp } from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Timeline } from '@/components/data-display/Timeline';
import { Currency } from '@/components/data-display';
import { AreaChartWrapper } from '@/components/charts/AreaChartWrapper';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { formatDateShort } from '@/lib/dateFormat';
import { convertDistanceFromSI, convertEnergyFromSI } from '@/lib/unitConversion';
import type { FleetAnalytics, Drive, ChargingSession } from '../types';

type ActivityKind = 'drive' | 'charge';

interface ActivityItem {
  type: ActivityKind;
  title: string;
  subtitle: string;
  /** Epoch milliseconds; NaN when the source timestamp is missing/invalid. */
  timeMs: number;
}

/** Coerce a backend timestamp to epoch ms, tolerating null / invalid input. */
function toEpochMs(value: string | number | Date | null | undefined): number {
  if (value == null) return NaN;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Relative-time label for the activity feed ("Just now", "5m ago", "2h ago",
 * "3d ago"), falling back to a short absolute date beyond a week. Mirrors the
 * shared `formatRelativeTime` convention in `@/lib/dateFormat`. Returns the
 * universal "—" placeholder for null / invalid input instead of "NaNm ago",
 * so a malformed timestamp can never surface garbage in the timeline.
 */
export function formatTimeAgo(input: Date | number | string | null | undefined): string {
  if (input == null) return '—';
  const ms = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(ms)) return '—';
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateShort(new Date(ms));
}

interface RecentActivityProps {
  recentDrives: Drive[] | undefined;
  recentCharges: ChargingSession[] | undefined;
  analytics: FleetAnalytics | undefined;
  toEfficiencyDisplay: (whKm: number) => number;
  distanceUnit: string;
  efficiencyUnit: string;
}

export function RecentActivity({
  recentDrives, recentCharges, analytics,
  toEfficiencyDisplay, distanceUnit, efficiencyUnit,
}: RecentActivityProps) {
  const { t } = useTranslation('dashboard');
  const { formatCurrency } = useFormatting();

  // Build a unified, most-recent-first activity timeline. Missing / invalid
  // timestamps sink to the bottom instead of scrambling the sort through NaN
  // (a plain `b.getTime() - a.getTime()` on an Invalid Date returns NaN, which
  // leaves V8's sort order undefined).
  const activityItems = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];
    (recentDrives ?? []).forEach((d) =>
      items.push({
        type: 'drive',
        title: `${fmtNumber(convertDistanceFromSI(d.distance_m ?? 0, distanceUnit === 'mi' ? 'mi' : 'km'), 1)} ${distanceUnit} ${t('activity.drive', 'drive')}`,
        subtitle: `${Math.floor((d.duration_s ?? 0) / 3600)}h ${fmtInt(Math.floor(((d.duration_s ?? 0) % 3600) / 60))}m · ${d.start_soc_pct ?? '?'}% → ${d.end_soc_pct ?? '?'}%`,
        timeMs: toEpochMs(d.started_at),
      }),
    );
    (recentCharges ?? []).forEach((s) =>
      items.push({
        type: 'charge',
        title: `${fmtNumber(convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh'), 1)} kWh ${t('activity.charged', 'charged')}`,
        subtitle: `${s.start_soc_pct ?? '?'}% → ${s.end_soc_pct ?? '?'}%${typeof s.cost === 'number' ? ` · ${formatCurrency(s.cost, 2)}` : ''}`,
        timeMs: toEpochMs(s.started_at),
      }),
    );
    const rank = (ms: number) => (Number.isFinite(ms) ? ms : -Infinity);
    items.sort((a, b) => rank(b.timeMs) - rank(a.timeMs));
    return items;
  }, [recentDrives, recentCharges, distanceUnit, t, formatCurrency]);

  // Battery trend for chart (oldest → newest along the x-axis).
  const batteryTrend = useMemo(
    () => (recentDrives ?? []).map((d, i) => ({ i: String(i), v: d.end_soc_pct ?? 50 })).reverse(),
    [recentDrives],
  );

  return (
    <div data-testid="recent-activity" className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Activity Feed */}
      <GlassPanel className="p-5 lg:col-span-1 h-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title flex items-center gap-2">
            <Activity aria-hidden="true" className="h-4 w-4 text-cyan-300" /> {t('activity.title', 'Recent Activity')}
          </h3>
          <Link to="/drives" className="text-2xs text-[var(--text-muted)] hover:text-cyan-300 transition-colors">
            {t('activity.viewAll', 'View all')}
          </Link>
        </div>
        {activityItems.length > 0 ? (
          <div data-testid="activity-timeline" className="max-h-[320px] overflow-y-auto pr-1">
            <Timeline
              items={activityItems.slice(0, 8).map((item) => ({
                icon: item.type === 'drive'
                  ? <Route aria-hidden="true" className="h-3.5 w-3.5" />
                  : <Zap aria-hidden="true" className="h-3.5 w-3.5" />,
                title: item.title,
                subtitle: item.subtitle,
                time: formatTimeAgo(item.timeMs),
                color: item.type === 'drive' ? '#00f0ff' : '#10b981',
              }))}
            />
          </div>
        ) : (
          <div data-testid="activity-empty" className="flex flex-col items-center justify-center py-8 text-center">
            <Clock aria-hidden="true" className="h-6 w-6 text-[var(--text-muted)] mb-2" />
            <p className="text-xs text-[var(--text-muted)]">{t('activity.empty', 'No activity yet. Start driving!')}</p>
          </div>
        )}
      </GlassPanel>

      {/* Battery Trend + Fleet Performance */}
      <div className="lg:col-span-2 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Battery Trend Chart */}
        <GlassPanel className="p-5">
          <h3 className="section-title flex items-center gap-2 mb-4">
            <BatteryCharging aria-hidden="true" className="h-4 w-4 text-emerald-300" /> {t('battery.title', 'Battery Trend')}
          </h3>
          {batteryTrend.length > 1 ? (
            <div className="h-36 sm:h-48">
              <AreaChartWrapper
                data={batteryTrend}
                xKey="i"
                series={[{ key: 'v', label: t('battery.seriesLabel', 'Battery %'), color: '#10b981' }]}
                height={180}
                yFormatter={(v) => `${v}%`}
              />
            </div>
          ) : (
            <div data-testid="battery-empty" className="h-36 sm:h-48 flex items-center justify-center">
              <p className="text-xs text-[var(--text-muted)]">{t('battery.empty', 'Charge data will appear here')}</p>
            </div>
          )}
        </GlassPanel>

        {/* Fleet Performance */}
        <GlassPanel className="p-5">
          <h3 className="section-title flex items-center gap-2 mb-4">
            <TrendingUp aria-hidden="true" className="h-4 w-4 text-purple-300" /> {t('perf.title', 'Fleet Performance')}
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
              <Currency value={analytics?.total_cost ?? 0} className="text-sm font-bold text-amber-300" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">{t('perf.co2', 'CO₂ Saved')}</span>
              <span className="text-sm font-bold text-emerald-300">{fmtInt((analytics?.total_energy_kwh ?? 0) * 0.42)} kg</span>
            </div>
            {analytics?.most_efficient_vehicle && (
              <div className="mt-3 p-3 rounded-xl bg-neon-green/5 border border-neon-green/10">
                <p className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">{t('perf.mostEfficient', 'Most Efficient')}</p>
                <p className="text-sm font-semibold text-emerald-300">{analytics.most_efficient_vehicle.name || '—'}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {fmtInt(toEfficiencyDisplay(analytics.most_efficient_vehicle.efficiency ?? 0))} {efficiencyUnit}
                </p>
              </div>
            )}
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}
