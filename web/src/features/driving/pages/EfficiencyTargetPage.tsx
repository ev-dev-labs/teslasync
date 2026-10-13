import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveHistory } from '@/api/hooks/useDriving';

import { Grid, PageLayout } from '@/components/layout';
import { SectionErrorBoundary, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { Caption, Input } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useStoredNumber } from '@/hooks/useStoredNumber';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceToSI } from '@/lib/unitConversion';

import {
  GoalPulse,
  RecentWeekScorecard,
  TargetConsistencyChart,
  TargetMethodology,
  WeekdayEfficiencyChart,
  WeeklyTargetChart,
  type EfficiencyTargetSectionState,
} from '../components/efficiency-target';
import { summarizeTarget } from '../lib/efficiencyTarget';
import { EfficiencyTargetBrief } from '../components/operationalbrief-a-m/EfficiencyTargetBrief';

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
  const [, setCalendarRevision] = useState(0);
  const nowMs = Date.now();
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const nextMonday = new Date(now);
      nextMonday.setHours(0, 0, 0, 0);
      nextMonday.setDate(now.getDate() + 7 - ((now.getDay() + 6) % 7));
      timeout = setTimeout(() => {
        setCalendarRevision((revision) => revision + 1);
        schedule();
      }, nextMonday.getTime() - now.getTime());
    };
    schedule();
    return () => clearTimeout(timeout);
  }, []);
  const drives = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);
  const sourceState = useDataState(historyQuery, { provenance: 'historical' });
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
  const targetLabel = t('effTarget.targetInput', 'Weekly consumption target');
  const [targetDraft, setTargetDraft] = useState<{
    text: string;
    canonical: number;
    unit: typeof distanceUnit;
  } | null>(null);
  const targetText =
    targetDraft?.canonical === targetWhPerKm && targetDraft.unit === distanceUnit
      ? targetDraft.text
      : String(targetDisplay);
  const targetInvalid =
    targetText.trim() === '' ||
    !Number.isFinite(Number(targetText)) ||
    Number(targetText) <= 0;

  const handleTargetChange = (text: string) => {
    const next = Number(text);
    const valid = text.trim() !== '' && Number.isFinite(next) && next > 0;
    const canonical = valid ? next / efficiencyScale : targetWhPerKm;
    setTargetDraft({ text, canonical, unit: distanceUnit });
    if (valid) setTargetWhPerKm(canonical);
  };

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('effTarget.title', 'Efficiency Target')}
      />
    );
  }

  const sectionState: EfficiencyTargetSectionState = {
    isLoading: sourceState.status === 'initial',
    error: sourceState.fatalError,
    onRetry: () => {
      void historyQuery.refetch();
    },
  };

  return (
    <PageLayout
      title={t('effTarget.title', 'Efficiency Target')}
      subtitle={t(
        'effTarget.subtitle',
        'A completed-week goal workspace built from the observed history window',
      )}
      query={historyQuery}
      contextActions={
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step={5}
            label={targetLabel}
            aria-label={targetLabel}
            value={targetText}
            error={targetInvalid ? t('common.invalidNumber', 'Enter a valid number') : undefined}
            hint={t('effTarget.kpi.canonical', 'Saved canonically in Wh/km')}
            onChange={(event) => handleTargetChange(event.target.value)}
            suffix={<Caption className="whitespace-nowrap">{efficiencyUnit}</Caption>}
            className="w-40 min-h-11 md:min-h-10"
          />
        </div>
      }
    >
      <StaleRefreshWarning state={sourceState} label={t('effTarget.title', 'Efficiency Target')} />
      <SectionErrorBoundary name="EfficiencyTargetBrief">
        <EfficiencyTargetBrief
          summary={summary}
          targetWhPerKm={targetWhPerKm}
          state={sectionState}
          retained={sourceState.status === 'stale' || sourceState.refreshError != null}
        />
      </SectionErrorBoundary>

      <Grid cols={SPLIT_COLUMNS} gap={4}>
        <SectionErrorBoundary name="EfficiencyTargetGoalPulse">
          <GoalPulse
            summary={summary}
            state={sectionState}
            className="xl:col-span-3"
          />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="EfficiencyTargetConsistency">
          <TargetConsistencyChart
            consistency={summary.consistency}
            state={sectionState}
            className="xl:col-span-2"
          />
        </SectionErrorBoundary>
      </Grid>

      <SectionErrorBoundary name="EfficiencyTargetWeekly">
        <WeeklyTargetChart
          weeks={summary.weeks}
          targetWhPerKm={targetWhPerKm}
          state={sectionState}
        />
      </SectionErrorBoundary>

      <Grid cols={SPLIT_COLUMNS} gap={4}>
        <SectionErrorBoundary name="EfficiencyTargetWeekday">
          <WeekdayEfficiencyChart
            weekdays={summary.weekdays}
            targetWhPerKm={targetWhPerKm}
            state={sectionState}
            className="xl:col-span-2"
          />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="EfficiencyTargetScorecard">
          <RecentWeekScorecard
            completedWeeks={summary.completedWeeks}
            state={sectionState}
            className="xl:col-span-3"
          />
        </SectionErrorBoundary>
      </Grid>

      <SectionErrorBoundary name="EfficiencyTargetMethodology">
        <TargetMethodology
          summary={summary}
          historyLimit={DRIVE_HISTORY_LIMIT}
          state={sectionState}
        />
      </SectionErrorBoundary>
    </PageLayout>
  );
}
