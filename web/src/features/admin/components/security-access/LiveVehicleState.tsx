import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Flashlight,
  Lightbulb,
  Signal,
  Armchair,
  Key,
  Car,
  Wrench,
  Gauge,
  Home,
  Monitor,
  CircleDot,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import type { SecurityEvent } from '@/types/admin';
import { asNonEmptyString } from '@/lib/typeGuards';
import { StatusTile } from './StatusTile';

/* ------------------------------------------------------------------ */
/*  Live signal builder (uses JSX icons — cannot live in helpers.ts)    */
/* ------------------------------------------------------------------ */

interface LiveSignal {
  key: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  active: boolean;
}

function boolLabel(val: boolean | null | undefined, t: (k: string, fb: string) => string): string {
  if (val == null) return '—';
  return val ? t('admin.security.on', 'On') : t('admin.security.off', 'Off');
}

function buildLiveSignals(ev: SecurityEvent | undefined, t: (k: string, fb: string) => string): LiveSignal[] {
  if (!ev) return [];
  return [
    {
      key: 'hazards',
      label: t('admin.security.live.hazards', 'Hazards'),
      icon: <Flashlight className="h-5 w-5" />,
      value: boolLabel(ev.lightsHazardsActive, t),
      active: !!ev.lightsHazardsActive,
    },
    {
      key: 'highBeams',
      label: t('admin.security.live.highBeams', 'High Beams'),
      icon: <Lightbulb className="h-5 w-5" />,
      value: boolLabel(ev.lightsHighBeams, t),
      active: !!ev.lightsHighBeams,
    },
    {
      key: 'turnSignal',
      label: t('admin.security.live.turnSignal', 'Turn Signal'),
      icon: <Signal className="h-5 w-5" />,
      value: asNonEmptyString(ev.lightsTurnSignal) ?? '—',
      active: (() => {
        const s = asNonEmptyString(ev.lightsTurnSignal);
        return !!s && !s.toLowerCase().includes('off');
      })(),
    },
    {
      key: 'driverSeat',
      label: t('admin.security.live.driverSeat', 'Driver Seat'),
      icon: <Armchair className="h-5 w-5" />,
      value: ev.driverSeatOccupied == null ? '—' : ev.driverSeatOccupied ? t('admin.security.live.occupied', 'Occupied') : t('admin.security.live.empty', 'Empty'),
      active: !!ev.driverSeatOccupied,
    },
    {
      key: 'pairedKeys',
      label: t('admin.security.live.pairedKeys', 'Paired Keys'),
      icon: <Key className="h-5 w-5" />,
      value: ev.pairedPhoneKeyCount != null ? String(ev.pairedPhoneKeyCount) : '—',
      active: (ev.pairedPhoneKeyCount ?? 0) > 0,
    },
    {
      key: 'valetMode',
      label: t('admin.security.live.valetMode', 'Valet Mode'),
      icon: <Car className="h-5 w-5" />,
      value: boolLabel(ev.valetModeEnabled, t),
      active: !!ev.valetModeEnabled,
    },
    {
      key: 'serviceMode',
      label: t('admin.security.live.serviceMode', 'Service Mode'),
      icon: <Wrench className="h-5 w-5" />,
      value: boolLabel(ev.serviceMode, t),
      active: !!ev.serviceMode,
    },
    {
      key: 'speedLimit',
      label: t('admin.security.live.speedLimit', 'Speed Limit'),
      icon: <Gauge className="h-5 w-5" />,
      value: typeof ev.speedLimitMode === 'boolean'
        ? (ev.speedLimitMode ? t('admin.security.on', 'On') : t('admin.security.off', 'Off'))
        : (asNonEmptyString(ev.speedLimitMode) ?? '—'),
      active: typeof ev.speedLimitMode === 'boolean'
        ? ev.speedLimitMode
        : (() => {
            const s = asNonEmptyString(ev.speedLimitMode);
            return !!s && !s.toLowerCase().includes('off');
          })(),
    },
    {
      key: 'homelinkDevices',
      label: t('admin.security.live.homelinkDevices', 'HomeLink Devices'),
      icon: <Home className="h-5 w-5" />,
      value: ev.homelinkDeviceCount != null ? String(ev.homelinkDeviceCount) : '—',
      active: (ev.homelinkDeviceCount ?? 0) > 0,
    },
    {
      key: 'centerDisplay',
      label: t('admin.security.live.centerDisplay', 'Center Display'),
      icon: <Monitor className="h-5 w-5" />,
      value: asNonEmptyString(ev.centerDisplay) ?? '—',
      active: (() => {
        const s = asNonEmptyString(ev.centerDisplay);
        return !!s && !s.toLowerCase().includes('off');
      })(),
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface LiveVehicleStateProps {
  latest: SecurityEvent | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function LiveVehicleState({ latest, isLoading, error, onRetry, className }: LiveVehicleStateProps) {
  const { t } = useTranslation();
  const liveSignals = useMemo(() => buildLiveSignals(latest, t), [latest, t]);

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <PanelTitle>{t('admin.security.liveState', 'Live Vehicle State')}</PanelTitle>
        {latest && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-neon-green/20 bg-neon-green/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
            <CircleDot className="h-3 w-3 animate-pulse" aria-hidden="true" />
            {t('admin.security.live.indicator', 'Live')}
          </span>
        )}
      </div>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} height={92} />
          ))}
        </div>
      ) : liveSignals.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
          {liveSignals.map((sig) => (
            <StatusTile
              key={sig.key}
              icon={sig.icon}
              tone={sig.active ? 'cyan' : 'muted'}
              label={sig.label}
              value={sig.value}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<CircleDot className="h-8 w-8" aria-hidden="true" />}
          message={t('admin.security.live.noData', 'No live state data available')}
        />
      )}
    </GlassPanel>
  );
}
