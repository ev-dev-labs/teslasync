import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLayout, CardGrid, Section } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { AIDigestNarration } from '@/components/ai';
import { usePageTitle } from '@/hooks/usePageTitle';
import { browserTimezone } from '@/lib/timezone';

import {
  useWeeklyDigest,
  useFsdWeeklyDigestNotification,
} from '../components/weekly-digest';
import {
  WeekNavigation,
  DrivingPanel,
  ChargingPanel,
  BatteryPanel,
  AlertsPanel,
  weeklyPeriod,
} from '../components/weekly-digest-modernization';
import { DigestOperationalSummary } from '../components/operationalbrief-n-z/DigestOperationalSummary';
import { FsdOperationalPanel } from '../components/operationalbrief-n-z/FsdOperationalPanel';

export default function WeeklyDigestPage() {
  const { t } = useTranslation();
  usePageTitle(t('analytics.weeklyDigest.title', 'Weekly digest'));

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

  // Period metadata describes, but never controls, the independent digest
  // week. Queries, notification identity and workspace vehicle stay owned by
  // the original hooks. Do not assert completeness for bounded history.
  const period = useMemo(
    () => weeklyPeriod(
      weekStart,
      weekLabel,
      browserTimezone(),
      t(
        'analytics.weeklyDigest.modernization.periodProvenance',
        'Selected week; based on available history records.',
      ),
    ),
    [weekStart, weekLabel, t],
  );

  return (
    <PageLayout
      title={t('analytics.weeklyDigest.title', 'Weekly digest')}
      subtitle={t('analytics.weeklyDigest.subtitle', 'Your driving and charging summary for the week')}
      query={freshnessQueries}
      dataSources={dataSources}
    >
      {/* Week navigation band */}
      <FadeIn>
        <CardGrid
          label={t('analytics.weeklyDigest.title', 'Weekly digest')}
          items={[{
            id: 'week-navigation',
            size: 'full',
            content: (
              <WeekNavigation
                weekLabel={weekLabel}
                isCurrentWeek={isCurrentWeek}
                onPrevWeek={goToPrevWeek}
                onNextWeek={goToNextWeek}
              />
            ),
          }]}
        />
      </FadeIn>

      {/* KPI band — full-width responsive metric grid */}
      <FadeIn delay={0.05}>
        <CardGrid
          label={t('analytics.weeklyDigest.weekSummary', 'Week summary')}
          items={[{
            id: 'week-summary',
            size: 'full',
            content: (
              <DigestOperationalSummary
                metrics={metrics}
                period={period}
                funFact={funFact}
                isLoading={summaryLoading}
                isError={Boolean(summaryError)}
                error={summaryError}
                onRetry={refetchAll}
                driveAvailable={freshnessQueries[0] ? freshnessQueries[0].data != null : undefined}
                chargingAvailable={freshnessQueries[1] ? freshnessQueries[1].data != null : undefined}
              />
            ),
          }]}
        />
      </FadeIn>

      {/* Driving + charging bento — two hero panels side-by-side on wide screens */}
      <FadeIn delay={0.1}>
        <Section id="weekly-digest-activity" title={t('analytics.weeklyDigest.activity', 'Driving & charging activity')}>
        <CardGrid
          label={t('analytics.weeklyDigest.activity', 'Driving & charging activity')}
          items={[
            {
              id: 'driving',
              size: 'half',
              content: (
                <DrivingPanel
                  metrics={metrics}
                  period={period}
                  dailyDistanceData={dailyDistanceData}
                  isLoading={drivesLoading}
                  isError={Boolean(drivesError)}
                  error={drivesError}
                  onRetry={refetchDrives}
                />
              ),
            },
            {
              id: 'charging',
              size: 'half',
              content: (
                <ChargingPanel
                  metrics={metrics}
                  period={period}
                  dailyEnergyData={dailyEnergyData}
                  isLoading={chargingLoading}
                  isError={Boolean(chargingError)}
                  error={chargingError}
                  onRetry={refetchCharging}
                />
              ),
            },
          ]}
        />
        </Section>
      </FadeIn>

      <FadeIn delay={0.12}>
        <CardGrid
          label={t('analytics.weeklyDigest.fsdSection', 'Supervised driving')}
          items={[{
            id: 'supervised-driving',
            size: 'full',
            content: (
              <FsdOperationalPanel
                insights={fsdInsights}
                period={period}
                isLoading={fsdLoading}
                isError={Boolean(fsdError)}
                error={fsdError}
                onRetry={refetchFsd}
                isCurrentWeek={isCurrentWeek}
              />
            ),
          }]}
        />
      </FadeIn>

      {/* Battery + alerts bento */}
      <FadeIn delay={0.15}>
        <Section id="weekly-digest-battery-alerts" title={t('analytics.weeklyDigest.batteryAndAlerts', 'Battery health & alerts')}>
        <CardGrid
          label={t('analytics.weeklyDigest.batteryAndAlerts', 'Battery health & alerts')}
          items={[
            {
              id: 'battery',
              size: 'half',
              content: (
                <BatteryPanel
                  metrics={metrics}
                  period={period}
                  isLoading={chargingLoading}
                  isError={Boolean(chargingError)}
                  error={chargingError}
                  onRetry={refetchCharging}
                />
              ),
            },
            {
              id: 'alerts',
              size: 'half',
              content: (
                <AlertsPanel
                  metrics={metrics}
                  period={period}
                  alertPieData={alertPieData}
                  isLoading={alertsLoading}
                  isError={Boolean(alertsError)}
                  error={alertsError}
                  onRetry={refetchAlerts}
                />
              ),
            },
          ]}
        />
        </Section>
      </FadeIn>

      {/* Week-over-week comparison — full-width detail band */}
      <FadeIn delay={0.2}>
        <CardGrid
          label={t('analytics.weeklyDigest.weekOverWeek', 'Week-over-week comparison')}
          items={[{
            id: 'week-comparison',
            size: 'full',
            content: (
              <DigestOperationalSummary
                comparison
                metrics={metrics}
                period={period}
                isLoading={summaryLoading}
                isError={Boolean(summaryError)}
                error={summaryError}
                onRetry={refetchAll}
                driveAvailable={freshnessQueries[0] ? freshnessQueries[0].data != null : undefined}
                chargingAvailable={freshnessQueries[1] ? freshnessQueries[1].data != null : undefined}
              />
            ),
          }]}
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
    </PageLayout>
  );
}
