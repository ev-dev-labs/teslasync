import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Thermometer, Lock, Unlock, Shield, Zap, Activity, Navigation,
  Gauge, Clock, Eye, MapPin, BatteryCharging, Monitor,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { FreshnessIndicator } from '@/components/data-display';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { Skeleton } from '@/components/feedback/Skeleton';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { Vehicle, VehicleState } from '../types';

interface VehicleHeroProps {
  vehicle: Vehicle;
  state: VehicleState | null;
  firmwareVersion: string;
  convertDistance: (km: number) => number;
  convertSpeed: (kmh: number) => number;
  convertTemp: (c: number) => number;
  isFahrenheit: boolean;
  distanceUnit: string;
  speedUnit: string;
  tempUnit: string;
}

export function VehicleHero({
  vehicle, state, firmwareVersion,
  convertDistance, convertSpeed, convertTemp,
  isFahrenheit, distanceUnit, speedUnit, tempUnit,
}: VehicleHeroProps) {
  const { t } = useTranslation('dashboard');
  const status = vehicle.state as 'online' | 'offline' | 'asleep' | 'driving' | 'charging';

  return (
    <GlassPanel className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />
      <div className="relative p-4 sm:p-6 lg:p-8">
        {/* Vehicle name + status */}
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            {vehicle.display_name || vehicle.vin}
          </h2>
          <StatusBadge status={status} size="md" />
          <FreshnessIndicator timestamp={vehicle.updated_at} />
        </div>
        <p className="text-sm text-[var(--text-muted)]">
          {vehicle.model} {vehicle.trim_badging} · <span className="font-mono">{vehicle.vin}</span>
        </p>

        {state ? (
          <div className="mt-6">
            {/* Context-aware radial gauges */}
            <div className="flex flex-wrap justify-center gap-3 sm:gap-6 mb-6">
              <RadialGauge
                value={state.battery_level} max={100} label={t('hero.battery', 'Battery')} unit="%"
                color={state.battery_level > 50 ? '#10b981' : '#f59e0b'} size={70}
              />
              <RadialGauge
                value={Math.round(convertDistance(state.rated_range))} max={600}
                label={t('hero.range', 'Range')} unit={distanceUnit} color="#00f0ff" size={70}
              />
              {(vehicle.state === 'driving' || state.speed > 0) && (
                <RadialGauge
                  value={Math.round(convertSpeed(state.speed))} max={250}
                  label={t('hero.speed', 'Speed')} unit={speedUnit} color="#a855f7" size={70}
                />
              )}
              {state.is_charging && (
                <RadialGauge
                  value={Math.round(state.charger_power ?? 0)} max={250}
                  label={t('hero.power', 'Power')} unit="kW" color="#10b981" size={70}
                />
              )}
              <RadialGauge
                value={Math.round(convertTemp(state.inside_temp))} max={isFahrenheit ? 122 : 50}
                label={t('hero.inside', 'Inside')} unit={tempUnit} color="#f97316" size={70}
              />
              <RadialGauge
                value={Math.round(convertTemp(state.outside_temp))} max={isFahrenheit ? 122 : 50}
                label={t('hero.outside', 'Outside')} unit={tempUnit} color="#3b82f6" size={70}
              />
            </div>

            {/* Charging details — only when charging */}
            {state.is_charging && (
              <div className="mb-4 p-3 rounded-xl bg-neon-green/5 border border-neon-green/10">
                <div className="flex items-center gap-2 mb-2">
                  <BatteryCharging className="h-4 w-4 text-neon-green animate-pulse" />
                  <span className="text-sm font-medium text-neon-green">{t('hero.charging', 'Charging')}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center text-xs">
                  <div>
                    <p className="text-[var(--text-muted)]">{t('hero.chargePower', 'Power')}</p>
                    <p className="text-sm font-bold text-neon-green">{fmtNumber(state.charger_power)} kW</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-muted)]">{t('hero.chargeRate', 'Rate')}</p>
                    <p className="text-sm font-bold text-[var(--text-primary)]">
                      {fmtInt(convertDistance(state.charge_rate ?? 0))} {distanceUnit}/h
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--text-muted)]">{t('hero.timeToFull', 'Time to Full')}</p>
                    <p className="text-sm font-bold text-[var(--text-primary)]">
                      {state.time_to_full_charge > 0 ? `${fmtNumber(state.time_to_full_charge, 1)}h` : '—'}
                    </p>
                    {state.time_to_full_charge > 0 && (
                      <p className="text-[10px] text-[var(--text-muted)]">
                        {t('hero.doneAt', 'Done')} ~{new Date(Date.now() + state.time_to_full_charge * 3_600_000)
                          .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Context-aware stat grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {buildStatCards(vehicle, state, firmwareVersion, {
                convertDistance, convertSpeed, convertTemp,
                distanceUnit, speedUnit, tempUnit,
              }, t).map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]"
                >
                  <item.icon className="h-4 w-4 shrink-0" style={{ color: item.color }} />
                  <div className="min-w-0">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{item.label}</p>
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Quick action buttons */}
            <div className="flex gap-2 mt-4">
              <Link to={`/vehicles/${vehicle.id}`}>
                <Button variant="secondary" size="sm" icon={<Eye className="h-3.5 w-3.5" />}>
                  {t('hero.details', 'Details')}
                </Button>
              </Link>
              <Link to="/commands">
                <Button variant="secondary" size="sm" icon={<Zap className="h-3.5 w-3.5" />}>
                  {t('hero.commands', 'Commands')}
                </Button>
              </Link>
              <Link to="/live">
                <Button variant="secondary" size="sm" icon={<MapPin className="h-3.5 w-3.5" />}>
                  {t('hero.liveMap', 'Live Map')}
                </Button>
              </Link>
              <Link to="/digital-twin">
                <Button variant="secondary" size="sm" icon={<Monitor className="h-3.5 w-3.5" />}>
                  {t('hero.digitalTwin', 'Digital Twin')}
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <GlassPanel className="mt-6 p-4 text-center">
            <Skeleton className="h-8 mx-auto" />
            <p className="text-sm text-[var(--text-secondary)] mt-2">
              {t('hero.asleep', 'Vehicle asleep — wake to see live data')}
            </p>
            <Link to="/commands">
              <Button variant="primary" size="sm" className="mt-3">{t('hero.wakeUp', 'Wake Up')}</Button>
            </Link>
          </GlassPanel>
        )}
      </div>
    </GlassPanel>
  );
}

/* Build context-aware stat cards based on vehicle state */
type LucideIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
interface StatItem { icon: LucideIcon; label: string; value: string; color: string }

function buildStatCards(
  vehicle: Vehicle, s: VehicleState, firmware: string,
  u: { convertDistance: (v: number) => number; convertSpeed: (v: number) => number; convertTemp: (v: number) => number;
       distanceUnit: string; speedUnit: string; tempUnit: string },
  t: (key: string, fallback: string) => string,
): StatItem[] {
  const isDriving = vehicle.state === 'driving' || s.speed > 0;
  const isCharging = s.is_charging;
  const cards: StatItem[] = [];

  if (isDriving) {
    cards.push(
      { icon: Gauge, label: 'Speed', value: `${fmtNumber(u.convertSpeed(s.speed), 0)} ${u.speedUnit}`, color: '#a855f7' },
      { icon: Zap, label: 'Power', value: `${fmtNumber(s.power)} kW`, color: s.power > 0 ? '#f59e0b' : s.power < 0 ? '#10b981' : '#374151' },
      { icon: Navigation, label: 'Odometer', value: `${fmtInt(u.convertDistance(s.odometer))} ${u.distanceUnit}`, color: '#a855f7' },
      { icon: Activity, label: 'Ideal Range', value: `${fmtNumber(u.convertDistance(s.ideal_range), 0)} ${u.distanceUnit}`, color: '#00f0ff' },
    );
  } else if (isCharging) {
    cards.push(
      { icon: Zap, label: 'Charge Rate', value: `${fmtInt(u.convertDistance(s.charge_rate ?? 0))} ${u.distanceUnit}/h`, color: '#10b981' },
      { icon: Clock, label: 'Time to Full', value: s.time_to_full_charge > 0 ? `${fmtNumber(s.time_to_full_charge, 1)}h` : '—', color: '#f59e0b' },
      { icon: Activity, label: 'Ideal Range', value: `${fmtNumber(u.convertDistance(s.ideal_range), 0)} ${u.distanceUnit}`, color: '#00f0ff' },
      { icon: Navigation, label: 'Odometer', value: `${fmtInt(u.convertDistance(s.odometer))} ${u.distanceUnit}`, color: '#a855f7' },
    );
  } else {
    cards.push(
      { icon: Thermometer, label: 'Inside', value: s.inside_temp != null ? `${fmtNumber(u.convertTemp(s.inside_temp), 1)}${u.tempUnit}` : '—', color: '#f97316' },
      { icon: Thermometer, label: 'Outside', value: s.outside_temp != null ? `${fmtNumber(u.convertTemp(s.outside_temp), 1)}${u.tempUnit}` : '—', color: '#3b82f6' },
      { icon: Navigation, label: 'Odometer', value: `${fmtInt(u.convertDistance(s.odometer))} ${u.distanceUnit}`, color: '#a855f7' },
      { icon: Activity, label: 'Ideal Range', value: `${fmtNumber(u.convertDistance(s.ideal_range), 0)} ${u.distanceUnit}`, color: '#00f0ff' },
    );
  }

  // Always-visible cards
  cards.push(
    { icon: s.is_locked ? Lock : Unlock, label: t('common.status', 'Status'), value: s.is_locked ? t('common.locked', 'Locked') : t('common.unlocked', 'Unlocked'), color: s.is_locked ? '#10b981' : '#f59e0b' },
    { icon: Shield, label: t('common.sentry', 'Sentry'), value: s.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off'), color: s.sentry_mode ? '#ef4444' : '#374151' },
    { icon: Gauge, label: 'Firmware', value: firmware, color: '#6366f1' },
    { icon: Zap, label: 'Power', value: `${fmtNumber(s.power)} kW`, color: s.power > 0 ? '#f59e0b' : s.power < 0 ? '#10b981' : '#374151' },
  );

  return cards;
}
