import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Play, Share2 } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { Button, PrintButton, Text } from '@/components/ui';
import { DataProvenanceBadge, DateTime } from '@/components/data-display';
import { SectionErrorBoundary, AlertBanner, StaleRefreshWarning } from '@/components/feedback';
import { ChartTimeRangeProvider } from '@/components/charts';
import { ShareDriveDialog } from '../components/ShareDriveDialog';
import { AIDriveCoaching } from '@/components/ai/AIDriveCoaching';
import { AISpeedProfileInsights } from '@/components/ai/AISpeedProfileInsights';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import {
  useDriveDetailData,
  DriveDetailSkeleton,
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
    drive, vehicle, isLoading, driveQuery,
    chartData, stats, trail, startPos, endPos, centerPos, speedSegments, speedHistData,
  } = useDriveDetailData(id ?? '');
  /* A drive is an immutable historical record. A failed refresh must not
   * delete the one the operator is reading — only a first load with nothing
   * retained may replace the page. */
  const driveState = useDataState(driveQuery, { provenance: 'historical' });

  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  if (isLoading) return <DriveDetailSkeleton />;

  /**
   * A drive can be persisted with all-zero aggregate fields when the
   * underlying signal_log slice contained only gear transitions (no
   * VehicleSpeed / Odometer / EnergyRemaining samples). In that case
   * HeroGauges, DriveStatCards, EnergySummaryPanel and MoreDetailsPanel
   * all render zero-valued metrics that read as "broken vehicle". Detect
   * that envelope and replace the numeric-summary panels with a single
   * banner explaining the gap. Charts and route map already gate
   * themselves internally on an empty chartData / trail.
   */
  const hasTelemetryRows = (drive?.telemetry?.length ?? 0) > 0
    || (drive?.positions?.length ?? 0) > 0;
  const hasMeaningfulDriveStats = !!drive && (
    (drive.distanceM ?? 0) > 0
    || ((stats?.maxSpd ?? 0) > 0)
    || ((stats?.energyWh ?? 0) > 0)
    || hasTelemetryRows
  );

  const routeTitle = drive?.startAddress && drive?.endAddress
    ? `${drive.startAddress} → ${drive.endAddress}`
    : t('driveDetail.title', 'Drive Detail');

  const vehicleName = vehicle?.display_name || t('driveDetail.vehicle', 'Vehicle');

  return (
    <PageContainer
      title={routeTitle}
      error={driveState.fatalError}
      empty={driveState.fatalError == null && !drive}
      emptyMessage={t(
        'driveDetail.notFound',
        'This drive could not be found. It may have been deleted, or the link is incorrect.',
      )}
      breadcrumbLabels={{
        '/drives/:id': drive
          ? `${drive.startAddress ?? t('driveDetail.title', 'Drive')} → ${drive.endAddress ?? ''}`
          : t('driveDetail.breadcrumbFallback', 'Drive #{{id}}', { id: id ?? '' }),
      }}
      actions={
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <DataProvenanceBadge
            provenance={driveState.provenance}
            status={driveState.status}
            updatedAt={driveState.updatedAt}
          />
          <Link to="/drives">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('driveDetail.backToDrives', 'Back to drives')}
              icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            />
          </Link>
          {id && (
            <Link to={`/drives/${id}/replay`}>
              <Button variant="ghost" size="sm" icon={<Play className="h-4 w-4" aria-hidden="true" />}>
                {t('driveDetail.replay', 'Replay')}
              </Button>
            </Link>
          )}
          {id && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShareDialogOpen(true)}
              icon={<Share2 className="h-4 w-4" aria-hidden="true" />}
            >
              {t('driveDetail.share', 'Share')}
            </Button>
          )}
          <PrintButton />
        </div>
      }
    >
      <StaleRefreshWarning
        state={driveState}
        label={t('driveDetail.title', 'Drive Detail')}
      />
      {drive && stats && (
        <>
          {/* Meta line — vehicle + drive window, replaces the redundant custom
              header h1 so PageContainer owns the single page-level heading. */}
          <Text as="p" variant="caption" className="-mt-2">
            {vehicleName}
            {' · '}
            <DateTime value={drive.startTs} variant="date" in="vehicle" />
            {' · '}
            <DateTime value={drive.startTs} variant="time" in="vehicle" showTz />
            {drive.endTs && (
              <>
                {' → '}
                <DateTime value={drive.endTs} variant="time" in="vehicle" />
              </>
            )}
          </Text>

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

          {/* Hero — headline summary of the drive. */}
          {hasMeaningfulDriveStats && (
            <SectionErrorBoundary name="drive-detail:hero-gauges" fallbackTitle={t('driveDetail.section.heroGaugesFailed', 'Hero gauges failed to load')}>
              <HeroGauges drive={drive} stats={stats} />
            </SectionErrorBoundary>
          )}

          <SectionErrorBoundary name="drive-detail:timeline" fallbackTitle={t('driveDetail.section.timelineFailed', 'Drive timeline failed to load')}>
            <DriveTimeline drive={drive} />
          </SectionErrorBoundary>

          {/* KPI band — full-width responsive stat grid. */}
          {hasMeaningfulDriveStats && (
            <SectionErrorBoundary name="drive-detail:stat-cards" fallbackTitle={t('driveDetail.section.statCardsFailed', 'Drive stats failed to load')}>
              <DriveStatCards drive={drive} stats={stats} />
            </SectionErrorBoundary>
          )}

          {/*
            Per-drive coaching narrative (AI, opt-in). Wrapped in
            withAiFeature('drive-coaching', …) so it renders ONLY when
            ai_mode != 'off' AND the drive-coaching toggle is on
            (ADR-015 §I5 + §I6). When AI is off the wrapper returns null —
            the surrounding stat-card stack and downstream sections are
            unaffected, which is the invariant
            TestDriveCoachingAIOffShowsOnlyBaselineStats verifies.
          */}
          <SectionErrorBoundary name="drive-detail:ai-coaching" fallbackTitle={t('driveDetail.section.aiCoachingFailed', 'Helix drive coaching failed to load')}>
            <AIDriveCoaching driveId={id} />
          </SectionErrorBoundary>

          {/* Detailed metrics — wide strip of secondary numbers. */}
          {hasMeaningfulDriveStats && (
            <SectionErrorBoundary name="drive-detail:more-details" fallbackTitle={t('driveDetail.section.moreDetailsFailed', 'More details failed to load')}>
              <MoreDetailsPanel drive={drive} stats={stats} />
            </SectionErrorBoundary>
          )}

          {/* Energy + cost bento — side-by-side on wide screens. */}
          {hasMeaningfulDriveStats && (
            <section
              aria-label={t('driveDetail.section.energyCost', 'Energy and cost')}
              className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-2"
            >
              <SectionErrorBoundary name="drive-detail:energy-summary" fallbackTitle={t('driveDetail.section.energySummaryFailed', 'Energy summary failed to load')}>
                <EnergySummaryPanel drive={drive} stats={stats} />
              </SectionErrorBoundary>
              {stats.energyWh > 0 && (
                <SectionErrorBoundary name="drive-detail:cost-savings" fallbackTitle={t('driveDetail.section.costSavingsFailed', 'Cost savings panel failed to load')}>
                  <CostSavingsPanel drive={drive} stats={stats} />
                </SectionErrorBoundary>
              )}
            </section>
          )}

          {/* Route + journey bento — map hero spans two columns on wide screens,
              journey summary fills the remaining column. */}
          <section
            aria-label={t('driveDetail.section.route', 'Route and journey')}
            className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-3"
          >
            <div className="xl:col-span-2">
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
            </div>
            <SectionErrorBoundary name="drive-detail:journey-details" fallbackTitle={t('driveDetail.section.journeyDetailsFailed', 'Journey details failed to load')}>
              <JourneyDetailsPanel drive={drive} />
            </SectionErrorBoundary>
          </section>

          {/*
            Every chart in this block reads `chartData` from the same
            `useDriveDetailData` source, so they share row indices. Wrapping in
            `<ChartTimeRangeProvider>` lets recharts' native syncId mechanism
            mirror the hover cursor across all charts; the `<ChartBrush>` inside
            `<DriveOverviewChart>` then zooms every synced chart simultaneously.
          */}
          <ChartTimeRangeProvider syncId="drive-detail">
            <div className="space-y-6">
              <SectionErrorBoundary name="drive-detail:overview-chart" fallbackTitle={t('driveDetail.section.overviewChartFailed', 'Drive overview chart failed to load')}>
                <DriveOverviewChart drive={drive} chartData={chartData} />
              </SectionErrorBoundary>

              {/* Detail charts — 1-col on phone, 2-col on desktop, 4-col on
                  ultra-wide (1920px+) so the row fills the screen. */}
              <section
                aria-label={t('driveDetail.section.detailCharts', 'Detailed drive charts')}
                className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 3xl:grid-cols-4"
              >
                <SectionErrorBoundary name="drive-detail:soc-chart" fallbackTitle={t('driveDetail.section.socChartFailed', 'SOC chart failed to load')}>
                  <SocChart chartData={chartData} />
                </SectionErrorBoundary>
                <SectionErrorBoundary name="drive-detail:elevation-chart" fallbackTitle={t('driveDetail.section.elevationChartFailed', 'Elevation chart failed to load')}>
                  <ElevationChart chartData={chartData} stats={stats} />
                </SectionErrorBoundary>
                <SectionErrorBoundary name="drive-detail:temperature" fallbackTitle={t('driveDetail.section.temperatureFailed', 'Temperature section failed to load')}>
                  <TemperatureSection chartData={chartData} stats={stats} />
                </SectionErrorBoundary>
                <SectionErrorBoundary name="drive-detail:speed-histogram" fallbackTitle={t('driveDetail.section.speedHistogramFailed', 'Speed histogram failed to load')}>
                  <SpeedHistogramChart speedHistData={speedHistData} />
                </SectionErrorBoundary>
              </section>

              <SectionErrorBoundary name="drive-detail:ai-speed-profile-insights" fallbackTitle={t('driveDetail.section.aiSpeedProfileInsightsFailed', 'Helix speed-profile insights failed to load')}>
                <AISpeedProfileInsights driveId={id} />
              </SectionErrorBoundary>
              <SectionErrorBoundary name="drive-detail:power-profile" fallbackTitle={t('driveDetail.section.powerProfileFailed', 'Power profile chart failed to load')}>
                <PowerProfileChart chartData={chartData} stats={stats} />
              </SectionErrorBoundary>
            </div>
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
