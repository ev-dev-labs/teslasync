import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { ShareDriveDialog } from '../components/ShareDriveDialog';
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  useDriveDetailData,
  DriveDetailSkeleton,
  DriveDetailHeader,
  HeroGauges,
  DriveTimeline,
  DriveStatCards,
  MoreDetailsPanel,
  EnergySummaryPanel,
  CostSavingsPanel,
  RouteMapSection,
  JourneyDetailsPanel,
  DriveOverviewChart,
  SocChart,
  ElevationChart,
  TemperatureSection,
  SpeedHistogramChart,
  PowerProfileChart,
  TirePressureSection,
} from '../components/drive-detail';

export default function DriveDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  usePageTitle(t('driveDetail.title', 'Drive Detail'));

  const {
    drive, vehicle, isLoading, error,
    chartData, stats, trail, startPos, endPos, centerPos, speedSegments, speedHistData,
  } = useDriveDetailData(id ?? '');

  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const breadcrumbs = useBreadcrumbs({
    '/drives/:id': drive
      ? `${drive.startAddress ?? t('driveDetail.title', 'Drive')} → ${drive.endAddress ?? ''}`
      : `Drive #${id}`,
  });

  if (isLoading) return <DriveDetailSkeleton />;

  return (
    <PageContainer
      title={t('driveDetail.title', 'Drive Detail')}
      error={error as Error | null}
      breadcrumbs={breadcrumbs}
    >
      {drive && stats && (
        <>
          <DriveDetailHeader
            drive={drive}
            driveId={id ?? ''}
            vehicleName={vehicle?.display_name || t('driveDetail.vehicle', 'Vehicle')}
            onShare={() => setShareDialogOpen(true)}
          />
          <HeroGauges drive={drive} stats={stats} />
          <DriveTimeline drive={drive} />
          <DriveStatCards drive={drive} stats={stats} />
          <MoreDetailsPanel drive={drive} stats={stats} />
          <EnergySummaryPanel drive={drive} stats={stats} />
          {stats.energyWh > 0 && <CostSavingsPanel drive={drive} stats={stats} />}
          <RouteMapSection
            drive={drive}
            trail={trail}
            startPos={startPos}
            endPos={endPos}
            centerPos={centerPos}
            speedSegments={speedSegments}
          />
          <JourneyDetailsPanel drive={drive} />
          <DriveOverviewChart drive={drive} chartData={chartData} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SocChart chartData={chartData} />
            <ElevationChart chartData={chartData} stats={stats} />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <TemperatureSection chartData={chartData} stats={stats} />
            <SpeedHistogramChart speedHistData={speedHistData} />
          </div>
          <PowerProfileChart chartData={chartData} stats={stats} />
          <TirePressureSection chartData={chartData} stats={stats} />
        </>
      )}
      {id && (
        <ShareDriveDialog
          driveId={id}
          open={shareDialogOpen}
          onClose={() => setShareDialogOpen(false)}
        />
      )}
    </PageContainer>
  );
}
