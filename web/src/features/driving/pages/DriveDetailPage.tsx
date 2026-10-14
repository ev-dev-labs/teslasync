import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Play, Share2 } from 'lucide-react';
import { PageLayout } from '@/components/layout';
import { BUTTON_BASE, BUTTON_VARIANTS, Button, Icon, PrintButton, Text } from '@/components/ui';
import { DataProvenanceBadge } from '@/components/data-display';
import { AlertBanner, DataSourceNotice, QueryError, resolveDataSourceStatus, StaleRefreshWarning } from '@/components/feedback';
import { ShareDriveDialog } from '../components/ShareDriveDialog';
import { AIDriveCoaching } from '@/components/ai';
import { AISpeedProfileInsights } from '@/components/ai';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { cn } from '@/lib/cn';
import { useFsdInsightsForDrive } from '@/api/hooks/useAnalytics';
import { DriveReportContent } from '../components/layout-modernization';
import { useDriveDetailData, DriveDetailSkeleton } from '../components/drive-detail';

const actionTargetClassName = 'min-h-11 min-w-11 max-w-full px-3 py-2 md:min-h-9 md:py-1.5';

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
    drive, vehicle, timezone, driveQuery, chartData, stats, routeSource,
    trail, startPos, endPos, centerPos, speedSegments, speedHistData,
  } = useDriveDetailData(id ?? '');
  const driveState = useDataState(driveQuery, { provenance: 'historical' });
  const fsdQuery = useFsdInsightsForDrive(
    drive ? String(drive.vehicleId) : undefined, id, timezone, true,
  );
  const fsdState = useDataState(fsdQuery, { provenance: 'historical' });
  const driveSource = { id: 'drive', label: t('driveDetail.title', 'Drive detail'), query: driveQuery };
  const fsdSource = {
    id: 'fsd', label: t('driveDetail.fsd.title', 'Supervised driving'),
    query: fsdQuery, enabled: drive != null && !!id,
  };
  const driveReadiness = resolveDataSourceStatus(driveSource);
  const fsdReadiness = resolveDataSourceStatus(fsdSource);
  const isLoading = driveReadiness === 'loading';
  const coldPausedSources = [driveSource, fsdSource].filter(
    source => source.query.data === undefined && source.query.fetchStatus === 'paused',
  );
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
    <PageLayout
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
        <Link to="/drives"
          aria-label={t('driveDetail.backToDrives', 'Back to drives')}
          className={cn(BUTTON_BASE, BUTTON_VARIANTS.ghost, actionTargetClassName)}>
          <Icon icon={ArrowLeft} />
        </Link>
      }
      primaryAction={id ? (
        <Link to={`/drives/${id}/replay`}
          className={cn(BUTTON_BASE, BUTTON_VARIANTS.secondary, actionTargetClassName)}>
          <Icon icon={Play} />
          <Text as="span" variant="bodySm" className="min-w-0 break-words">
            {t('driveDetail.replay', 'Replay')}
          </Text>
        </Link>
      ) : undefined}
      overflowActions={
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          {id ? (
            <Button variant="ghost" size="sm" wrapLabel className={actionTargetClassName}
              onClick={() => setShareDialogOpen(true)} icon={<Icon icon={Share2} />}>
              {t('driveDetail.share', 'Share')}
            </Button>
          ) : null}
          <PrintButton className={actionTargetClassName} />
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
      <DataSourceNotice sources={coldPausedSources} />
      {driveReadiness === 'ready' && !drive && !driveState.fatalError ? (
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

      <DriveReportContent
        id={id}
        data={{ drive, stats, chartData, routeSource, trail, startPos, endPos, centerPos, speedSegments, speedHistData }}
        meaningful={hasMeaningfulDriveStats}
        sections={reportSections}
        fsdInsight={fsdInsight}
        fsdLoading={fsdSource.enabled && fsdReadiness === 'loading'}
        fsdError={fsdState.fatalError}
        speedInsights={<AISpeedProfileInsights driveId={drive ? id : undefined} />}
        coaching={<AIDriveCoaching driveId={drive ? id : undefined} />}
      />
      {/* Dialog state is scoped to the routed record, not the example /412. */}
      {id ? <ShareDriveDialog key={id} driveId={id} open={shareDialogOpen} onClose={() => setShareDialogOpen(false)} /> : null}
    </PageLayout>
  );
}
