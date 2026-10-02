import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Play, Share2 } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { Button, PrintButton, Text } from '@/components/ui';
import { DataProvenanceBadge } from '@/components/data-display';
import { AlertBanner, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { ChartTimeRangeProvider } from '@/components/charts';
import { ShareDriveDialog } from '../components/ShareDriveDialog';
import { AIDriveCoaching } from '@/components/ai/AIDriveCoaching';
import { AISpeedProfileInsights } from '@/components/ai/AISpeedProfileInsights';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useTimezone } from '@/lib/timezone';
import { useFsdInsightsForDrive } from '@/api/hooks/useAnalytics';
import { DriveDetailSection } from '../components/drive-detail/DriveDetailSection';
import {
  useDriveDetailData, DriveDetailSkeleton, HeroGauges,
  DrivePhysicsDebriefPanel, SupervisedDrivingPanel, GearTheaterPanel,
  SilentCounterPanel, DriveLedgerCompactPanel, MoreDetailsPanel,
  CostSavingsPanel, RouteMapSection, JourneyDetailsPanel, DriveOverviewChart,
  SocChart, ElevationChart, TemperatureSection, SpeedHistogramChart,
  PowerProfileChart, TirePressureSection, WhyEndedPanel, RoadAnomalyPanel,
} from '../components/drive-detail';

/**
 * A drive report, not a second drives workspace.
 *
 * Ownership of facts:
 * - Journey: addresses, endpoint coordinates, timestamps and endpoint SOC.
 * - Overview: aggregate distance / duration / speed / consumption, baselines.
 * - Energy evidence: energy sources, odometer and range endpoints.
 * - Charts: sample statistics, not a second copy of persisted aggregates.
 * - Cost: configured-rate estimates, never a charging invoice.
 * - FSD / physics: their own attribution, uncertainty and missing signals.
 *
 * Each source stays isolated. A failed refresh must not erase a retained
 * historical record; a missing record must not remove the report's sections.
 */
export default function DriveDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  usePageTitle(t('driveDetail.title', 'Drive detail'));
  const {
    drive, vehicle, isLoading, driveQuery, chartData, stats, routeSource,
    trail, startPos, endPos, centerPos, speedSegments, speedHistData,
  } = useDriveDetailData(id ?? '');
  const driveState = useDataState(driveQuery, { provenance: 'historical' });
  const timezone = useTimezone('vehicle');
  const fsdQuery = useFsdInsightsForDrive(
    drive ? String(drive.vehicleId) : undefined, id, timezone, true,
  );
  const fsdState = useDataState(fsdQuery, { provenance: 'historical' });
  const contributingDrives = fsdState.data?.drive_analytics?.contributing_drives ?? [];
  const fsdInsight = contributingDrives.find((candidate) => candidate.drive_id === drive?.id);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  // A telemetry-gap notice is additional context, never a reason to remove
  // panels or display a zero-valued peak. The panel owns its missing values.
  const hasTelemetryRows = (drive?.telemetry?.length ?? 0) > 0
    || (drive?.positions?.length ?? 0) > 0;
  const hasMeaningfulDriveStats = !!drive && (
    (drive.distanceM ?? 0) > 0 || (stats?.maxSpd ?? 0) > 0
    || (stats?.energyWh ?? 0) > 0 || hasTelemetryRows
  );
  const routeTitle = drive?.startAddress && drive?.endAddress
    ? `${drive.startAddress} → ${drive.endAddress}`
    : t('driveDetail.title', 'Drive detail');
  const available = drive != null && stats != null;
  const reportSections = [
    { id: 'journey', label: t('driveDetail.journeyDetails', 'Journey details') },
    { id: 'overview', label: t('driveDetail.report.overview', 'Overview') },
    { id: 'route', label: t('driveDetail.route', 'Route') },
    { id: 'telemetry', label: t('driveDetail.report.telemetry', 'Telemetry') },
    { id: 'energy', label: t('driveDetail.report.energy', 'Energy and cost') },
    { id: 'supervised', label: t('driveDetail.fsd.title', 'Supervised driving') },
    { id: 'physics', label: t('driveDetail.debrief.title', 'Post-drive physics') },
    { id: 'diagnostics', label: t('driveDetail.report.diagnostics', 'Diagnostics') },
  ];

  return (
    <PageContainer
      title={routeTitle}
      compactHeader
      busy={isLoading}
      breadcrumbLabels={{
        '/drives/:id': drive
          ? routeTitle
          : t('driveDetail.breadcrumbFallback', 'Drive #{{id}}', { id: id ?? '' }),
      }}
      metadataActions={
        <DataProvenanceBadge provenance={driveState.provenance} status={driveState.status} updatedAt={driveState.updatedAt} />
      }
      secondaryActions={
        <Link to="/drives">
          <Button variant="ghost" size="sm" aria-label={t('driveDetail.backToDrives', 'Back to drives')} icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />} />
        </Link>
      }
      primaryAction={id ? (
        <Link to={`/drives/${id}/replay`}>
          <Button variant="secondary" size="sm" icon={<Play className="h-4 w-4" aria-hidden="true" />}>
            {t('driveDetail.replay', 'Replay')}
          </Button>
        </Link>
      ) : undefined}
      overflowActions={
        <div data-print-hide className="flex items-center gap-2">
          {id ? (
            <Button variant="ghost" size="sm" onClick={() => setShareDialogOpen(true)} icon={<Share2 className="h-4 w-4" aria-hidden="true" />}>
              {t('driveDetail.share', 'Share')}
            </Button>
          ) : null}
          <PrintButton />
        </div>
      }
    >
      <Text as="p" variant="caption">
        {vehicle?.display_name || t('driveDetail.vehicle', 'Vehicle')}
        {' · '}
        {t('driveDetail.breadcrumbFallback', 'Drive #{{id}}', { id: id ?? '—' })}
      </Text>
      {isLoading ? <DriveDetailSkeleton /> : null}
      {driveState.fatalError ? (
        <QueryError error={driveState.fatalError} onRetry={() => { void driveQuery.refetch(); }} />
      ) : null}
      {!isLoading && !drive && !driveState.fatalError ? (
        <AlertBanner variant="info">
          {t('driveDetail.notFound', 'This drive could not be found. It may have been deleted, or the link is incorrect.')}
        </AlertBanner>
      ) : null}
      <StaleRefreshWarning state={driveState} label={t('driveDetail.title', 'Drive detail')} />
      <StaleRefreshWarning state={fsdState} label={t('driveDetail.fsd.title', 'Supervised driving')} />
      {!isLoading && drive && !hasMeaningfulDriveStats ? (
        <AlertBanner variant="info" title={t('driveDetail.noTelemetryTitle', 'No telemetry recorded for this drive')}>
          {t('driveDetail.noTelemetryBody', 'Only the start/end timestamps and battery levels are available. Distance, speed, energy and route data require live telemetry samples — none were captured during this drive.')}
        </AlertBanner>
      ) : null}

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <DriveDetailSection id="journey" title={reportSections[0].label} available={drive != null}>
          {drive ? <JourneyDetailsPanel drive={drive} /> : null}
        </DriveDetailSection>
        <DriveDetailSection id="route" testId="drive-detail-route" title={reportSections[2].label} available={drive != null}>
          {drive ? (
            <RouteMapSection
              drive={drive} trail={trail} startPos={startPos} endPos={endPos}
              centerPos={centerPos} speedSegments={speedSegments}
              routePoints={routeSource} fsdEvidence={fsdInsight?.evidence}
            />
          ) : null}
        </DriveDetailSection>
      </div>
      <DriveDetailSection id="overview" testId="drive-detail-summary" title={reportSections[1].label} available={available}>
        {drive && stats ? <HeroGauges drive={drive} stats={stats} meaningful={hasMeaningfulDriveStats} /> : null}
      </DriveDetailSection>

      <div id="energy" className="grid min-w-0 scroll-mt-24 gap-4 xl:grid-cols-2">
        <DriveDetailSection id="energy-evidence" title={t('driveDetail.moreDetails', 'More details')} available={available}>
          {drive && stats ? <MoreDetailsPanel drive={drive} stats={stats} chartData={chartData} /> : null}
        </DriveDetailSection>
        <DriveDetailSection id="cost-estimate" title={t('driveDetail.costSavings', 'Cost and savings')} available={available}>
          {drive && stats ? <CostSavingsPanel drive={drive} stats={stats} /> : null}
        </DriveDetailSection>
      </div>
      <div id="supervised" className="grid min-w-0 scroll-mt-24 gap-4 xl:grid-cols-2">
        <DriveDetailSection id="fsd-evidence" title={reportSections[5].label}>
          <SupervisedDrivingPanel insight={fsdInsight} isLoading={fsdState.status === 'initial'} error={fsdState.fatalError} isOngoing={!!drive && !drive.endTs} />
        </DriveDetailSection>
        <DriveDetailSection id="silent-counter" title={t('driveDetail.silent.title', 'Counter silent while moving')}>
          <SilentCounterPanel driveId={id} />
        </DriveDetailSection>
      </div>

      {/* The brush and hover cursor still share the same sample indices.
          The aggregate overview above is deliberately outside this provider. */}
      <ChartTimeRangeProvider syncId="drive-detail">
        <div data-testid="drive-detail-evidence" className="space-y-4">
          <DriveDetailSection id="telemetry" title={reportSections[3].label} available={drive != null}>
            {drive ? <DriveOverviewChart drive={drive} chartData={chartData} /> : null}
          </DriveDetailSection>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <DriveDetailSection id="battery-trace" title={t('driveDetail.soc', 'SOC')} available={available}>
              <SocChart chartData={chartData} />
            </DriveDetailSection>
            <DriveDetailSection id="speed-distribution" title={t('driveDetail.speedHistogram', 'Speed histogram')} available={available}>
              <SpeedHistogramChart speedHistData={speedHistData} />
            </DriveDetailSection>
            <DriveDetailSection id="power-trace" title={t('driveDetail.powerProfile', 'Power profile')} available={available}>
              {stats ? <PowerProfileChart chartData={chartData} stats={stats} drive={drive ?? undefined} /> : null}
            </DriveDetailSection>
            <DriveDetailSection id="elevation-trace" title={t('driveDetail.elevProfile', 'Elevation profile')} available={available}>
              {stats ? <ElevationChart chartData={chartData} stats={stats} /> : null}
            </DriveDetailSection>
            <DriveDetailSection id="temperature-trace" title={t('driveDetail.temperatures', 'Temperatures')} available={available}>
              {stats ? <TemperatureSection chartData={chartData} stats={stats} /> : null}
            </DriveDetailSection>
            <DriveDetailSection id="tire-trace" title={t('driveDetail.tirePressure', 'Tire pressure during drive')} available={available}>
              {stats ? <TirePressureSection chartData={chartData} stats={stats} /> : null}
            </DriveDetailSection>
          </div>
          {/* These wrappers retain ADR-015 opt-in gating; AI off means no AI UI. */}
          <DriveDetailSection id="speed-insights" title={t('driveDetail.report.speedInsights', 'Helix speed-profile insights')}>
            <AISpeedProfileInsights driveId={drive ? id : undefined} />
          </DriveDetailSection>
        </div>
      </ChartTimeRangeProvider>

      <div id="physics" className="space-y-4 scroll-mt-24">
        <DriveDetailSection id="physics-debrief" title={reportSections[6].label}>
          <DrivePhysicsDebriefPanel stats={stats} chartData={chartData} fsdInsight={fsdInsight} />
        </DriveDetailSection>
        <DriveDetailSection id="physics-ledger" title={t('driveDetail.ledger.title', 'Energy ledger')}>
          <DriveLedgerCompactPanel driveId={id} />
        </DriveDetailSection>
        <DriveDetailSection id="coaching" title={t('driveDetail.report.coaching', 'Helix drive coaching')}>
          <AIDriveCoaching driveId={drive ? id : undefined} />
        </DriveDetailSection>
      </div>

      <div id="diagnostics" className="space-y-4 scroll-mt-24">
        <DriveDetailSection id="gear-theater" title={t('driveDetail.theater.title', 'Gear theater')}>
          <GearTheaterPanel driveId={id} />
        </DriveDetailSection>
        <DriveDetailSection id="road-analysis" title={t('driveDetail.road.title', 'Possible road-surface anomalies')} available={!!id}>
          {id ? <RoadAnomalyPanel driveId={id} /> : null}
        </DriveDetailSection>
        <DriveDetailSection id="why-ended" title={t('driveDetail.whyEnded.title', 'Why did this drive end?')} available={!!id}>
          {id ? <WhyEndedPanel driveId={id} /> : null}
        </DriveDetailSection>
      </div>
      {/* Dialog state is scoped to the routed record, not the example /412. */}
      {id ? <ShareDriveDialog key={id} driveId={id} open={shareDialogOpen} onClose={() => setShareDialogOpen(false)} /> : null}
    </PageContainer>
  );
}
