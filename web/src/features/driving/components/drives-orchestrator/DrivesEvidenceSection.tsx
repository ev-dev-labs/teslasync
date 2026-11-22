import { BulkActionsToolbar } from '@/components/data-display';
import { TableToolbar } from '@/components/forms';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { DrivesEvidenceHeading } from './DrivesEvidenceHeading';
import { DrivesEvidenceNotices } from './DrivesEvidenceNotices';
import { DrivesGridEvidence } from './DrivesGridEvidence';
import { DrivesEvidenceEmpty } from './DrivesEvidenceEmpty';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = { model: DrivesListPageController };

export function DrivesEvidenceSection({ model }: Props) {
  const {
    t, desktopEvidence, isDrivesLoading, currentStats, tableControls,
    pageState, refetchPage, bulkSelected, matchingError,
    matchingTotal, clearBulk, bulkDriveActions,
  } = model;
  const hasGrid = currentStats.count > 0 || (matchingTotal ?? 0) > 0;
  return (
    <section
      aria-label={t('drives.list', 'Drive list')}
      className="space-y-3"
      data-tour="drives-list"
    >
      {!hasGrid && (
        <DrivesEvidenceHeading {...model} />
      )}
      {desktopEvidence && !hasGrid && <TableToolbar {...tableControls} />}
      <DrivesEvidenceNotices {...model} />
      <StaleRefreshWarning state={pageState} label={t('drives.driveEvidence', 'Drive evidence')} />
      {matchingError && <QueryError error={matchingError} onRetry={model.selectAllMatching} />}
      {hasGrid ? (
        <>
          {bulkSelected.size > 0 && <BulkActionsToolbar
            selectedIds={Array.from(bulkSelected)}
            total={matchingTotal ?? bulkSelected.size}
            selectionScope="filtered"
            onClear={clearBulk}
            actions={bulkDriveActions}
            itemNoun={{
              one: t('bulk.noun.drive_one', 'drive'),
              other: t('bulk.noun.drive_other', 'drives'),
            }}
          />}
          <DrivesGridEvidence {...model} />
        </>
      ) : pageState.fatalError ? (
        <QueryError error={pageState.fatalError} onRetry={() => { void refetchPage(); }} />
      ) : isDrivesLoading || pageState.status === 'initial' ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : <DrivesEvidenceEmpty {...model} />}
    </section>
  );
}
