import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives } from '@/api/hooks/useDriving';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import {
  ShareCardAccountingIdentities,
  ShareCardCoverageDisclosure,
  ShareCardDistanceDistribution,
  ShareCardDurationDistribution,
  ShareCardEfficiencyEvidence,
  ShareCardEvidenceLedger,
  ShareCardLineInventory,
  ShareCardMethodology,
  ShareCardMonthlyTrend,
  ShareCardPreviewExport,
  ShareCardRepresentativeDirectory,
  ShareCardSourceScopeLedger,
  ShareCardStyleControls,
  ShareCardWeekdayProfile,
  shareCardQueryState,
  useShareCardComposition,
  useShareCardDisplay,
} from '../components/share-card';
import { analyzeShareCard } from '../lib/shareCard';

export default function ShareCardPage() {
  const { t } = useTranslation();
  usePageTitle(t('shareCard.title', 'Share Card Studio'));
  const { vehicleId } = useSelectedVehicle();
  const timezone = useTimezone('vehicle');
  const display = useShareCardDisplay();
  const {
    start,
    end,
    startInstant,
    endInstantExclusive,
    setRange,
  } = useRangeState({
    persistKey: 'share-card.range',
    defaultPresetId: '30d',
    timezone,
  });
  const drivesQuery = useDrives(
    vehicleId != null ? String(vehicleId) : undefined,
    { start: startInstant, end: endInstantExclusive, limit: 1_000 },
  );
  const drives = drivesQuery.data ?? [];
  const analysis = useMemo(
    () => analyzeShareCard(drives, {
      startLabel: start,
      endLabel: end,
      startInstant,
      endInstantExclusive,
      timezone,
    }),
    [drives, end, endInstantExclusive, start, startInstant, timezone],
  );
  const state = shareCardQueryState(
    drivesQuery,
    vehicleId != null,
    () => {
      void drivesQuery.refetch();
    },
  );
  const sectionProps = { analysis, state, display };
  const compositionProps = useShareCardComposition(
    analysis,
    state,
    display,
    start,
    end,
  );

  return (
    <PageContainer
      title={t('shareCard.title', 'Share Card Studio')}
      subtitle={t(
        'shareCard.subtitle',
        'Compose a local, evidence-backed SVG without overstating selected-window coverage',
      )}
      query={vehicleId != null ? drivesQuery : undefined}
      copyLink
      actions={(
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            presetIds={['30d', '90d', '1y', 'all']}
            align="end"
            triggerTestId="share-card-range"
          />
        </div>
      )}
    >
      <FadeIn><ShareCardEvidenceLedger {...sectionProps} /></FadeIn>
      <FadeIn delay={0.02}><ShareCardSourceScopeLedger {...sectionProps} /></FadeIn>
      <FadeIn delay={0.03}><ShareCardCoverageDisclosure {...sectionProps} /></FadeIn>
      <Grid cols={{ default: 1, xl: 3 }} gap={4}>
        <FadeIn delay={0.04}><ShareCardStyleControls {...compositionProps} /></FadeIn>
        <div className="xl:col-span-2">
          <FadeIn delay={0.05}><ShareCardPreviewExport {...compositionProps} /></FadeIn>
        </div>
      </Grid>
      <FadeIn delay={0.06}><ShareCardLineInventory {...compositionProps} /></FadeIn>
      <FadeIn delay={0.07}><ShareCardMonthlyTrend {...sectionProps} /></FadeIn>
      <FadeIn delay={0.08}><ShareCardWeekdayProfile {...sectionProps} /></FadeIn>
      <Grid cols={{ default: 1, xl: 2 }} gap={4}>
        <FadeIn delay={0.09}><ShareCardDistanceDistribution {...sectionProps} /></FadeIn>
        <FadeIn delay={0.1}><ShareCardDurationDistribution {...sectionProps} /></FadeIn>
      </Grid>
      <FadeIn delay={0.11}><ShareCardEfficiencyEvidence {...sectionProps} /></FadeIn>
      <FadeIn delay={0.12}><ShareCardRepresentativeDirectory {...sectionProps} /></FadeIn>
      <FadeIn delay={0.13}><ShareCardAccountingIdentities {...sectionProps} /></FadeIn>
      <FadeIn delay={0.14}><ShareCardMethodology {...sectionProps} /></FadeIn>
    </PageContainer>
  );
}
