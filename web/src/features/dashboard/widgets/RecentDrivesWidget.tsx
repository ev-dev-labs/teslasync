import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Route, ArrowUpRight, ArrowRight } from 'lucide-react';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';

import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDateLabels } from '@/hooks/useDateLabels';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { WidgetDetailCard, type DetailEntry } from './shared';
import { WidgetShell } from './WidgetShell';
import { IconButton } from '@/components/ui/IconButton';
import type { WidgetProps } from './types';
import type { Drive } from '../types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function RecentDrivesWidget({ vehicleId }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const { formatTime } = useDateFormat();
  const { formatRelativeDays, formatWeekdayName } = useDateLabels();

  const { data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['drives', id, 'recent-5'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}&limit=5`),
    enabled: id > 0,
  });

  const driveList = safeArray(drives);

  const entries: DetailEntry[] = driveList.map((drive) => {
    const distance = knownNumber(drive.distance_m);
    const duration = knownNumber(drive.duration_s);
    const energy = knownNumber(drive.energy_used_wh);
    const distDisplay = distance == null ? null : convertDistanceFromSI(distance, unitPrefs.distance);

    const start = drive.start_address?.trim();
    const end = drive.end_address?.trim();
    const routeLabel = start || end
      ? `${start || '—'} → ${end || '—'}`
      : t('widget.recentDrivesListDrive', 'Drive');

    const day = formatRelativeDays(drive.start_ts);
    const dateLabel = day === 'Today' || day === 'Yesterday'
      ? `${day} ${formatTime(drive.start_ts)}`
      : `${formatWeekdayName(drive.start_ts)} ${formatTime(drive.start_ts)}`;
    const durationLabel = duration == null
      ? '—'
      : `${fmtInt(duration / 60)} ${t('widget.recentDrivesDurationUnit', 'min')}`;

    const efficiencyLabel = energy != null && distDisplay != null && distDisplay > 0
      ? `${fmtInt(energy / distDisplay)} Wh/${unitPrefs.distance}`
      : undefined;

    return {
      id: drive.id,
      label: routeLabel,
      sublabel: `${dateLabel} · ${durationLabel}`,
      value: distDisplay == null ? '—' : `${fmtNumber(distDisplay, 1)} ${unitPrefs.distance}`,
      hint: efficiencyLabel,
    };
  });

  const hasKnownDistance = driveList.some((drive) => knownNumber(drive.distance_m) != null);
  const totalDistanceM = driveList.reduce(
    (sum, drive) => sum + (knownNumber(drive.distance_m) ?? 0),
    0,
  );
  const footerTotal = hasKnownDistance
    ? `${fmtNumber(convertDistanceFromSI(totalDistanceM, unitPrefs.distance), 0)} ${unitPrefs.distance}`
    : '—';

  const trust = useDataState({
    data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  }, { provenance: 'historical' });

  return (
    <WidgetShell
      title={t('widget.recentDrives', 'Recent drives')}
      icon={<Route className="h-3.5 w-3.5" aria-hidden="true" />}
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
      footer={driveList.length > 0 ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 text-xs text-[var(--text-muted)]">
            {t('widget.recentDrivesWeekSummary', '{{count}} drives this week · {{total}}', {
              count: driveList.length,
              total: footerTotal,
            })}
          </span>
          <Link
            to="/drives"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline"
          >
            {t('widget.allDrives', 'All drives')}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      ) : undefined}
    >
      <WidgetDetailCard
        entries={entries}
        compact
        emptyIcon={<Route className="h-5 w-5" aria-hidden="true" />}
        emptyMessage={t('widget.noDrives', 'No recent drives')}
      />
    </WidgetShell>
  );
}
