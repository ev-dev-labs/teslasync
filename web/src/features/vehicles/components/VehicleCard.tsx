import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Trash2, Lock, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { ProgressRing } from '@/components/data-display/ProgressRing';
import { TeslaCarViz, parseModelKey } from '@/components/TeslaCarViz';
import { useSettings } from '@/hooks/useSettings';
import { getVehicleState, getVehicleStatus } from '@/api/vehicles';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { Vehicle } from '@/api/types';
import type { VehicleState } from '@/api/types';

/** Traffic-light color for battery percentage */
function batteryColor(level: number): string {
  if (level > 60) return '#10b981';
  if (level > 25) return '#f59e0b';
  return '#ef4444';
}

interface VehicleCardProps {
  vehicle: Vehicle;
  onDelete: (v: Vehicle) => void;
}

export function VehicleCard({ vehicle, onDelete }: VehicleCardProps) {
  const { t } = useTranslation('vehicles');
  const { convertDistance, convertTemp, distanceUnit, tempUnit } = useSettings();

  const { data: stateData } = useQuery({
    queryKey: ['vehicle-state', vehicle.id],
    queryFn: () => getVehicleState(vehicle.id),
    refetchInterval: 30_000,
  });

  const state: VehicleState | undefined = stateData?.state;
  const status = getVehicleStatus(vehicle, state);
  const batColor = batteryColor(state?.battery_level ?? 0);

  return (
    <GlassPanel hover glow="cyan" className="p-0 overflow-hidden transition-all duration-300 group">
      {/* Gradient accent strip */}
      <div className="h-1 bg-gradient-to-r from-cyan-400 via-purple-400 to-green-400 opacity-40 group-hover:opacity-80 transition-opacity" />

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
                className="text-base font-semibold text-gray-900 dark:text-white hover:text-cyan-400 transition-colors truncate"
              >
                {vehicle.display_name || vehicle.vin}
              </Link>
              <StatusBadge status={status} />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {vehicle.model} {vehicle.trim_badging} ·{' '}
              <span className="font-mono">{vehicle.vin}</span>
            </p>

            {/* Stats row */}
            {state && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                  <ProgressRing
                    value={state.battery_level}
                    size={36}
                    strokeWidth={3}
                    color={batColor}
                    label=""
                  />
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                      {state.battery_level}%
                    </p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                      {Math.round(convertDistance(state.rated_range))} {distanceUnit}
                    </p>
                  </div>
                </div>

                <div className="text-center">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {fmtNumber(convertTemp(state.inside_temp))} {tempUnit}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    {t('card.interior', 'Interior')}
                  </p>
                </div>

                <div className="text-center">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {fmtInt(convertDistance(state.odometer))}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                    {distanceUnit}
                  </p>
                </div>

                {state.is_charging && (
                  <div className="text-center">
                    <p className="text-sm font-medium text-green-500">
                      {state.charger_power} kW
                    </p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                      {t('card.charging', 'Charging')}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2 ml-auto">
                  {state.is_locked && <Lock className="h-3.5 w-3.5 text-green-500" />}
                  {state.sentry_mode && <Shield className="h-3.5 w-3.5 text-cyan-400" />}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <Link
              to={`/vehicles/${vehicle.id}`}
              className="rounded-lg p-2 text-gray-400 hover:bg-cyan-400/10 hover:text-cyan-400 transition-all"
              title={t('card.viewDetails', 'View details')}
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(vehicle)}
              className="rounded-lg p-2 text-gray-400 hover:bg-red-500/10 hover:text-red-500"
              title={t('card.removeVehicle', 'Remove vehicle')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
