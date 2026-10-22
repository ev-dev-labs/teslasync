import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Unlock, Shield } from 'lucide-react';
import { useVehicles, useSecurityLatest } from '@/api/hooks/useVehicles';
import { asBoolean, asNonEmptyString } from '@/lib/typeGuards';
import { useDataState } from '@/hooks/useDataState';
import { EmptyState } from '@/components/feedback';
import { WidgetBigNumber, WidgetDetailCard, type DetailEntry } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const DASH = '—';

type TriState = 'ok' | 'warning' | 'error' | 'inactive' | 'unknown';

function toDetailStatus(status: TriState): DetailEntry['status'] {
  switch (status) {
    case 'ok':
      return 'success';
    case 'warning':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return 'neutral';
  }
}

export default function SecurityStatusWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useSecurityLatest(id, 5_000);
  const {
    data: securityData,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const trust = useDataState(query, { provenance: 'cached', maxAgeMs: 120_000 });

  // While no explicit vehicle is pinned and the vehicle list is still
  // resolving, the security query is disabled (id === 0) and returns no data.
  // Keep the skeleton up rather than flashing the empty state before the
  // default vehicle lands.
  const resolvingVehicle = vehicleId == null && vehiclesLoading;

  const model = useMemo(() => {
    if (!securityData) return null;

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

    const lockStatus: TriState = locked == null ? 'unknown' : locked ? 'ok' : 'error';
    const lockValue =
      locked == null ? DASH : locked ? t('widget.locked', 'Locked') : t('widget.unlocked', 'Unlocked');
    const sentryStatus: TriState = sentry == null ? 'unknown' : sentry ? 'ok' : 'inactive';
    const doorsStatus: TriState = !doorKnown ? 'unknown' : openDoors.length === 0 ? 'ok' : 'warning';
    const windowsStatus: TriState = !windowsKnown
      ? 'unknown'
      : openWindows.length === 0
        ? 'ok'
        : 'warning';

    const entries: DetailEntry[] = [
      {
        id: 'sentry',
        label: t('widget.sentry', 'Sentry'),
        status: toDetailStatus(sentryStatus),
        value:
          sentry == null ? DASH : sentry ? t('widget.active', 'Active') : t('widget.off', 'Off'),
      },
      {
        id: 'doors',
        label: t('widget.doors', 'Doors'),
        status: toDetailStatus(doorsStatus),
        value: !doorKnown
          ? DASH
          : openDoors.length === 0
            ? t('widget.allClosed', 'All closed')
            : `${openDoors.length} ${t('widget.open', 'Open')}`,
      },
      {
        id: 'windows',
        label: t('widget.windows', 'Windows'),
        status: toDetailStatus(windowsStatus),
        value: !windowsKnown
          ? DASH
          : openWindows.length === 0
            ? t('widget.allClosed', 'All closed')
            : `${openWindows.length} ${t('widget.open', 'Open')}`,
      },
    ];

    return { locked, lockStatus, lockValue, entries };
  }, [securityData, t]);

  const heroIcon =
    model == null || model.locked == null ? (
      <Shield className="h-6 w-6 text-[var(--text-muted)]" aria-hidden="true" />
    ) : model.locked ? (
      <Lock className="h-6 w-6 text-[var(--semantic-success)]" aria-hidden="true" />
    ) : (
      <Unlock className="h-6 w-6 text-[var(--semantic-danger)]" aria-hidden="true" />
    );

  return (
    <WidgetShell
      title={t('widget.security', 'Security')}
      icon={<Shield className="h-3.5 w-3.5 text-emerald-300" />}
      loading={isLoading || resolvingVehicle}
      dataState={securityData != null || isLoading || isError || error ? trust : undefined}
      error={trust.fatalError ? String(trust.fatalError) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {model ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <WidgetBigNumber value={model.lockValue} animated={false} />
            <span className="shrink-0">{heroIcon}</span>
          </div>
          <WidgetDetailCard entries={model.entries} />
        </div>
      ) : (
        <EmptyState
          /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Shield className="h-5 w-5" />}
          message={t('widget.noSecurity', 'No security data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
