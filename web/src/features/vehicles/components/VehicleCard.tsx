import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Trash2, Lock, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { ProgressRing } from '@/components/data-display/ProgressRing';
import { TeslaCarViz, parseModelKey } from '@/components/data-display/TeslaCarViz';
import { useUnits } from '@/hooks/useUnits';
import { useVehicleState, getVehicleStatus } from '@/api/hooks/useVehicles';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtInt } from '@/lib/numberFormat';
import { batteryColor } from '@/lib/colors';
import type { Vehicle } from '@/api/types';
import type { VehicleState } from '@/api/types';

interface VehicleCardProps {
  vehicle: Vehicle;
  onDelete: (v: Vehicle) => void;
}

export function VehicleCard({ vehicle, onDelete }: VehicleCardProps) {
  const { t } = useTranslation('vehicles');
  const { unitPrefs, formatDistance, formatTemperature } = useUnits();

  const { data: stateData, isLoading, isError } = useVehicleState(vehicle.id);

  const state: VehicleState | undefined = stateData?.state;
  const status = getVehicleStatus(state);
  const batteryLevel = state?.battery_level ?? 0;
  const batColor = batteryColor(batteryLevel);
  // Computed once so the heading link and the icon-only control labels share
  // the same accessible name (display name, or VIN when the name is blank).
  const vehicleLabel = vehicle.display_name || vehicle.vin;

  const handleDelete = useCallback(() => onDelete(vehicle), [onDelete, vehicle]);

  return (
    <GlassPanel hover glow="cyan" className="p-0 overflow-hidden transition-all duration-normal group">
      {/* Gradient accent strip */}
      <div aria-hidden="true" className="h-1 bg-gradient-to-r from-cyan-400 via-purple-400 to-green-400 opacity-40 group-hover:opacity-80 transition-opacity" />

      <div className="p-5">
        <div className="flex items-start gap-5">
          {/* Car viz */}
          <div className="shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
            <TeslaCarViz
              model={parseModelKey(vehicle.model)}
              size="sm"
              batteryLevel={state?.battery_level ?? 50}
              isCharging={state?.is_charging ?? false}
              isLocked={state?.is_locked ?? true}
              isClimateOn={false}
              speed={0}
              sentryMode={state?.sentry_mode ?? false}
            />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1.5">
              <Link
                to={`/vehicles/${vehicle.id}`}
                className="text-base font-semibold text-[var(--text-primary)] hover:text-cyan-400 transition-colors truncate"
              >
                {vehicleLabel}
              </Link>
              <StatusBadge status={status} />
            </div>
            <p className="text-xs text-[var(--text-muted)] dark:text-[var(--text-muted)] mb-3">
              {vehicle.model} {vehicle.trim_badging} ·{' '}
              <span className="font-mono">{vehicle.vin}</span>
            </p>

            {/* Stats row — always render a state so the panel is never blank */}
            {state ? (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                  <ProgressRing
                    value={batteryLevel}
                    size={36}
                    strokeWidth={3}
                    color={batColor}
                    label=""
                  />
                  <div>
                    <p className="text-sm font-bold text-[var(--text-primary)]">
                      {batteryLevel}%
                    </p>
                    <p className="text-2xs text-[var(--text-muted)] dark:text-[var(--text-muted)]">
                      {formatDistance(state.rated_range)}
                    </p>
                  </div>
                </div>

                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {formatTemperature(state.inside_temp)}
                  </p>
                  <p className="text-2xs text-[var(--text-muted)] dark:text-[var(--text-muted)]">
                    {t('card.interior', 'Interior')}
                  </p>
                </div>

                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {fmtInt(convertDistanceFromSI(state.odometer ?? 0, unitPrefs.distance))}
                  </p>
                  <p className="text-2xs text-[var(--text-muted)] dark:text-[var(--text-muted)]">
                    {unitPrefs.distance}
                  </p>
                </div>

                {state.is_charging && (
                  <div className="text-center">
                    <p className="text-sm font-medium text-green-500">
                      {state.charger_power ?? 0} kW
                    </p>
                    <p className="text-2xs text-[var(--text-muted)] dark:text-[var(--text-muted)]">
                      {t('card.charging', 'Charging')}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2 ml-auto">
                  {state.is_locked && (
                    <Lock
                      role="img"
                      aria-label={t('card.locked', 'Locked')}
                      className="h-3.5 w-3.5 text-green-500"
                    />
                  )}
                  {state.sentry_mode && (
                    <Shield
                      role="img"
                      aria-label={t('card.sentryOn', 'Sentry mode on')}
                      className="h-3.5 w-3.5 text-cyan-400"
                    />
                  )}
                </div>
              </div>
            ) : (
              <p
                role="status"
                className="text-2xs text-[var(--text-muted)] dark:text-[var(--text-muted)]"
              >
                {isLoading
                  ? t('card.stateLoading', 'Loading live state…')
                  : isError
                    ? t('card.stateError', 'Live state unavailable')
                    : t('card.stateEmpty', 'No live telemetry yet')}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <Link
              to={`/vehicles/${vehicle.id}`}
              className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-cyan-400/10 hover:text-cyan-400 transition-all"
              title={t('card.viewDetails', 'View details')}
              aria-label={t('card.viewDetailsFor', 'View details for {{name}}', { name: vehicleLabel })}
            >
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-500"
              title={t('card.removeVehicle', 'Remove vehicle')}
              aria-label={t('card.removeVehicleNamed', 'Remove {{name}}', { name: vehicleLabel })}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
