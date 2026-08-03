import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ParkingCircle, Moon, Timer, MapPin } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip, DataTable, type Column } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import { summarizeParking, type LocationDwell } from '../lib/parkingDwell';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export default function ParkingAnalyticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('parking.title', 'Parking Analytics'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { start, end, setRange } = useRangeState({
    persistKey: 'parking-analytics.range',
    defaultPresetId: '30d',
  });

  const drivesQuery = useDrives(vehicleIdStr);
  const allDrives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const drives = useMemo<Drive[]>(() => {
    if (!allDrives.length) return [];
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter((d) => {
      if (!d.startTs) return false;
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allDrives, start, end]);

  // The trailing stint runs to "now", but never past the picked window's end
  // so historic ranges stay historic. Recomputed with the query, which is
  // fresh enough for dwell math — no ticking clock needed.
  const summary = useMemo(() => {
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return summarizeParking(drives, Math.min(Date.now(), endMs));
  }, [drives, end]);

  /** "3d 7h" / "5h" / "12m" humanized duration. */
  const fmtDwell = useMemo(
    () => (ms: number): string => {
      const days = Math.floor(ms / DAY_MS);
      const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
      if (days > 0) return t('parking.durationDh', '{{d}}d {{h}}h', { d: days, h: hours });
      if (hours > 0) return t('parking.durationH', '{{h}}h', { h: hours });
      return t('parking.durationM', '{{m}}m', { m: Math.max(1, Math.floor(ms / 60_000)) });
    },
    [t],
  );

  const ongoing = summary.stints.find((s) => s.ongoing);

  const columns = useMemo<Column<LocationDwell>[]>(() => [
    {
      key: 'location',
      header: t('parking.location', 'Location'),
      render: (r) => (
        <span className="flex items-center gap-2">
          <Text variant="bodySm" className="block max-w-[16rem] truncate" title={r.location ?? undefined}>
            {r.location ?? t('parking.unknown', 'Unknown location')}
          </Text>
          {ongoing != null && ongoing.location === r.location && (
            <Badge variant="info">{t('parking.now', 'now')}</Badge>
          )}
        </span>
      ),
    },
    {
      key: 'stints',
      header: t('parking.stints', 'Stints'),
      align: 'right',
      sortable: true,
      render: (r) => <Text variant="body" className="font-mono tabular-nums">{r.stints}</Text>,
    },
    {
      key: 'totalMs',
      header: t('parking.dwell', 'Time Parked'),
      align: 'right',
      sortable: true,
      render: (r) => <Text variant="body" className="font-mono tabular-nums">{fmtDwell(r.totalMs)}</Text>,
    },
    {
      key: 'share',
      header: t('parking.share', 'Share'),
      align: 'right',
      sortable: true,
      render: (r) => (
        <span className="flex items-center justify-end gap-2">
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--surface-2)]" aria-hidden="true">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.round(r.share * 100)}%`, background: chartTokens.series[5] }}
            />
          </span>
          <Text variant="body" className="font-mono tabular-nums">{Math.round(r.share * 100)}%</Text>
        </span>
      ),
    },
  ], [t, fmtDwell, ongoing]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('parking.title', 'Parking Analytics')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('parking.title', 'Parking Analytics')}
      subtitle={t('parking.subtitle', 'Where your car spends its time between drives')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="parking-analytics-range"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('parking.kpis', 'Parking summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('parking.parkedShare', 'Time Parked')}
                value={summary.parkedShare != null ? `${Math.round(summary.parkedShare * 100)}%` : '—'}
                subtitle={t('parking.vsDriving', 'vs time driving')}
                icon={<ParkingCircle className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('parking.nightShare', 'Overnight Share')}
                value={summary.nightShare != null ? `${Math.round(summary.nightShare * 100)}%` : '—'}
                subtitle={t('parking.nightWindow', '22:00–06:00')}
                icon={<Moon className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('parking.longestStint', 'Longest Stint')}
                value={summary.longestStint ? fmtDwell(summary.longestStint.durationMs) : '—'}
                subtitle={summary.longestStint?.location ?? undefined}
                icon={<Timer className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('parking.locations', 'Locations')}
                value={summary.locations.length}
                subtitle={t('parking.stintCount', '{{count}} stints', { count: summary.stints.length })}
                icon={<MapPin className="h-5 w-5" />}
                color="green"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Top locations */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('parking.topLocations', 'Where It Sits')}
            <HelpTooltip
              size="sm"
              i18nKey="help.parkingAnalytics.body"
              defaultValue="Parking stints are reconstructed from the gaps between consecutive drives, located at the previous drive's destination. The overnight share counts parked time falling between 22:00 and 06:00 local."
              ariaLabel={t('help.parkingAnalytics.iconLabel', 'More info about parking analytics')}
            />
          </PanelTitle>
          {isError ? (
            <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
          ) : isLoading ? (
            <Skeleton height={280} />
          ) : summary.locations.length === 0 ? (
            <EmptyState
              icon={<ParkingCircle className="h-8 w-8" />}
              message={t('parking.noData', 'Not enough drives in this period to reconstruct parking.')}
              actionTo={{ label: t('parking.browseDrives', 'Browse drives'), to: '/drives' }}
            />
          ) : (
            <DataTable
              tableId="vehicles:parking-locations"
              columns={columns}
              data={summary.locations}
              keyExtractor={(r) => r.location ?? '∅'}
              emptyMessage={t('parking.noData', 'Not enough drives in this period to reconstruct parking.')}
              pagination
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
