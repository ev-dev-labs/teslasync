import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Route, ArrowUpRight, MapPin, Clock, Battery } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { Caption, Text } from '@/components/ui';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import { formatDurationMinutes } from '@/lib/dateFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { isFiniteNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { useDataState } from '@/hooks/useDataState';
import type { WidgetProps } from './types';
import type { Drive } from '../types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/** Truncate a display address to `maxLen` chars with an ellipsis; "—" when absent. */
export function truncateAddress(addr: string | null | undefined, maxLen: number): string {
  if (!addr) return '—';
  return addr.length > maxLen ? `${addr.slice(0, maxLen)}…` : addr;
}

/**
 * Battery percentage consumed over a drive (start − end SOC). Returns null when
 * either reading is non-finite or the delta is non-positive: a drive that
 * gained charge (regen-dominant / bad data) or held flat has no meaningful
 * "used" figure, and a negative percentage would mislead the reader.
 */
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
  const { formatDateShort } = useDateFormat();

  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;
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
        <Link
          to="/drives"
          className="min-h-11 rounded-md text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] transition-colors flex items-center gap-1"
        >
          {t('widget.viewAll', 'View all')} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      }
    >
      {items.length > 0 ? (
        <ul className="space-y-1.5 overflow-y-auto h-full">
          {items.map((d) => {
            const distance = knownNumber(d.distance_m);
            const duration = knownNumber(d.duration_s);
            const dist = distance == null ? null : convertDistanceFromSI(distance, unitPrefs.distance);
            const distanceLabel = dist == null ? '—' : `${fmtNumber(dist)} ${unitPrefs.distance}`;
            const dateLabel = formatDateShort(d.start_ts);
            const batteryUsed = batteryUsedPct(d.start_soc_pct, d.end_soc_pct);

            return (
              <li key={d.id}>
                <Link
                  to={`/drives/${d.id}`}
                  aria-label={`${t('widget.recentDrivesList.drive', 'Drive')}: ${distanceLabel}, ${dateLabel}`}
                  className="block rounded-lg group focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"
                >
                  <div className="grid grid-cols-1 @xs:flex @xs:flex-wrap items-start gap-2 p-2 rounded-lg hover:bg-[var(--surface-hover)] transition-colors">
                    {/* Left column: distance + duration */}
                    <div className="flex-shrink-0 min-w-[4.5rem]">
                      <WidgetBigNumber
                        value={distanceLabel}
                        size="secondary"
                        animated={false}
                      />
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="h-2.5 w-2.5 text-[var(--text-muted)]" aria-hidden="true" />
                        <Caption className="tabular-nums">
                          {duration == null ? '—' : formatDurationMinutes(duration / 60, { subMinuteLabel: '<1m' })}
                        </Caption>
                      </div>
                    </div>

                    {/* Center column: addresses (only when wide enough) */}
                    {isWide && (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <MapPin className="h-2.5 w-2.5 text-emerald-400/60 flex-shrink-0" aria-hidden="true" />
                          <Text variant="bodySm" className="min-w-0 [overflow-wrap:anywhere]" title={d.start_address ?? undefined}>
                            {d.start_address || '—'}
                          </Text>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <MapPin className="h-2.5 w-2.5 text-red-400/60 flex-shrink-0" aria-hidden="true" />
                          <Text variant="bodySm" className="min-w-0 [overflow-wrap:anywhere]" title={d.end_address ?? undefined}>
                            {d.end_address || '—'}
                          </Text>
                        </div>
                      </div>
                    )}

                    {/* Right column: battery + date */}
                    <div className="min-w-0 @xs:ms-auto @xs:text-end">
                      <div className="flex items-center justify-end gap-1">
                        <Battery className="h-2.5 w-2.5 text-[var(--text-muted)]" aria-hidden="true" />
                        <Text variant="bodySm" className="tabular-nums">
                          {knownNumber(d.start_soc_pct) == null ? '?' : fmtNumber(d.start_soc_pct)}% → {knownNumber(d.end_soc_pct) == null ? '?' : fmtNumber(d.end_soc_pct)}%
                        </Text>
                      </div>
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        {batteryUsed != null && dist != null && dist > 0 && (
                          <Text variant="bodySm" className="text-cyan-300 tabular-nums">
                            {fmtNumber(batteryUsed)}%
                          </Text>
                        )}
                        <Caption className="tabular-nums">
                          {dateLabel}
                        </Caption>
                      </div>
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
