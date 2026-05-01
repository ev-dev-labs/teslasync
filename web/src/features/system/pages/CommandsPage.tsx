/**
 * CommandsPage — remote control center for Tesla fleet.
 *
 * Renders fleet stats and a VehicleCommandCenter per vehicle.
 * Each command center handles search, favorites, collapsible categories,
 * and command execution via the config-driven command system.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState, Skeleton } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { request } from '@/api/client';
import { Car, Wifi, Power, Loader2, Activity, AlertTriangle, History } from 'lucide-react';
import type { Vehicle, VehicleState } from '../commands';
import { VehicleCommandCenter } from '../components/VehicleCommandCenter';

export default function CommandsPage() {
  const { t } = useTranslation();
  usePageTitle(t('commands.title', 'Commands'));

  const { data: vehicles, isLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const { data: statesMap, error: statesError } = useQuery({
    queryKey: ['command-vehicle-states', vehicles?.map(v => v.id)],
    queryFn: async () => {
      if (!vehicles) return {};
      const entries = await Promise.all(
        vehicles.map(async v => {
          try {
            const data = await request<{ state: VehicleState }>(`/vehicles/${v.id}/state`);
            return [v.id, data.state ?? null] as const;
          } catch {
            return [v.id, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<number, VehicleState | null>;
    },
    enabled: !!vehicles && vehicles.length > 0,
    refetchInterval: 15_000,
  });

  const states = statesMap ?? {};
  const onlineCount = vehicles?.filter(v => v.state !== 'asleep' && v.state !== 'offline').length ?? 0;

  return (
    <PageContainer
      title={t('commands.pageTitle', 'Vehicle Commands')}
      subtitle={t('commands.subtitle', 'Remote control center for your Tesla fleet')}
      loading={isLoading}
      actions={
        <div className="flex items-center gap-3">
          <Link
            to="/command-history"
            className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors"
          >
            <History className="h-3.5 w-3.5" />
            {t('commands.viewHistory', 'View History')}
          </Link>
          {vehicles && vehicles.length > 0 && (
            <span className="text-xs text-white/40">
              <span className="text-emerald-300 font-medium">{onlineCount}</span>/{vehicles.length} {t('online')}
            </span>
          )}
        </div>
      }
    >
      {/* Stats */}
      <FadeIn>
        {vehicles && vehicles.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label={t('Vehicles')} value={vehicles.length} icon={<Car className="h-4 w-4" />} color="cyan" />
            <MetricCard label={t('Online')} value={onlineCount} icon={<Wifi className="h-4 w-4" />} color="green" />
            <MetricCard label={t('Asleep')} value={(vehicles?.length ?? 0) - onlineCount} icon={<Power className="h-4 w-4" />} color="amber" />
            <MetricCard label={t('Refresh')} value="15s" icon={<Loader2 className="h-4 w-4" />} color="purple" />
          </div>
        ) : (
          <EmptyState
            icon={<Activity className="h-8 w-8 opacity-20" />}
            message={t('common.noData', 'No data available')}
            className="py-8"
          />
        )}
      </FadeIn>

      {statesError && (
        <GlassPanel className="p-3 flex items-center gap-2 bg-neon-red/5 border-neon-red/20">
          <AlertTriangle className="h-4 w-4 text-neon-red" />
          <span className="text-xs text-rose-300">
            {t('commands.statesError', 'Failed to load vehicle states')}: {(statesError as Error).message}
          </span>
        </GlassPanel>
      )}

      {/* Vehicle Command Centers */}
      {isLoading ? (
        <div className="space-y-6">{[1, 2].map(i => <Skeleton key={i} className="h-72" />)}</div>
      ) : vehicles && vehicles.length > 0 ? (
        <StaggerContainer className="space-y-6">
          {vehicles.map(v => (
            <StaggerItem key={v.id}>
              <VehicleCommandCenter vehicle={v} state={states[v.id] ?? null} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      ) : (
        <EmptyState
          icon={<Car className="h-8 w-8" />}
          title={t('commands.noVehicles', 'No vehicles found')}
          message={t('commands.connectFleet', 'Connect your Tesla account and sync your fleet to start sending commands.')}
        />
      )}
    </PageContainer>
  );
}
