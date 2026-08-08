import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useDriveHistory,
  useDriveTelemetry,
} from '@/api/hooks/useDriving';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Select } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { useTimezone } from '@/lib/timezone';
import type { Drive } from '@/types/driving';

import {
  DriveDnaCoverageCadence,
  DriveDnaEncodingLegend,
  DriveDnaFingerprintPanel,
  DriveDnaGenomePanel,
  DriveDnaKpiBand,
  DriveDnaMethodology,
  DriveDnaPowerDistribution,
  DriveDnaSocElevationChart,
  DriveDnaSpeedDistribution,
  DriveDnaSpeedPowerChart,
  type DriveDnaSectionState,
} from '../components/drive-dna';
import { buildDriveDnaModel } from '../lib/driveDNA';

const DRIVE_HISTORY_LIMIT = 1_000;
const HERO_COLUMNS = { default: 1, xl: 3 } as const;
const CHART_COLUMNS = { default: 1, xl: 2 } as const;

export default function DriveDNAPage() {
  const { t } = useTranslation();
  usePageTitle(t('driveDna.title', 'Drive DNA'));
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const timezone = useTimezone('vehicle');
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDriveHistory(vehicleIdStr, DRIVE_HISTORY_LIMIT);
  const hasDriveListData =
    vehicleId != null && drivesQuery.data !== undefined;
  const listIsResolved =
    vehicleId != null && (hasDriveListData || drivesQuery.isSuccess);
  const drives = useMemo<Drive[]>(
    () => (vehicleId != null ? drivesQuery.data ?? [] : []),
    [drivesQuery.data, vehicleId],
  );
  const [selectedId, setSelectedId] = useState('');
  const activeDrive = useMemo(
    () => drives.find((drive) => String(drive.id) === selectedId) ?? drives[0] ?? null,
    [drives, selectedId],
  );
  const activeId = activeDrive ? String(activeDrive.id) : '';
  const telemetryQuery = useDriveTelemetry(activeId);
  const hasTelemetryData =
    activeId !== '' && telemetryQuery.data !== undefined;
  const telemetryIsResolved =
    activeId !== '' && (hasTelemetryData || telemetryQuery.isSuccess);
  const telemetryData =
    activeId !== '' ? telemetryQuery.data : undefined;
  const model = useMemo(
    () => buildDriveDnaModel(telemetryData),
    [telemetryData],
  );
  const capReached =
    listIsResolved && drives.length >= DRIVE_HISTORY_LIMIT;
  const driveOptions = useMemo(
    () =>
      drives.map((drive) => ({
        value: String(drive.id),
        label: t(
          'driveDna.selector.option',
          '{{date}} · {{distance}}',
          {
            date: formatDateTime(drive.startTs, { tz: timezone }),
            distance: units.formatDistance(drive.distanceM, { precision: 1 }),
          },
        ),
      })),
    [drives, t, timezone, units],
  );
  const driveLabel = activeDrive
    ? t('driveDna.selector.driveLabel', 'Drive on {{date}}', {
        date: formatDateTime(activeDrive.startTs, { tz: timezone }),
      })
    : t('driveDna.title', 'Drive DNA');
  const state = useMemo<DriveDnaSectionState>(
    () => ({
      vehicleSelected: vehicleId != null,
      hasDrive: activeDrive != null,
      list: {
        isLoading:
          vehicleId != null &&
          !hasDriveListData &&
          drivesQuery.isLoading,
        isResolved: listIsResolved,
        error:
          drivesQuery.isError && !hasDriveListData
            ? drivesQuery.error
            : null,
        refreshError:
          drivesQuery.isError && hasDriveListData
            ? drivesQuery.error
            : null,
        onRetry: () => void drivesQuery.refetch(),
      },
      telemetry: {
        isLoading:
          activeId !== '' &&
          !hasTelemetryData &&
          telemetryQuery.isLoading,
        isResolved: telemetryIsResolved,
        error:
          telemetryQuery.isError && !hasTelemetryData
            ? telemetryQuery.error
            : null,
        refreshError:
          telemetryQuery.isError && hasTelemetryData
            ? telemetryQuery.error
            : null,
        onRetry: () => void telemetryQuery.refetch(),
      },
    }),
    [
      activeDrive,
      activeId,
      drivesQuery,
      hasDriveListData,
      hasTelemetryData,
      listIsResolved,
      telemetryIsResolved,
      telemetryQuery,
      vehicleId,
    ],
  );
  const selectorPlaceholder = drivesQuery.isLoading
    ? t('driveDna.selector.loading', 'Loading drives…')
    : drivesQuery.isError && !hasDriveListData
      ? t('driveDna.selector.error', 'Drive list unavailable')
      : t('driveDna.selector.empty', 'No drives available');

  return (
    <PageContainer
      title={t('driveDna.title', 'Drive DNA')}
      subtitle={t(
        'driveDna.subtitle',
        'Deterministic artwork and sampled evidence from one selected drive’s telemetry emissions',
      )}
      actions={
        <div className="flex flex-wrap items-start justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <Select
            aria-label={t('driveDna.selector.aria', 'Choose a drive')}
            value={activeId}
            onChange={(event) => setSelectedId(event.target.value)}
            options={driveOptions}
            placeholder={selectorPlaceholder}
            disabled={driveOptions.length === 0}
            hint={
              capReached
                ? t(
                    'driveDna.selector.capReached',
                    'Newest 1,000 drives shown; older drives may be outside this selector.',
                  )
                : t(
                    'driveDna.selector.capHint',
                    'Selection history is capped at 1,000 recent drives.',
                  )
            }
          />
        </div>
      }
    >
      <FadeIn>
        <DriveDnaKpiBand drive={activeDrive} model={model} state={state} units={units} capReached={capReached} />
      </FadeIn>
      <FadeIn delay={0.05}>
        <Grid cols={HERO_COLUMNS} gap={4}>
          <div className="xl:col-span-2"><DriveDnaFingerprintPanel model={model} state={state} /></div>
          <DriveDnaGenomePanel model={model} state={state} driveLabel={driveLabel} units={units} />
        </Grid>
      </FadeIn>
      <FadeIn delay={0.1}><DriveDnaEncodingLegend model={model} state={state} units={units} /></FadeIn>
      <FadeIn delay={0.15}>
        <Grid cols={CHART_COLUMNS} gap={4}>
          <DriveDnaSpeedPowerChart model={model} state={state} units={units} />
          <DriveDnaSocElevationChart model={model} state={state} units={units} />
        </Grid>
      </FadeIn>
      <FadeIn delay={0.2}>
        <Grid cols={CHART_COLUMNS} gap={4}>
          <DriveDnaPowerDistribution model={model} state={state} units={units} />
          <DriveDnaSpeedDistribution model={model} state={state} units={units} />
        </Grid>
      </FadeIn>
      <FadeIn delay={0.25}><DriveDnaCoverageCadence model={model} state={state} units={units} /></FadeIn>
      <FadeIn delay={0.3}>
        <DriveDnaMethodology state={state} historyLimit={DRIVE_HISTORY_LIMIT} historyReturned={drives.length} capReached={capReached} />
      </FadeIn>
    </PageContainer>
  );
}
