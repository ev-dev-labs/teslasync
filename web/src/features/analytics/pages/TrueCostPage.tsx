import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCostBreakdown } from '@/api/hooks/useAnalytics';
import { AITCONarration } from '@/components/ai';

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
      content: <TrueCostLayoutSlot delay={0}>
        <TrueCostEvidenceLedger {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'source-scope', size: 'full',
      content: <TrueCostLayoutSlot delay={0.02}>
        <TrueCostSourceScopeLedger {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'boundary', size: 'full',
      content: <TrueCostLayoutSlot delay={0.03}>
        <TrueCostBoundaryDisclosure {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'savings', size: 'full',
      content: <TrueCostLayoutSlot delay={0.04}>
        <TrueCostSavingsEnvelope {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'fixed-ledger', size: 'full',
      content: <TrueCostLayoutSlot delay={0.045}>
        <TrueCostFixedLedger
          vehicleId={vehicleId ?? undefined}
          totalKm={query.data?.total_km ?? 0}
          totalChargingCost={query.data?.total_charging_cost ?? 0}
        />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'cumulative', size: 'half',
      content: <TrueCostLayoutSlot delay={0.05}>
        <TrueCostCumulativeChart {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'monthly-cost', size: 'half',
      content: <TrueCostLayoutSlot delay={0.06}>
        <TrueCostMonthlyCostChart {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'monthly-delta', size: 'half',
      content: <TrueCostLayoutSlot delay={0.07}>
        <TrueCostMonthlyDeltaChart {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'energy-trend', size: 'half',
      content: <TrueCostLayoutSlot delay={0.08}>
        <TrueCostEnergyCostTrend {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'per-distance', size: 'full',
      content: <TrueCostLayoutSlot delay={0.09}>
        <TrueCostPerDistanceChart {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'monthly-directory', size: 'full',
      content: <TrueCostLayoutSlot delay={0.1}>
        <TrueCostMonthlyDirectory {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'assumptions', size: 'full',
      content: <TrueCostLayoutSlot delay={0.11}>
        <TrueCostAssumptionsLedger {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'temporal-coverage', size: 'full',
      content: <TrueCostLayoutSlot delay={0.12}>
        <TrueCostTemporalCoverage {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'break-even', size: 'half',
      content: <TrueCostLayoutSlot delay={0.13}>
        <TrueCostBreakEven {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'sensitivity', size: 'half',
      content: <TrueCostLayoutSlot delay={0.14}>
        <TrueCostSensitivityMatrix {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'accounting', size: 'full',
      content: <TrueCostLayoutSlot delay={0.15}>
        <TrueCostAccountingIdentities {...sectionProps} />
      </TrueCostLayoutSlot>,
    },
    {
      id: 'methodology', size: 'full',
      content: <TrueCostLayoutSlot delay={0.16}>
        <TrueCostMethodology {...sectionProps} />
      </TrueCostLayoutSlot>,
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
        <AITCONarration {...narrationProps} />
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
