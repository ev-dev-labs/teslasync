import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Route, ArrowUpRight } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Drive } from '../types';

export default function RecentDrivesWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const { formatDateShort } = useDateFormat();

  const { data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
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
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      actions={
        <Link
          to="/drives"
          className="text-2xs text-[var(--text-muted)] hover:text-cyan-300 transition-colors flex items-center gap-0.5"
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
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {fmtNumber(convertDistanceFromSI(d.distance_m ?? 0, unitPrefs.distance), 1)} {unitPrefs.distance}
                  </p>
                  <p className="text-2xs text-[var(--text-muted)]">
                    {fmtInt((d.duration_s ?? 0) / 60)} {t('widget.recentDrives.durationUnit', 'min')} ·{' '}
                    {d.start_soc_pct ?? '?'}% → {d.end_soc_pct ?? '?'}%
                  </p>
                </div>
                <span className="text-2xs text-[var(--text-muted)] shrink-0">
                  {formatDateShort(d.start_ts)}
                </span>
              </div>
            </Link>
          ))
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Route className="h-5 w-5" />}
            message={t('widget.noDrives', 'No recent drives')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
