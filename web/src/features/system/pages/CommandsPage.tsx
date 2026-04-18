/**
 * CommandsPage — remote control center for Tesla fleet.
 *
 * Grouped command buttons per vehicle with live state display.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/numberFormat';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { MetricCard } from '@/components/data-display/MetricCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { useToast } from '@/components/feedback/Toast';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSettings } from '@/hooks/useSettings';
import { request } from '@/api/client';
import {
  Lock, Unlock, Wind, Car, Zap, Power, Shield, Home,
  Volume2, MapPin, GaugeCircle, DoorOpen, AlertTriangle, CheckCircle,
  Loader2, Battery, Wifi, Activity, Thermometer, Speaker, Locate,
  CalendarPlus, CalendarMinus, BatteryFull, BatteryMedium, Gauge,
  ShieldAlert, Dog, Tent, Flame, UserPlus, Eraser,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
  model: string;
  state: string;
  battery_level: number;
  battery_range: number;
}

interface VehicleState {
  battery_level: number;
  rated_range: number;
  is_locked: boolean;
  is_charging: boolean;
  is_climate_on: boolean;
  sentry_mode: boolean;
  inside_temp: number;
  speed: number;
}

// ─── Command Button ──────────────────────────────────────────────────────────

function CommandButton({ icon, label, sublabel, onClick, loading, variant = 'default', active }: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  onClick: () => void;
  loading?: boolean;
  variant?: 'default' | 'danger' | 'success';
  active?: boolean;
}) {
  const variantStyles = {
    default: 'hover:border-neon-cyan/30',
    danger: 'hover:border-neon-red/30',
    success: 'hover:border-neon-green/30',
  };
  const activeStyles = {
    default: 'border-neon-cyan/20 bg-neon-cyan/5',
    danger: 'border-neon-red/20 bg-neon-red/5',
    success: 'border-neon-green/20 bg-neon-green/5',
  };
  const iconColors = {
    default: active ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5 text-[var(--text-secondary)]',
    danger: active ? 'bg-neon-red/20 text-neon-red' : 'bg-white/5 text-[var(--text-secondary)]',
    success: active ? 'bg-neon-green/20 text-neon-green' : 'bg-white/5 text-[var(--text-secondary)]',
  };

  return (
    <GlassPanel
      className={cn(
        'p-4 flex flex-col items-center gap-2 transition-all duration-300 text-center min-h-[100px] justify-center cursor-pointer',
        variantStyles[variant],
        active && activeStyles[variant],
        loading && 'opacity-50',
      )}
      onClick={loading ? undefined : onClick}
    >
      <div className={cn('rounded-xl p-2.5 transition-colors', iconColors[variant])}>
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
      </div>
      <div>
        <span className="text-xs font-medium text-[var(--text-primary)] block">{label}</span>
        {sublabel && (
          <span className={cn('text-[10px] mt-0.5 font-medium block',
            active ? (variant === 'danger' ? 'text-neon-red' : variant === 'success' ? 'text-neon-green' : 'text-neon-cyan') : 'text-[var(--text-muted)]',
          )}>{sublabel}</span>
        )}
      </div>
    </GlassPanel>
  );
}

// ─── Command Group ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslateFn = (...args: any[]) => any;

function CommandGroup({ title, children, t }: { title: string; children: React.ReactNode; t: TranslateFn }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium block">{t(title)}</span>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{children}</div>
    </div>
  );
}

// ─── Vehicle Command Center ──────────────────────────────────────────────────

function VehicleCommandCenter({ vehicle, state, t, convertTemp, convertDistance, tempUnit, distanceUnit }: {
  vehicle: Vehicle; state: VehicleState | null; t: TranslateFn;
  convertTemp: (c: number) => number; convertDistance: (km: number) => number;
  tempUnit: string; distanceUnit: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [lastResult, setLastResult] = useState<{ success: boolean; message: string } | null>(null);
  const name = vehicle.display_name || vehicle.vin;
  const isAsleep = vehicle.state === 'asleep' || vehicle.state === 'offline';

  const cmd = useMutation({
    mutationFn: ({ command, params }: { command: string; params?: Record<string, unknown> }) =>
      request<{ success: boolean; message: string }>(`/vehicles/${vehicle.id}/command/${command}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: params ? JSON.stringify(params) : undefined,
      }),
    onSuccess: (data) => {
      setLastResult(data);
      qc.invalidateQueries({ queryKey: ['command-vehicle-states'] });
      qc.invalidateQueries({ queryKey: ['vehicle-state'] });
      if (data.success) toast.success(`${t('Command sent to')} ${name}`);
      else toast.error(data.message || `${t('Command failed on')} ${name}`);
    },
    onError: (err: Error) => {
      setLastResult({ success: false, message: err.message });
      toast.error(`${t('Command failed')}: ${err.message}`);
    },
  });

  const wakeMut = useMutation({
    mutationFn: () => request<{ success: boolean }>(`/vehicles/${vehicle.id}/command/wake_up`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['command-vehicle-states'] });
      toast.success(`${name} ${t('is waking up')}`);
    },
    onError: (err: Error) => toast.error(`${t('Failed to wake')} ${name}: ${err.message}`),
  });

  const sendCmd = (command: string) => { setLastResult(null); cmd.mutate({ command }); };

  return (
    <GlassPanel className="p-6">
      {/* Vehicle header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-lg font-semibold text-[var(--text-primary)]">{name}</span>
            <Badge variant={isAsleep ? 'neutral' : 'success'} size="sm">{vehicle.state}</Badge>
          </div>
          <span className="text-xs text-[var(--text-muted)]">{vehicle.model} · {vehicle.vin}</span>
        </div>
        {state && (
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1"><Battery className="h-3.5 w-3.5 text-[var(--text-muted)]" /><span className={cn('font-semibold', (state.battery_level ?? 0) > 50 ? 'text-neon-green' : 'text-neon-amber')}>{state.battery_level}%</span></span>
            <span className="flex items-center gap-1"><Wifi className="h-3.5 w-3.5 text-[var(--text-muted)]" /><span className="text-[var(--text-secondary)]">{fmtNumber(convertDistance(state.rated_range), 0)} {distanceUnit}</span></span>
            {state.inside_temp != null && (
              <span className="flex items-center gap-1"><Thermometer className="h-3.5 w-3.5 text-[var(--text-muted)]" /><span className="text-[var(--text-secondary)]">{fmtNumber(convertTemp(state.inside_temp), 0)}{tempUnit}</span></span>
            )}
          </div>
        )}
      </div>

      {/* Status feedback */}
      {lastResult && (
        <GlassPanel className={cn('p-3 mb-4 flex items-center gap-2', lastResult.success ? 'bg-neon-green/5 border-neon-green/20' : 'bg-neon-red/5 border-neon-red/20')}>
          {lastResult.success ? <CheckCircle className="h-4 w-4 text-neon-green" /> : <AlertTriangle className="h-4 w-4 text-neon-red" />}
          <span className={cn('text-xs', lastResult.success ? 'text-neon-green' : 'text-neon-red')}>{lastResult.message}</span>
        </GlassPanel>
      )}

      {isAsleep && (
        <GlassPanel className="p-3 mb-4 flex items-center gap-2 bg-neon-amber/5 border-neon-amber/20">
          <Power className="h-4 w-4 text-neon-amber" />
          <span className="text-xs text-neon-amber">{t('Vehicle is')} {vehicle.state}. {t('Wake it up first to send commands.')}</span>
        </GlassPanel>
      )}

      {/* Commands */}
      <div className="space-y-5">
        <CommandGroup title="Security & Access" t={t}>
          <CommandButton icon={<Power className="h-5 w-5" />} label={t('Wake Up')} sublabel={isAsleep ? t('Required') : t('Awake')} onClick={() => wakeMut.mutate()} loading={wakeMut.isPending} variant="success" active={!isAsleep} />
          <CommandButton icon={state?.is_locked ? <Lock className="h-5 w-5" /> : <Unlock className="h-5 w-5" />} label={state?.is_locked ? t('Locked') : t('Unlocked')} sublabel={state?.is_locked ? t('Tap to unlock') : t('Tap to lock')} onClick={() => sendCmd(state?.is_locked ? 'unlock' : 'lock')} loading={cmd.isPending} active={state?.is_locked} />
          <CommandButton icon={<Shield className="h-5 w-5" />} label={t('Sentry')} sublabel={state?.sentry_mode ? t('Active') : t('Inactive')} onClick={() => sendCmd(state?.sentry_mode ? 'sentry_off' : 'sentry_on')} loading={cmd.isPending} active={state?.sentry_mode} variant={state?.sentry_mode ? 'danger' : 'default'} />
          <CommandButton icon={<GaugeCircle className="h-5 w-5" />} label={t('Speed Limit')} sublabel={t('Enable')} onClick={() => sendCmd('speed_limit_on')} loading={cmd.isPending} variant="danger" />
          <CommandButton icon={<UserPlus className="h-5 w-5" />} label={t('commands.security.guestMode', 'Guest Mode')} sublabel={t('commands.security.enable', 'Enable')} onClick={() => sendCmd('guest_mode_on')} loading={cmd.isPending} />
          <CommandButton
            icon={<Eraser className="h-5 w-5" />}
            label={t('commands.security.eraseData', 'Erase Data')}
            sublabel={t('commands.security.guestOnly', 'Guest mode only')}
            onClick={() => {
              if (window.confirm(t('commands.security.confirmErase', 'This will erase all user data from the vehicle touchscreen. Continue?'))) {
                sendCmd('erase_user_data');
              }
            }}
            loading={cmd.isPending}
            variant="danger"
          />
        </CommandGroup>

        <CommandGroup title="Climate & Comfort" t={t}>
          <CommandButton icon={<Wind className="h-5 w-5" />} label={t('Climate')} sublabel={state?.is_climate_on ? (state.inside_temp != null ? `${t('ON')} · ${fmtNumber(convertTemp(state.inside_temp), 0)}${tempUnit}` : t('ON')) : t('OFF')} onClick={() => sendCmd(state?.is_climate_on ? 'climate_off' : 'climate_on')} loading={cmd.isPending} active={state?.is_climate_on} />
        </CommandGroup>

        <CommandGroup title="Climate Protection" t={t}>
          <CommandButton
            icon={<ShieldAlert className="h-5 w-5" />}
            label={t('commands.climate.bioweapon', 'Bioweapon')}
            sublabel={t('commands.climate.defenseMode', 'Defense Mode')}
            onClick={() => sendCmd('bioweapon_on')}
            loading={cmd.isPending}
            variant="danger"
          />
          <CommandButton
            icon={<Thermometer className="h-5 w-5" />}
            label={t('commands.climate.cop', 'Overheat Protect')}
            sublabel={t('commands.climate.copOn', 'On (AC)')}
            onClick={() => sendCmd('cop_on')}
            loading={cmd.isPending}
          />
          <CommandButton
            icon={<Dog className="h-5 w-5" />}
            label={t('commands.climate.dogMode', 'Dog Mode')}
            onClick={() => sendCmd('dog_mode')}
            loading={cmd.isPending}
            variant="success"
          />
          <CommandButton
            icon={<Tent className="h-5 w-5" />}
            label={t('commands.climate.campMode', 'Camp Mode')}
            onClick={() => sendCmd('camp_mode')}
            loading={cmd.isPending}
            variant="success"
          />
          <CommandButton
            icon={<Flame className="h-5 w-5" />}
            label={t('commands.climate.maxPrecondition', 'Max Precondition')}
            sublabel={t('commands.climate.override', 'Override')}
            onClick={() => sendCmd('preconditioning_max')}
            loading={cmd.isPending}
            variant="danger"
          />
        </CommandGroup>

        <CommandGroup title="Charging" t={t}>
          <CommandButton icon={<Zap className="h-5 w-5" />} label={t('Charge Port')} sublabel={t('Open')} onClick={() => sendCmd('charge_port_open')} loading={cmd.isPending} />
          <CommandButton icon={<Zap className="h-5 w-5" />} label={t('Charge Port')} sublabel={t('Close')} onClick={() => sendCmd('close_charge_port')} loading={cmd.isPending} />
          <CommandButton icon={<Zap className="h-5 w-5" />} label={t('Start Charge')} sublabel={state?.is_charging ? t('Charging') : t('Idle')} onClick={() => sendCmd('charge_start')} loading={cmd.isPending} variant="success" active={state?.is_charging} />
          <CommandButton icon={<Zap className="h-5 w-5" />} label={t('Stop Charge')} onClick={() => sendCmd('charge_stop')} loading={cmd.isPending} variant="danger" />
          <CommandButton icon={<BatteryFull className="h-5 w-5" />} label={t('Max Range')} sublabel={t('Trip mode')} onClick={() => sendCmd('charge_max_range')} loading={cmd.isPending} variant="danger" />
          <CommandButton icon={<BatteryMedium className="h-5 w-5" />} label={t('Standard')} sublabel={t('Daily mode')} onClick={() => sendCmd('charge_standard')} loading={cmd.isPending} variant="success" />
          <CommandButton
            icon={<Gauge className="h-5 w-5" />}
            label={t('Set Amps')}
            sublabel={t('Amperage')}
            onClick={() => {
              const amps = window.prompt(t('Enter charging amps (e.g., 16, 32, 48):'));
              if (amps) {
                cmd.mutate({ command: 'set_charging_amps', params: { charging_amps: amps } });
              }
            }}
            loading={cmd.isPending}
          />
        </CommandGroup>

        <CommandGroup title="Doors & Trunk" t={t}>
          <CommandButton icon={<DoorOpen className="h-5 w-5" />} label={t('Frunk')} sublabel={t('Open')} onClick={() => sendCmd('frunk_open')} loading={cmd.isPending} />
          <CommandButton icon={<DoorOpen className="h-5 w-5" />} label={t('Trunk')} sublabel={t('Open')} onClick={() => sendCmd('trunk_open')} loading={cmd.isPending} />
        </CommandGroup>

        <CommandGroup title="Schedules" t={t}>
          <CommandButton
            icon={<CalendarPlus className="h-5 w-5" />}
            label={t('Add Charge Schedule')}
            sublabel={t('Midnight daily')}
            onClick={() => cmd.mutate({
              command: 'add_charge_schedule',
              params: {
                id: '0',
                name: 'Default',
                days_of_week: '127',
                start_enabled: 'true',
                start_time: '0',
                end_enabled: 'false',
                end_time: '0',
                one_time: 'false',
              },
            })}
            loading={cmd.isPending}
            variant="success"
          />
          <CommandButton
            icon={<CalendarMinus className="h-5 w-5" />}
            label={t('Remove Charge Schedule')}
            sublabel={t('By ID')}
            onClick={() => {
              const id = window.prompt(t('Enter schedule ID to remove:'));
              if (id) cmd.mutate({ command: 'remove_charge_schedule', params: { id } });
            }}
            loading={cmd.isPending}
            variant="danger"
          />
          <CommandButton
            icon={<CalendarPlus className="h-5 w-5" />}
            label={t('Add Precondition')}
            sublabel={t('7 AM daily')}
            onClick={() => cmd.mutate({
              command: 'add_precondition_schedule',
              params: {
                id: '0',
                name: 'Morning',
                days_of_week: '127',
                precondition_time: '420',
                one_time: 'false',
              },
            })}
            loading={cmd.isPending}
            variant="success"
          />
          <CommandButton
            icon={<CalendarMinus className="h-5 w-5" />}
            label={t('Remove Precondition')}
            sublabel={t('By ID')}
            onClick={() => {
              const id = window.prompt(t('Enter schedule ID to remove:'));
              if (id) cmd.mutate({ command: 'remove_precondition_schedule', params: { id } });
            }}
            loading={cmd.isPending}
            variant="danger"
          />
        </CommandGroup>

        <CommandGroup title="Alerts & Location" t={t}>
          <CommandButton icon={<Volume2 className="h-5 w-5" />} label={t('Horn')} onClick={() => sendCmd('honk_horn')} loading={cmd.isPending} variant="danger" />
          <CommandButton icon={<MapPin className="h-5 w-5" />} label={t('Flash Lights')} onClick={() => sendCmd('flash_lights')} loading={cmd.isPending} />
          <CommandButton icon={<Speaker className="h-5 w-5" />} label={t('Boombox')} sublabel={t('Random fart')} onClick={() => sendCmd('boombox_fart')} loading={cmd.isPending} />
          <CommandButton icon={<Locate className="h-5 w-5" />} label={t('Locate Ping')} sublabel={t('Find my car')} onClick={() => sendCmd('boombox_ping')} loading={cmd.isPending} />
          <CommandButton
            icon={<Home className="h-5 w-5" />}
            label={t('commands.homelink.trigger', 'HomeLink')}
            sublabel={t('commands.homelink.garage', 'Garage door')}
            onClick={() => {
              const lat = window.prompt(t('commands.homelink.enterLat', 'Enter vehicle latitude:'));
              const lon = lat ? window.prompt(t('commands.homelink.enterLon', 'Enter vehicle longitude:')) : null;
              if (lat && lon) {
                cmd.mutate({ command: 'trigger_homelink', params: { lat, lon } });
              }
            }}
            loading={cmd.isPending}
          />
        </CommandGroup>
      </div>
    </GlassPanel>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function CommandsPage() {
  const { t } = useTranslation();
  usePageTitle(t('Commands'));

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
  const { convertTemp, convertDistance, tempUnit, distanceUnit } = useSettings();

  return (
    <PageContainer
      title={t('Vehicle Commands')}
      subtitle={t('Remote control center for your Tesla fleet')}
      loading={isLoading}
      actions={
        vehicles && vehicles.length > 0 ? (
          <span className="text-xs text-[var(--text-muted)]">
            <span className="text-neon-green font-medium">{onlineCount}</span>/{vehicles.length} {t('online')}
          </span>
        ) : undefined
      }
    >
      {/* Stats */}
      <FadeIn>
        {vehicles && vehicles.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label={t('Vehicles')} value={vehicles.length} icon={<Car className="h-4 w-4" />} color="cyan" />
            <MetricCard label={t('Online')} value={onlineCount} icon={<Wifi className="h-4 w-4" />} color="green" />
            <MetricCard label={t('Asleep')} value={vehicles.length - onlineCount} icon={<Power className="h-4 w-4" />} color="amber" />
            <MetricCard label={t('Refresh')} value="15s" icon={<Loader2 className="h-4 w-4" />} color="purple" />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
            <Activity className="h-8 w-8 opacity-20" />
            <p className="text-xs">{t('common.noData', 'No data available')}</p>
          </div>
        )}
      </FadeIn>

      {statesError && (
        <GlassPanel className="p-3 flex items-center gap-2 bg-neon-red/5 border-neon-red/20">
          <AlertTriangle className="h-4 w-4 text-neon-red" />
          <span className="text-xs text-neon-red">{t('Failed to load vehicle states')}: {(statesError as Error).message}</span>
        </GlassPanel>
      )}

      {/* Vehicle Command Centers */}
      {isLoading ? (
        <div className="space-y-6">{[1, 2].map(i => <Skeleton key={i} className="h-72" />)}</div>
      ) : vehicles && vehicles.length > 0 ? (
        <StaggerContainer className="space-y-6">
          {vehicles.map(v => (
            <StaggerItem key={v.id}>
              <VehicleCommandCenter vehicle={v} state={states[v.id] ?? null} t={t} convertTemp={convertTemp} convertDistance={convertDistance} tempUnit={tempUnit} distanceUnit={distanceUnit} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      ) : (
        <EmptyState
          icon={<Car className="h-8 w-8" />}
          title={t('No vehicles found')}
          message={t('Connect your Tesla account and sync your fleet to start sending commands.')}
        />
      )}
    </PageContainer>
  );
}
