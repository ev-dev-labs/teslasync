import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Route, ArrowUpRight } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { request } from '@/api/client';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Drive } from '../types';

export default function RecentDrivesWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { convertDistance, distanceUnit } = useSettings();

  const { data: drives, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['drives', id, 'recent-5'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}&limit=5`),
    enabled: id > 0,
  });

  const items = drives ?? [];

  return (
    <WidgetShell
      title={t('widget.recentDrives', 'Recent Drives')}
      icon={<Route className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      actions={
        <Link
          to="/drives"
          className="text-[10px] text-white/30 hover:text-cyan-300 transition-colors flex items-center gap-0.5"
        >
          {t('widget.viewAll', 'View all')} <ArrowUpRight className="h-3 w-3" />
        </Link>
      }
    >
      <div className="space-y-2 overflow-y-auto h-full">
        {items.length > 0 ? (
          items.map((d) => (
            <Link key={d.id} to={`/drives/${d.id}`} className="block">
              <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white/90 truncate">
                    {fmtNumber(convertDistance(d.distance_mi ?? 0), 1)} {distanceUnit}
                  </p>
                  <p className="text-[10px] text-white/40">
                    {fmtInt(d.duration_min ?? 0)} min · {d.start_battery_pct ?? '?'}% →{' '}
                    {d.end_battery_pct ?? '?'}%
                  </p>
                </div>
                <span className="text-[10px] text-white/40 shrink-0">
                  {new Date(d.start_ts).toLocaleDateString(undefined, {
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
    </WidgetShell>
  );
}
