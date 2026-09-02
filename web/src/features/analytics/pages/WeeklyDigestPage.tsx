import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { AIDigestNarration } from '@/components/ai/AIDigestNarration';
import { usePageTitle } from '@/hooks/usePageTitle';

import {
  useWeeklyDigest,
  useFsdWeeklyDigestNotification,
  WeekSelector,
  SummaryHeroCards,
  DrivingSection,
  ChargingSection,
  BatteryHealthSection,
  AlertsSection,
  FsdSection,
  WeekOverWeekSummary,
} from '../components/weekly-digest';

export default function WeeklyDigestPage() {
  const { t } = useTranslation();
  usePageTitle(t('analytics.weeklyDigest.title', 'Weekly Digest'));

  const {
    weekLabel,
    weekStart,
    isCurrentWeek,
    metrics,
    dailyDistanceData,
    dailyEnergyData,
    alertPieData,
    funFact,
    goToPrevWeek,
    goToNextWeek,
    selectedVehicleId,
    drivesLoading,
    drivesError,
    refetchDrives,
    chargingLoading,
    chargingError,
    refetchCharging,
    alertsLoading,
    alertsError,
    refetchAlerts,
    fsdInsights,
    fsdLoading,
    fsdError,
    refetchFsd,
    refetchAll,
    freshnessQueries,
  } = useWeeklyDigest();

  useFsdWeeklyDigestNotification({
    vehicleId: selectedVehicleId || undefined,
    weekStart,
    isCurrentWeek,
    insights: fsdInsights,
    isReady: !fsdLoading && !fsdError,
  });

  // The KPI band + week-over-week comparison aggregate the drive & charge
  // domains, so they share those two domains' loading / error state.
  const summaryLoading = drivesLoading || chargingLoading;
  const summaryError = drivesError ?? chargingError ?? null;
  const dataSources = useMemo(
    () => [
      {
        id: 'drive-history',
        label: t('dataSources.labels.driveHistory', 'Drive history'),
        query: freshnessQueries[0] ?? {},
        enabled: freshnessQueries[0] != null,
      },
      {
        id: 'charging-history',
        label: t('dataSources.labels.chargingHistory', 'Charging history'),
        query: freshnessQueries[1] ?? {},
        enabled: freshnessQueries[1] != null,
      },
      {
        id: 'alert-history',
        label: t('dataSources.labels.alertHistory', 'Alert history'),
        query: freshnessQueries[2] ?? {},
        enabled: freshnessQueries[2] != null,
      },
      {
        id: 'fsd-insights',
        label: t('dataSources.labels.fsdInsights', 'Supervised driving'),
        query: freshnessQueries[3] ?? {},
        enabled: freshnessQueries[3] != null,
      },
    ],
    [freshnessQueries, t],
  );

  // AIDigestNarration feeds this id into a POST body (`vehicle_id`), so coerce
  // it to a finite number at the boundary and drop anything non-numeric —
  // forwarding a NaN would serialise to `null` on the wire. `0` is a valid id
  // and is intentionally preserved (an empty selection is the only "no id").
  const parsedVehicleId = Number(selectedVehicleId);
  const aiVehicleId =
    selectedVehicleId !== '' && Number.isFinite(parsedVehicleId) ? parsedVehicleId : undefined;

  const actions = (
    <VehicleSelect
      ariaLabel={t('analytics.weeklyDigest.selectVehicle', 'Select vehicle')}
      className="w-full sm:w-48"
    />
  );

  return (
    <PageContainer
      title={t('analytics.weeklyDigest.title', 'Weekly Digest')}
      subtitle={t('analytics.weeklyDigest.subtitle', 'Your driving and charging summary for the week')}
      actions={actions}
      query={freshnessQueries}
      dataSources={dataSources}
    >
      {/* Week navigation band */}
      <FadeIn>
        <WeekSelector
          weekLabel={weekLabel}
          isCurrentWeek={isCurrentWeek}
          onPrevWeek={goToPrevWeek}
          onNextWeek={goToNextWeek}
        />
      </FadeIn>

      {/* KPI band — full-width responsive metric grid */}
      <FadeIn delay={0.05}>
        <SummaryHeroCards
          metrics={metrics}
          funFact={funFact}
          isLoading={summaryLoading}
          isError={Boolean(summaryError)}
          error={summaryError}
          onRetry={refetchAll}
        />
      </FadeIn>

      {/* Driving + charging bento — two hero panels side-by-side on wide screens */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('analytics.weeklyDigest.activity', 'Driving & charging activity')}
          className="grid grid-cols-1 gap-4 xl:gap-5 2xl:grid-cols-2"
        >
          <DrivingSection
            metrics={metrics}
            dailyDistanceData={dailyDistanceData}
            isLoading={drivesLoading}
            isError={Boolean(drivesError)}
            error={drivesError}
            onRetry={refetchDrives}
          />
          <ChargingSection
            metrics={metrics}
            dailyEnergyData={dailyEnergyData}
            isLoading={chargingLoading}
            isError={Boolean(chargingError)}
            error={chargingError}
            onRetry={refetchCharging}
          />
        </section>
      </FadeIn>

      <FadeIn delay={0.12}>
        <FsdSection
          insights={fsdInsights}
          isLoading={fsdLoading}
          isError={Boolean(fsdError)}
          error={fsdError}
          onRetry={refetchFsd}
          isCurrentWeek={isCurrentWeek}
        />
      </FadeIn>

      {/* Battery + alerts bento */}
      <FadeIn delay={0.15}>
        <section
          aria-label={t('analytics.weeklyDigest.batteryAndAlerts', 'Battery health & alerts')}
          className="grid grid-cols-1 gap-4 xl:gap-5 xl:grid-cols-2"
        >
          <BatteryHealthSection
            metrics={metrics}
            isLoading={chargingLoading}
            isError={Boolean(chargingError)}
            error={chargingError}
            onRetry={refetchCharging}
          />
          <AlertsSection
            metrics={metrics}
            alertPieData={alertPieData}
            isLoading={alertsLoading}
            isError={Boolean(alertsError)}
            error={alertsError}
            onRetry={refetchAlerts}
          />
        </section>
      </FadeIn>

      {/* Week-over-week comparison — full-width detail band */}
      <FadeIn delay={0.2}>
        <WeekOverWeekSummary
          metrics={metrics}
          isLoading={summaryLoading}
          isError={Boolean(summaryError)}
          error={summaryError}
          onRetry={refetchAll}
        />
      </FadeIn>

      {/*
        Weekly digest narration is wrapped by withAiFeature('digest-narration', …)
        so it renders as a no-op when ai_mode='off' OR the per-feature toggle is
        off (ADR-015 §I5 + §I6 + §I7). The deterministic template digest above is
        unchanged and remains the canonical baseline for every user.
      */}
      <FadeIn delay={0.25}>
        <AIDigestNarration vehicleId={aiVehicleId} />
      </FadeIn>
    </PageContainer>
  );
}
