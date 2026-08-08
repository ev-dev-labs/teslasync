import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Thermometer, Lock, Unlock, Shield, Zap, Activity, Navigation,
  Gauge, Clock, Eye, MapPin, BatteryCharging, Monitor,
  type LucideIcon,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { FreshnessIndicator } from '@/components/data-display';
import { LinearGauge } from '@/components/charts/LinearGauge';
import { ambientTemperatureGaugeRange } from '@/components/charts/temperatureGaugeRange';
import { Skeleton } from '@/components/feedback/Skeleton';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { Vehicle, VehicleState } from '../types';

interface VehicleHeroProps {
  vehicle: Vehicle;
  state: VehicleState | null;
  firmwareVersion: string;
  toDistanceDisplay: (km: number) => number;
  toSpeedDisplay: (kmh: number) => number;
  toTemperatureDisplay: (c: number) => number;
  distanceUnit: string;
  speedUnit: string;
  tempUnit: string;
  /** TanStack Query dataUpdatedAt (ms epoch) — overrides vehicle.updated_at for freshness */
  lastFetchedAt?: number;
}

export function VehicleHero({
  vehicle, state, firmwareVersion,
  toDistanceDisplay, toSpeedDisplay, toTemperatureDisplay,
  distanceUnit, speedUnit, tempUnit,
  lastFetchedAt,
}: VehicleHeroProps) {
  const { t } = useTranslation('dashboard');
  const { formatTime } = useDateFormat();
  const status = (state?.state ?? 'offline') as string;
  /* Both ends converted together so the arc means the same thing in °C and
   * °F, with a sub-zero floor so cold outside readings still render. */
  const tempRange = ambientTemperatureGaugeRange(toTemperatureDisplay);

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />
      <div className="relative p-4 sm:p-6 lg:p-8">
        {/* Vehicle name + status */}
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            {vehicle.display_name || vehicle.vin}
          </h2>
          <StatusBadge status={status} size="md" />
          <FreshnessIndicator
            timestamp={lastFetchedAt ? new Date(lastFetchedAt).toISOString() : vehicle.updated_at}
          />
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          {vehicle.model} {vehicle.trim_badging} · <span className="font-mono">{vehicle.vin}</span>
        </p>

        {state ? (
          <div className="mt-6">
            {/* Context-aware gauges. Bars need horizontal room, so they sit in
                a responsive grid rather than the single wrapping row the old
                fixed-diameter rings used. */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 mb-6">
              <LinearGauge
                value={state.battery_level ?? 0} max={100} label={t('hero.battery', 'Battery')} unit="%"
                color={(state.battery_level ?? 0) > 50 ? '#10b981' : '#f59e0b'} size={70}
              />
              <LinearGauge
                value={Math.round(toDistanceDisplay(state.rated_range ?? 0))} max={600}
                label={t('hero.range', 'Range')} unit={distanceUnit} color="#00f0ff" size={70}
              />
              {(status === 'driving' || (state.speed ?? 0) > 0) && (
                <LinearGauge
                  value={Math.round(toSpeedDisplay(state.speed ?? 0))} max={250}
                  label={t('hero.speed', 'Speed')} unit={speedUnit} color="#a855f7" size={70}
                />
              )}
              {state.is_charging && (
                <LinearGauge
                  value={Math.round(state.charger_power ?? 0)} max={250}
                  label={t('hero.power', 'Power')} unit="kW" color="#10b981" size={70}
                />
              )}
              <LinearGauge
                value={Math.round(toTemperatureDisplay(state.inside_temp ?? 0))} {...tempRange}
                label={t('hero.inside', 'Inside')} unit={tempUnit} color="#f97316" size={70}
              />
              <LinearGauge
                value={Math.round(toTemperatureDisplay(state.outside_temp ?? 0))} {...tempRange}
                label={t('hero.outside', 'Outside')} unit={tempUnit} color="#3b82f6" size={70}
              />
            </div>

            {/* Charging details — only when charging */}
            {state.is_charging && (
              <div className="mb-4 p-3 rounded-xl bg-neon-green/5 border border-neon-green/10">
                <div className="flex items-center gap-2 mb-2">
                  <BatteryCharging className="h-4 w-4 text-neon-green animate-pulse" aria-hidden />
                  <span className="text-sm font-medium text-emerald-300">{t('hero.charging', 'Charging')}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center text-xs">
                  <div>
                    <p className="text-[var(--text-secondary)]">{t('hero.chargePower', 'Power')}</p>
                    <p className="text-sm font-bold text-emerald-300">{fmtNumber(state.charger_power)} kW</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-secondary)]">{t('hero.chargeRate', 'Rate')}</p>
                    <p className="text-sm font-bold text-[var(--text-primary)]">
                      {fmtInt(toDistanceDisplay(state.charge_rate ?? 0))} {distanceUnit}/h
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--text-secondary)]">{t('hero.timeToFull', 'Time to Full')}</p>
                    <p className="text-sm font-bold text-[var(--text-primary)]">
                      {state.time_to_full_charge > 0 ? `${fmtNumber(state.time_to_full_charge, 1)}h` : '—'}
                    </p>
                    {state.time_to_full_charge > 0 && (
                      <p className="text-2xs text-[var(--text-secondary)]">
                        {t('hero.doneAt', 'Done')} ~{formatTime(new Date(Date.now() + state.time_to_full_charge * 3_600_000))}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Context-aware stat grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {buildStatCards(vehicle, state, firmwareVersion, {
                toDistanceDisplay, toSpeedDisplay, toTemperatureDisplay,
                distanceUnit, speedUnit, tempUnit,
              }, t).map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]"
                >
                  <item.icon className="h-4 w-4 shrink-0" style={{ color: item.color }} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-2xs text-[var(--text-secondary)] uppercase tracking-wider">{item.label}</p>
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
            <p className="text-sm text-[var(--text-muted)] mt-2">
              {t('hero.asleep', 'Vehicle asleep — wake to see live data')}
            </p>
            <Link to="/commands">
              <Button variant="primary" size="sm" className="mt-3">{t('hero.wakeUp', 'Wake Up')}</Button>
            </Link>
          </GlassPanel>
        )}
      </div>
    </div>
  );
}

/* Build context-aware stat cards based on vehicle state */
interface StatItem { icon: LucideIcon; label: string; value: string; color: string }

function buildStatCards(
  _vehicle: Vehicle, s: VehicleState, firmware: string,
  u: { toDistanceDisplay: (v: number) => number; toSpeedDisplay: (v: number) => number; toTemperatureDisplay: (v: number) => number;
       distanceUnit: string; speedUnit: string; tempUnit: string },
  t: (key: string, fallback: string) => string,
): StatItem[] {
  // Null-safe SI reads — the API declares these non-optional, but a partial
  // telemetry frame can leave a field null; defaulting here keeps every derived
  // string finite instead of leaking "NaN" into a tile.
  const speed = s.speed ?? 0;
  const power = s.power ?? 0;
  const odometer = s.odometer ?? 0;
  const idealRange = s.ideal_range ?? 0;
  const isDriving = s.state === 'driving' || speed > 0;
  const isCharging = s.is_charging;
  const cards: StatItem[] = [];

  // Single source of truth for the Power tile so it can appear in the driving
  // context OR the always-visible row, but never both (which previously pushed
  // two tiles sharing the same React key in driving mode).
  const powerColor = power > 0 ? '#f59e0b' : power < 0 ? '#10b981' : '#374151';
  const powerCard: StatItem = {
    icon: Zap, label: t('hero.power', 'Power'), value: `${fmtNumber(power)} kW`, color: powerColor,
  };

  if (isDriving) {
    cards.push(
      { icon: Gauge, label: t('hero.speed', 'Speed'), value: `${fmtNumber(u.toSpeedDisplay(speed), 0)} ${u.speedUnit}`, color: '#a855f7' },
      powerCard,
      { icon: Navigation, label: t('hero.odometer', 'Odometer'), value: `${fmtInt(u.toDistanceDisplay(odometer))} ${u.distanceUnit}`, color: '#a855f7' },
      { icon: Activity, label: t('hero.idealRange', 'Ideal Range'), value: `${fmtNumber(u.toDistanceDisplay(idealRange), 0)} ${u.distanceUnit}`, color: '#00f0ff' },
    );
  } else if (isCharging) {
    cards.push(
      { icon: Zap, label: t('hero.chargeRate', 'Charge Rate'), value: `${fmtInt(u.toDistanceDisplay(s.charge_rate ?? 0))} ${u.distanceUnit}/h`, color: '#10b981' },
      { icon: Clock, label: t('hero.timeToFull', 'Time to Full'), value: (s.time_to_full_charge ?? 0) > 0 ? `${fmtNumber(s.time_to_full_charge, 1)}h` : '—', color: '#f59e0b' },
      { icon: Activity, label: t('hero.idealRange', 'Ideal Range'), value: `${fmtNumber(u.toDistanceDisplay(idealRange), 0)} ${u.distanceUnit}`, color: '#00f0ff' },
      { icon: Navigation, label: t('hero.odometer', 'Odometer'), value: `${fmtInt(u.toDistanceDisplay(odometer))} ${u.distanceUnit}`, color: '#a855f7' },
    );
  } else {
    cards.push(
      { icon: Thermometer, label: t('hero.inside', 'Inside'), value: s.inside_temp != null ? `${fmtNumber(u.toTemperatureDisplay(s.inside_temp), 1)}${u.tempUnit}` : '—', color: '#f97316' },
      { icon: Thermometer, label: t('hero.outside', 'Outside'), value: s.outside_temp != null ? `${fmtNumber(u.toTemperatureDisplay(s.outside_temp), 1)}${u.tempUnit}` : '—', color: '#3b82f6' },
      { icon: Navigation, label: t('hero.odometer', 'Odometer'), value: `${fmtInt(u.toDistanceDisplay(odometer))} ${u.distanceUnit}`, color: '#a855f7' },
      { icon: Activity, label: t('hero.idealRange', 'Ideal Range'), value: `${fmtNumber(u.toDistanceDisplay(idealRange), 0)} ${u.distanceUnit}`, color: '#00f0ff' },
    );
  }

  // Always-visible cards. Power is appended here only when it is not already
  // surfaced by the driving context above, so it renders exactly once.
  cards.push(
    { icon: s.is_locked ? Lock : Unlock, label: t('common.status', 'Status'), value: s.is_locked ? t('common.locked', 'Locked') : t('common.unlocked', 'Unlocked'), color: s.is_locked ? '#10b981' : '#f59e0b' },
    { icon: Shield, label: t('common.sentry', 'Sentry'), value: s.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off'), color: s.sentry_mode ? '#ef4444' : '#374151' },
    { icon: Gauge, label: t('hero.firmware', 'Firmware'), value: firmware, color: '#6366f1' },
  );
  if (!isDriving) cards.push(powerCard);

  return cards;
}
