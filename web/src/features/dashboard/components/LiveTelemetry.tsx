import { useTranslation } from 'react-i18next';
import {
  Cog, Thermometer, Shield, Zap, Snowflake, CircleDot,
  Headphones, Navigation2, ShieldCheck,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/feedback/Skeleton';
import { cleanNil } from '@/lib/cleanNil';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { MotorData, ClimateData, SecurityData, TirePressureData, MediaData, LocationData } from '../types';

interface LiveTelemetryProps {
  motorData: MotorData | undefined;
  climateData: ClimateData | undefined;
  securityData: SecurityData | undefined;
  tireData: TirePressureData | undefined;
  mediaData: MediaData | undefined;
  locationData: LocationData | undefined;
  toTemperatureDisplay: (c: number) => number;
  toDistanceDisplay: (km: number) => number;
  toPressureDisplay: (bar: number) => number;
  tempUnit: string;
  distanceUnit: string;
  pressureUnit: string;
}

/** Fan speed is reported on a fixed 0–6 scale in the Tesla climate signal set. */
const FAN_SPEED_MAX = 6;

/** Clamp a percentage into [0, 100] so progress fills never overflow their track. */
function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function LiveTelemetry({
  motorData, climateData, securityData, tireData, mediaData, locationData,
  toTemperatureDisplay, toDistanceDisplay, toPressureDisplay, tempUnit, distanceUnit, pressureUnit,
}: LiveTelemetryProps) {
  const { t } = useTranslation('dashboard');

  return (
    <div>
      {/* Section divider */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--glass-border)] to-transparent" />
        <h3 className="section-title flex items-center gap-2 text-sm uppercase tracking-widest text-[var(--text-secondary)]">
          <Cog className="h-4 w-4 text-cyan-300" /> {t('telemetry.title', 'Live Telemetry')}
        </h3>
        <div className="h-px flex-1 bg-gradient-to-r from-[var(--glass-border)] via-[var(--glass-border)] to-transparent" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Drivetrain */}
        <DrivetrainPanel data={motorData} toTemperatureDisplay={toTemperatureDisplay} tempUnit={tempUnit} />

        {/* Climate */}
        <ClimatePanel data={climateData} toTemperatureDisplay={toTemperatureDisplay} tempUnit={tempUnit} />

        {/* Security */}
        <SecurityPanel data={securityData} />

        {/* Tire Pressure */}
        <TirePressurePanel data={tireData} toPressureDisplay={toPressureDisplay} pressureUnit={pressureUnit} />

        {/* Media */}
        <MediaPanel data={mediaData} />

        {/* Navigation */}
        <NavigationPanel data={locationData} toDistanceDisplay={toDistanceDisplay} distanceUnit={distanceUnit} />
      </div>
    </div>
  );
}

/* ———— Drivetrain Panel ———— */
function DrivetrainPanel({ data, toTemperatureDisplay, tempUnit }: {
  data: MotorData | undefined; toTemperatureDisplay: (c: number) => number; tempUnit: string;
}) {
  const { t } = useTranslation('dashboard');
  return (
    <GlassPanel hover glow="purple" className="p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-3">
        <Cog className="h-3.5 w-3.5 text-purple-300" /> {t('telemetry.drivetrain', 'Drivetrain')}
      </h4>
      {data ? (
        <div className="space-y-2.5">
          <TelemetryRow label={t('telemetry.torque', 'Torque')} value={data.di_torque != null ? `${data.di_torque} Nm` : '—'} />
          <TelemetryRow label={t('telemetry.motorTemp', 'Motor Temp')} value={data.di_stator_temp != null ? `${fmtInt(toTemperatureDisplay(data.di_stator_temp))}${tempUnit}` : '—'} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">{t('telemetry.gear', 'Gear')}</span>
            {cleanNil(data.gear) ? (
              <Badge variant={data.gear === 'D' ? 'success' : data.gear === 'R' ? 'danger' : 'neutral'}>
                {cleanNil(data.gear)}
              </Badge>
            ) : <span className="text-sm text-[var(--text-muted)]">—</span>}
          </div>
          <TelemetryRow
            label={t('telemetry.gforce', 'G-Force')}
            value={data.lateral_accel != null || data.longitudinal_accel != null
              ? `${fmtNumber(Math.max(Math.abs(data.lateral_accel ?? 0), Math.abs(data.longitudinal_accel ?? 0)), 2)}g`
              : '—'}
          />
        </div>
      ) : <SkeletonRows />}
    </GlassPanel>
  );
}

/* ———— Climate Panel ———— */
function ClimatePanel({ data, toTemperatureDisplay, tempUnit }: {
  data: ClimateData | undefined; toTemperatureDisplay: (c: number) => number; tempUnit: string;
}) {
  const { t } = useTranslation('dashboard');
  const fanSpeed = data?.hvac_fan_speed ?? 0;
  return (
    <GlassPanel hover glow="cyan" className="p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-3">
        <Thermometer className="h-3.5 w-3.5 text-cyan-300" /> {t('telemetry.climate', 'Climate')}
      </h4>
      {data ? (
        <div className="space-y-2.5">
          <TelemetryRow label={t('telemetry.cabin', 'Cabin')} value={data.inside_temp != null ? `${fmtInt(toTemperatureDisplay(data.inside_temp))}${tempUnit}` : '—'} />
          <TelemetryRow label={t('telemetry.outside', 'Outside')} value={data.outside_temp != null ? `${fmtInt(toTemperatureDisplay(data.outside_temp))}${tempUnit}` : '—'} />
          <TelemetryRow label={t('telemetry.hvac', 'HVAC Power')} value={data.hvac_power != null ? `${fmtNumber(data.hvac_power, 1)} kW` : '—'} />
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--text-secondary)]">{t('telemetry.fan', 'Fan')}</span>
              <span className="text-2xs text-[var(--text-muted)]">{fanSpeed}/{FAN_SPEED_MAX}</span>
            </div>
            <div
              className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden"
              role="progressbar"
              aria-label={t('telemetry.fan', 'Fan')}
              aria-valuenow={fanSpeed}
              aria-valuemin={0}
              aria-valuemax={FAN_SPEED_MAX}
            >
              <div
                className="h-full rounded-full transition-all duration-slow"
                style={{
                  width: `${clampPct((fanSpeed / FAN_SPEED_MAX) * 100)}%`,
                  background: 'linear-gradient(90deg, #00f0ff, #a855f7)',
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {data.defrost_mode && data.defrost_mode !== 'Off' && (
              <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                <Snowflake className="h-2.5 w-2.5" /> {t('telemetry.defrost', 'Defrost')}
              </span>
            )}
            {data.battery_heater_on && (
              <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400">
                <Zap className="h-2.5 w-2.5" /> {t('telemetry.batHeater', 'Bat Heater')}
              </span>
            )}
            {(!data.defrost_mode || data.defrost_mode === 'Off') && !data.battery_heater_on && (
              <span className="text-2xs text-[var(--text-muted)]">{t('telemetry.noModes', 'No active modes')}</span>
            )}
          </div>
        </div>
      ) : <SkeletonRows />}
    </GlassPanel>
  );
}

/* ———— Security Panel ———— */
function SecurityPanel({ data }: { data: SecurityData | undefined }) {
  const { t } = useTranslation('dashboard');

  if (!data) {
    return (
      <GlassPanel hover glow="green" className="p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-3">
          <Shield className="h-3.5 w-3.5 text-emerald-300" /> {t('telemetry.security', 'Security')}
        </h4>
        <SkeletonRows />
      </GlassPanel>
    );
  }

  const doorStates = (data.door_state ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const openDoors = doorStates.filter((s) => s.toLowerCase().includes('open'));
  const windows = [
    { label: 'FD', val: data.fd_window },
    { label: 'FP', val: data.fp_window },
    { label: 'RD', val: data.rd_window },
    { label: 'RP', val: data.rp_window },
  ];
  const openWindows = windows.filter((w) => w.val && w.val.toLowerCase() !== 'closed');

  return (
    <GlassPanel hover glow="green" className="p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-3">
        <Shield className="h-3.5 w-3.5 text-emerald-300" /> {t('telemetry.security', 'Security')}
      </h4>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-secondary)]">{t('telemetry.lock', 'Lock')}</span>
          <span className={`text-sm font-bold flex items-center gap-1 ${data.locked ? 'text-emerald-300' : 'text-rose-300'}`}>
            {data.locked ? '🔒' : '🔓'} {data.locked ? t('telemetry.locked', 'Locked') : t('telemetry.unlocked', 'Unlocked')}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-secondary)]">{t('telemetry.sentry', 'Sentry')}</span>
          <span className={`text-sm font-bold flex items-center gap-1 ${data.sentry_mode ? 'text-cyan-300' : 'text-[var(--text-muted)]'}`}>
            🛡️ {data.sentry_mode ? t('telemetry.active', 'Active') : t('telemetry.off', 'Off')}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-secondary)]">{t('telemetry.doors', 'Doors')}</span>
          <Badge variant={openDoors.length === 0 ? 'success' : 'warning'}>
            {openDoors.length === 0 ? t('telemetry.allClosed', 'All Closed') : `${openDoors.length} ${t('telemetry.open', 'Open')}`}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-secondary)]">{t('telemetry.windows', 'Windows')}</span>
          <Badge variant={openWindows.length === 0 ? 'success' : 'warning'}>
            {openWindows.length === 0 ? t('telemetry.allClosed', 'All Closed') : `${openWindows.length} ${t('telemetry.open', 'Open')}`}
          </Badge>
        </div>
      </div>
    </GlassPanel>
  );
}

/* ———— Tire Pressure Panel ———— */
function TirePressurePanel({ data, toPressureDisplay, pressureUnit }: {
  data: TirePressureData | undefined; toPressureDisplay: (bar: number) => number; pressureUnit: string;
}) {
  const { t } = useTranslation('dashboard');

  if (!data) {
    return (
      <GlassPanel hover glow="cyan" className="p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-3">
          <CircleDot className="h-3.5 w-3.5 text-cyan-300" /> {t('telemetry.tirePressure', 'Tire Pressure')}
        </h4>
        <SkeletonRows />
      </GlassPanel>
    );
  }

  const tires = [
    { label: 'FL', value: data.front_left },
    { label: 'FR', value: data.front_right },
    { label: 'RL', value: data.rear_left },
    { label: 'RR', value: data.rear_right },
  ];

  const getPressureColor = (bar: number | null) => {
    if (bar == null) return 'text-[var(--text-muted)]';
    if (bar < 2.068 || bar > 3.103) return 'text-rose-300';
    if (bar < 2.275 || bar > 2.896) return 'text-amber-300';
    return 'text-emerald-300';
  };

  const allNormal = tires.every((tire) => {
    if (tire.value == null) return true;
    return tire.value >= 2.275 && tire.value <= 2.896;
  });

  return (
    <GlassPanel hover glow="cyan" className="p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-3">
        <CircleDot className="h-3.5 w-3.5 text-cyan-300" /> {t('telemetry.tirePressure', 'Tire Pressure')}
      </h4>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {tires.map((tire) => (
            <div key={tire.label} className="text-center p-2 rounded-lg bg-white/[0.03] border border-white/[0.04]">
              <p className="text-2xs text-[var(--text-muted)] uppercase">{tire.label}</p>
              <p className={`text-sm font-bold ${getPressureColor(tire.value)}`}>
                {tire.value != null ? fmtNumber(toPressureDisplay(tire.value), 1) : '—'}
              </p>
              <p className="text-2xs text-[var(--text-muted)]">{pressureUnit}</p>
            </div>
          ))}
        </div>
        <div className="text-center">
          <Badge variant={allNormal ? 'success' : 'warning'}>
            <ShieldCheck className="h-2.5 w-2.5" />
            {allNormal ? t('telemetry.allNormal', 'All Normal') : t('telemetry.warning', 'Warning')}
          </Badge>
        </div>
      </div>
    </GlassPanel>
  );
}

/* ———— Media Panel ———— */
function MediaPanel({ data }: { data: MediaData | undefined }) {
  const { t } = useTranslation('dashboard');
  const volume = data?.audio_volume;
  const volumeMax = data?.audio_volume_max;
  const volumePct = volume != null && volumeMax ? clampPct((volume / volumeMax) * 100) : 0;
  return (
    <GlassPanel hover glow="purple" className="p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-3">
        <Headphones className="h-3.5 w-3.5 text-purple-300" /> {t('telemetry.media', 'Media')}
      </h4>
      {data ? (
        <div className="space-y-2.5">
          <div>
            <p className="text-sm font-bold text-[var(--text-primary)] truncate">
              {cleanNil(data.now_playing_title) || '—'}
            </p>
            <p className="text-xs text-[var(--text-secondary)] truncate">
              {cleanNil(data.now_playing_artist) || t('telemetry.unknownArtist', 'Unknown artist')}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">{t('telemetry.status', 'Status')}</span>
            <Badge variant={cleanNil(data.playback_status) === 'Playing' ? 'success' : cleanNil(data.playback_status) === 'Paused' ? 'warning' : 'neutral'}>
              {cleanNil(data.playback_status) ?? '—'}
            </Badge>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--text-secondary)]">{t('telemetry.volume', 'Volume')}</span>
              <span className="text-2xs text-[var(--text-muted)]">
                {data.audio_volume != null ? `${data.audio_volume}` : '—'}
                {data.audio_volume_max != null ? `/${data.audio_volume_max}` : ''}
              </span>
            </div>
            <div
              className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden"
              role="progressbar"
              aria-label={t('telemetry.volume', 'Volume')}
              aria-valuenow={data.audio_volume ?? 0}
              aria-valuemin={0}
              aria-valuemax={data.audio_volume_max ?? 0}
            >
              <div
                className="h-full rounded-full transition-all duration-slow"
                style={{
                  width: `${volumePct}%`,
                  background: 'linear-gradient(90deg, #a855f7, #00f0ff)',
                }}
              />
            </div>
          </div>
        </div>
      ) : <SkeletonRows />}
    </GlassPanel>
  );
}

/* ———— Navigation Panel ———— */
function NavigationPanel({ data, toDistanceDisplay, distanceUnit }: {
  data: LocationData | undefined; toDistanceDisplay: (km: number) => number; distanceUnit: string;
}) {
  const { t } = useTranslation('dashboard');
  return (
    <GlassPanel hover glow="cyan" className="p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-3">
        <Navigation2 className="h-3.5 w-3.5 text-cyan-300" /> {t('telemetry.navigation', 'Navigation')}
      </h4>
      {data ? (
        <div className="space-y-2.5">
          <TelemetryRow label={t('telemetry.destination', 'Destination')} value={data.destination_name || '—'} />
          <TelemetryRow
            label={t('telemetry.distance', 'Distance')}
            value={data.miles_to_arrival != null
              ? `${fmtNumber(toDistanceDisplay(data.miles_to_arrival), 1)} ${distanceUnit}`
              : '—'}
          />
          <TelemetryRow
            label={t('telemetry.eta', 'ETA')}
            value={data.minutes_to_arrival != null ? `${fmtInt(data.minutes_to_arrival)} min` : '—'}
          />
          <div className="flex items-center gap-2 flex-wrap">
            {data.located_at_home && (
              <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">
                🏠 {t('telemetry.home', 'Home')}
              </span>
            )}
            {data.located_at_work && (
              <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                🏢 {t('telemetry.work', 'Work')}
              </span>
            )}
            {data.located_at_favorite && (
              <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
                ⭐ {t('telemetry.favorite', 'Favorite')}
              </span>
            )}
            {!data.located_at_home && !data.located_at_work && !data.located_at_favorite && (
              <span className="text-2xs text-[var(--text-muted)]">{t('telemetry.noSavedLocation', 'No saved location')}</span>
            )}
          </div>
        </div>
      ) : <SkeletonRows />}
    </GlassPanel>
  );
}

/* ———— Shared helpers ———— */
function TelemetryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <span className="text-sm font-bold text-[var(--text-primary)] truncate max-w-[120px]">{value}</span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2.5">
      {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-5" />)}
    </div>
  );
}
