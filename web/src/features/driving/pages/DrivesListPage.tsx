import { CopyLinkButton, PageLayout } from '@/components/layout';
import { SavedViewMenu } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { PullToRefresh } from '@/components/mobile';
import { AINLDriveSearch } from '@/components/ai';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useDrivesListPage } from '../hooks/useDrivesListPage';
import { DrivesStickySummary } from '../components/drives-orchestrator/DrivesStickySummary';
import { DrivesOperationalBrief } from '../components/drives-orchestrator/DrivesOperationalBrief';
import { DrivesSourceNotices } from '../components/drives-orchestrator/DrivesSourceNotices';
import { DrivesMobileFilters } from '../components/drives-orchestrator/DrivesMobileFilters';
import { DrivesOverview } from '../components/drives-orchestrator/DrivesOverview';
import { DrivesTrendAnalysis } from '../components/drives-orchestrator/DrivesTrendAnalysis';
import { DrivesCollectionFilters } from '../components/drives-orchestrator/DrivesCollectionFilters';
import { DrivesEvidenceSection } from '../components/drives-orchestrator/DrivesEvidenceSection';
import { DrivePreview } from '../components/continuation-driving-primary/DrivePreview';

export default function DrivesListPage() {
  const model = useDrivesListPage();
  const {
    t, vehicleId, drivesQuery, savedView, handlePullToRefresh, desktopEvidence,
    previewDrive, setPreviewDrive, navigate, tz, previewFrom, previewTo,
    toDistanceDisplay, toEfficiencyDisplay, formatEnergy, distanceUnit, efficiencyUnit,
  } = model;

  /* ---- Defensive: no vehicle ---- */
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('drives.title', 'Drive History')} />;
  }

  return (
    <PageLayout
      title={t('drives.title', 'Drive History')}
      subtitle={t(
        'drives.subtitle',
        'Measured energy intensity, route evidence, and comparable drive history',
      )}
      compactHeader
      query={drivesQuery}
      overflowActions={
        <>
          <div data-tour="drives-saved-views">
            <SavedViewMenu
              route="/drives"
              currentQuery={savedView.currentQuery}
              onApply={savedView.apply}
              iconOnly
            />
          </div>
          <CopyLinkButton iconOnly />
        </>
      }
    >
      <PullToRefresh onRefresh={handlePullToRefresh}>
        <div className="min-w-0 space-y-6">
          <DrivesStickySummary {...model} />
          <DrivesOperationalBrief {...model} />
          <DrivesSourceNotices {...model} />
          {/* Opt-in natural-language search leaves the typed search as baseline. */}
          <FadeIn>
            <AINLDriveSearch />
          </FadeIn>
          {!desktopEvidence && <DrivesMobileFilters {...model} />}
          <DrivesOverview {...model} />
          <DrivesTrendAnalysis {...model} />
          {!desktopEvidence && <DrivesCollectionFilters {...model} />}
          <DrivesEvidenceSection model={model} />
          <DrivePreview
            drive={previewDrive}
            onClose={() => setPreviewDrive(null)}
            onOpenDetails={(id) => navigate(`/drives/${id}`)}
            timezone={tz}
            from={previewFrom}
            to={previewTo}
            toDistanceDisplay={toDistanceDisplay}
            toEfficiencyDisplay={toEfficiencyDisplay}
            formatEnergy={formatEnergy}
            distanceUnit={distanceUnit}
            efficiencyUnit={efficiencyUnit}
          />
        </div>
      </PullToRefresh>
    </PageLayout>
  );
}
