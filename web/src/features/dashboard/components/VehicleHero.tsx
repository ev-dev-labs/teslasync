import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Thermometer, Lock, Unlock, Shield, Zap, Activity, Navigation,
  Gauge, Clock, Eye, MapPin, BatteryCharging, Monitor, HelpCircle,
  type LucideIcon,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { Heading, Text } from '@/components/ui/Typography';
import { severityTokens, gaugeTone } from '@/lib/tokens';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { FreshnessIndicator } from '@/components/data-display';
import { LinearGauge } from '@/components/charts/LinearGauge';
import { ambientTemperatureGaugeRange } from '@/components/charts/temperatureGaugeRange';
import { Skeleton } from '@/components/feedback/Skeleton';
import { cn } from '@/lib/cn';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { deriveTrustedVehicleStatus } from '@/api/hooks/useVehicles';
import type {
  VehicleStateFreshness,
  VerifiedVehicleStateField,
} from '@/api/hooks/useVehicles';
import type { VehicleStatus } from '@/api/types';
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
  /**
   * Backend observation instant (ms epoch) of the newest REAL live signal.
   *
   * Deliberately not the query's `dataUpdatedAt`: that is when the request
   * completed, which advances on every poll even when the car has said
   * nothing for an hour and never regresses after a failed refresh.
   */
  observedAt?: number;
  /** Backend freshness classification of the live stream. */
  freshness?: VehicleStateFreshness;
  /** State fields backed by real live signals. */
  verifiedFields?: readonly VerifiedVehicleStateField[];
}

const NO_VERIFIED_FIELDS: readonly VerifiedVehicleStateField[] = [];

export function VehicleHero({
  vehicle, state, firmwareVersion,
  toDistanceDisplay, toSpeedDisplay, toTemperatureDisplay,
  distanceUnit, speedUnit, tempUnit,
  observedAt,
  freshness = 'unknown',
  verifiedFields = NO_VERIFIED_FIELDS,
}: VehicleHeroProps) {
  const { t } = useTranslation('dashboard');
  const { formatTime } = useDateFormat();
  /* THE shared precedence: verified charging → verified motion → verified FSM
   * state. `null` means Unknown and is rendered as such — it must never fall
   * through to "offline", which is what made the hero and Fleet Posture
   * disagree about the same car. */
  const status = deriveTrustedVehicleStatus(state, {
    freshness,
    observedAt: observedAt ?? null,
    verifiedFields,
  });
  const unknownStatus = status == null;
  /* Both ends converted together so the arc means the same thing in °C and
   * °F, with a sub-zero floor so cold outside readings still render. */
  const tempRange = ambientTemperatureGaugeRange(toTemperatureDisplay);

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--surface-2)] via-transparent to-transparent" />
      <div className="relative p-4 sm:p-6 lg:p-8">
        {/* Vehicle name + status */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-1">
          <Heading level="section" className="text-2xl">
            {vehicle.display_name || vehicle.vin}
          </Heading>
          {unknownStatus ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]"
              title={t('hero.unknownHelp', 'No current, verified telemetry backs an operational state for this vehicle.')}
            >
              <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {t('hero.unknownStatus', 'Unknown')}
            </span>
          ) : (
            <StatusBadge status={status} size="md" />
          )}
          <FreshnessIndicator
            timestamp={observedAt != null ? new Date(observedAt).toISOString() : null}
          />
        </div>
        <Text as="p" size="sm" color="secondary">
          {vehicle.model} {vehicle.trim_badging} · <span className="font-mono">{vehicle.vin}</span>
        </Text>
        {/* Provenance line — always rendered so "we don't know" is as visible
            as a confident answer, and announced politely on change. */}
        <Text
          as="p"
          size="2xs"
          color="muted"
          className="mt-1"
          aria-live="polite"
        >
          {freshness === 'fresh'
            ? t('hero.provenanceLive', 'Live telemetry · {{count}} verified field(s)', {
                count: verifiedFields.length,
              })
            : freshness === 'stale'
              ? t('hero.provenanceStale', 'Last known reading — telemetry has gone quiet')
              : t('hero.provenanceUnknown', 'No verified observation time — showing last durable record')}
        </Text>

        {state ? (
          <div className="mt-6">
            {/* Context-aware gauges. Bars need horizontal room, so they sit in
                a responsive grid rather than the single wrapping row the old
                fixed-diameter rings used. */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 mb-6">
              <LinearGauge
                value={state.battery_level ?? 0} max={100} label={t('hero.battery', 'Battery')} unit="%"
                tone={(state.battery_level ?? 0) > 50 ? 'success' : 'warning'} size={70}
              />
              <LinearGauge
                value={Math.round(toDistanceDisplay(state.rated_range ?? 0))} max={600}
                label={t('hero.range', 'Range')} unit={distanceUnit} tone="accent" size={70}
              />
              {status === 'driving' && (
                <LinearGauge
                  value={Math.round(toSpeedDisplay(state.speed ?? 0))} max={250}
                  label={t('hero.speed', 'Speed')} unit={speedUnit} tone="purple" size={70}
                />
              )}
              {status === 'charging' && (
                <LinearGauge
                  value={Math.round(state.charger_power ?? 0)} max={250}
                  label={t('hero.power', 'Power')} unit="kW" tone="success" size={70}
                />
              )}
              <LinearGauge
                value={Math.round(toTemperatureDisplay(state.inside_temp ?? 0))} {...tempRange}
                label={t('hero.inside', 'Inside')} unit={tempUnit} tone="warning" size={70}
              />
              <LinearGauge
                value={Math.round(toTemperatureDisplay(state.outside_temp ?? 0))} {...tempRange}
                label={t('hero.outside', 'Outside')} unit={tempUnit} tone="primary" size={70}
              />
            </div>

            {/* Charging details — only when charging */}
            {status === 'charging' && (
              <div className={cn('mb-4 p-3 rounded-xl border', severityTokens.success.bg, severityTokens.success.border)}>
                <div className="flex items-center gap-2 mb-2">
                  <BatteryCharging className={cn('h-4 w-4 animate-pulse', severityTokens.success.fg)} aria-hidden />
                  <Text as="span" size="sm" weight="medium" className={severityTokens.success.fg}>
                    {t('hero.charging', 'Charging')}
                  </Text>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center text-xs">
                  <div>
                    <Text as="p" size="xs" color="secondary">{t('hero.chargePower', 'Power')}</Text>
                    <Text as="p" size="sm" weight="bold" className={severityTokens.success.fg}>
                      {fmtNumber(state.charger_power)} kW
                    </Text>
                  </div>
                  <div>
                    <Text as="p" size="xs" color="secondary">{t('hero.chargeRate', 'Rate')}</Text>
                    <Text as="p" size="sm" weight="bold" color="primary">
                      {fmtInt(toDistanceDisplay(state.charge_rate ?? 0))} {distanceUnit}/h
                    </Text>
                  </div>
                  <div>
                    <Text as="p" size="xs" color="secondary">{t('hero.timeToFull', 'Time to Full')}</Text>
                    <Text as="p" size="sm" weight="bold" color="primary">
                      {state.time_to_full_charge > 0 ? `${fmtNumber(state.time_to_full_charge, 1)}h` : '—'}
                    </Text>
                    {state.time_to_full_charge > 0 && (
                      <Text as="p" size="2xs" color="secondary">
                        {t('hero.doneAt', 'Done')} ~{formatTime(new Date(Date.now() + state.time_to_full_charge * 3_600_000))}
                      </Text>
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
              }, t, status).map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 p-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border-subtle)]"
                >
                  <item.icon className="h-4 w-4 shrink-0" style={{ color: item.color }} aria-hidden />
                  <div className="min-w-0">
                    <Text as="p" size="2xs" color="secondary" className="uppercase tracking-wider">{item.label}</Text>
                    <Text as="p" size="sm" weight="semibold" color="primary" className="truncate">{item.value}</Text>
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
            <Text as="p" size="sm" color="muted" className="mt-2">
              {t('hero.asleep', 'Vehicle asleep — wake to see live data')}
            </Text>
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
  status: VehicleStatus | null,
): StatItem[] {
  // Null-safe SI reads — the API declares these non-optional, but a partial
  // telemetry frame can leave a field null; defaulting here keeps every derived
  // string finite instead of leaking "NaN" into a tile.
  const speed = s.speed ?? 0;
  const power = s.power ?? 0;
  const odometer = s.odometer ?? 0;
  const idealRange = s.ideal_range ?? 0;
  // Context selection follows the SHARED trusted status. When the status is
  // Unknown we fall through to the neutral tile set rather than inventing a
  // driving context from an unverified speed reading.
  const isDriving = status === 'driving';
  const isCharging = status === 'charging';
  const cards: StatItem[] = [];

  // Single source of truth for the Power tile so it can appear in the driving
  // context OR the always-visible row, but never both (which previously pushed
  // two tiles sharing the same React key in driving mode).
  const powerColor = power > 0 ? gaugeTone.warning : power < 0 ? gaugeTone.success : gaugeTone.neutral;
  const powerCard: StatItem = {
    icon: Zap, label: t('hero.power', 'Power'), value: `${fmtNumber(power)} kW`, color: powerColor,
  };

  if (isDriving) {
    cards.push(
      { icon: Gauge, label: t('hero.speed', 'Speed'), value: `${fmtNumber(u.toSpeedDisplay(speed), 0)} ${u.speedUnit}`, color: gaugeTone.purple },
      powerCard,
      { icon: Navigation, label: t('hero.odometer', 'Odometer'), value: `${fmtInt(u.toDistanceDisplay(odometer))} ${u.distanceUnit}`, color: gaugeTone.purple },
      { icon: Activity, label: t('hero.idealRange', 'Ideal Range'), value: `${fmtNumber(u.toDistanceDisplay(idealRange), 0)} ${u.distanceUnit}`, color: gaugeTone.accent },
    );
  } else if (isCharging) {
    cards.push(
      { icon: Zap, label: t('hero.chargeRate', 'Charge Rate'), value: `${fmtInt(u.toDistanceDisplay(s.charge_rate ?? 0))} ${u.distanceUnit}/h`, color: gaugeTone.success },
      { icon: Clock, label: t('hero.timeToFull', 'Time to Full'), value: (s.time_to_full_charge ?? 0) > 0 ? `${fmtNumber(s.time_to_full_charge, 1)}h` : '—', color: gaugeTone.warning },
      { icon: Activity, label: t('hero.idealRange', 'Ideal Range'), value: `${fmtNumber(u.toDistanceDisplay(idealRange), 0)} ${u.distanceUnit}`, color: gaugeTone.accent },
      { icon: Navigation, label: t('hero.odometer', 'Odometer'), value: `${fmtInt(u.toDistanceDisplay(odometer))} ${u.distanceUnit}`, color: gaugeTone.purple },
    );
  } else {
    cards.push(
      { icon: Thermometer, label: t('hero.inside', 'Inside'), value: s.inside_temp != null ? `${fmtNumber(u.toTemperatureDisplay(s.inside_temp), 1)}${u.tempUnit}` : '—', color: gaugeTone.warning },
      { icon: Thermometer, label: t('hero.outside', 'Outside'), value: s.outside_temp != null ? `${fmtNumber(u.toTemperatureDisplay(s.outside_temp), 1)}${u.tempUnit}` : '—', color: gaugeTone.primary },
      { icon: Navigation, label: t('hero.odometer', 'Odometer'), value: `${fmtInt(u.toDistanceDisplay(odometer))} ${u.distanceUnit}`, color: gaugeTone.purple },
      { icon: Activity, label: t('hero.idealRange', 'Ideal Range'), value: `${fmtNumber(u.toDistanceDisplay(idealRange), 0)} ${u.distanceUnit}`, color: gaugeTone.accent },
    );
  }

  // Always-visible cards. Power is appended here only when it is not already
  // surfaced by the driving context above, so it renders exactly once.
  cards.push(
    { icon: s.is_locked ? Lock : Unlock, label: t('common.status', 'Status'), value: s.is_locked ? t('common.locked', 'Locked') : t('common.unlocked', 'Unlocked'), color: s.is_locked ? gaugeTone.success : gaugeTone.warning },
    { icon: Shield, label: t('common.sentry', 'Sentry'), value: s.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off'), color: s.sentry_mode ? gaugeTone.danger : gaugeTone.neutral },
    { icon: Gauge, label: t('hero.firmware', 'Firmware'), value: firmware, color: gaugeTone.info },
  );
  if (!isDriving) cards.push(powerCard);

  return cards;
}
