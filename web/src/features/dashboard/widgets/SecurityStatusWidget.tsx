import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Unlock, Shield, ShieldCheck, DoorOpen, AppWindow } from 'lucide-react';
import { useVehicles, useSecurityLatest } from '@/api/hooks/useVehicles';
import { asNonEmptyString } from '@/lib/typeGuards';
import { WidgetStatusGrid, type StatusCell } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function SecurityStatusWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: securityData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useSecurityLatest(id, 5_000);

  const cells = useMemo<StatusCell[]>(() => {
    if (!securityData) return [];

    const doorRaw = asNonEmptyString(securityData.door_state) ?? '';
    const doorStates = doorRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // If door_state arrived as native boolean true, treat as one open door.
    const doorBoolOpen = securityData.door_state === true;
    const openDoors = doorBoolOpen ? ['open'] : doorStates.filter((s) => s.toLowerCase().includes('open'));

    const windows = [
      { val: securityData.fd_window },
      { val: securityData.fp_window },
      { val: securityData.rd_window },
      { val: securityData.rp_window },
    ];
    const openWindows = windows.filter((w) => {
      if (typeof w.val === 'boolean') return w.val;
      const s = asNonEmptyString(w.val);
      return !!s && s.toLowerCase() !== 'closed';
    });

    return [
      {
        id: 'lock',
        label: t('widget.lock', 'Lock'),
        status: securityData.locked ? 'ok' : 'error',
        value: securityData.locked
          ? t('widget.locked', 'Locked')
          : t('widget.unlocked', 'Unlocked'),
        icon: securityData.locked
          ? <Lock className="h-3.5 w-3.5" />
          : <Unlock className="h-3.5 w-3.5" />,
      },
      {
        id: 'sentry',
        label: t('widget.sentry', 'Sentry'),
        status: securityData.sentry_mode ? 'ok' : 'inactive',
        value: securityData.sentry_mode
          ? t('widget.active', 'Active')
          : t('widget.off', 'Off'),
        icon: securityData.sentry_mode
          ? <ShieldCheck className="h-3.5 w-3.5" />
          : <Shield className="h-3.5 w-3.5" />,
      },
      {
        id: 'doors',
        label: t('widget.doors', 'Doors'),
        status: openDoors.length === 0 ? 'ok' : 'warning',
        value: openDoors.length === 0
          ? t('widget.allClosed', 'All Closed')
          : `${openDoors.length} ${t('widget.open', 'Open')}`,
        icon: <DoorOpen className="h-3.5 w-3.5" />,
      },
      {
        id: 'windows',
        label: t('widget.windows', 'Windows'),
        status: openWindows.length === 0 ? 'ok' : 'warning',
        value: openWindows.length === 0
          ? t('widget.allClosed', 'All Closed')
          : `${openWindows.length} ${t('widget.open', 'Open')}`,
        icon: <AppWindow className="h-3.5 w-3.5" />,
      },
    ];
  }, [securityData, t]);

  return (
    <WidgetShell
      title={t('widget.security', 'Security')}
      icon={<Shield className="h-3.5 w-3.5 text-neon-green" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <WidgetStatusGrid
        cells={cells}
        cols={2}
        emptyIcon={<Shield className="h-5 w-5" />}
        emptyMessage={t('widget.noSecurity', 'No security data')}
      />
    </WidgetShell>
  );
}
