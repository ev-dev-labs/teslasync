import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import {
  Badge,
  Caption,
  GlassPanel,
  Heading,
  StatusPill,
} from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { EmptyState, QueryError } from '@/components/feedback';
import { SystemSummaryBrief } from '../operationalbrief-all/SystemSummaryBrief';
import { deriveTrustedVehicleStatus } from '@/api/hooks/useVehicles';
import type { VehicleStateReadings } from '@/api/types';
import type { Vehicle } from '../../commands';

interface CommandCenterHeroProps {
  vehicle: Vehicle;
  state: VehicleStateReadings | null;
  stateTrust: Parameters<typeof deriveTrustedVehicleStatus>[1];
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
  stateTrust,
  loading,
  error,
  onRetry,
}: CommandCenterHeroProps) {
  const { t } = useTranslation();
  const name =
    vehicle.display_name?.trim() ||
    vehicle.vin ||
    t('commands.vehicle.fallbackName', 'Vehicle {{id}}', { id: vehicle.id });
  const rawStatus = (state?.state || vehicle.state || 'offline').toLowerCase();
  const verifiedStatus = deriveTrustedVehicleStatus(state, stateTrust);
  const status = verifiedStatus ?? rawStatus;
  const knownStatus = t(
    `commands.status.${status}`,
    status.replace(/_/g, ' ').replace(/^\w/, (value) => value.toUpperCase()),
  );
  const statusLabel = verifiedStatus
    ? knownStatus
    : t('commands.hero.lastKnownStatus', 'Last known: {{status}}', { status: knownStatus });

  const battery = state?.battery_level != null ? state.battery_level : null;
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
              <Heading level="section" as="h2" className="truncate">
                {name}
              </Heading>
              <Caption className="mt-1 block break-all">
                {[vehicle.model, vehicle.vin].filter(Boolean).join(' · ') || '—'}
              </Caption>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              color={verifiedStatus ? STATUS_COLORS[verifiedStatus] ?? 'bg-[var(--text-muted)]' : 'bg-[var(--text-muted)]'}
              pulse={verifiedStatus === 'online'}
            >
              {statusLabel}
            </StatusPill>
            <Caption>
              {stateTrust?.observedAt != null
                ? <>{t('commands.hero.lastSignal', 'Last signal')}: <TimeStamp value={stateTrust.observedAt} format="relative" /></>
                : t('commands.hero.noSignalTime', 'No verified signal time')}
            </Caption>
          </div>
        </div>

        <SystemSummaryBrief
          title={t('commands.hero.vehicleState', 'Vehicle state')}
          description={t('commands.hero.briefDescription', 'Battery, estimated range, cabin temperature, and access state from the selected vehicle readings.')}
          scope={name}
          freshness={stateTrust?.observedAt != null ? <TimeStamp value={stateTrust.observedAt} format="relative" /> : t('commands.hero.noSignalTime', 'No verified signal time')}
          available={state != null} loading={loading && !state} retained={!!error && state != null}
          statusLabel={statusLabel}
          metrics={[
            { metricId: 'percent', occurrenceId: 'battery', rawValue: battery, label: t('commands.hero.battery', 'Battery') },
            { metricId: 'distance', occurrenceId: 'range', rawValue: state?.rated_range, label: t('commands.hero.range', 'Estimated range'), display: { precision: 0 } },
            { metricId: 'temperature', occurrenceId: 'cabin', rawValue: state?.inside_temp, label: t('commands.hero.cabin', 'Cabin'), display: { precision: 0 } },
          ]}
          textMetrics={[{ key: 'access', value: lockState ?? '—', valueState: lockState == null ? 'missing' : 'value',
            label: t('commands.hero.access', 'Access state'), detail: <>{t('commands.hero.vehicleState', 'Vehicle state')} · {
              stateTrust?.observedAt != null
                ? <>{t('commands.hero.lastSignal', 'Last signal')}: <TimeStamp value={stateTrust.observedAt} format="relative" /></>
                : t('commands.hero.noSignalTime', 'No verified signal time')
            }</> }]}
        />
        {error ? (
          <QueryError
            error={error}
            onRetry={onRetry}
            resourceName={t('commands.hero.vehicleState', 'Vehicle state')}
          />
        ) : !loading && !state ? (
          <EmptyState /* no-action: live vehicle state and permissions determine availability in this panel */
            icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
            title={t('commands.hero.noTelemetryTitle', 'Live state unavailable')}
            message={t(
              'commands.hero.noTelemetry',
              'Commands remain available, but state-dependent controls may not reflect the vehicle yet.',
            )}
            className="py-6"
          />
        ) : null}
      </div>
    </GlassPanel>
  );
}
