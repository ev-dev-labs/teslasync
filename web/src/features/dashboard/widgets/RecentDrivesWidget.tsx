import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Route, ArrowUpRight } from 'lucide-react';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';

import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { WidgetEventFeed, type EventFeedItem } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Drive } from '../types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function RecentDrivesWidget({ vehicleId }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const { formatDateShort } = useDateFormat();

  const { data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['drives', id, 'recent-5'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}&limit=5`),
    enabled: id > 0,
  });

  const items: EventFeedItem[] = safeArray(drives).map((drive) => {
    const distance = knownNumber(drive.distance_m);
    const duration = knownNumber(drive.duration_s);
    const startSoc = knownNumber(drive.start_soc_pct);
    const endSoc = knownNumber(drive.end_soc_pct);
    return {
      id: drive.id,
      icon: <Route className="h-4 w-4" aria-hidden="true" />,
      title: distance == null ? '—' : `${fmtNumber(convertDistanceFromSI(distance, unitPrefs.distance))} ${unitPrefs.distance}`,
      subtitle: `${duration == null ? '—' : fmtNumber(duration / 60)} ${t('widget.recentDrives.durationUnit', 'min')} · ${startSoc == null ? '?' : fmtNumber(startSoc)}% → ${endSoc == null ? '?' : fmtNumber(endSoc)}% · ${formatDateShort(drive.start_ts)}`,
      timestamp: drive.start_ts,
      color: 'var(--accent-primary)',
      href: `/drives/${drive.id}`,
      wrap: true,
    };
  });
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
        <Link
          to="/drives"
          className="min-h-11 rounded-md text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] transition-colors flex items-center gap-1"
        >
          {t('widget.viewAll', 'View all')} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      }
    >
      <WidgetEventFeed
        items={items}
        maxItems={items.length}
        emptyIcon={<Route className="h-5 w-5" aria-hidden="true" />}
        emptyMessage={t('widget.noDrives', 'No recent drives')}
      />
    </WidgetShell>
  );
}
