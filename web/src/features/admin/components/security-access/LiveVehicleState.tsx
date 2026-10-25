import { Icons } from '@/lib/icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { DataProvenanceBadge } from '@/components/data-display';
import type { DataState } from '@/api/dataState';
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

/** True when a string-enum signal is present and not in an "off" state.
 *  Narrows to a non-empty string first so we never call `.toLowerCase()`
 *  on a boolean/number that slipped onto a `string`-typed signal field. */
function stringSignalActive(val: unknown): boolean {
  const s = asNonEmptyString(val);
  return !!s && !s.toLowerCase().includes('off');
}

/** Resolve a signal that may arrive as a native bool OR a string enum
 *  (e.g. SpeedLimitMode, CenterDisplay) into a display value + active flag.
 *  The backend serializes raw `signal.SignalValue`, so a field typed
 *  `string | boolean | null` can legitimately surface either shape; handling
 *  both keeps sibling tiles consistent instead of degrading a boolean to "—". */
function boolOrStringState(
  val: string | boolean | null | undefined,
  t: (k: string, fb: string) => string,
): { value: string; active: boolean } {
  if (typeof val === 'boolean') {
    return {
      value: val ? t('admin.security.on', 'On') : t('admin.security.off', 'Off'),
      active: val,
    };
  }
  return { value: asNonEmptyString(val) ?? '—', active: stringSignalActive(val) };
}

function buildLiveSignals(ev: SecurityEvent | undefined, t: (k: string, fb: string) => string): LiveSignal[] {
  if (!ev) return [];
  const speedLimit = boolOrStringState(ev.speedLimitMode, t);
  const centerDisplay = boolOrStringState(ev.centerDisplay, t);
  return [
    {
      key: 'hazards',
      label: t('admin.security.live.hazards', 'Hazards'),
      icon: <Icons.flashlight className="h-5 w-5" />,
      value: boolLabel(ev.lightsHazardsActive, t),
      active: !!ev.lightsHazardsActive,
    },
    {
      key: 'highBeams',
      label: t('admin.security.live.highBeams', 'High beams'),
      icon: <Icons.lightbulb className="h-5 w-5" />,
      value: boolLabel(ev.lightsHighBeams, t),
      active: !!ev.lightsHighBeams,
    },
    {
      key: 'turnSignal',
      label: t('admin.security.live.turnSignal', 'Turn signal'),
      icon: <Icons.signal className="h-5 w-5" />,
      value: asNonEmptyString(ev.lightsTurnSignal) ?? '—',
      active: stringSignalActive(ev.lightsTurnSignal),
    },
    {
      key: 'driverSeat',
      label: t('admin.security.live.driverSeat', 'Driver seat'),
      icon: <Icons.cabin className="h-5 w-5" />,
      value: ev.driverSeatOccupied == null ? '—' : ev.driverSeatOccupied ? t('admin.security.live.occupied', 'Occupied') : t('admin.security.live.empty', 'Empty'),
      active: !!ev.driverSeatOccupied,
    },
    {
      key: 'pairedKeys',
      label: t('admin.security.live.pairedKeys', 'Paired keys'),
      icon: <Icons.key className="h-5 w-5" />,
      value: ev.pairedPhoneKeyCount != null ? String(ev.pairedPhoneKeyCount) : '—',
      active: (ev.pairedPhoneKeyCount ?? 0) > 0,
    },
    {
      key: 'valetMode',
      label: t('admin.security.live.valetMode', 'Valet mode'),
      icon: <Icons.vehicle className="h-5 w-5" />,
      value: boolLabel(ev.valetModeEnabled, t),
      active: !!ev.valetModeEnabled,
    },
    {
      key: 'serviceMode',
      label: t('admin.security.live.serviceMode', 'Service mode'),
      icon: <Icons.maintenance className="h-5 w-5" />,
      value: boolLabel(ev.serviceMode, t),
      active: !!ev.serviceMode,
    },
    {
      key: 'speedLimit',
      label: t('admin.security.live.speedLimit', 'Speed limit'),
      icon: <Icons.speed className="h-5 w-5" />,
      value: speedLimit.value,
      active: speedLimit.active,
    },
    {
      key: 'homelinkDevices',
      label: t('admin.security.live.homelinkDevices', 'HomeLink devices'),
      icon: <Icons.home className="h-5 w-5" />,
      value: ev.homelinkDeviceCount != null ? String(ev.homelinkDeviceCount) : '—',
      active: (ev.homelinkDeviceCount ?? 0) > 0,
    },
    {
      key: 'centerDisplay',
      label: t('admin.security.live.centerDisplay', 'Center display'),
      icon: <Icons.monitor className="h-5 w-5" />,
      value: centerDisplay.value,
      active: centerDisplay.active,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface LiveVehicleStateProps {
  sourceState?: DataState<SecurityEvent>;
  latest: SecurityEvent | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function LiveVehicleState({ latest, sourceState, isLoading, error, onRetry, className }: LiveVehicleStateProps) {
  const { t } = useTranslation();
  const liveSignals = useMemo(() => buildLiveSignals(latest, t), [latest, t]);

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <PanelTitle>{t('admin.security.liveState', 'Live vehicle state')}</PanelTitle>
        <DataProvenanceBadge
          provenance={sourceState?.provenance ?? 'unknown'}
          status={sourceState?.status ?? 'initial'}
        />
      </div>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading && !latest ? (
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
              tone="muted"
              label={sig.label}
              value={sig.value}
            />
          ))}
        </div>
      ) : (
        // no-action: mirrors DigitalTwinPanel's 5s-poll latest-state query —
        // this panel self-heals once telemetry lands.
        <EmptyState
          icon={<Icons.tirePressure className="h-8 w-8" aria-hidden="true" />}
          message={t('admin.security.live.noData', 'No live state data available')}
        />
      )}
    </GlassPanel>
  );
}
