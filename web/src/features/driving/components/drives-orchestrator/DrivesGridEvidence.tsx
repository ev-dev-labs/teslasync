import { Button } from '@/components/ui';
import { QueryError, Skeleton } from '@/components/feedback';
import { DrivesEvidenceTable } from '../DrivesEvidenceTable';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController,
  'paginatedDrives' | 'currentStats' | 'hasDrivePayload' | 'gridScope' | 'valueFilter' | 'changeValueSelection'
  | 'clearValueFilter' | 'bulkSelected' | 'setBulkSelected' | 'setPreviewDrive'
  | 'sortBy' | 'effectiveSortDirection' | 'sortGrid' | 'collection'
  | 'setUrlBatch' | 'fsdFilter' | 'gridFilters' | 'changeGridFilter'
  | 'toDistanceDisplay' | 'toSpeedDisplay' | 'toEfficiencyDisplay' | 'toTemperatureDisplay'
  | 'toPowerDisplay' | 'formatEnergy' | 'formatEnergyCost' | 'distanceUnit'
  | 'speedUnit' | 'efficiencyUnit' | 'unitPrefs' | 'tz' | 'fsdDataAvailable'
  | 'fsdByDriveID' | 'anomalyDriveIds' | 'safePage' | 'pageSize' | 'matchingTotal'
  | 'setPage' | 't' | 'tableControls' | 'vehicleId'
  | 'driveStatus' | 'viewContext' | 'restoreView' | 'clearGridFilters'
  | 'collectionPills' | 'fsdPills' | 'pageState' | 'refetchPage'
  | 'canSelectMatching' | 'selectAllMatching' | 'matchingIsPending'>;

export function DrivesGridEvidence({
  paginatedDrives, currentStats, hasDrivePayload, gridScope, valueFilter, changeValueSelection, clearValueFilter,
  bulkSelected, setBulkSelected, setPreviewDrive, sortBy, effectiveSortDirection,
  sortGrid, collection, setUrlBatch, fsdFilter, gridFilters, changeGridFilter,
  toDistanceDisplay, toSpeedDisplay, toEfficiencyDisplay, toTemperatureDisplay,
  toPowerDisplay, formatEnergy, formatEnergyCost, distanceUnit, speedUnit,
  efficiencyUnit, unitPrefs, tz, fsdDataAvailable, fsdByDriveID, anomalyDriveIds,
  safePage, pageSize, matchingTotal, setPage, t, tableControls,
  vehicleId, driveStatus, viewContext, restoreView, clearGridFilters,
  collectionPills, fsdPills, pageState, refetchPage, canSelectMatching, selectAllMatching, matchingIsPending,
}: Props) {
  const setDriveStatus = (value: string) => setUrlBatch({ grid_status: value === 'all' ? null : value, page: null });
  return (
    <DrivesEvidenceTable
      drives={paginatedDrives}
      gridScope={gridScope}
      rangeTotal={hasDrivePayload ? currentStats.count : undefined}
      emptyContent={pageState.fatalError ? <QueryError error={pageState.fatalError} onRetry={() => { void refetchPage(); }} />
        : pageState.status === 'initial' ? <Skeleton className="h-24" /> : undefined}
      valueSelections={valueFilter.selections}
      invalidValueSelection={valueFilter.invalid}
      onValueSelectionChange={changeValueSelection}
      onValueFilterClear={clearValueFilter}
      selectedIds={bulkSelected}
      onSelectionChange={setBulkSelected}
      onPreview={setPreviewDrive}
      sortBy={sortBy}
      sortDir={effectiveSortDirection}
      onSort={sortGrid}
      collection={collection}
      collectionPills={collectionPills}
      onCollectionChange={(value) => setUrlBatch({ coll: value === 'all' ? null : value, fsd: null, page: null })}
      onDriveFilterClear={() => setUrlBatch({ grid_date: null, coll: null, page: null })}
      fsdFilter={fsdFilter}
      fsdPills={fsdPills}
      onFsdFilterChange={(value) => setUrlBatch({ fsd: value === 'all' ? null : value, coll: null, page: null })}
      filters={gridFilters}
      onFilterChange={changeGridFilter}
      vehicleId={vehicleId}
      driveStatus={driveStatus}
      onDriveStatusChange={setDriveStatus}
      toDistanceDisplay={toDistanceDisplay}
      toSpeedDisplay={toSpeedDisplay}
      toEfficiencyDisplay={toEfficiencyDisplay}
      toTemperatureDisplay={toTemperatureDisplay}
      toPowerDisplay={toPowerDisplay}
      formatEnergy={formatEnergy}
      formatEnergyCost={formatEnergyCost}
      distanceUnit={distanceUnit}
      speedUnit={speedUnit}
      efficiencyUnit={efficiencyUnit}
      temperatureUnit={unitPrefs.temperature}
      powerUnit={unitPrefs.power}
      timezone={tz}
      fsdAvailable={fsdDataAvailable}
      fsdByDriveID={fsdByDriveID}
      anomalyDriveIds={anomalyDriveIds}
      paginationControls={matchingTotal == null ? undefined : {
        page: safePage,
        pageSize,
        total: matchingTotal,
        onPageChange: setPage,
        onPageSizeChange: (size) => setUrlBatch({ size: String(size), page: null }),
      }}
      matchingActions={canSelectMatching && <Button variant="ghost" size="sm" wrapLabel className="min-h-9"
        disabled={matchingIsPending} onClick={selectAllMatching}>
        {t('drives.grid.selectMatching', 'Select {{count}} matching', { count: matchingTotal })}
      </Button>}
      savedViews={{ context: viewContext, onRestore: restoreView }}
      onClearAllFilters={clearGridFilters}
      controls={tableControls}
    />
  );
}
