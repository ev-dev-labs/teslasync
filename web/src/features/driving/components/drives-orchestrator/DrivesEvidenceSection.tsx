import { BulkActionsToolbar } from '@/components/data-display';
import { TableToolbar } from '@/components/forms';
import { QueryError, Skeleton } from '@/components/feedback';
import { DrivesEvidenceHeading } from './DrivesEvidenceHeading';
import { DrivesEvidenceNotices } from './DrivesEvidenceNotices';
import { DrivesDesktopEvidence } from './DrivesDesktopEvidence';
import { DrivesMobileEvidence } from './DrivesMobileEvidence';
import { DrivesEvidenceEmpty } from './DrivesEvidenceEmpty';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = { model: DrivesListPageController };

export function DrivesEvidenceSection({ model }: Props) {
  const {
    t, desktopEvidence, isDrivesLoading, dateFilteredDrives, tableControls,
    drivesState, refetchDrives, paginatedDrives, bulkSelected,
    filteredDrives, clearBulk, bulkDriveActions,
  } = model;
  return (
    <section
      aria-label={t('drives.list', 'Drive list')}
      className="space-y-3"
      data-tour="drives-list"
    >
      {(!desktopEvidence || isDrivesLoading || dateFilteredDrives.length === 0) && (
        <DrivesEvidenceHeading {...model} />
      )}
      {desktopEvidence && dateFilteredDrives.length === 0 && <TableToolbar {...tableControls} />}
      <DrivesEvidenceNotices {...model} />
      {drivesState.fatalError ? (
        <QueryError error={drivesState.fatalError} onRetry={() => { void refetchDrives(); }} />
      ) : isDrivesLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : paginatedDrives.length > 0 || (desktopEvidence && dateFilteredDrives.length > 0) ? (
        <>
          {bulkSelected.size > 0 && <BulkActionsToolbar
            selectedIds={Array.from(bulkSelected)}
            total={filteredDrives.length}
            selectionScope="filtered"
            onClear={clearBulk}
            actions={bulkDriveActions}
            itemNoun={{
              one: t('bulk.noun.drive_one', 'drive'),
              other: t('bulk.noun.drive_other', 'drives'),
            }}
          />}
          {desktopEvidence
            ? <DrivesDesktopEvidence {...model} />
            : <DrivesMobileEvidence {...model} />}
        </>
      ) : <DrivesEvidenceEmpty {...model} />}
    </section>
  );
}
