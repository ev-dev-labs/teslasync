import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useCostBreakdown } from '@/api/hooks/useAnalytics';
import { AITCONarration } from '@/components/ai';
import { SectionErrorBoundary } from '@/components/feedback';

import { CardGrid, PageLayout, Section, type CardGridItem } from '@/components/layout';
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
  TrueCostMethodology,
  TrueCostMonthlyCostChart,
  TrueCostMonthlyDeltaChart,
  TrueCostMonthlyDirectory,
  TrueCostPerDistanceChart,
  TrueCostSensitivityMatrix,
  TrueCostSourceScopeLedger,
  TrueCostTemporalCoverage,
  trueCostQueryState,
  useTrueCostDisplay,
} from '../components/true-cost';
import { TrueCostSavingsEnvelope } from '../components/operationalbrief-n-z/TrueCostSavingsEnvelope';
import { TrueCostEvidenceLedger } from '../components/operationalbrief-n-z/TrueCostEvidenceLedger';
import { TrueCostFixedLedger, TrueCostLayoutSlot } from '../components/true-cost-modernization';
import { analyzeTrueCost } from '../lib/trueCost';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

function evidenceSlot(id: string, delay: number, content: ReactNode) {
  return (
    <TrueCostLayoutSlot delay={delay}>
      <SectionErrorBoundary name={`TrueCost:${id}`}>
        {content}
      </SectionErrorBoundary>
    </TrueCostLayoutSlot>
  );
}

export default function TrueCostPage() {
  useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('tco.title', 'Lifetime operating cost'));
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

  // Keep source order, source-specific states and specialist formatting intact.
  // One CardGrid observes the allocated content width; slots consume its
  // existing placement context instead of creating another packing engine.
  const items: CardGridItem[] = [
    {
      id: 'evidence', size: 'full',
      content: evidenceSlot('evidence', 0, <TrueCostEvidenceLedger {...sectionProps} />),
    },
    {
      id: 'source-scope', size: 'full',
      content: evidenceSlot('source-scope', 0.02, <TrueCostSourceScopeLedger {...sectionProps} />),
    },
    {
      id: 'boundary', size: 'full',
      content: evidenceSlot('boundary', 0.03, <TrueCostBoundaryDisclosure {...sectionProps} />),
    },
    {
      id: 'savings', size: 'full',
      content: evidenceSlot('savings', 0.04, <TrueCostSavingsEnvelope {...sectionProps} />),
    },
    {
      id: 'fixed-ledger', size: 'full',
      content: evidenceSlot('fixed-ledger', 0.045,
        <TrueCostFixedLedger
          vehicleId={vehicleId ?? undefined}
          aggregateState={state}
          totalKm={query.data?.total_km}
          totalChargingCost={query.data?.total_charging_cost}
        />
      ),
    },
    {
      id: 'cumulative', size: 'half',
      content: evidenceSlot('cumulative', 0.05, <TrueCostCumulativeChart {...sectionProps} />),
    },
    {
      id: 'monthly-cost', size: 'half',
      content: evidenceSlot('monthly-cost', 0.06, <TrueCostMonthlyCostChart {...sectionProps} />),
    },
    {
      id: 'monthly-delta', size: 'half',
      content: evidenceSlot('monthly-delta', 0.07, <TrueCostMonthlyDeltaChart {...sectionProps} />),
    },
    {
      id: 'energy-trend', size: 'half',
      content: evidenceSlot('energy-trend', 0.08, <TrueCostEnergyCostTrend {...sectionProps} />),
    },
    {
      id: 'per-distance', size: 'full',
      content: evidenceSlot('per-distance', 0.09, <TrueCostPerDistanceChart {...sectionProps} />),
    },
    {
      id: 'monthly-directory', size: 'full',
      content: evidenceSlot('monthly-directory', 0.1, <TrueCostMonthlyDirectory {...sectionProps} />),
    },
    {
      id: 'assumptions', size: 'full',
      content: evidenceSlot('assumptions', 0.11, <TrueCostAssumptionsLedger {...sectionProps} />),
    },
    {
      id: 'temporal-coverage', size: 'full',
      content: evidenceSlot('temporal-coverage', 0.12, <TrueCostTemporalCoverage {...sectionProps} />),
    },
    {
      id: 'break-even', size: 'half',
      content: evidenceSlot('break-even', 0.13, <TrueCostBreakEven {...sectionProps} />),
    },
    {
      id: 'sensitivity', size: 'half',
      content: evidenceSlot('sensitivity', 0.14, <TrueCostSensitivityMatrix {...sectionProps} />),
    },
    {
      id: 'accounting', size: 'full',
      content: evidenceSlot('accounting', 0.15, <TrueCostAccountingIdentities {...sectionProps} />),
    },
    {
      id: 'methodology', size: 'full',
      content: evidenceSlot('methodology', 0.16, <TrueCostMethodology {...sectionProps} />),
    },
  ];

  return (
    <PageLayout
      title={t('tco.title', 'Lifetime operating cost')}
      subtitle={t(
        'tco.subtitle',
        'Evidence-backed recorded charging versus modeled gasoline operating cost',
      )}
      query={vehicleId != null ? query : undefined}
    >
      <div data-testid="tco-ai-slot">
        <SectionErrorBoundary name="TrueCost:narration">
          <AITCONarration {...narrationProps} />
        </SectionErrorBoundary>
      </div>

      <Section
        id="tco-operating-evidence"
        title={t('tco.modernization.evidence.title', 'Operating-cost evidence')}
      >
        <CardGrid
          label={t('tco.kpis.aria', 'True cost KPI and evidence ledger')}
          items={items}
        />
      </Section>
    </PageLayout>
  );
}
