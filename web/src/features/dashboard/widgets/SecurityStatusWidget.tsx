import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Unlock, Shield, ShieldCheck, DoorOpen, AppWindow } from 'lucide-react';
import { useVehicles, useSecurityLatest } from '@/api/hooks/useVehicles';
import { asBoolean, asNonEmptyString } from '@/lib/typeGuards';
import { WidgetStatusGrid, type StatusCell } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const DASH = '—';

export default function SecurityStatusWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: securityData,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSecurityLatest(id, 5_000);

  // While no explicit vehicle is pinned and the vehicle list is still
  // resolving, the security query is disabled (id === 0) and returns no data.
  // Keep the skeleton up rather than flashing the empty state before the
  // default vehicle lands.
  const resolvingVehicle = vehicleId == null && vehiclesLoading;

  const cells = useMemo<StatusCell[]>(() => {
    if (!securityData) return [];

    const locked = asBoolean(securityData.locked);
    const sentry = asBoolean(securityData.sentry_mode);

    // ── Doors ─────────────────────────────────────────────────────────
    const doorRaw = securityData.door_state;
    const doorKnown = typeof doorRaw === 'boolean' || asNonEmptyString(doorRaw) != null;
    const doorStates = (asNonEmptyString(doorRaw) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // A native boolean `true` means at least one door reports open.
    const openDoors =
      doorRaw === true ? ['open'] : doorStates.filter((s) => s.toLowerCase().includes('open'));

    // ── Windows ───────────────────────────────────────────────────────
    const windowVals = [
      securityData.fd_window,
      securityData.fp_window,
      securityData.rd_window,
      securityData.rp_window,
    ];
    const windowsKnown = windowVals.some(
      (v) => typeof v === 'boolean' || asNonEmptyString(v) != null,
    );
    const openWindows = windowVals.filter((val) => {
      if (typeof val === 'boolean') return val;
      const s = asNonEmptyString(val);
      return !!s && s.toLowerCase() !== 'closed';
    });

    return [
      {
        id: 'lock',
        label: t('widget.lock', 'Lock'),
        status: locked == null ? 'unknown' : locked ? 'ok' : 'error',
        value:
          locked == null
            ? DASH
            : locked
              ? t('widget.locked', 'Locked')
              : t('widget.unlocked', 'Unlocked'),
        icon: locked
          ? <Lock className="h-3.5 w-3.5" />
          : <Unlock className="h-3.5 w-3.5" />,
      },
      {
        id: 'sentry',
        label: t('widget.sentry', 'Sentry'),
        status: sentry == null ? 'unknown' : sentry ? 'ok' : 'inactive',
        value:
          sentry == null
            ? DASH
            : sentry
              ? t('widget.active', 'Active')
              : t('widget.off', 'Off'),
        icon: sentry
          ? <ShieldCheck className="h-3.5 w-3.5" />
          : <Shield className="h-3.5 w-3.5" />,
      },
      {
        id: 'doors',
        label: t('widget.doors', 'Doors'),
        status: !doorKnown ? 'unknown' : openDoors.length === 0 ? 'ok' : 'warning',
        value: !doorKnown
          ? DASH
          : openDoors.length === 0
            ? t('widget.allClosed', 'All Closed')
            : `${openDoors.length} ${t('widget.open', 'Open')}`,
        icon: <DoorOpen className="h-3.5 w-3.5" />,
      },
      {
        id: 'windows',
        label: t('widget.windows', 'Windows'),
        status: !windowsKnown ? 'unknown' : openWindows.length === 0 ? 'ok' : 'warning',
        value: !windowsKnown
          ? DASH
          : openWindows.length === 0
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
      loading={isLoading || resolvingVehicle}
      error={error && !securityData ? String(error) : null}
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
