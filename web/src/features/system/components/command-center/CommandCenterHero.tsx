import { useTranslation } from 'react-i18next';
import { Battery, Gauge, LockKeyhole, Thermometer } from 'lucide-react';
import {
  Badge,
  Caption,
  GlassPanel,
  Heading,
  StatusPill,
} from '@/components/ui';
import { MetricTile, FreshnessIndicator } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';
import type { Vehicle, VehicleState } from '../../commands';

interface CommandCenterHeroProps {
  vehicle: Vehicle;
  state: VehicleState | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-emerald-400',
  driving: 'bg-cyan-400',
  charging: 'bg-blue-400',
  asleep: 'bg-amber-400',
  offline: 'bg-red-400',
};

export function CommandCenterHero({
  vehicle,
  state,
  loading,
  error,
  onRetry,
}: CommandCenterHeroProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const name =
    vehicle.display_name?.trim() ||
    vehicle.vin ||
    t('commands.vehicle.fallbackName', 'Vehicle {{id}}', { id: vehicle.id });
  const rawStatus = (state?.state || vehicle.state || 'offline').toLowerCase();
  const statusLabel = t(
    `commands.status.${rawStatus}`,
    rawStatus.replace(/_/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase()),
  );

  const battery = state?.battery_level != null ? state.battery_level : null;
  const range =
    state?.rated_range != null
      ? convertDistanceFromSI(state.rated_range, unitPrefs.distance)
      : null;
  const cabinTemperature =
    state?.inside_temp != null
      ? convertTempFromSI(state.inside_temp, unitPrefs.temperature)
      : null;
  const lockState =
    state?.is_locked == null
      ? null
      : state.is_locked
        ? t('commands.readiness.locked', 'Locked')
        : t('commands.readiness.unlocked', 'Unlocked');

  return (
    <GlassPanel
      className="relative overflow-hidden p-4 sm:p-6"
      data-testid="command-center-hero"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-cyan-500/10 via-transparent to-purple-500/10"
      />
      <div className="relative space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <Badge variant="info" size="sm">
              {t('commands.hero.selectedVehicle', 'Selected vehicle')}
            </Badge>
            <div>
              <Heading level="page" as="h2" className="truncate">
                {name}
              </Heading>
              <Caption className="mt-1 block break-all">
                {[vehicle.model, vehicle.vin].filter(Boolean).join(' · ') || '—'}
              </Caption>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              color={STATUS_COLORS[rawStatus] ?? 'bg-[var(--text-muted)]'}
              pulse={rawStatus === 'online'}
            >
              {statusLabel}
            </StatusPill>
            <FreshnessIndicator timestamp={vehicle.updated_at} size="md" />
          </div>
        </div>

        {error ? (
          <QueryError
            error={error}
            onRetry={onRetry}
            resourceName={t('commands.hero.vehicleState', 'Vehicle state')}
          />
        ) : loading ? (
          <div
            role="status"
            aria-label={t('commands.hero.loadingState', 'Loading vehicle state')}
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} height={82} className="rounded-xl" />
            ))}
          </div>
        ) : state ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricTile
              value={battery}
              unit="%"
              label={t('commands.hero.battery', 'Battery')}
              accentClass="text-cyan-300"
              sublabel={<Battery className="mx-auto h-3.5 w-3.5" aria-hidden="true" />}
            />
            <MetricTile
              value={range}
              decimals={0}
              unit={unitPrefs.distance}
              label={t('commands.hero.range', 'Estimated range')}
              accentClass="text-emerald-300"
              sublabel={<Gauge className="mx-auto h-3.5 w-3.5" aria-hidden="true" />}
            />
            <MetricTile
              value={cabinTemperature}
              decimals={0}
              unit={unitPrefs.temperature}
              label={t('commands.hero.cabin', 'Cabin')}
              accentClass="text-amber-300"
              sublabel={<Thermometer className="mx-auto h-3.5 w-3.5" aria-hidden="true" />}
            />
            <MetricTile
              value={lockState}
              label={t('commands.hero.access', 'Access state')}
              accentClass="text-purple-300"
              sublabel={<LockKeyhole className="mx-auto h-3.5 w-3.5" aria-hidden="true" />}
            />
          </div>
        ) : (
          <EmptyState /* no-action: live vehicle state and permissions determine availability in this panel */
            icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
            title={t('commands.hero.noTelemetryTitle', 'Live state unavailable')}
            message={t(
              'commands.hero.noTelemetry',
              'Commands remain available, but state-dependent controls may not reflect the vehicle yet.',
            )}
            className="py-6"
          />
        )}
      </div>
    </GlassPanel>
  );
}
