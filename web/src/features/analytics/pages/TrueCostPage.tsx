import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCostBreakdown } from '@/api/hooks/useAnalytics';
import { AITCONarration } from '@/components/ai/AITCONarration';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSettings } from '@/hooks/useSettings';
import {
  TrueCostAccountingIdentities,
  TrueCostAssumptionsLedger,
  TrueCostBoundaryDisclosure,
  TrueCostBreakEven,
  TrueCostCumulativeChart,
  TrueCostEnergyCostTrend,
  TrueCostEvidenceLedger,
  TrueCostMethodology,
  TrueCostMonthlyCostChart,
  TrueCostMonthlyDeltaChart,
  TrueCostMonthlyDirectory,
  TrueCostPerDistanceChart,
  TrueCostSavingsEnvelope,
  TrueCostSensitivityMatrix,
  TrueCostSourceScopeLedger,
  TrueCostTemporalCoverage,
  trueCostQueryState,
  useTrueCostDisplay,
} from '../components/true-cost';
import { analyzeTrueCost } from '../lib/trueCost';

export default function TrueCostPage() {
  const { t } = useTranslation();
  usePageTitle(t('tco.title', 'Lifetime Operating Cost'));
  const { vehicleId } = useSelectedVehicle();
  const { settings } = useSettings();
  const vehicleIdString = vehicleId != null ? String(vehicleId) : '';
  const query = useCostBreakdown(vehicleIdString);
  const display = useTrueCostDisplay();
  const gasUnit: 'liter' | 'gallon' = query.data?.gas_unit === 'liter'
    ? 'liter'
    : query.data?.gas_unit === 'gallon'
      ? 'gallon'
      : settings.gas_unit === 'liter'
        ? 'liter'
        : 'gallon';
  const analysis = useMemo(() => analyzeTrueCost(query.data), [query.data]);
  const retry = useCallback(() => {
    void query.refetch();
  }, [query.refetch]);
  const state = useMemo(
    () => trueCostQueryState(query, vehicleId != null, retry),
    [
      query.data,
      query.error,
      query.fetchStatus,
      query.isError,
      query.isFetching,
      query.isLoading,
      query.isPending,
      query.isSuccess,
      retry,
      vehicleId,
    ],
  );
  const sectionProps = { analysis, state, display, gasUnit };
  const narrationProps = { vehicleId: vehicleId ?? undefined };

  return (
    <PageContainer
      title={t('tco.title', 'Lifetime Operating Cost')}
      subtitle={t(
        'tco.subtitle',
        'Evidence-backed recorded charging versus modeled gasoline operating cost',
      )}
      query={vehicleId != null ? query : undefined}
      actions={<VehicleSelect />}
    >
      <div data-testid="tco-ai-slot">
        <AITCONarration {...narrationProps} />
      </div>

      <FadeIn>
        <TrueCostEvidenceLedger {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.02}>
        <TrueCostSourceScopeLedger {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.03}>
        <TrueCostBoundaryDisclosure {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.04}>
        <TrueCostSavingsEnvelope {...sectionProps} />
      </FadeIn>

      <div className="grid gap-4 xl:grid-cols-2">
        <FadeIn delay={0.05}>
          <TrueCostCumulativeChart {...sectionProps} />
        </FadeIn>
        <FadeIn delay={0.06}>
          <TrueCostMonthlyCostChart {...sectionProps} />
        </FadeIn>
        <FadeIn delay={0.07}>
          <TrueCostMonthlyDeltaChart {...sectionProps} />
        </FadeIn>
        <FadeIn delay={0.08}>
          <TrueCostEnergyCostTrend {...sectionProps} />
        </FadeIn>
      </div>

      <FadeIn delay={0.09}>
        <TrueCostPerDistanceChart {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.1}>
        <TrueCostMonthlyDirectory {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.11}>
        <TrueCostAssumptionsLedger {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.12}>
        <TrueCostTemporalCoverage {...sectionProps} />
      </FadeIn>

      <div className="grid gap-4 xl:grid-cols-2">
        <FadeIn delay={0.13}>
          <TrueCostBreakEven {...sectionProps} />
        </FadeIn>
        <FadeIn delay={0.14}>
          <TrueCostSensitivityMatrix {...sectionProps} />
        </FadeIn>
      </div>

      <FadeIn delay={0.15}>
        <TrueCostAccountingIdentities {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.16}>
        <TrueCostMethodology {...sectionProps} />
      </FadeIn>
    </PageContainer>
  );
}
