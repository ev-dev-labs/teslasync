import { useTranslation } from 'react-i18next';
import { Calendar } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Select } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { AIDigestNarration } from '@/components/ai/AIDigestNarration';
import { usePageTitle } from '@/hooks/usePageTitle';

import {
  useWeeklyDigest,
  DigestSkeleton,
  WeekSelector,
  SummaryHeroCards,
  DrivingSection,
  ChargingSection,
  BatteryHealthSection,
  AlertsSection,
  WeekOverWeekSummary,
} from '../components/weekly-digest';

export default function WeeklyDigestPage() {
  const { t } = useTranslation();
  usePageTitle(t('analytics.weeklyDigest.title', 'Weekly Digest'));

  const {
    weekLabel,
    isCurrentWeek,
    isLoading,
    error,
    hasData,
    metrics,
    dailyDistanceData,
    dailyEnergyData,
    alertPieData,
    funFact,
    goToPrevWeek,
    goToNextWeek,
    vehicleOptions,
    selectedVehicleId,
    setVehicleId,
  } = useWeeklyDigest();

  const actions = (
    <Select
      options={vehicleOptions}
      value={selectedVehicleId}
      onChange={(e) => setVehicleId(e.target.value)}
      placeholder={t('analytics.weeklyDigest.selectVehicle', 'Select vehicle')}
      className="w-48"
    />
  );

  return (
    <PageContainer
      title={t('analytics.weeklyDigest.title', 'Weekly Digest')}
      subtitle={t('analytics.weeklyDigest.subtitle', 'Your driving and charging summary for the week')}
      actions={actions}
      loading={isLoading}
      error={error as Error | null}
    >
      {isLoading ? (
        <DigestSkeleton />
      ) : !hasData ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Calendar className="h-10 w-10" />}
          title={t('analytics.weeklyDigest.noData', 'No Data')}
          message={t(
            'analytics.weeklyDigest.noDataMessage',
            'No driving or charging data found for this week.',
          )}
        />
      ) : (
        <FadeIn className="space-y-8">
          <WeekSelector
            weekLabel={weekLabel}
            isCurrentWeek={isCurrentWeek}
            onPrevWeek={goToPrevWeek}
            onNextWeek={goToNextWeek}
          />
          <SummaryHeroCards metrics={metrics} funFact={funFact} />
          <DrivingSection metrics={metrics} dailyDistanceData={dailyDistanceData} />
          <ChargingSection metrics={metrics} dailyEnergyData={dailyEnergyData} />
          <BatteryHealthSection metrics={metrics} />
          <AlertsSection metrics={metrics} alertPieData={alertPieData} />
          <WeekOverWeekSummary metrics={metrics} />
          {/*
            Phase-50 / 0012 — U2 Weekly digest narration. The AI section
            is wrapped by withAiFeature('digest-narration', …) so it
            renders as a no-op when ai_mode='off' OR the per-feature
            toggle is off (ADR-015 §I5 + §I6 + §I7). The deterministic
            template digest above is unchanged and remains the canonical
            baseline for every user.
          */}
          <AIDigestNarration />
        </FadeIn>
      )}
    </PageContainer>
  );
}
