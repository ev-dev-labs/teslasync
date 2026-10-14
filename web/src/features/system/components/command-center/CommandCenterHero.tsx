import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import {
  Badge,
  Caption,
  GlassPanel,
  Heading,
  StatusPill,
} from '@/components/ui';
import { DataProvenanceBadge, OperationalBrief, TimeStamp } from '@/components/data-display';
import { DataSourceNotice, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { deriveDataState, type DataState } from '@/api/dataState';
import { deriveTrustedVehicleStatus } from '@/api/hooks/useVehicles';
import type { VehicleStateReadings } from '@/api/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { neonColorMap } from '@/lib/tokens';
import type { Vehicle } from '../../commands';

interface CommandCenterHeroProps {
  vehicle: Vehicle;
  state: VehicleStateReadings | null;
  stateTrust: Parameters<typeof deriveTrustedVehicleStatus>[1];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  dataState?: DataState<unknown>;
}

const STATUS_COLORS: Record<string, string> = {
  online: neonColorMap.green.dot,
  driving: neonColorMap.cyan.dot,
  charging: neonColorMap.blue.dot,
  asleep: neonColorMap.amber.dot,
  offline: neonColorMap.red.dot,
};

export function CommandCenterHero({
  vehicle,
  state,
  stateTrust,
  loading,
  error,
  onRetry,
  dataState,
}: CommandCenterHeroProps) {
  const { t } = useTranslation();
  // Legacy props cannot establish a query pause or provenance.
  const source = dataState ?? deriveDataState({
    data: state ?? stateTrust ?? undefined,
    error,
    isLoading: loading,
    refetch: onRetry,
  }, { provenance: 'unknown', unavailable: state == null && stateTrust != null });
  const retry = source.retry ?? onRetry;
  const initial = source.status === 'initial';
  const pending = initial && !source.isRefreshBlocked && !loading;
  const sourceLabel = source.isRefreshBlocked
    ? t('dataSources.status.paused', 'Refresh paused')
    : pending
      ? t('dataSources.status.pending', 'Pending')
      : t(`operations.sourceStatus.${source.status}`, {
          defaultValue: {
            initial: 'Awaiting source', initialFailure: 'Source unavailable',
            ok: 'Source loaded', stale: 'Retained source',
            partial: 'Partial source', unavailable: 'No source data',
          }[source.status],
        });
  const name =
    vehicle.display_name?.trim() ||
    vehicle.vin ||
    t('commands.vehicle.fallbackName', 'Vehicle {{id}}', { id: vehicle.id });
  const rawStatus = (state?.state || vehicle.state || '').toLowerCase();
  const verifiedStatus = source.status === 'ok'
    && (dataState == null || source.provenance === 'live')
      ? deriveTrustedVehicleStatus(state, stateTrust) : null;
  const status = verifiedStatus ?? rawStatus;
  const knownStatus = t(
    `commands.status.${status}`,
    status.replace(/_/g, ' ').replace(/^\w/, (value) => value.toUpperCase()),
  );
  const statusLabel = !status
    ? t('common.unknown', 'Unknown')
    : verifiedStatus
      ? knownStatus
      : t('commands.hero.lastKnownStatus', 'Last known: {{status}}', { status: knownStatus });

  const battery = state?.battery_level != null ? state.battery_level : null;
  const lockState =
    state?.is_locked == null
      ? null
      : state.is_locked
        ? t('commands.readiness.locked', 'Locked')
        : t('commands.readiness.unlocked', 'Unlocked');
  const title = t('commands.hero.vehicleState', 'Vehicle state');
  const description = t('commands.hero.briefDescription', 'Battery, estimated range, cabin temperature, and access state from the selected vehicle readings.');
  const observation = stateTrust?.observedAt != null
    ? <TimeStamp value={stateTrust.observedAt} format="relative" />
    : t('commands.hero.noSignalTime', 'No verified signal time');
  const metrics = useOperationalMetrics([
    { metricId: 'percent', occurrenceId: 'battery', rawValue: battery, label: t('commands.hero.battery', 'Battery') },
    { metricId: 'distance', occurrenceId: 'range', rawValue: state?.rated_range, label: t('commands.hero.range', 'Estimated range'), display: { precision: 0 } },
    { metricId: 'temperature', occurrenceId: 'cabin', rawValue: state?.inside_temp, label: t('commands.hero.cabin', 'Cabin'), display: { precision: 0 } },
  ]);

  return (
    <GlassPanel
      className="relative overflow-hidden p-4 sm:p-6"
      data-testid="command-center-hero"
      data-source-status={source.status}
      data-source-provenance={source.provenance}
      data-refresh-blocked={source.isRefreshBlocked || undefined}
    >
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
            <DataProvenanceBadge provenance={source.provenance} status={source.status} />
            <StatusPill
              color={verifiedStatus ? STATUS_COLORS[verifiedStatus] ?? neonColorMap.neutral.dot : neonColorMap.neutral.dot}
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

        <OperationalBrief
          compact
          eyebrow={t('system.brief.eyebrow', 'System evidence')}
          title={title}
          description={description}
          scope={name}
          freshness={observation}
          loading={initial && !source.isRefreshBlocked && loading}
          statusLabel={`${sourceLabel} · ${statusLabel}`}
          statusTone={source.fatalError ? 'danger' : source.status === 'stale' || source.status === 'partial' ? 'warning' : 'neutral'}
          provenance={description}
          narrative={{
            whatChanged: description, whyItMatters: null,
            confidence: { label: 'not_scored', score: null, basis: [] },
            likelyCause: null, recommendedResponse: null,
            limitations: [name, ...(typeof observation === 'string' ? [observation] : [])],
            evidence: [], provenance: [{ source: description }],
          }}
          metrics={[
            ...metrics,
            { key: 'access', value: lockState ?? '—', valueState: lockState == null ? 'missing' : 'value',
            label: t('commands.hero.access', 'Access state'), detail: <>{t('commands.hero.vehicleState', 'Vehicle state')} · {
              stateTrust?.observedAt != null
                ? <>{t('commands.hero.lastSignal', 'Last signal')}: <TimeStamp value={stateTrust.observedAt} format="relative" /></>
                : t('commands.hero.noSignalTime', 'No verified signal time')
            }</> },
          ]}
        />
        {source.status === 'stale' || source.status === 'partial' ? (
          <StaleRefreshWarning state={source} label={title}
            title={source.isRefreshBlocked ? sourceLabel : undefined} />
        ) : null}
        {initial && source.isRefreshBlocked ? (
          <DataSourceNotice sources={[{ id: 'vehicle-state', label: title,
            query: { fetchStatus: 'paused', refetch: retry } }]} title={sourceLabel} />
        ) : source.fatalError ? (
          <QueryError
            error={source.fatalError}
            onRetry={retry}
            resourceName={title}
          />
        ) : source.hasData && !state ? (
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
