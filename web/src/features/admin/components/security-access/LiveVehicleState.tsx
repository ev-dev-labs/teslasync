import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
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
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import type { SecurityEvent } from '@/types/admin';
import { asNonEmptyString } from '@/lib/typeGuards';

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
      icon: <Flashlight className="h-4 w-4" />,
      value: boolLabel(ev.lightsHazardsActive, t),
      active: !!ev.lightsHazardsActive,
    },
    {
      key: 'highBeams',
      label: t('admin.security.live.highBeams', 'High Beams'),
      icon: <Lightbulb className="h-4 w-4" />,
      value: boolLabel(ev.lightsHighBeams, t),
      active: !!ev.lightsHighBeams,
    },
    {
      key: 'turnSignal',
      label: t('admin.security.live.turnSignal', 'Turn Signal'),
      icon: <Signal className="h-4 w-4" />,
      value: asNonEmptyString(ev.lightsTurnSignal) ?? '—',
      active: (() => {
        const s = asNonEmptyString(ev.lightsTurnSignal);
        return !!s && !s.toLowerCase().includes('off');
      })(),
    },
    {
      key: 'driverSeat',
      label: t('admin.security.live.driverSeat', 'Driver Seat'),
      icon: <Armchair className="h-4 w-4" />,
      value: ev.driverSeatOccupied == null ? '—' : ev.driverSeatOccupied ? t('admin.security.live.occupied', 'Occupied') : t('admin.security.live.empty', 'Empty'),
      active: !!ev.driverSeatOccupied,
    },
    {
      key: 'pairedKeys',
      label: t('admin.security.live.pairedKeys', 'Paired Keys'),
      icon: <Key className="h-4 w-4" />,
      value: ev.pairedPhoneKeyCount != null ? String(ev.pairedPhoneKeyCount) : '—',
      active: (ev.pairedPhoneKeyCount ?? 0) > 0,
    },
    {
      key: 'valetMode',
      label: t('admin.security.live.valetMode', 'Valet Mode'),
      icon: <Car className="h-4 w-4" />,
      value: boolLabel(ev.valetModeEnabled, t),
      active: !!ev.valetModeEnabled,
    },
    {
      key: 'serviceMode',
      label: t('admin.security.live.serviceMode', 'Service Mode'),
      icon: <Wrench className="h-4 w-4" />,
      value: boolLabel(ev.serviceMode, t),
      active: !!ev.serviceMode,
    },
    {
      key: 'speedLimit',
      label: t('admin.security.live.speedLimit', 'Speed Limit'),
      icon: <Gauge className="h-4 w-4" />,
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
      icon: <Home className="h-4 w-4" />,
      value: ev.homelinkDeviceCount != null ? String(ev.homelinkDeviceCount) : '—',
      active: (ev.homelinkDeviceCount ?? 0) > 0,
    },
    {
      key: 'centerDisplay',
      label: t('admin.security.live.centerDisplay', 'Center Display'),
      icon: <Monitor className="h-4 w-4" />,
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
}

export function LiveVehicleState({ latest }: LiveVehicleStateProps) {
  const { t } = useTranslation();
  const liveSignals = useMemo(() => buildLiveSignals(latest, t), [latest, t]);

  return (
    <FadeIn delay={0.17}>
      <GlassPanel className="p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-200">
            {t('admin.security.liveState', 'Live Vehicle State')}
          </h2>
          {latest && (
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <CircleDot className="h-3 w-3 animate-pulse" />
              {t('admin.security.live.indicator', 'Live')}
            </span>
          )}
        </div>
        {liveSignals.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {liveSignals.map((sig) => (
              <GlassPanel key={sig.key} className="p-3" hover>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={cn(sig.active ? 'text-cyan-400' : 'text-[var(--text-muted)]')}>
                    {sig.icon}
                  </span>
                  <span className="text-[10px] font-medium text-[var(--text-muted)] truncate">
                    {sig.label}
                  </span>
                </div>
                <span
                  className={cn(
                    'text-sm font-semibold block truncate',
                    sig.active ? 'text-white' : 'text-[var(--text-muted)]',
                  )}
                >
                  {sig.value}
                </span>
              </GlassPanel>
            ))}
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('admin.security.live.noData', 'No live state data available')} />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
