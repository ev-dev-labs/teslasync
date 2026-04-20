import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Monitor, Lock, Unlock, ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState, useSecurityLatest } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function DigitalTwinWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];
  const id = vehicle?.id ?? 0;
  const { data: stateData, isLoading } = useVehicleState(id);
  const { data: security } = useSecurityLatest(id, 5_000);
  const state = stateData?.state;

  const doorStates = (security?.door_state ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const openDoors = doorStates.filter((s) => s.toLowerCase().includes('open'));
  const windows = [
    security?.fd_window,
    security?.fp_window,
    security?.rd_window,
    security?.rp_window,
  ];
  const openWindows = windows.filter((w) => w && w.toLowerCase() !== 'closed');

  return (
    <WidgetShell
      title={t('widget.digitalTwin', 'Digital Twin')}
      icon={<Monitor className="h-3.5 w-3.5 text-neon-purple" />}
      loading={isLoading}
      actions={
        <Link
          to="/digital-twin"
          className="text-[10px] text-white/30 hover:text-neon-cyan transition-colors flex items-center gap-0.5"
        >
          {t('widget.open', 'Open')} <ArrowUpRight className="h-3 w-3" />
        </Link>
      }
    >
      {vehicle ? (
        <div className="h-full flex flex-col items-center justify-center gap-3">
          {/* Simplified car visualization */}
          <div className="relative w-28 h-20 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
            <Monitor className="h-10 w-10 text-neon-purple/60" />
            {/* Door indicators */}
            <div className="absolute -left-1.5 top-2 flex flex-col gap-1">
              <div
                className={`w-1 h-4 rounded-full ${openDoors.some((d) => d.includes('FD') || d.includes('driver')) ? 'bg-neon-red' : 'bg-neon-green/50'}`}
              />
              <div
                className={`w-1 h-4 rounded-full ${openDoors.some((d) => d.includes('RD') || d.includes('rear')) ? 'bg-neon-red' : 'bg-neon-green/50'}`}
              />
            </div>
            <div className="absolute -right-1.5 top-2 flex flex-col gap-1">
              <div
                className={`w-1 h-4 rounded-full ${openDoors.some((d) => d.includes('FP') || d.includes('passenger')) ? 'bg-neon-red' : 'bg-neon-green/50'}`}
              />
              <div
                className={`w-1 h-4 rounded-full ${openDoors.some((d) => d.includes('RP')) ? 'bg-neon-red' : 'bg-neon-green/50'}`}
              />
            </div>
          </div>

          {/* Status badges */}
          <div className="flex flex-wrap gap-1.5 justify-center">
            <Badge variant={state?.is_locked ? 'success' : 'danger'}>
              {state?.is_locked ? (
                <Lock className="h-2.5 w-2.5 mr-0.5" />
              ) : (
                <Unlock className="h-2.5 w-2.5 mr-0.5" />
              )}
              {state?.is_locked ? t('widget.locked', 'Locked') : t('widget.unlocked', 'Unlocked')}
            </Badge>
            <Badge variant={openWindows.length === 0 ? 'success' : 'warning'}>
              {openWindows.length === 0
                ? t('widget.windowsClosed', 'Windows Closed')
                : `${openWindows.length} ${t('widget.windowsOpen', 'Open')}`}
            </Badge>
          </div>

          <p className="text-xs text-white/40">
            {vehicle.display_name || vehicle.vin}
          </p>
        </div>
      ) : (
        <EmptyState
          icon={<Monitor className="h-5 w-5" />}
          message={t('widget.noVehicle', 'No vehicle data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
