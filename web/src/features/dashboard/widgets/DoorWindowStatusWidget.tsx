import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DoorOpen } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useSecurityLatest } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

interface ItemStatus {
  label: string;
  state: 'closed' | 'open' | 'partial' | 'unknown';
}

function statusVariant(state: ItemStatus['state']) {
  if (state === 'closed') return 'success' as const;
  if (state === 'open') return 'warning' as const;
  if (state === 'partial') return 'warning' as const;
  return 'neutral' as const;
}

function StatusItem({ label, state }: ItemStatus) {
  const { t } = useTranslation('dashboard');
  const labelMap: Record<ItemStatus['state'], string> = {
    closed: t('widget.doorWindow.closed', 'Closed'),
    open: t('widget.doorWindow.open', 'Open'),
    partial: t('widget.doorWindow.partial', 'Partial'),
    unknown: '—',
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-white/50 truncate">{label}</span>
      <Badge variant={statusVariant(state)} size="sm">
        {labelMap[state]}
      </Badge>
    </div>
  );
}

function parseWindowState(val: string | undefined | null): ItemStatus['state'] {
  if (val == null || val === '') return 'unknown';
  const lower = val.toLowerCase();
  if (lower === 'closed') return 'closed';
  if (lower.includes('vent') || lower.includes('partial')) return 'partial';
  return 'open';
}

function parseDoorStates(doorState: string | undefined | null): Record<string, ItemStatus['state']> {
  const result: Record<string, ItemStatus['state']> = {
    fl: 'unknown',
    fr: 'unknown',
    rl: 'unknown',
    rr: 'unknown',
  };
  if (!doorState) return result;

  const parts = doorState.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

  // If all doors are reported, assume closed unless explicitly marked open
  // Common formats: "DriverFrontOpen,PassengerFrontClosed,..."
  // or "all_closed" or individual door states
  const hasAllClosed = parts.some((p) => p === 'all_closed' || p === 'allclosed');
  if (hasAllClosed) {
    return { fl: 'closed', fr: 'closed', rl: 'closed', rr: 'closed' };
  }

  // Default to closed if we have any data, then override with open states
  if (parts.length > 0) {
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
    // Generic "open" without qualifier — mark all as open
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
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: securityData, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useSecurityLatest(id, 5_000);

  const isCompact = size.cols === 1 && size.rows === 1;
  const isTall = size.rows >= 2;

  const doors = useMemo(() => parseDoorStates(securityData?.door_state), [securityData?.door_state]);

  const windows = useMemo<Record<string, ItemStatus['state']>>(() => ({
    fl: parseWindowState(securityData?.fd_window),
    fr: parseWindowState(securityData?.fp_window),
    rl: parseWindowState(securityData?.rd_window),
    rr: parseWindowState(securityData?.rp_window),
  }), [securityData?.fd_window, securityData?.fp_window, securityData?.rd_window, securityData?.rp_window]);

  const openDoorCount = Object.values(doors).filter((s) => s === 'open').length;
  const openWindowCount = Object.values(windows).filter((s) => s !== 'closed' && s !== 'unknown').length;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.doorWindow.title', 'Door & Window Status')}
      icon={<DoorOpen className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {securityData ? (
        isCompact ? (
          /* Compact: summary counts only */
          <div className="flex flex-col items-center justify-center h-full gap-1">
            <Badge variant={openDoorCount === 0 ? 'success' : 'warning'} size="sm">
              {openDoorCount === 0
                ? t('widget.doorWindow.doorsAllClosed', 'Doors ✓')
                : `${openDoorCount} ${t('widget.doorWindow.doorsOpen', 'door(s) open')}`}
            </Badge>
            <Badge variant={openWindowCount === 0 ? 'success' : 'warning'} size="sm">
              {openWindowCount === 0
                ? t('widget.doorWindow.windowsAllClosed', 'Windows ✓')
                : `${openWindowCount} ${t('widget.doorWindow.windowsOpen', 'window(s) open')}`}
            </Badge>
          </div>
        ) : (
          /* Medium / Large: full grid of individual doors + windows */
          <div className={isTall ? 'space-y-4' : 'space-y-2'}>
            {/* Doors */}
            <div>
              <h4 className="text-[10px] font-medium text-white/30 uppercase tracking-wider mb-1.5">
                {t('widget.doorWindow.doors', 'Doors')}
              </h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <StatusItem label={t('widget.doorWindow.fl', 'Front Left')} state={doors.fl} />
                <StatusItem label={t('widget.doorWindow.fr', 'Front Right')} state={doors.fr} />
                <StatusItem label={t('widget.doorWindow.rl', 'Rear Left')} state={doors.rl} />
                <StatusItem label={t('widget.doorWindow.rr', 'Rear Right')} state={doors.rr} />
              </div>
            </div>

            {/* Windows */}
            <div>
              <h4 className="text-[10px] font-medium text-white/30 uppercase tracking-wider mb-1.5">
                {t('widget.doorWindow.windows', 'Windows')}
              </h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <StatusItem label={t('widget.doorWindow.fl', 'Front Left')} state={windows.fl} />
                <StatusItem label={t('widget.doorWindow.fr', 'Front Right')} state={windows.fr} />
                <StatusItem label={t('widget.doorWindow.rl', 'Rear Left')} state={windows.rl} />
                <StatusItem label={t('widget.doorWindow.rr', 'Rear Right')} state={windows.rr} />
              </div>
            </div>
          </div>
        )
      ) : (
        <EmptyState
          icon={<DoorOpen className="h-5 w-5" />}
          message={t('widget.doorWindow.noData', 'No door/window data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
