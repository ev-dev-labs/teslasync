import React from 'react';
import {View} from 'react-native';

import type {Drive} from '../../api/types';
import {KeyValueRow} from '../../components/data/KeyValueRow';
import {ListRow} from '../../components/data/ListRow';
import {ScreenSection} from '../../components/data/ScreenSection';
import {FleetMessage} from './FleetMessage';
import {fleetStyles} from './fleetStyles';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatEnergy,
  formatSocRange,
} from './formatFleetValue';

interface DriveListSectionProps {
  drives: Drive[];
  selectedDriveId: number | null;
  isLoading: boolean;
  hasError: boolean;
  onSelect: (driveId: number) => void;
}

export function DriveListSection({
  drives,
  selectedDriveId,
  isLoading,
  hasError,
  onSelect,
}: DriveListSectionProps) {
  return (
    <ScreenSection
      title="Drives and trips"
      subtitle="Native trip list backed by /drives with selectable route/replay detail.">
      {isLoading && drives.length === 0 ? (
        <FleetMessage
          title="Loading drives"
          message="Fetching recent drives from the TeslaSync API."
          tone="loading"
        />
      ) : hasError && drives.length === 0 ? (
        <FleetMessage
          title="Drive API unavailable"
          message="Drive and trip rows will appear when /drives is reachable."
          tone="error"
        />
      ) : drives.length === 0 ? (
        <FleetMessage
          title="No drives returned"
          message="Recent trips, scoring, and replay metadata will render here."
          tone="empty"
          icon="drive"
        />
      ) : (
        <View style={fleetStyles.list}>
          {drives.map(drive => (
            <ListRow
              key={drive.id}
              title={`Drive #${drive.id}`}
              subtitle={`${formatDistance(drive.distance_m)} · ${formatDuration(drive.duration_s)}`}
              meta={drive.id === selectedDriveId ? 'Selected' : formatDateTime(drive.start_ts)}
              icon="drive"
              selected={drive.id === selectedDriveId}
              tone={(drive.score ?? 0) >= 90 ? 'success' : 'accent'}
              onPress={() => onSelect(drive.id)}
              detail={
                <View>
                  <KeyValueRow label="Energy used" value={formatEnergy(drive.energy_used_wh)} />
                  <KeyValueRow
                    label="State of charge"
                    value={formatSocRange(drive.start_soc_pct, drive.end_soc_pct)}
                  />
                  <KeyValueRow label="Score" value={drive.score ?? '-'} />
                </View>
              }
            />
          ))}
        </View>
      )}
    </ScreenSection>
  );
}
