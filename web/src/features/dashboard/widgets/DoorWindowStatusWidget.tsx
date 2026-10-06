import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DoorOpen } from 'lucide-react';
import { Badge, Subhead } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useVehicles, useSecurityLatest } from '@/api/hooks/useVehicles';
import { asNonEmptyString } from '@/lib/typeGuards';
import { WidgetStatusGrid, type StatusCell } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

// Exported for direct unit testing of the parse/label branches; the component
// remains the module's default export and its behaviour is unchanged.
export type DoorWindowState = 'closed' | 'open' | 'partial' | 'unknown';

export function toGridStatus(state: DoorWindowState): StatusCell['status'] {
  if (state === 'closed') return 'ok';
  if (state === 'open' || state === 'partial') return 'warning';
  return 'unknown';
}

export function toValueLabel(state: DoorWindowState, t: (key: string, fallback: string) => string): string {
  if (state === 'closed') return t('widget.doorWindow.closed', 'Closed');
  if (state === 'open') return t('widget.doorWindow.open', 'Open');
  if (state === 'partial') return t('widget.doorWindow.partial', 'Partial');
  return '—';
}

export function parseWindowState(val: unknown): DoorWindowState {
  // Backend may emit window state as a native boolean.
  if (typeof val === 'boolean') return val ? 'open' : 'closed';
  const raw = asNonEmptyString(val);
  if (!raw) return 'unknown';
  // Tesla's WindowState enum arrives as (optionally "WindowState"-prefixed)
  // "Closed" | "PartiallyOpen" | "Opened" | "Unknown", with a legacy "0"
  // sentinel meaning closed. Match defensively so an "Unknown" (or a prefixed
  // "WindowStateClosed") value is never mis-reported as an open window — the
  // old `=== 'closed'` / fall-through-to-'open' logic flagged both as open.
  const lower = raw.toLowerCase().replace(/windowstate/g, '');
  if (lower.includes('closed') || lower === '0') return 'closed';
  if (lower.includes('vent') || lower.includes('partial')) return 'partial';
  if (lower.includes('open')) return 'open';
  return 'unknown';
}

export function parseDoorStates(doorState: unknown): Record<string, DoorWindowState> {
  const result: Record<string, DoorWindowState> = {
    fl: 'unknown',
    fr: 'unknown',
    rl: 'unknown',
    rr: 'unknown',
  };
  // Backend may emit DoorState as a native boolean.
  if (typeof doorState === 'boolean') {
    return doorState
      ? { fl: 'open', fr: 'open', rl: 'open', rr: 'open' }
      : { fl: 'closed', fr: 'closed', rl: 'closed', rr: 'closed' };
  }
  const raw = asNonEmptyString(doorState);
  if (!raw) return result;

  const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

  const hasAllClosed = parts.some((p) => p === 'all_closed' || p === 'allclosed' || p === 'closed');
  if (hasAllClosed) {
    return { fl: 'closed', fr: 'closed', rl: 'closed', rr: 'closed' };
  }

  // A list of open doors is exhaustive; an unknown enum is not such a list.
  if (parts.some((part) => part.includes('open'))) {
    result.fl = 'closed';
    result.fr = 'closed';
    result.rl = 'closed';
    result.rr = 'closed';
  }

  for (const part of parts) {
    if (part.includes('driver') && part.includes('front') && part.includes('open')) result.fl = 'open';
    else if (part.includes('passenger') && part.includes('front') && part.includes('open')) result.fr = 'open';
    else if (part.includes('driver') && part.includes('rear') && part.includes('open')) result.rl = 'open';
    else if (part.includes('passenger') && part.includes('rear') && part.includes('open')) result.rr = 'open';
    else if (part.includes('front') && part.includes('left') && part.includes('open')) result.fl = 'open';
    else if (part.includes('front') && part.includes('right') && part.includes('open')) result.fr = 'open';
    else if (part.includes('rear') && part.includes('left') && part.includes('open')) result.rl = 'open';
    else if (part.includes('rear') && part.includes('right') && part.includes('open')) result.rr = 'open';
    else if (part === 'open') {
      result.fl = 'open';
      result.fr = 'open';
      result.rl = 'open';
      result.rr = 'open';
    }
  }

  return result;
}

export default function DoorWindowStatusWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehicleQuery = useVehicles();
  const { data: vehicles } = vehicleQuery;
  const vehicleState = useDataState(vehicleQuery);
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useSecurityLatest(id, 5_000);
  const { data: securityData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const state = useDataState(query, { provenance: 'live' });
  const displayState = id === 0 && (vehicleState.fatalError || vehicleQuery.isLoading) ? vehicleState : state;

  const isCompact = size.cols === 1 && size.rows === 1;
  const isTall = size.rows >= 2;

  const doors = useMemo(() => parseDoorStates(securityData?.door_state), [securityData?.door_state]);

  const windows = useMemo<Record<string, DoorWindowState>>(() => ({
    fl: parseWindowState(securityData?.fd_window),
    fr: parseWindowState(securityData?.fp_window),
    rl: parseWindowState(securityData?.rd_window),
    rr: parseWindowState(securityData?.rp_window),
  }), [securityData?.fd_window, securityData?.fp_window, securityData?.rd_window, securityData?.rp_window]);

  const openDoorCount = Object.values(doors).filter((s) => s === 'open').length;
  const openWindowCount = Object.values(windows).filter((s) => s !== 'closed' && s !== 'unknown').length;
  const doorsKnown = Object.values(doors).every((s) => s !== 'unknown');
  const windowsKnown = Object.values(windows).every((s) => s !== 'unknown');

  const doorCells = useMemo<StatusCell[]>(() => {
    const positions = ['fl', 'fr', 'rl', 'rr'] as const;
    const labels: Record<string, string> = {
      fl: t('widget.doorWindow.fl', 'Front left'),
      fr: t('widget.doorWindow.fr', 'Front right'),
      rl: t('widget.doorWindow.rl', 'Rear left'),
      rr: t('widget.doorWindow.rr', 'Rear right'),
    };
    return positions.map((pos) => ({
      id: `door-${pos}`,
      label: labels[pos],
      status: toGridStatus(doors[pos]),
      value: toValueLabel(doors[pos], t),
    }));
  }, [doors, t]);

  const windowCells = useMemo<StatusCell[]>(() => {
    const positions = ['fl', 'fr', 'rl', 'rr'] as const;
    const labels: Record<string, string> = {
      fl: t('widget.doorWindow.fl', 'Front left'),
      fr: t('widget.doorWindow.fr', 'Front right'),
      rl: t('widget.doorWindow.rl', 'Rear left'),
      rr: t('widget.doorWindow.rr', 'Rear right'),
    };
    return positions.map((pos) => ({
      id: `window-${pos}`,
      label: labels[pos],
      status: toGridStatus(windows[pos]),
      value: toValueLabel(windows[pos], t),
    }));
  }, [windows, t]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.doorWindow.title', 'Door & window status')}
      icon={<DoorOpen className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={isLoading}
      dataState={{ ...displayState, status: displayState.status === 'initial' && !isLoading && !vehicleQuery.isLoading ? 'unavailable' : displayState.status }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => { if (id > 0) void refetch(); else void vehicleQuery.refetch(); }}
    >
      {securityData ? (
        isCompact ? (
          <div className="flex min-w-0 flex-col items-start justify-center h-full gap-2">
            <Badge variant={openDoorCount > 0 ? 'warning' : doorsKnown ? 'success' : 'neutral'} size="sm">
              {openDoorCount === 0 && !doorsKnown
                ? t('widget.doorWindow.doorsUnknown', 'Doors unknown')
                : openDoorCount === 0
                ? t('widget.doorWindow.doorsAllClosed', 'Doors ✓')
                : `${openDoorCount} ${t('widget.doorWindow.doorsOpen', 'door(s) open')}`}
            </Badge>
            <Badge variant={openWindowCount > 0 ? 'warning' : windowsKnown ? 'success' : 'neutral'} size="sm">
              {openWindowCount === 0 && !windowsKnown
                ? t('widget.doorWindow.windowsUnknown', 'Windows unknown')
                : openWindowCount === 0
                ? t('widget.doorWindow.windowsAllClosed', 'Windows ✓')
                : `${openWindowCount} ${t('widget.doorWindow.windowsOpen', 'window(s) open')}`}
            </Badge>
          </div>
        ) : (
          <div className={isTall ? 'space-y-4' : 'space-y-2'}>
            <div>
              <Subhead className="mb-1.5 break-words">
                {t('widget.doorWindow.doors', 'Doors')}
              </Subhead>
              <WidgetStatusGrid cells={doorCells} cols={2} />
            </div>
            <div>
              <Subhead className="mb-1.5 break-words">
                {t('widget.doorWindow.windows', 'Windows')}
              </Subhead>
              <WidgetStatusGrid cells={windowCells} cols={2} />
            </div>
          </div>
        )
      ) : (
        <WidgetStatusGrid
          cells={[]}
          emptyIcon={<DoorOpen className="h-5 w-5" />}
          emptyMessage={t('widget.doorWindow.noData', 'No door/window data')}
        />
      )}
    </WidgetShell>
  );
}
