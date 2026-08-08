import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives } from '@/api/hooks/useDriving';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import {
  ConsumptionSpeedCurve,
  DriveEvidenceScatter,
  MonthlyOperatingContext,
  SpeedBandCoverage,
  SpeedBandScorecard,
  SpeedSweetSpotKpis,
  SpeedSweetSpotMethodology,
  SweetSpotEvidence,
  type SpeedSweetSpotSectionState,
} from '../components/speed-sweet-spot';
import { computeSweetSpot } from '../lib/speedSweetSpot';

const DRIVE_WINDOW_LIMIT = 1_000;
const EVIDENCE_COLUMNS = { default: 1, xl: 5 } as const;

export default function SpeedSweetSpotPage() {
  const { t } = useTranslation();
  usePageTitle(t('sweetSpot.title', 'Speed Sweet Spot'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { start, end, setRange } = useRangeState({
    persistKey: 'speed-sweetspot.range',
    defaultPresetId: 'all',
  });
  const drivesQuery = useDrives(vehicleIdStr, {
    start,
    end,
    limit: DRIVE_WINDOW_LIMIT,
  });
  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const summary = useMemo(
    () => computeSweetSpot(drives, { windowLimit: DRIVE_WINDOW_LIMIT }),
    [drives],
  );

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('sweetSpot.title', 'Speed Sweet Spot')}
      />
    );
  }

  const sectionState: SpeedSweetSpotSectionState = {
    isLoading: drivesQuery.isLoading,
    error: drivesQuery.isError ? drivesQuery.error : null,
    onRetry: () => {
      void drivesQuery.refetch();
    },
  };

  return (
    <PageContainer
      title={t('sweetSpot.title', 'Speed Sweet Spot')}
      subtitle={t(
        'sweetSpot.subtitle',
        'Observed efficiency by whole-drive average speed — not instantaneous cruising speed or a recommended road speed',
      )}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="speed-sweetspot-range"
          />
        </div>
      }
    >
      <FadeIn>
        <SpeedSweetSpotKpis summary={summary} {...sectionState} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <Grid cols={EVIDENCE_COLUMNS} gap={4}>
          <SweetSpotEvidence
            summary={summary}
            state={sectionState}
            className="xl:col-span-2"
          />
          <SpeedBandCoverage
            summary={summary}
            state={sectionState}
            className="xl:col-span-3"
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.1}>
        <ConsumptionSpeedCurve summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.15}>
        <DriveEvidenceScatter summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.2}>
        <MonthlyOperatingContext summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.25}>
        <SpeedBandScorecard summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.3}>
        <SpeedSweetSpotMethodology
          summary={summary}
          start={start}
          end={end}
          windowLimit={DRIVE_WINDOW_LIMIT}
          state={sectionState}
        />
      </FadeIn>
    </PageContainer>
  );
}
