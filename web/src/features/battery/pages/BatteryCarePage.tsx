import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HeartPulse, BatteryFull, BatteryWarning, Zap, Percent } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard, MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives } from '@/api/hooks/useDriving';
import { useChargingSessions } from '@/api/hooks/useCharging';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';

import { computeBatteryCare } from '../lib/batteryCare';

function pct(v: number | null): string {
  return v != null ? `${Math.round(v * 100)}%` : '—';
}

export default function BatteryCarePage() {
  const { t } = useTranslation();
  usePageTitle(t('batteryCare.title', 'Battery Care'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const sessionsQuery = useChargingSessions(vehicleIdStr);
  const drivesQuery = useDrives(vehicleIdStr);

  const care = useMemo(
    () => computeBatteryCare(sessionsQuery.data ?? [], drivesQuery.data ?? []),
    [sessionsQuery.data, drivesQuery.data],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('batteryCare.title', 'Battery Care')} />;
  }

  const isLoading = sessionsQuery.isLoading || drivesQuery.isLoading;
  const isError = sessionsQuery.isError || drivesQuery.isError;
  const error = sessionsQuery.error ?? drivesQuery.error;
  const retry = () => {
    if (sessionsQuery.isError) void sessionsQuery.refetch();
    if (drivesQuery.isError) void drivesQuery.refetch();
  };

  return (
    <PageContainer
      title={t('batteryCare.title', 'Battery Care')}
      subtitle={t('batteryCare.subtitle', 'How gently your charging habits treat the pack')}
      query={[sessionsQuery, drivesQuery]}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('batteryCare.kpis', 'Battery care summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={error} onRetry={retry} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('batteryCare.score', 'Care Score')}
                value={care.score != null ? care.score : '—'}
                subtitle={t('batteryCare.of100', 'of 100')}
                icon={<HeartPulse className="h-5 w-5" />}
                color={care.score == null ? 'cyan' : care.score >= 80 ? 'green' : care.score >= 60 ? 'amber' : 'red'}
              />
              <MetricCard
                label={t('batteryCare.fullCharges', 'Charges to {{pct}}%+', { pct: care.fullChargePct })}
                value={pct(care.fullChargeShare)}
                subtitle={t('batteryCare.ofSessions', 'of {{count}} sessions', { count: care.sessionsAnalyzed })}
                icon={<BatteryFull className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('batteryCare.deepDischarges', 'Deep Discharges')}
                value={pct(care.deepDischargeShare)}
                subtitle={t('batteryCare.below10', 'arrivals below 10%')}
                icon={<BatteryWarning className="h-5 w-5" />}
                color="red"
              />
              <MetricCard
                label={t('batteryCare.dcShare', 'DC Fast Energy')}
                value={pct(care.dcEnergyShare)}
                subtitle={t('batteryCare.ofEnergy', 'of charged energy')}
                icon={<Zap className="h-5 w-5" />}
                color="purple"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Habit breakdown */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-4 flex items-center gap-2">
            <Percent className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('batteryCare.habits', 'Habit Breakdown')}
            <HelpTooltip
              size="sm"
              i18nKey="help.batteryCare.body"
              defaultValue="Lithium packs age fastest when held full, drained deep, or fast-charged often. The score starts at 100 and pays for each habit: full charges and deep discharges cost up to 30 points each; DC fast energy and time outside the 20–80% band cost up to 20 each."
              ariaLabel={t('help.batteryCare.iconLabel', 'More info about the care score')}
            />
          </PanelTitle>
          {isError ? (
            <QueryError error={error} onRetry={retry} />
          ) : isLoading ? (
            <Skeleton height={200} />
          ) : care.sessionsAnalyzed === 0 ? (
            <EmptyState /* no-action: needs charging history to grade; appears only before the first synced session. */
              icon={<HeartPulse className="h-8 w-8" />}
              message={t('batteryCare.noData', 'No charging sessions with SoC data yet.')}
            />
          ) : (
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 xl:grid-cols-2">
              <MetricBar
                label={t('batteryCare.barBand', 'Sessions finishing inside 20–80%')}
                value={(care.bandFinishShare ?? 0) * 100}
                max={100}
                color={chartTokens.series[1]}
                sublabel={pct(care.bandFinishShare)}
              />
              <MetricBar
                label={t('batteryCare.barFull', 'Sessions charged to {{pct}}%+', { pct: care.fullChargePct })}
                value={(care.fullChargeShare ?? 0) * 100}
                max={100}
                color={chartTokens.series[2]}
                sublabel={pct(care.fullChargeShare)}
              />
              <MetricBar
                label={t('batteryCare.barDeep', 'Drives arriving below 10%')}
                value={(care.deepDischargeShare ?? 0) * 100}
                max={100}
                color={chartTokens.series[3]}
                sublabel={pct(care.deepDischargeShare)}
              />
              <MetricBar
                label={t('batteryCare.barDc', 'Energy from DC fast charging')}
                value={(care.dcEnergyShare ?? 0) * 100}
                max={100}
                color={chartTokens.series[4]}
                sublabel={pct(care.dcEnergyShare)}
              />
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
