import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives, useRegenEfficiency } from '@/api/hooks/useDriving';

import { CardGrid, PageLayout } from '@/components/layout/layout-reference';
import { FadeIn } from '@/components/motion';
import { StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';

import {
  CoverageMethodology,
  MonthlyRecoveryTrend,
  RankedDriveEvidence,
  RecoveryContext,
  RecoveryOverview,
  RecoveryRatioDistribution,
  RegenCardSlot,
  RegenKpiBand,
  toRegenSectionState,
} from '../components/regen-efficiency-modernization';
import {
  REGEN_HISTORY_LIMIT,
  buildRegenEfficiencyModel,
} from '../lib/regenEfficiency';

export default function RegenEfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('regen.title', 'Regenerative Braking'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const selectedTimeZone = useTimezone('vehicle');
  const { startInstant, endInstantExclusive, timezone } = useRangeState({
    persistKey: 'regen-efficiency.range',
    defaultPresetId: 'all',
    timezone: selectedTimeZone,
  });

  const aggregateQuery = useRegenEfficiency(
    vehicleIdStr,
    startInstant,
    endInstantExclusive,
  );
  const drivesQuery = useDrives(vehicleIdStr, {
    start: startInstant,
    end: endInstantExclusive,
    limit: REGEN_HISTORY_LIMIT,
  });
  // Source trust is independent: a failed refresh cannot erase either the
  // retained payload or a healthy neighboring source. Query policy is untouched.
  const aggregateDataState = useDataState(aggregateQuery, { provenance: 'historical' });
  const detailDataState = useDataState(drivesQuery, { provenance: 'historical' });
  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const model = useMemo(
    () => buildRegenEfficiencyModel(drives, REGEN_HISTORY_LIMIT, timezone),
    [drives, timezone],
  );

  const aggregateState = toRegenSectionState(aggregateDataState, aggregateQuery);
  const detailState = toRegenSectionState(detailDataState, drivesQuery);

  return (
    <PageLayout
      title={t('regen.title', 'Regenerative Braking')}
      subtitle={t(
        'regen.subtitle',
        'Descriptive energy-recovery evidence for the selected date window',
      )}
      query={[aggregateQuery, drivesQuery]}
      busy={aggregateDataState.isRefreshing || detailDataState.isRefreshing}
    >
      <StaleRefreshWarning
        state={aggregateDataState}
        label={t('regen.overview.aggregateTitle', 'Complete aggregate')}
      />
      <StaleRefreshWarning
        state={detailDataState}
        label={t('regen.overview.sampleTitle', 'Detailed returned sample')}
      />
      <FadeIn>
        <RegenKpiBand
          aggregate={aggregateQuery.data}
          model={model}
          aggregateState={aggregateState}
          detailState={detailState}
          retained={aggregateDataState.refreshError != null || detailDataState.refreshError != null}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <RecoveryOverview
          aggregate={aggregateQuery.data}
          model={model}
          aggregateState={aggregateState}
          detailState={detailState}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <MonthlyRecoveryTrend model={model} state={detailState} />
      </FadeIn>

      <FadeIn delay={0.15}>
        <RecoveryRatioDistribution model={model} state={detailState} />
      </FadeIn>

      <FadeIn delay={0.2}>
        <CardGrid
          label={t('regen.modernization.contextGrid', 'Recovery context')}
          items={[
            {
              id: 'regen-temperature',
              size: 'half',
              content: (
                <RegenCardSlot>
                  <RecoveryContext kind="temperature" model={model} state={detailState} />
                </RegenCardSlot>
              ),
            },
            {
              id: 'regen-soc',
              size: 'half',
              content: (
                <RegenCardSlot>
                  <RecoveryContext kind="soc" model={model} state={detailState} />
                </RegenCardSlot>
              ),
            },
          ]}
        />
      </FadeIn>

      <FadeIn delay={0.25}>
        <RankedDriveEvidence model={model} state={detailState} />
      </FadeIn>

      <FadeIn delay={0.3}>
        <CoverageMethodology
          aggregate={aggregateQuery.data}
          model={model}
          aggregateState={aggregateState}
          detailState={detailState}
        />
      </FadeIn>
    </PageLayout>
  );
}
