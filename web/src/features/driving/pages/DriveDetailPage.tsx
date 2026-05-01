import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { SectionErrorBoundary } from '@/components/feedback';
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
          <SectionErrorBoundary name="drive-detail:header" fallbackTitle={t('driveDetail.section.headerFailed', 'Drive header failed to load')}>
            <DriveDetailHeader
              drive={drive}
              driveId={id ?? ''}
              vehicleName={vehicle?.display_name || t('driveDetail.vehicle', 'Vehicle')}
              onShare={() => setShareDialogOpen(true)}
            />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="drive-detail:hero-gauges" fallbackTitle={t('driveDetail.section.heroGaugesFailed', 'Hero gauges failed to load')}>
            <HeroGauges drive={drive} stats={stats} />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="drive-detail:timeline" fallbackTitle={t('driveDetail.section.timelineFailed', 'Drive timeline failed to load')}>
            <DriveTimeline drive={drive} />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="drive-detail:stat-cards" fallbackTitle={t('driveDetail.section.statCardsFailed', 'Drive stats failed to load')}>
            <DriveStatCards drive={drive} stats={stats} />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="drive-detail:more-details" fallbackTitle={t('driveDetail.section.moreDetailsFailed', 'More details failed to load')}>
            <MoreDetailsPanel drive={drive} stats={stats} />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="drive-detail:energy-summary" fallbackTitle={t('driveDetail.section.energySummaryFailed', 'Energy summary failed to load')}>
            <EnergySummaryPanel drive={drive} stats={stats} />
          </SectionErrorBoundary>
          {stats.energyWh > 0 && (
            <SectionErrorBoundary name="drive-detail:cost-savings" fallbackTitle={t('driveDetail.section.costSavingsFailed', 'Cost savings panel failed to load')}>
              <CostSavingsPanel drive={drive} stats={stats} />
            </SectionErrorBoundary>
          )}
          <SectionErrorBoundary name="drive-detail:route-map" fallbackTitle={t('driveDetail.section.routeMapFailed', 'Route map failed to load')}>
            <RouteMapSection
              drive={drive}
              trail={trail}
              startPos={startPos}
              endPos={endPos}
              centerPos={centerPos}
              speedSegments={speedSegments}
            />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="drive-detail:journey-details" fallbackTitle={t('driveDetail.section.journeyDetailsFailed', 'Journey details failed to load')}>
            <JourneyDetailsPanel drive={drive} />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="drive-detail:overview-chart" fallbackTitle={t('driveDetail.section.overviewChartFailed', 'Drive overview chart failed to load')}>
            <DriveOverviewChart drive={drive} chartData={chartData} />
          </SectionErrorBoundary>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionErrorBoundary name="drive-detail:soc-chart" fallbackTitle={t('driveDetail.section.socChartFailed', 'SOC chart failed to load')}>
              <SocChart chartData={chartData} />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="drive-detail:elevation-chart" fallbackTitle={t('driveDetail.section.elevationChartFailed', 'Elevation chart failed to load')}>
              <ElevationChart chartData={chartData} stats={stats} />
            </SectionErrorBoundary>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionErrorBoundary name="drive-detail:temperature" fallbackTitle={t('driveDetail.section.temperatureFailed', 'Temperature section failed to load')}>
              <TemperatureSection chartData={chartData} stats={stats} />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="drive-detail:speed-histogram" fallbackTitle={t('driveDetail.section.speedHistogramFailed', 'Speed histogram failed to load')}>
              <SpeedHistogramChart speedHistData={speedHistData} />
            </SectionErrorBoundary>
          </div>
          <SectionErrorBoundary name="drive-detail:power-profile" fallbackTitle={t('driveDetail.section.powerProfileFailed', 'Power profile chart failed to load')}>
            <PowerProfileChart chartData={chartData} stats={stats} />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="drive-detail:tire-pressure" fallbackTitle={t('driveDetail.section.tirePressureFailed', 'Tire pressure section failed to load')}>
            <TirePressureSection chartData={chartData} stats={stats} />
          </SectionErrorBoundary>
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
