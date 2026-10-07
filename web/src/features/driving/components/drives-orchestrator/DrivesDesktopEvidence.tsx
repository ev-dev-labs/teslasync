import { Route } from 'lucide-react';
import { SectionTitle, Badge } from '@/components/ui';
import { DrivesEvidenceTable } from '../DrivesEvidenceTable';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController,
  'paginatedDrives' | 'dateFilteredDrives' | 'valueFilter' | 'changeValueSelection'
  | 'clearValueFilter' | 'bulkSelected' | 'setBulkSelected' | 'setPreviewDrive'
  | 'sortBy' | 'effectiveSortDirection' | 'sortGrid' | 'search' | 'collection'
  | 'setUrlBatch' | 'fsdFilter' | 'gridFilters' | 'changeGridFilter'
  | 'toDistanceDisplay' | 'toSpeedDisplay' | 'toEfficiencyDisplay' | 'toTemperatureDisplay'
  | 'toPowerDisplay' | 'formatEnergy' | 'formatEnergyCost' | 'distanceUnit'
  | 'speedUnit' | 'efficiencyUnit' | 'unitPrefs' | 'tz' | 'fsdDataAvailable'
  | 'fsdByDriveID' | 'anomalyDriveIds' | 'safePage' | 'pageSize' | 'sortedDrives'
  | 'setPage' | 't' | 'fmtCompact' | 'tableControls'>;

export function DrivesDesktopEvidence({
  paginatedDrives, dateFilteredDrives, valueFilter, changeValueSelection, clearValueFilter,
  bulkSelected, setBulkSelected, setPreviewDrive, sortBy, effectiveSortDirection,
  sortGrid, search, collection, setUrlBatch, fsdFilter, gridFilters, changeGridFilter,
  toDistanceDisplay, toSpeedDisplay, toEfficiencyDisplay, toTemperatureDisplay,
  toPowerDisplay, formatEnergy, formatEnergyCost, distanceUnit, speedUnit,
  efficiencyUnit, unitPrefs, tz, fsdDataAvailable, fsdByDriveID, anomalyDriveIds,
  safePage, pageSize, sortedDrives, setPage, t, fmtCompact, tableControls,
}: Props) {
  return (
    <DrivesEvidenceTable
      drives={paginatedDrives}
      availableDrives={dateFilteredDrives}
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
      search={search}
      collection={collection}
      onCollectionChange={(value) => setUrlBatch({ coll: value === 'all' ? null : value, fsd: null, page: null })}
      onDriveFilterClear={() => setUrlBatch({ q: null, coll: null, page: null })}
      fsdFilter={fsdFilter}
      onFsdFilterChange={(value) => setUrlBatch({ fsd: value === 'all' ? null : value, coll: null, page: null })}
      filters={gridFilters}
      onFilterChange={changeGridFilter}
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
      paginationControls={{
        page: safePage,
        pageSize,
        total: sortedDrives.length,
        onPageChange: setPage,
        onPageSizeChange: (size) => setUrlBatch({ size: String(size), page: null }),
      }}
      toolbarHeading={(
        <SectionTitle className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)]">
            <Route className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          </span>
          {t('drives.driveEvidence', 'Drive evidence')}
          <Badge variant="neutral" size="sm" className="tabular-nums">{fmtCompact(sortedDrives.length)}</Badge>
        </SectionTitle>
      )}
      controls={tableControls}
    />
  );
}
