import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrive, useDrives } from '@/api/hooks/useDriving';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Select } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateShort } from '@/lib/dateFormat';
import type { Drive } from '@/types/driving';

import {
  AdvantageBreakdown,
  BatteryComparisonChart,
  ComparisonVerdict,
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

const DRIVE_HISTORY_WINDOW = { limit: 1000 } as const;
const HERO_COLUMNS = { default: 1, xl: 5 } as const;
const PAIR_COLUMNS = { default: 1, lg: 2 } as const;

export default function DriveComparePage() {
  const { t } = useTranslation();
  usePageTitle(t('driveCompare.title', 'Drive Compare'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance } = useUnits();
  const drivesQuery = useDrives(vehicleIdStr, DRIVE_HISTORY_WINDOW);
  const drives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const [idA, setIdA] = useState('');
  const [idB, setIdB] = useState('');
  const hasDrive = (id: string) => drives.some((drive) => String(drive.id) === id);
  const activeA = idA && hasDrive(idA) ? idA : (drives[0] ? String(drives[0].id) : '');
  const activeB = idB && hasDrive(idB) ? idB : (drives[1] ? String(drives[1].id) : '');

  const driveAQuery = useDrive(activeA);
  const driveBQuery = useDrive(activeB);
  const driveA = driveAQuery.data ?? null;
  const driveB = driveBQuery.data ?? null;
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
      label: `${formatDateShort(drive.startTs)} · ${formatDistance(drive.distanceM, { precision: 1 })}`,
    })),
    [drives, formatDistance],
  );

  const listError = drivesQuery.isError ? drivesQuery.error : null;
  const detailAError = driveAQuery.isError ? driveAQuery.error : null;
  const detailBError = driveBQuery.isError ? driveBQuery.error : null;
  const needTwo = !drivesQuery.isLoading && !listError && drives.length < 2;
  const selectionMessage = needTwo
    ? t('driveCompare.needTwo', 'At least two drives are needed for a comparison.')
    : sameDrive
      ? t(
          'driveCompare.samePick',
          'Pick two different drives with the A and B selectors above to continue.',
        )
      : null;

  const combinedLoading = drivesQuery.isLoading || driveAQuery.isLoading || driveBQuery.isLoading;
  const combinedError = listError ?? detailAError ?? detailBError;
  const missingDetails = !combinedLoading && !combinedError && !selectionMessage && (!driveA || !driveB)
    ? t('driveCompare.detailsUnavailable', 'Drive details are not available for this comparison.')
    : null;
  const compareState: CompareSectionState = {
    isLoading: combinedLoading,
    error: combinedError,
    emptyMessage: selectionMessage ?? missingDetails,
    onRetry: () => {
      void drivesQuery.refetch();
      if (activeA) void driveAQuery.refetch();
      if (activeB) void driveBQuery.refetch();
    },
  };

  const identityState = (
    side: 'a' | 'b',
    hasData: boolean,
  ): CompareSectionState => {
    const query = side === 'a' ? driveAQuery : driveBQuery;
    const detailError = side === 'a' ? detailAError : detailBError;
    const isLoading = drivesQuery.isLoading || query.isLoading;
    const error = listError ?? detailError;
    const noDetail = !isLoading && !error && !selectionMessage && !hasData
      ? t('driveCompare.detailsUnavailable', 'Drive details are not available for this comparison.')
      : null;
    return {
      isLoading,
      error,
      emptyMessage: selectionMessage ?? noDetail,
      onRetry: () => {
        void drivesQuery.refetch();
        if (side === 'a' ? activeA : activeB) void query.refetch();
      },
    };
  };

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('driveCompare.title', 'Drive Compare')} />;
  }

  return (
    <PageContainer
      title={t('driveCompare.title', 'Drive Compare')}
      subtitle={t('driveCompare.subtitle', 'Compare context, efficiency, and telemetry from any two drives')}
      query={[drivesQuery, driveAQuery, driveBQuery]}
      actions={
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          {driveOptions.length > 0 ? (
            <>
              <Select
                aria-label={t('driveCompare.pickA', 'Choose drive A')}
                value={activeA}
                onChange={(event) => setIdA(event.target.value)}
                options={driveOptions}
                size="sm"
              />
              <Select
                aria-label={t('driveCompare.pickB', 'Choose drive B')}
                value={activeB}
                onChange={(event) => setIdB(event.target.value)}
                options={driveOptions}
                size="sm"
              />
            </>
          ) : null}
        </div>
      }
    >
      <FadeIn>
        <section aria-label={t('driveCompare.sections.verdict', 'Comparison verdict and advantages')}>
          <Grid cols={HERO_COLUMNS} gap={4}>
            <ComparisonVerdict
              summary={summary}
              state={compareState}
              className="xl:col-span-3"
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
    </PageContainer>
  );
}
