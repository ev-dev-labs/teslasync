import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Monitor, ArrowUpRight, Lock, Unlock, Shield } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { VehicleTwin } from '@/components/vehicles';
import { useVehicles, useVehicleState, useSecurityLatest, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { buildTwinState } from '@/lib/vehicleState';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const REFRESH_INTERVAL = 5_000;

export default function DigitalTwinMiniWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];
  const id = vehicle?.id ?? 0;

  const { data: securityData, isLoading: secLoading } = useSecurityLatest(id, REFRESH_INTERVAL);
  const { data: vehicleStateData, isLoading: stateLoading, isFetching: stateFetching, isStale: stateStale, isError: stateError, dataUpdatedAt: stateUpdatedAt, refetch: refetchState } = useVehicleState(id, { refetchInterval: REFRESH_INTERVAL });
  const { data: chargingData } = useChargingTelemetryLatest(id, REFRESH_INTERVAL);

  // Include the vehicle-list load so the shell shows a skeleton during the
  // initial fetch instead of flashing the "No vehicle data" empty state.
  const isLoading = vehiclesLoading || secLoading || stateLoading;
  const vehicleState = vehicleStateData?.state ?? null;

  const twinState = useMemo(
    () => buildTwinState(securityData, vehicleState, chargingData),
    [securityData, vehicleState, chargingData],
  );

  const isCompact = size.cols <= 2 && size.rows <= 2;

  return (
    <WidgetShell
      title={t('widget.digitalTwinMini', 'Digital Twin')}
      icon={<Monitor className="h-3.5 w-3.5 text-neon-purple" />}
      loading={isLoading}
      updatedAt={stateUpdatedAt}
      isFetching={stateFetching}
      isStale={stateStale}
      isError={stateError}
      onRefresh={() => refetchState()}
      noPadding
      actions={
        <Link
          to="/digital-twin"
          className="text-2xs text-[var(--text-muted)] hover:text-cyan-300 transition-colors flex items-center gap-0.5"
        >
          {t('widget.open', 'Open')} <ArrowUpRight className="h-3 w-3" />
        </Link>
      }
    >
      {vehicle ? (
        <div className="h-full flex flex-col items-center justify-center gap-2 px-2 pb-2">
          <div className="flex-1 min-h-0 flex items-center justify-center w-full">
            <VehicleTwin
              {...twinState}
              size="sm"
              vehicleId={vehicle?.id}
              exteriorColor={vehicle?.exterior_color}
            />
          </div>

          {/* Status badges — shown unless very cramped */}
          {!isCompact || size.rows >= 2 ? (
            <div className="flex-shrink-0 flex flex-wrap gap-1.5 justify-center">
              <Badge
                variant={
                  // Unknown lock state stays neutral — a green "success" chip
                  // here would falsely signal a secured vehicle.
                  twinState.locked === false ? 'danger' : twinState.locked ? 'success' : 'neutral'
                }
              >
                {twinState.locked === false ? (
                  <Unlock className="h-2.5 w-2.5 mr-0.5" />
                ) : (
                  <Lock className="h-2.5 w-2.5 mr-0.5" />
                )}
                {twinState.locked === false
                  ? t('widget.unlocked', 'Unlocked')
                  : twinState.locked
                    ? t('widget.locked', 'Locked')
                    : '—'}
              </Badge>
              {twinState.sentryMode != null && (
                <Badge variant={twinState.sentryMode ? 'info' : 'neutral'}>
                  <Shield className="h-2.5 w-2.5 mr-0.5" />
                  {twinState.sentryMode
                    ? t('widget.sentryOn', 'Sentry')
                    : t('widget.sentryOff', 'Off')}
                </Badge>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Monitor className="h-5 w-5" />}
          message={t('widget.noVehicle', 'No vehicle data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
