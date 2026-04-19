import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Route, ArrowUpRight } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { request } from '@/api/client';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { WidgetProps } from './types';
import type { Drive } from '../types';

export default function RecentDrivesWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { convertDistance, distanceUnit } = useSettings();

  const { data: drives, isLoading } = useQuery({
    queryKey: ['drives', id, 'recent-5'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}&limit=5`),
    enabled: id > 0,
  });

  const items = drives ?? [];

  return (
    <GlassPanel className="h-full flex flex-col p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
          <Route className="h-3.5 w-3.5 text-neon-cyan" />
          {t('widget.recentDrives', 'Recent Drives')}
        </h3>
        <Link
          to="/drives"
          className="text-[10px] text-[var(--text-muted)] hover:text-neon-cyan transition-colors flex items-center gap-0.5"
        >
          {t('widget.viewAll', 'View all')} <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2">
        {isLoading ? (
          [1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)
        ) : items.length > 0 ? (
          items.map((d) => (
            <Link key={d.id} to={`/drives/${d.id}`} className="block">
              <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {fmtNumber(convertDistance(d.distance ?? 0), 1)} {distanceUnit}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    {fmtInt(d.duration_min ?? 0)} min · {d.start_battery_level ?? '?'}% →{' '}
                    {d.end_battery_level ?? '?'}%
                  </p>
                </div>
                <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                  {new Date(d.start_date).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </Link>
          ))
        ) : (
          <EmptyState
            icon={<Route className="h-5 w-5" />}
            message={t('widget.noDrives', 'No recent drives')}
            className="py-4"
          />
        )}
      </div>
    </GlassPanel>
  );
}
