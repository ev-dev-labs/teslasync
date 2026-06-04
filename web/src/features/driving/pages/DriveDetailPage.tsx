import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { PrintButton } from '@/components/ui';
import { SectionErrorBoundary, AlertBanner } from '@/components/feedback';
import { ChartTimeRangeProvider } from '@/components/charts';
import { ShareDriveDialog } from '../components/ShareDriveDialog';
import { AIDriveCoaching } from '@/components/ai/AIDriveCoaching';
import { AISpeedProfileInsights } from '@/components/ai/AISpeedProfileInsights';
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
  WhyEndedPanel,
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

  if (isLoading) return <DriveDetailSkeleton />;

  /**
   * A drive can be persisted with all-zero aggregate fields when the
   * underlying signal_log slice contained only gear transitions (no
   * VehicleSpeed / Odometer / EnergyRemaining samples). In that case
   * HeroGauges, DriveStatCards, EnergySummaryPanel and MoreDetailsPanel
   * all render zero-valued metrics that read as "broken vehicle". Detect
   * that envelope and replace the four numeric-summary panels with a
   * single banner explaining the gap. Charts and route map already
   * gate themselves internally on an empty chartData / trail.
   */
  const hasTelemetryRows = (drive?.telemetry?.length ?? 0) > 0
    || (drive?.positions?.length ?? 0) > 0;
  const hasMeaningfulDriveStats = !!drive && (
    (drive.distanceM ?? 0) > 0
    || ((stats?.maxSpd ?? 0) > 0)
    || ((stats?.energyWh ?? 0) > 0)
    || hasTelemetryRows
  );

  return (
    <PageContainer
      title={t('driveDetail.title', 'Drive Detail')}
      error={error as Error | null}
      breadcrumbLabels={{
        '/drives/:id': drive
          ? `${drive.startAddress ?? t('driveDetail.title', 'Drive')} → ${drive.endAddress ?? ''}`
          : `Drive #${id}`,
      }}
      actions={
        <div data-print-hide className="flex items-center gap-2">
          <PrintButton />
        </div>
      }
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
          {!hasMeaningfulDriveStats && (
            <AlertBanner
              variant="info"
              title={t('driveDetail.noTelemetryTitle', 'No telemetry recorded for this drive')}
            >
              {t(
                'driveDetail.noTelemetryBody',
                'Only the start/end timestamps and battery levels are available. Distance, speed, energy and route data require live telemetry samples — none were captured during this drive.',
              )}
            </AlertBanner>
          )}
          {hasMeaningfulDriveStats && (
            <SectionErrorBoundary name="drive-detail:hero-gauges" fallbackTitle={t('driveDetail.section.heroGaugesFailed', 'Hero gauges failed to load')}>
              <HeroGauges drive={drive} stats={stats} />
            </SectionErrorBoundary>
          )}
          <SectionErrorBoundary name="drive-detail:timeline" fallbackTitle={t('driveDetail.section.timelineFailed', 'Drive timeline failed to load')}>
            <DriveTimeline drive={drive} />
          </SectionErrorBoundary>
          {hasMeaningfulDriveStats && (
            <SectionErrorBoundary name="drive-detail:stat-cards" fallbackTitle={t('driveDetail.section.statCardsFailed', 'Drive stats failed to load')}>
              <DriveStatCards drive={drive} stats={stats} />
            </SectionErrorBoundary>
          )}
          {/*
            Per-drive coaching narrative (AI, opt-in).

            This is the AI surface for the drive detail page. It is
            wrapped in withAiFeature('drive-coaching', …) so it
            renders ONLY when ai_mode != 'off' AND the drive-coaching
            toggle is on (ADR-015 §I5 + §I6). When AI is off the
            wrapper returns null — the surrounding stat-card stack
            and downstream sections are unaffected, which is the
            invariant TestDriveCoachingAIOffShowsOnlyBaselineStats
            verifies.

            Placement: directly after the DriveStatCards block so
            the coaching narrative appears alongside the same
            metrics the LLM is reading from (stat cards above ↔
            narrative below ↔ deep dives further down the page).
          */}
          <SectionErrorBoundary name="drive-detail:ai-coaching" fallbackTitle={t('driveDetail.section.aiCoachingFailed', 'Helix drive coaching failed to load')}>
            <AIDriveCoaching driveId={id} />
          </SectionErrorBoundary>
          {hasMeaningfulDriveStats && (
            <SectionErrorBoundary name="drive-detail:more-details" fallbackTitle={t('driveDetail.section.moreDetailsFailed', 'More details failed to load')}>
              <MoreDetailsPanel drive={drive} stats={stats} />
            </SectionErrorBoundary>
          )}
          {hasMeaningfulDriveStats && (
            <SectionErrorBoundary name="drive-detail:energy-summary" fallbackTitle={t('driveDetail.section.energySummaryFailed', 'Energy summary failed to load')}>
              <EnergySummaryPanel drive={drive} stats={stats} />
            </SectionErrorBoundary>
          )}
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
          {/*
            Every chart in this block reads `chartData`
            from the same `useDriveDetailData` source, so they share row
            indices. Wrapping in `<ChartTimeRangeProvider>` lets recharts'
            native syncId mechanism mirror the hover cursor across all charts;
            the `<ChartBrush>` rendered inside `<DriveOverviewChart>` then
            zooms every synced chart simultaneously.
          */}
          <ChartTimeRangeProvider syncId="drive-detail">
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
            <SectionErrorBoundary name="drive-detail:ai-speed-profile-insights" fallbackTitle={t('driveDetail.section.aiSpeedProfileInsightsFailed', 'Helix speed-profile insights failed to load')}>
              <AISpeedProfileInsights driveId={id} />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="drive-detail:power-profile" fallbackTitle={t('driveDetail.section.powerProfileFailed', 'Power profile chart failed to load')}>
              <PowerProfileChart chartData={chartData} stats={stats} />
            </SectionErrorBoundary>
          </ChartTimeRangeProvider>
          <SectionErrorBoundary name="drive-detail:tire-pressure" fallbackTitle={t('driveDetail.section.tirePressureFailed', 'Tire pressure section failed to load')}>
            <TirePressureSection chartData={chartData} stats={stats} />
          </SectionErrorBoundary>
          {id && (
            <SectionErrorBoundary name="drive-detail:why-ended" fallbackTitle={t('driveDetail.section.whyEndedFailed', 'Why-ended diagnostic failed to load')}>
              <WhyEndedPanel driveId={id} />
            </SectionErrorBoundary>
          )}
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
