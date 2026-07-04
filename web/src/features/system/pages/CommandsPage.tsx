/**
 * CommandsPage — modern-ui, full-width remote control center for the Tesla fleet.
 *
 * Renders a fleet KPI band and a VehicleCommandCenter per vehicle. Each command
 * center handles search, favorites, collapsible categories, and command
 * execution via the config-driven command system. Data loads through TanStack
 * queries against /vehicles + /vehicles/{id}/state; every section owns its own
 * loading / empty / error state so nothing is gated behind a single guard.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Car, Wifi, Power, RefreshCw, Terminal, Layers, History, AlertTriangle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, PanelTitle } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState, Skeleton, AlertBanner } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { getErrorMessage } from '@/lib/errorMessage';
import { request } from '@/api/client';
import { COMMANDS, CATEGORY_ORDER, type Vehicle, type VehicleState } from '../commands';
import { VehicleCommandCenter } from '../components/VehicleCommandCenter';

/** How often the live vehicle-state fan-out re-polls, in ms. */
const STATE_REFRESH_MS = 15_000;

export default function CommandsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('commands.title', 'Commands'));

  // Fleet roster — the command centers below are keyed off this list.
  const vehiclesQuery = useQuery({
    queryKey: ['vehicles'],
    queryFn: ({ signal }) => request<Vehicle[]>('/vehicles', { signal }),
  });
  const vehicles = vehiclesQuery.data ?? [];
  const vehiclesLoading = vehiclesQuery.isLoading;
  const vehiclesError = vehiclesQuery.error;

  // Live per-vehicle state, fanned out and polled. Individual failures degrade
  // to `null` per vehicle so one unreachable car never blanks the whole board;
  // a total fan-out outage (every car unreachable) surfaces as a query error
  // so the non-blocking states warning below can render.
  const statesQuery = useQuery({
    queryKey: ['command-vehicle-states', vehicles.map((v) => v.id)],
    queryFn: async () => {
      let failures = 0;
      const entries = await Promise.all(
        vehicles.map(async (v) => {
          try {
            const data = await request<{ state: VehicleState }>(`/vehicles/${v.id}/state`);
            return [v.id, data.state ?? null] as const;
          } catch {
            failures += 1;
            return [v.id, null] as const;
          }
        }),
      );
      // A single unreachable car degrades to `null` for just that vehicle so
      // the board keeps rendering. But if EVERY state fetch fails the fan-out
      // is effectively down — surface that as a query error so the page shows
      // its non-blocking warning banner instead of silently pretending every
      // car simply has no live state.
      if (vehicles.length > 0 && failures === vehicles.length) {
        throw new Error(
          t('commands.statesUnreachable', 'All {{count}} vehicles were unreachable', {
            count: vehicles.length,
          }),
        );
      }
      return Object.fromEntries(entries) as Record<number, VehicleState | null>;
    },
    enabled: vehicles.length > 0,
    refetchInterval: STATE_REFRESH_MS,
  });
  const states = statesQuery.data ?? {};
  const statesError = statesQuery.error;

  const onlineCount = useMemo(
    () => vehicles.filter((v) => v.state !== 'asleep' && v.state !== 'offline').length,
    [vehicles],
  );
  const asleepCount = Math.max(0, vehicles.length - onlineCount);

  // Single-vehicle fleets stay full-bleed (a 2-col grid would leave dead space);
  // multi-vehicle fleets reflow into two columns on very wide monitors.
  const centersClass = vehicles.length > 1
    ? 'grid grid-cols-1 gap-4 sm:gap-5 2xl:grid-cols-2'
    : 'space-y-4 sm:space-y-5';

  return (
    <PageContainer
      title={t('commands.pageTitle', 'Vehicle Commands')}
      subtitle={t('commands.subtitle', 'Remote control center for your Tesla fleet')}
      query={[vehiclesQuery, statesQuery]}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {vehicles.length > 0 && (
            <Badge variant="success" size="lg" className="min-h-11">
              <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
              {t('commands.onlineCount', '{{online}}/{{total}} online', {
                online: onlineCount,
                total: vehicles.length,
              })}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11"
            icon={<History className="h-4 w-4" aria-hidden="true" />}
            onClick={() => navigate('/command-history')}
          >
            {t('commands.viewHistory', 'View History')}
          </Button>
        </div>
      }
    >
      {/* 1 — Fleet KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('commands.fleetStats', 'Fleet status')}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6"
        >
          {vehiclesLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={86} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('commands.kpi.vehicles', 'Vehicles')}
                value={vehicles.length}
                icon={<Car className="h-4 w-4" />}
                color="cyan"
              />
              <MetricCard
                label={t('commands.kpi.online', 'Online')}
                value={onlineCount}
                icon={<Wifi className="h-4 w-4" />}
                color="green"
              />
              <MetricCard
                label={t('commands.kpi.asleep', 'Asleep')}
                value={asleepCount}
                icon={<Power className="h-4 w-4" />}
                color="amber"
              />
              <MetricCard
                label={t('commands.kpi.commands', 'Commands')}
                value={COMMANDS.length}
                icon={<Terminal className="h-4 w-4" />}
                color="purple"
              />
              <MetricCard
                label={t('commands.kpi.categories', 'Categories')}
                value={CATEGORY_ORDER.length}
                icon={<Layers className="h-4 w-4" />}
                color="blue"
              />
              <MetricCard
                label={t('commands.kpi.refresh', 'Auto-refresh')}
                value={`${STATE_REFRESH_MS / 1000}s`}
                icon={<RefreshCw className="h-4 w-4" />}
                color="cyan"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Non-blocking notice when the live-state fan-out fails */}
      {statesError && (
        <FadeIn>
          <AlertBanner variant="warning" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}>
            {t('commands.statesError', 'Failed to load vehicle states')}: {getErrorMessage(statesError)}
          </AlertBanner>
        </FadeIn>
      )}

      {/* 3 — Vehicle command centers: full-width detail band */}
      <FadeIn delay={0.1}>
        <section aria-label={t('commands.centers', 'Vehicle command centers')}>
          {vehiclesError ? (
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-3">{t('commands.pageTitle', 'Vehicle Commands')}</PanelTitle>
              <AlertBanner variant="danger" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}>
                {t('commands.loadError', 'Failed to load your fleet')}: {getErrorMessage(vehiclesError)}
              </AlertBanner>
            </GlassPanel>
          ) : vehiclesLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:gap-5 2xl:grid-cols-2">
              {[1, 2].map((i) => (
                <Skeleton key={i} height={288} className="rounded-2xl" />
              ))}
            </div>
          ) : vehicles.length === 0 ? (
            <GlassPanel className="p-4 sm:p-5">
              <EmptyState /* no-action: onboarding empty state — the CTA copy already points users to Tesla account sync */
                icon={<Car className="h-8 w-8" />}
                title={t('commands.noVehicles', 'No vehicles found')}
                message={t('commands.connectFleet', 'Connect your Tesla account and sync your fleet to start sending commands.')}
              />
            </GlassPanel>
          ) : (
            <StaggerContainer className={centersClass}>
              {vehicles.map((v) => (
                <StaggerItem key={v.id}>
                  <VehicleCommandCenter vehicle={v} state={states[v.id] ?? null} />
                </StaggerItem>
              ))}
            </StaggerContainer>
          )}
        </section>
      </FadeIn>
    </PageContainer>
  );
}
