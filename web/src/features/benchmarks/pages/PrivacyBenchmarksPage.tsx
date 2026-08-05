import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useBenchmarkPrivacyStatus,
  useBenchmarkReleases,
  useCreateBenchmarkRelease,
  useOptInBenchmarks,
  useRevokeBenchmarks,
} from '@/api/hooks/useBenchmarks';
import { EmptyState } from '@/components/feedback';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { GlassPanel } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  BenchmarkPercentileChart,
  CohortEligibilityPanel,
  ConsentGate,
  MethodologyPanel,
  MetricComparisonGrid,
  PrivacyBudgetPanel,
  PrivacyControls,
} from '../components';

export default function PrivacyBenchmarksPage() {
  const { t } = useTranslation();
  usePageTitle(t('benchmarks.title', 'Privacy-Preserving Benchmarks'));
  const { vehicleId } = useSelectedVehicle();
  const [acknowledged, setAcknowledged] = useState(false);
  const statusQuery = useBenchmarkPrivacyStatus(vehicleId);
  const optedIn = statusQuery.data?.opted_in ?? false;
  const releasesQuery = useBenchmarkReleases(vehicleId, 12, 0, optedIn);
  const consent = useOptInBenchmarks();
  const createRelease = useCreateBenchmarkRelease();
  const revoke = useRevokeBenchmarks();
  const latest = releasesQuery.data?.items[0] ?? null;
  const releaseError = createRelease.error instanceof Error
    ? createRelease.error
    : releasesQuery.error instanceof Error
      ? releasesQuery.error
      : null;

  const consentNow = () => {
    if (vehicleId != null) consent.mutate(vehicleId);
  };
  const createNow = () => {
    if (vehicleId != null) createRelease.mutate({ vehicle_id: vehicleId });
  };
  const revokeNow = () => {
    if (vehicleId != null) revoke.mutate(vehicleId);
  };
  const pageError = statusQuery.error instanceof Error ? statusQuery.error : null;

  return (
    <PageContainer
      title={t('benchmarks.title', 'Privacy-Preserving Benchmarks')}
      subtitle={t(
        'benchmarks.subtitle',
        'Compare bounded local metrics with coarse, opt-in cohorts using differential privacy.',
      )}
      loading={statusQuery.isLoading}
      error={pageError}
      query={statusQuery}
    >
      {vehicleId == null ? (
        <GlassPanel className="p-6">
          <EmptyState
            icon={<ShieldCheck className="h-9 w-9" />}
            title={t('benchmarks.noVehicleTitle', 'Select a vehicle')}
            message={t(
              'benchmarks.noVehicle',
              'Choose a vehicle before reviewing or changing benchmark consent.',
            )}
          />
        </GlassPanel>
      ) : (
        <>
          <FadeIn>
            <ConsentGate
              optedIn={optedIn}
              acknowledged={acknowledged}
              pending={consent.isPending}
              error={consent.error instanceof Error ? consent.error : null}
              onAcknowledgedChange={setAcknowledged}
              onConsent={consentNow}
            />
          </FadeIn>
          <Grid cols={{ default: 1, lg: 2 }} gap={4}>
            <FadeIn delay={0.04}>
              <PrivacyBudgetPanel status={statusQuery.data ?? null} />
            </FadeIn>
            <FadeIn delay={0.08}>
              <CohortEligibilityPanel
                optedIn={optedIn}
                release={latest}
                minimumCohortSize={statusQuery.data?.minimum_cohort_size ?? 5}
                pending={createRelease.isPending}
                loading={releasesQuery.isLoading}
                error={releaseError}
                onCreate={createNow}
              />
            </FadeIn>
          </Grid>
          <FadeIn delay={0.12}>
            <MetricComparisonGrid release={latest} loading={releasesQuery.isLoading} />
          </FadeIn>
          <FadeIn delay={0.16}>
            <BenchmarkPercentileChart release={latest} loading={releasesQuery.isLoading} />
          </FadeIn>
          <Grid cols={{ default: 1, lg: 2 }} gap={4}>
            <FadeIn delay={0.2}>
              <MethodologyPanel />
            </FadeIn>
            <FadeIn delay={0.24}>
              <PrivacyControls
                optedIn={optedIn}
                pending={revoke.isPending}
                error={revoke.error instanceof Error ? revoke.error : null}
                onRevoke={revokeNow}
              />
            </FadeIn>
          </Grid>
        </>
      )}
    </PageContainer>
  );
}
