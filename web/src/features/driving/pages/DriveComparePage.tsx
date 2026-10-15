import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { useDrive, useDrives } from '@/api/hooks/useDriving';

import { Grid, PageLayout } from '@/components/layout';
import { StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { Select } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { Drive } from '@/types/driving';

import {
  AdvantageBreakdown,
  BatteryComparisonChart,
  DriveIdentityCard,
  HeadToHeadGrid,
  SpeedComparisonChart,
  type CompareSectionState,
} from '../components/drive-compare';
import {
  compareDrives,
  normalizeDriveProfile,
  summarizeComparison,
} from '../lib/driveCompare';
import { CompareVerdictBrief } from '../components/operationalbrief-a-m/CompareVerdictBrief';

const DRIVE_HISTORY_WINDOW = { limit: 1000 } as const;
const HERO_COLUMNS = { default: 1, xl: 5 } as const;
const PAIR_COLUMNS = { default: 1, lg: 2 } as const;

export default function DriveComparePage() {
  const { t } = useTranslation();
  usePageTitle(t('driveCompare.title', 'Drive Compare'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance } = useUnits();
  const { formatDateShort } = useDateFormat();
  const drivesQuery = useDrives(vehicleIdStr, DRIVE_HISTORY_WINDOW);
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const drives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const [searchParams, setSearchParams] = useSearchParams();
  const hasDrive = (id: string) => drives.some((drive) => String(drive.id) === id);
  const requestedA = searchParams.get('drive_a') ?? '';
  const requestedB = searchParams.get('drive_b') ?? '';
  const activeA = requestedA
    ? requestedA
    : drives[0]
      ? String(drives[0].id)
      : '';
  const fallbackB = drives.find((drive) => String(drive.id) !== activeA);
  const activeB = requestedB
    ? requestedB
    : fallbackB
      ? String(fallbackB.id)
      : '';

  useEffect(() => {
    if (!activeA) return;
    const canonical = new URLSearchParams(searchParams);
    canonical.set('drive_a', activeA);
    if (activeB) canonical.set('drive_b', activeB);
    else canonical.delete('drive_b');
    if (canonical.toString() !== searchParams.toString()) {
      setSearchParams(canonical, { replace: true });
    }
  }, [activeA, activeB, searchParams, setSearchParams]);

  const updateSelection = (key: 'drive_a' | 'drive_b', value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const detailAId = vehicleId != null && hasDrive(activeA) ? activeA : '';
  const detailBId = vehicleId != null && hasDrive(activeB) ? activeB : '';
  const driveAQuery = useDrive(detailAId);
  const driveBQuery = useDrive(detailBId);
  const driveAState = useDataState(driveAQuery, { provenance: 'historical' });
  const driveBState = useDataState(driveBQuery, { provenance: 'historical' });
  const driveA = detailAId ? driveAQuery.data ?? null : null;
  const driveB = detailBId ? driveBQuery.data ?? null : null;
  const sameDrive = activeA !== '' && activeA === activeB;

  const rows = useMemo(
    () => driveA && driveB && !sameDrive ? compareDrives(driveA, driveB) : null,
    [driveA, driveB, sameDrive],
  );
  const summary = useMemo(() => rows ? summarizeComparison(rows) : null, [rows]);
  const profileA = useMemo(() => driveA ? normalizeDriveProfile(driveA) : null, [driveA]);
  const profileB = useMemo(() => driveB ? normalizeDriveProfile(driveB) : null, [driveB]);

  const driveOptions = useMemo(
    () => drives.map((drive) => ({
      value: String(drive.id),
      label: `${formatDateShort(drive.startTs)} · ${formatDistance(drive.distanceM)}`,
    })),
    [drives, formatDateShort, formatDistance],
  );

  const listError = drivesState.fatalError;
  const detailAError = detailAId ? driveAState.fatalError : null;
  const detailBError = detailBId ? driveBState.fatalError : null;
  // A paused first request is neither loading nor empty: report it neutrally.
  const pausedWithoutData = (state: { hasData: boolean; isRefreshBlocked: boolean; fatalError: Error | null }) =>
    !state.hasData && state.isRefreshBlocked && state.fatalError == null;
  const listPaused = pausedWithoutData(drivesState);
  const listLoading = drivesState.status === 'initial' && !listPaused;
  const unavailableSelection = t(
    'driveCompare.selectionUnavailable',
    "The requested drive is unavailable in this vehicle's loaded history window. Choose a drive to replace it.",
  );
  const unavailableA = !listLoading && !listPaused && !listError && activeA !== '' && !detailAId;
  const unavailableB = !listLoading && !listPaused && !listError && activeB !== '' && !detailBId;
  const optionsFor = (id: string) => id && !hasDrive(id)
    ? [{ value: id, label: listLoading
        ? t('driveCompare.loading', 'Loading drive comparison')
        : unavailableSelection, disabled: true }, ...driveOptions]
    : driveOptions;
  const needTwo = !listLoading && !listPaused && !listError && drives.length < 2;
  const selectionMessage = unavailableA || unavailableB
    ? unavailableSelection
    : needTwo
      ? t('driveCompare.needTwo', 'At least two drives are needed for a comparison.')
      : sameDrive
        ? t(
            'driveCompare.samePick',
            'Pick two different drives with the A and B selectors above to continue.',
          )
        : null;

  const detailAPaused = detailAId !== '' && pausedWithoutData(driveAState);
  const detailBPaused = detailBId !== '' && pausedWithoutData(driveBState);
  const combinedPaused = listPaused || detailAPaused || detailBPaused;
  const combinedLoading = !combinedPaused && (listLoading
    || (detailAId !== '' && driveAState.status === 'initial')
    || (detailBId !== '' && driveBState.status === 'initial'));
  const combinedError = listError ?? detailAError ?? detailBError;
  const missingDetails = !combinedLoading && !combinedPaused && !combinedError && !selectionMessage && (!driveA || !driveB)
    ? t('driveCompare.detailsUnavailable', 'Drive details are not available for this comparison.')
    : null;
  const compareState: CompareSectionState = {
    isLoading: combinedLoading,
    isPaused: combinedPaused,
    error: combinedError,
    emptyMessage: selectionMessage ?? missingDetails,
    onRetry: () => {
      void drivesQuery.refetch();
      if (detailAId) void driveAQuery.refetch();
      if (detailBId) void driveBQuery.refetch();
    },
  };

  const identityState = (
    side: 'a' | 'b',
    hasData: boolean,
  ): CompareSectionState => {
    const query = side === 'a' ? driveAQuery : driveBQuery;
    const detailError = side === 'a' ? detailAError : detailBError;
    const source = side === 'a' ? driveAState : driveBState;
    const activeId = side === 'a' ? detailAId : detailBId;
    const isPaused = listPaused || (activeId !== '' && pausedWithoutData(source));
    const isLoading = !isPaused && (listLoading || (activeId !== '' && source.status === 'initial'));
    const error = listError ?? detailError;
    const noDetail = !isLoading && !isPaused && !error && !selectionMessage && !hasData
      ? t('driveCompare.detailsUnavailable', 'Drive details are not available for this comparison.')
      : null;
    return {
      isLoading,
      isPaused,
      error,
      emptyMessage: (side === 'a' ? unavailableA : unavailableB)
        ? unavailableSelection
        : unavailableA || unavailableB ? noDetail : selectionMessage ?? noDetail,
      onRetry: () => {
        void drivesQuery.refetch();
        if (activeId) void query.refetch();
      },
    };
  };

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('driveCompare.title', 'Drive Compare')} />;
  }

  return (
    <PageLayout
      title={t('driveCompare.title', 'Drive Compare')}
      subtitle={t('driveCompare.subtitle', 'Compare context, efficiency, and telemetry from any two drives')}
      query={[drivesQuery, driveAQuery, driveBQuery]}
      contextActions={
        <div className="grid w-full min-w-0 max-w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {driveOptions.length > 0 || activeA || activeB ? (
            <>
              <Select
                label={t('driveCompare.pickA', 'Choose drive A')}
                aria-label={t('driveCompare.pickA', 'Choose drive A')}
                value={activeA}
                onChange={(event) => updateSelection('drive_a', event.target.value)}
                options={optionsFor(activeA)}
                hint={unavailableA ? unavailableSelection : undefined}
                size="sm"
              />
              <Select
                label={t('driveCompare.pickB', 'Choose drive B')}
                aria-label={t('driveCompare.pickB', 'Choose drive B')}
                value={activeB}
                onChange={(event) => updateSelection('drive_b', event.target.value)}
                options={optionsFor(activeB)}
                hint={unavailableB ? unavailableSelection : undefined}
                size="sm"
              />
            </>
          ) : null}
        </div>
      }
    >
      <StaleRefreshWarning state={drivesState} label={t('driveCompare.title', 'Drive Compare')} />
      <StaleRefreshWarning state={driveAState} label={t('driveCompare.pickA', 'Choose drive A')} />
      <StaleRefreshWarning state={driveBState} label={t('driveCompare.pickB', 'Choose drive B')} />
      <FadeIn>
        <section aria-label={t('driveCompare.sections.verdict', 'Comparison verdict and advantages')}>
          <Grid cols={HERO_COLUMNS} gap={4}>
            <CompareVerdictBrief
              summary={summary}
              state={compareState}
              className="xl:col-span-3"
              retained={driveAState.status === 'stale' || driveBState.status === 'stale'
                || driveAState.refreshError != null || driveBState.refreshError != null}
              browseAction={needTwo
                ? { label: t('driveCompare.browseDrives', 'Browse drives'), to: '/drives' }
                : undefined}
            />
            <AdvantageBreakdown
              rows={rows}
              summary={summary}
              state={compareState}
              className="xl:col-span-2"
            />
          </Grid>
        </section>
      </FadeIn>

      <FadeIn delay={0.05}>
        <section aria-label={t('driveCompare.sections.context', 'Drive identity and context')}>
          <Grid cols={PAIR_COLUMNS} gap={4}>
            <DriveIdentityCard side="a" drive={driveA} state={identityState('a', !!driveA)} />
            <DriveIdentityCard side="b" drive={driveB} state={identityState('b', !!driveB)} />
          </Grid>
        </section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <section aria-label={t('driveCompare.sections.profiles', 'Normalized telemetry comparisons')}>
          <Grid cols={PAIR_COLUMNS} gap={4}>
            <SpeedComparisonChart profileA={profileA} profileB={profileB} state={compareState} />
            <BatteryComparisonChart profileA={profileA} profileB={profileB} state={compareState} />
          </Grid>
        </section>
      </FadeIn>

      <FadeIn delay={0.15}>
        <HeadToHeadGrid
          rows={rows}
          startA={driveA?.startTs ?? null}
          startB={driveB?.startTs ?? null}
          state={compareState}
        />
      </FadeIn>
    </PageLayout>
  );
}
