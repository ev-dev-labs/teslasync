import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Route, ArrowUpRight } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { Caption, Text } from '@/components/ui';
import { isFiniteNumber } from '@/lib/numberFormat';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import { formatDurationMinutes } from '@/lib/dateConvert';
import { convertDistanceFromSI, convertEfficiencyFromSI } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import { IconButton } from '@/components/ui/IconButton';
import { WidgetBigNumber } from './shared';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { useDataState } from '@/hooks/useDataState';
import type { WidgetProps } from './types';
import type { Drive } from '../types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateLabels } from '@/hooks/useDateLabels';
import { useDateFormat } from '@/hooks/useDateFormat';
import { dashboardTokens } from '../lib/dashboardTokens';

/** Truncate a display address to `maxLen` chars with an ellipsis; "—" when absent. */
export function truncateAddress(addr: string | null | undefined, maxLen: number): string {
  if (!addr) return '—';
  return addr.length > maxLen ? `${addr.slice(0, maxLen)}…` : addr;
}

export function batteryUsedPct(
  startSoc: number | null | undefined,
  endSoc: number | null | undefined,
): number | null {
  if (!isFiniteNumber(startSoc) || !isFiniteNumber(endSoc)) return null;
  const used = startSoc - endSoc;
  return used > 0 ? used : null;
}

export default function RecentDrivesListWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const { formatTime } = useDateFormat();
  const { formatRelativeDays, formatWeekdayName } = useDateLabels();

  const isTall = size.rows >= 2;
  const isWide = size.cols >= 3;
  const driveLimit = isWide ? 10 : isTall ? 7 : 5;

  const { data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['drives', id, `recent-list-${driveLimit}`],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}&limit=${driveLimit}`),
    enabled: id > 0,
  });

  const items = useMemo(() => safeArray(drives), [drives]);
  const trust = useDataState({
    data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  }, { provenance: 'historical' });

  return (
    <WidgetShell
      title={t('widget.recentDrivesList', 'Recent drives')}
      icon={<Route className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />}
      loading={isLoading}
      dataState={trust.hasData ? trust : undefined}
      error={trust.fatalError?.message ?? null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      actions={
        <IconButton href="/drives" icon={<ArrowUpRight className="h-4 w-4" aria-hidden="true" />}
          label={t('widget.viewAll', 'View all')} aria-label={t('widget.viewAll', 'View all')} />
      }
    >
      {items.length > 0 ? (
        <ul className="space-y-1.5 overflow-y-auto h-full">
          {items.map((d) => {
            const distance = knownNumber(d.distance_m);
            const duration = knownNumber(d.duration_s);
            const dist = distance == null ? null : convertDistanceFromSI(distance, unitPrefs.distance);
            const distanceLabel = dist == null ? '—' : `${fmtNumber(dist, 0)} ${unitPrefs.distance}`;
            const relativeDay = formatRelativeDays(d.start_ts);
            const dateLabel = relativeDay === 'Today' || relativeDay === 'Yesterday'
              ? `${relativeDay} ${formatTime(d.start_ts)}`
              : `${formatWeekdayName(d.start_ts)} ${formatTime(d.start_ts)}`;
            const durationLabel = duration == null
              ? null
              : duration < 60
                ? t('widget.recentDrivesSubMinute', '<1m')
                : formatDurationMinutes(duration / 60, { subMinuteLabel: '<1m' });
            const energy = knownNumber(d.energy_used_wh);
            const efficiencyWhPerKm = energy != null && distance != null && distance > 0
              ? energy / (distance / 1000)
              : null;
            const efficiencyLabel = efficiencyWhPerKm != null
              ? `${fmtNumber(convertEfficiencyFromSI(efficiencyWhPerKm, unitPrefs.distance), 0)} Wh/${unitPrefs.distance}`
              : null;
            const startAddress = d.start_address?.trim();
            const endAddress = d.end_address?.trim();
            const routeLabel = startAddress || endAddress
              ? `${startAddress || '—'} → ${endAddress || '—'}`
              : t('activity.timeline.item.drive', 'Drive');

            return (
              <li key={d.id}>
                <Link
                  to={`/drives/${d.id}`}
                  aria-label={`${t('widget.recentDrivesListDrive', 'Drive')}: ${distanceLabel}, ${dateLabel}`}
                  className="group block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"
                >
                  <div className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start ${dashboardTokens.density.rowGap} ${dashboardTokens.density.rowPadding} rounded-lg hover:bg-[var(--surface-hover)] ${dashboardTokens.motion.transition}`}>
                    <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--text-secondary)]" />
                    <div className="min-w-0">
                      <Text variant="bodySm" className="block min-w-0 font-medium [overflow-wrap:anywhere]">
                        {startAddress || endAddress ? `${startAddress || '—'} → ${endAddress || '—'}` : routeLabel}
                      </Text>
                      <Caption className="mt-0.5 block tabular-nums">
                        {[dateLabel, durationLabel].filter((value): value is string => value != null).join(' · ')}
                      </Caption>
                    </div>
                    <div className="text-end">
                      <WidgetBigNumber
                        value={distanceLabel}
                        size="secondary"
                        animated={false}
                      />
                      {efficiencyLabel && (
                        <Caption className="mt-0.5 block tabular-nums text-[var(--text-muted)]">
                          {efficiencyLabel}
                        </Caption>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Route className="h-5 w-5" aria-hidden="true" />}
          message={t('widget.noDrivesList', 'No recent drives recorded')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
