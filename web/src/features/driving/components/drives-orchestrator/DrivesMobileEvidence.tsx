import { DateGroupedList } from '@/components/data-display';
import { Pagination } from '@/components/ui';
import { StaggerContainer, StaggerItem } from '@/components/motion';
import { DriveCard } from '../DriveCard';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController,
  'density' | 'groupedDrives' | 'toDistanceDisplay' | 'toSpeedDisplay' | 'toEfficiencyDisplay'
  | 'distanceUnit' | 'speedUnit' | 'efficiencyUnit' | 'formatEnergyCost' | 'tz'
  | 'anomalyDriveIds' | 'fsdByDriveID' | 'bulkSelected' | 'toggleDriveSelected'
  | 'setPreviewDrive' | 'sortedDrives' | 'safePage' | 'pageSize' | 'setPage' | 'setUrlBatch'>;

export function DrivesMobileEvidence({
  density, groupedDrives, toDistanceDisplay, toSpeedDisplay, toEfficiencyDisplay,
  distanceUnit, speedUnit, efficiencyUnit, formatEnergyCost, tz,
  anomalyDriveIds, fsdByDriveID, bulkSelected, toggleDriveSelected, setPreviewDrive,
  sortedDrives, safePage, pageSize, setPage, setUrlBatch,
}: Props) {
  return (
    <>
      <div data-drive-list-density={density} className={density === 'compact' ? '[&_.group]:py-2' : undefined}>
        <StaggerContainer>
          <DateGroupedList
            groups={groupedDrives}
            itemKey={(d) => d.id}
            renderItem={(d) => (
              <StaggerItem>
                <DriveCard
                  drive={d}
                  toDistanceDisplay={toDistanceDisplay}
                  toSpeedDisplay={toSpeedDisplay}
                  toEfficiencyDisplay={toEfficiencyDisplay}
                  distanceUnit={distanceUnit}
                  speedUnit={speedUnit}
                  efficiencyUnit={efficiencyUnit}
                  formatEnergyCost={formatEnergyCost}
                  tz={tz}
                  isAnomaly={anomalyDriveIds.has(d.id)}
                  fsdInsight={fsdByDriveID.get(d.id)}
                  selected={bulkSelected.has(d.id)}
                  onToggleSelect={toggleDriveSelected}
                  onPreview={setPreviewDrive}
                />
              </StaggerItem>
            )}
          />
        </StaggerContainer>
      </div>
      {sortedDrives.length > 0 && <Pagination
        page={safePage}
        pageSize={pageSize}
        total={sortedDrives.length}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setUrlBatch({ size: String(s), page: null }); }}
      />}
    </>
  );
}
