import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useCarbonIntensity,
  useCarbonRecommendation,
  useCarbonSummary,
} from '@/api/hooks/useCarbon';

import { Grid, PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import {
  CarbonAccountingIdentities,
  CarbonIntensityCurve,
  CarbonMethodology,
  CarbonMonthlyTrend,
  CarbonSourceScopeLedger,
  useCarbonDisplay,
  useCarbonQueryStates,
} from '../components/carbon-intelligence';
import { CarbonEvidenceBrief as CarbonEvidenceLedger } from '../components/operationalbrief-a-m/CarbonEvidenceBrief';
import { CarbonCoverageBrief as CarbonCurveCoverage } from '../components/operationalbrief-a-m/CarbonCoverageBrief';
import { CarbonLifetimeBrief as CarbonLifetimeContext } from '../components/operationalbrief-a-m/CarbonLifetimeBrief';
import { CarbonFootprintBrief as CarbonPeriodFootprint } from '../components/operationalbrief-a-m/CarbonFootprintBrief';
import { CarbonDirectoryBrief as CarbonHourlyDirectory } from '../components/operationalbrief-a-m/CarbonDirectoryBrief';
import { CarbonScoreBrief as CarbonGreenTimingScore } from '../components/operationalbrief-a-m/CarbonScoreBrief';
import { CarbonRecommendationBrief as CarbonRecommendation } from '../components/operationalbrief-a-m/CarbonRecommendationBrief';
import { CarbonOpportunityBrief as CarbonOpportunityMath } from '../components/operationalbrief-a-m/CarbonOpportunityBrief';
import { buildCarbonIntelligence } from '../lib/carbonIntelligence';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function CarbonIntelligencePage() {
  useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('carbon.title', 'Carbon intelligence'));
  const { vehicleId } = useSelectedVehicle();
  const timezone = useTimezone('vehicle');
  const { start, end, startInstant, endInstantExclusive } = useRangeState({
    persistKey: 'carbon.range',
    defaultPresetId: '90d',
    timezone,
  });
  const display = useCarbonDisplay();

  const intensityQuery = useCarbonIntensity();
  const periodQuery = useCarbonSummary(
    vehicleId,
    startInstant,
    endInstantExclusive,
  );
  const lifetimeQuery = useCarbonSummary(vehicleId);
  const recommendationQuery = useCarbonRecommendation(vehicleId);

  const analysis = useMemo(
    () => buildCarbonIntelligence({
      intensity: intensityQuery.data,
      periodSummary: periodQuery.data,
      lifetimeSummary: lifetimeQuery.data,
      recommendation: recommendationQuery.data,
      window: {
        startLabel: start,
        endLabel: end,
        startInstant,
        endInstantExclusive,
        timezone,
      },
    }),
    [
      end,
      endInstantExclusive,
      intensityQuery.data,
      lifetimeQuery.data,
      periodQuery.data,
      recommendationQuery.data,
      start,
      startInstant,
      timezone,
    ],
  );
  const states = useCarbonQueryStates({
    intensity: intensityQuery,
    period: periodQuery,
    lifetime: lifetimeQuery,
    recommendation: recommendationQuery,
    vehicleSelected: vehicleId != null,
  });
  const sectionProps = { analysis, states, display };

  return (
    <PageLayout
      title={t('carbon.title', 'Carbon intelligence')}
      subtitle={t(
        'carbon.subtitle',
        'Dense evidence for selected-period charging emissions, model coverage, lifetime context, and bounded scenarios',
      )}
      query={vehicleId != null
        ? [
          intensityQuery,
          periodQuery,
          lifetimeQuery,
          recommendationQuery,
        ]
        : intensityQuery}
      copyLink
    >
      <FadeIn>
        <CarbonEvidenceLedger {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.03}>
        <CarbonSourceScopeLedger {...sectionProps} />
      </FadeIn>
      <Grid cols={{ default: 1, xl: 2 }} gap={4}>
        <FadeIn delay={0.04}>
          <CarbonPeriodFootprint {...sectionProps} />
        </FadeIn>
        <FadeIn delay={0.05}>
          <CarbonLifetimeContext {...sectionProps} />
        </FadeIn>
      </Grid>
      <FadeIn delay={0.06}>
        <CarbonMonthlyTrend {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.07}>
        <CarbonCurveCoverage {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.08}>
        <CarbonIntensityCurve {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.09}>
        <CarbonHourlyDirectory {...sectionProps} />
      </FadeIn>
      <Grid cols={{ default: 1, xl: 2 }} gap={4}>
        <FadeIn delay={0.1}>
          <CarbonGreenTimingScore {...sectionProps} />
        </FadeIn>
        <FadeIn delay={0.11}>
          <CarbonRecommendation {...sectionProps} />
        </FadeIn>
      </Grid>
      <FadeIn delay={0.12}>
        <CarbonOpportunityMath {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.13}>
        <CarbonAccountingIdentities {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.14}>
        <CarbonMethodology {...sectionProps} />
      </FadeIn>
    </PageLayout>
  );
}
