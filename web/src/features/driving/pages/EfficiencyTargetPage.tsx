import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveHistory } from '@/api/hooks/useDriving';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Input } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useStoredNumber } from '@/hooks/useStoredNumber';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceToSI } from '@/lib/unitConversion';

import {
  EfficiencyTargetKpis,
  GoalPulse,
  RecentWeekScorecard,
  TargetConsistencyChart,
  TargetMethodology,
  WeekdayEfficiencyChart,
  WeeklyTargetChart,
  type EfficiencyTargetSectionState,
} from '../components/efficiency-target';
import { summarizeTarget } from '../lib/efficiencyTarget';

const DRIVE_HISTORY_LIMIT = 1000;
const SPLIT_COLUMNS = { default: 1, xl: 5 } as const;

export default function EfficiencyTargetPage() {
  const { t } = useTranslation();
  usePageTitle(t('effTarget.title', 'Efficiency Target'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { unitPrefs } = useUnits();
  const [targetWhPerKm, setTargetWhPerKm] = useStoredNumber(
    'teslasync:efficiency-target:v1',
    160,
  );
  const historyQuery = useDriveHistory(vehicleIdStr, DRIVE_HISTORY_LIMIT);
  const nowMs = useMemo(() => Date.now(), []);
  const drives = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);
  const summary = useMemo(
    () =>
      summarizeTarget(drives, targetWhPerKm, nowMs, {
        historyLimit: DRIVE_HISTORY_LIMIT,
      }),
    [drives, nowMs, targetWhPerKm],
  );

  const distanceUnit = unitPrefs.distance === 'mi' ? 'mi' : 'km';
  const efficiencyScale = convertDistanceToSI(1, distanceUnit) / 1000;
  const efficiencyUnit =
    distanceUnit === 'mi'
      ? t('effTarget.whPerMi', 'Wh/mi')
      : t('effTarget.whPerKm', 'Wh/km');
  const targetDisplay = Math.round(targetWhPerKm * efficiencyScale);

  const handleTargetChange = (text: string) => {
    if (text === '') return;
    const next = Number(text);
    if (!Number.isFinite(next) || next <= 0) return;
    setTargetWhPerKm(next / efficiencyScale);
  };

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('effTarget.title', 'Efficiency Target')}
      />
    );
  }

  const sectionState: EfficiencyTargetSectionState = {
    isLoading: historyQuery.isLoading,
    error: historyQuery.isError ? historyQuery.error : null,
    onRetry: () => {
      void historyQuery.refetch();
    },
  };

  return (
    <PageContainer
      title={t('effTarget.title', 'Efficiency Target')}
      subtitle={t(
        'effTarget.subtitle',
        'A completed-week goal workspace built from the observed history window',
      )}
      query={historyQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <Input
            key={`efficiency-target-${distanceUnit}`}
            type="number"
            inputMode="numeric"
            min={1}
            step={5}
            aria-label={t(
              'effTarget.targetInput',
              'Weekly consumption target',
            )}
            defaultValue={targetDisplay}
            onChange={(event) => handleTargetChange(event.target.value)}
            suffix={<span className="whitespace-nowrap">{efficiencyUnit}</span>}
            className="max-w-[10rem]"
          />
        </div>
      }
    >
      <FadeIn>
        <EfficiencyTargetKpis
          summary={summary}
          targetWhPerKm={targetWhPerKm}
          state={sectionState}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <Grid cols={SPLIT_COLUMNS} gap={4}>
          <GoalPulse
            summary={summary}
            state={sectionState}
            className="xl:col-span-3"
          />
          <TargetConsistencyChart
            consistency={summary.consistency}
            state={sectionState}
            className="xl:col-span-2"
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.1}>
        <WeeklyTargetChart
          weeks={summary.weeks}
          targetWhPerKm={targetWhPerKm}
          state={sectionState}
        />
      </FadeIn>

      <FadeIn delay={0.15}>
        <Grid cols={SPLIT_COLUMNS} gap={4}>
          <WeekdayEfficiencyChart
            weekdays={summary.weekdays}
            targetWhPerKm={targetWhPerKm}
            state={sectionState}
            className="xl:col-span-2"
          />
          <RecentWeekScorecard
            completedWeeks={summary.completedWeeks}
            state={sectionState}
            className="xl:col-span-3"
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.2}>
        <TargetMethodology
          summary={summary}
          historyLimit={DRIVE_HISTORY_LIMIT}
          state={sectionState}
        />
      </FadeIn>
    </PageContainer>
  );
}
