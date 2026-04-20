import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Route, ArrowUpRight, MapPin, Clock, Battery } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { request } from '@/api/client';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Drive } from '../types';

function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function truncateAddress(addr: string | undefined, maxLen: number): string {
  if (!addr) return '—';
  return addr.length > maxLen ? `${addr.slice(0, maxLen)}…` : addr;
}

export default function RecentDrivesListWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { convertDistance, distanceUnit } = useSettings();

  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;
  const driveLimit = isWide ? 10 : isTall ? 7 : 5;

  const { data: drives, isLoading } = useQuery({
    queryKey: ['drives', id, `recent-list-${driveLimit}`],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}&limit=${driveLimit}`),
    enabled: id > 0,
  });

  const items = useMemo(() => drives ?? [], [drives]);

  return (
    <WidgetShell
      title={t('widget.recentDrivesList', 'Recent Drives')}
      icon={<Route className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      actions={
        <Link
          to="/drives"
          className="text-[10px] text-white/30 hover:text-neon-cyan transition-colors flex items-center gap-0.5"
        >
          {t('widget.viewAll', 'View all')} <ArrowUpRight className="h-3 w-3" />
        </Link>
      }
    >
      <div className="space-y-1.5 overflow-y-auto h-full">
        {items.length > 0 ? (
          items.map((d) => {
            const dist = convertDistance(d.distance ?? 0);
            const batteryUsed =
              d.start_battery_level != null && d.end_battery_level != null
                ? d.start_battery_level - d.end_battery_level
                : null;

            return (
              <Link key={d.id} to={`/drives/${d.id}`} className="block group">
                <div className="flex items-start gap-3 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
                  {/* Left column: distance + duration */}
                  <div className="flex-shrink-0 min-w-[4.5rem]">
                    <p className="text-sm font-semibold text-white/90 tabular-nums">
                      {fmtNumber(dist, 1)} {distanceUnit}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="h-2.5 w-2.5 text-white/30" />
                      <span className="text-[10px] text-white/40 tabular-nums">
                        {formatDuration(d.duration_min ?? 0)}
                      </span>
                    </div>
                  </div>

                  {/* Center column: addresses (only when wide enough) */}
                  {isWide && (
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <MapPin className="h-2.5 w-2.5 text-emerald-400/60 flex-shrink-0" />
                        <span className="text-[10px] text-white/50 truncate">
                          {truncateAddress(d.start_address, 30)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <MapPin className="h-2.5 w-2.5 text-red-400/60 flex-shrink-0" />
                        <span className="text-[10px] text-white/50 truncate">
                          {truncateAddress(d.end_address, 30)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Right column: battery + date */}
                  <div className="flex-shrink-0 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Battery className="h-2.5 w-2.5 text-white/30" />
                      <span className="text-[10px] text-white/50 tabular-nums">
                        {d.start_battery_level ?? '?'}% → {d.end_battery_level ?? '?'}%
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      {batteryUsed != null && dist > 0 && (
                        <span className="text-[10px] text-neon-cyan/60 tabular-nums">
                          {fmtInt(batteryUsed)}%
                        </span>
                      )}
                      <span className="text-[10px] text-white/30 tabular-nums">
                        {new Date(d.start_date).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        ) : (
          <EmptyState
            icon={<Route className="h-5 w-5" />}
            message={t('widget.noDrivesList', 'No recent drives recorded')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
