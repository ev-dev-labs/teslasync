import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Wallet, Route, Clock3 } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, HelpTooltip } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard, MetricBar, KVList, type KVItem } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import { summarizeUtilization } from '../lib/utilization';

export default function UtilizationPage() {
  const { t } = useTranslation();
  usePageTitle(t('utilization.title', 'Utilization'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance, formatEnergy } = useUnits();
  const { formatCurrency, costPerKwh } = useFormatting();

  const { start, end, setRange } = useRangeState({
    persistKey: 'utilization.range',
    defaultPresetId: 'all',
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

  // Observation window ends at the range end (or now for open-ended ranges).
  const summary = useMemo(() => {
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return summarizeUtilization(drives, costPerKwh, Math.min(Date.now(), endMs));
  }, [drives, costPerKwh, end]);

  const costItems = useMemo<KVItem[]>(
    () => [
      {
        label: t('utilization.costPerDistance', 'Energy cost per distance'),
        value:
          summary.costPerKm != null
            ? `${formatCurrency(summary.costPerKm, 3)} / ${formatDistance(1000, { precision: 0 })}`
            : '—',
      },
      {
        label: t('utilization.costPerHour', 'Energy cost per driving hour'),
        value: summary.costPerDrivingHour != null ? formatCurrency(summary.costPerDrivingHour) : '—',
      },
      {
        label: t('utilization.totalCost', 'Energy cost in period'),
        value: summary.totalEnergyCost != null ? formatCurrency(summary.totalEnergyCost) : '—',
      },
      {
        label: t('utilization.energy', 'Energy used'),
        value: formatEnergy(summary.energyWh, { precision: 1 }),
      },
    ],
    [summary, t, formatCurrency, formatDistance, formatEnergy],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('utilization.title', 'Utilization')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('utilization.title', 'Utilization')}
      subtitle={t('utilization.subtitle', 'How intensively the car is actually used')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="utilization-range"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('utilization.kpis', 'Utilization summary metrics')}
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
                label={t('utilization.drivingShare', 'Time Driving')}
                value={
                  summary.drivingShare != null
                    ? `${(summary.drivingShare * 100).toFixed(1)}%`
                    : '—'
                }
                subtitle={t('utilization.ofWindow', 'of the observed window')}
                icon={<Activity className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('utilization.activeDays', 'Days Used')}
                value={summary.activeDayShare != null ? `${Math.round(summary.activeDayShare * 100)}%` : '—'}
                subtitle={
                  summary.observedDays != null
                    ? t('utilization.observed', 'of {{days}} observed days', { days: Math.round(summary.observedDays) })
                    : undefined
                }
                icon={<Clock3 className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('utilization.perDay', 'Distance per Day')}
                value={summary.distancePerDayM != null ? formatDistance(summary.distancePerDayM, { precision: 1 }) : '—'}
                subtitle={t('utilization.driveCount', '{{count}} drives', { count: summary.drives })}
                icon={<Route className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('utilization.costPerKmCard', 'Cost per Distance')}
                value={
                  summary.costPerKm != null
                    ? `${formatCurrency(summary.costPerKm, 3)}/${formatDistance(1000, { precision: 0 })}`
                    : '—'
                }
                subtitle={t('utilization.energyOnly', 'energy only')}
                icon={<Wallet className="h-5 w-5" />}
                color="amber"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Time split + cost ledger */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('utilization.timeSplit', 'Where the Hours Go')}
              <HelpTooltip
                size="sm"
                i18nKey="help.utilization.body"
                defaultValue="The observed window runs from the first drive in the picked period to its end. Driving hours come from logged drive durations; everything else is the car sitting still. Costs use your electricity rate from Settings and cover energy only."
                ariaLabel={t('help.utilization.iconLabel', 'More info about utilization')}
              />
            </PanelTitle>
            {isError ? (
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            ) : isLoading ? (
              <Skeleton height={140} />
            ) : summary.observedDays == null ? (
              <EmptyState
                icon={<Activity className="h-8 w-8" />}
                message={t('utilization.noData', 'No drives in this period yet.')}
                actionTo={{ label: t('utilization.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <div className="space-y-4">
                <MetricBar
                  label={t('utilization.drivingHours', 'Driving hours')}
                  value={summary.drivingHours}
                  max={Math.max((summary.observedDays ?? 1) * 24, 1)}
                  color={chartTokens.series[5]}
                  sublabel={t('utilization.hours', '{{h}} h', { h: summary.drivingHours })}
                />
                <MetricBar
                  label={t('utilization.idleHours', 'Parked hours')}
                  value={Math.max(0, (summary.observedDays ?? 0) * 24 - summary.drivingHours)}
                  max={Math.max((summary.observedDays ?? 1) * 24, 1)}
                  color={chartTokens.series[4]}
                  sublabel={t('utilization.hours', '{{h}} h', {
                    h: Math.round(Math.max(0, (summary.observedDays ?? 0) * 24 - summary.drivingHours)),
                  })}
                />
                <Text variant="bodySm" as="p" className="pt-1">
                  {t(
                    'utilization.takeaway',
                    'Over this window the car was in motion {{pct}}% of the time and covered {{dist}}.',
                    {
                      pct: summary.drivingShare != null ? (summary.drivingShare * 100).toFixed(1) : '—',
                      dist: formatDistance(summary.distanceM, { precision: 0 }),
                    },
                  )}
                </Text>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('utilization.ledger', 'Cost of Motion')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={160} />
            ) : (
              <KVList
                items={costItems}
                emptyMessage={t('utilization.noData', 'No drives in this period yet.')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
