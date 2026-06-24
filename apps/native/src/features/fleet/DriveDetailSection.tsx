import React from 'react';
import {View} from 'react-native';

import type {Drive} from '../../api/types';
import {KeyValueRow} from '../../components/data/KeyValueRow';
import {MetricGrid} from '../../components/data/MetricGrid';
import {ScreenSection} from '../../components/data/ScreenSection';
import {StatusPill} from '../../components/ui/StatusPill';
import {FleetMessage} from './FleetMessage';
import {fleetStyles} from './fleetStyles';
import {
  formatDateTime,
  formatDistance,
  formatEfficiency,
  formatEnergy,
  formatPower,
  formatSpeed,
} from './formatFleetValue';

interface DriveDetailSectionProps {
  drive: Drive | null | undefined;
  isLoading: boolean;
  hasError: boolean;
}

export function DriveDetailSection({drive, isLoading, hasError}: DriveDetailSectionProps) {
  return (
    <ScreenSection
      title="Drive detail shell"
      subtitle="Selected drive/trip detail route with distance, power, SOC, status, and endpoint metadata.">
      {!drive && isLoading ? (
        <FleetMessage
          title="Loading drive detail"
          message="Resolving the selected drive detail route."
          tone="loading"
        />
      ) : !drive ? (
        <FleetMessage
          title="No selected drive"
          message="Select a drive once /drives returns trip history."
          tone="empty"
          icon="drive"
        />
      ) : (
        <View style={fleetStyles.detailStack}>
          <View style={fleetStyles.detailHeader}>
            <View style={fleetStyles.detailCopy}>
              <KeyValueRow label="Started" value={formatDateTime(drive.start_ts)} />
              <KeyValueRow label="Ended" value={formatDateTime(drive.end_ts)} />
            </View>
            <StatusPill
              label={drive.end_ts ? drive.ended_status ?? 'Complete' : 'In progress'}
              state={drive.end_ts ? 'online' : 'warning'}
            />
          </View>
          <MetricGrid
            items={[
              {
                id: 'distance',
                label: 'Distance',
                value: formatDistance(drive.distance_m),
                helper: 'Drive distance',
                tone: 'accent',
                icon: 'navigation',
              },
              {
                id: 'energy',
                label: 'Energy used',
                value: formatEnergy(drive.energy_used_wh),
                helper: formatEfficiency(drive.energy_used_wh, drive.distance_m),
                tone: 'warning',
                icon: 'efficiency',
              },
              {
                id: 'regen',
                label: 'Regen',
                value: formatEnergy(drive.regen_energy_wh),
                helper: 'Regenerative energy',
                tone: 'success',
                icon: 'recycle',
              },
              {
                id: 'score',
                label: 'Score',
                value: drive.score ?? '-',
                helper: 'Drive score',
                tone: (drive.score ?? 0) >= 90 ? 'success' : 'neutral',
                icon: 'award',
              },
            ]}
            minItemWidth={160}
          />
          <View>
            <KeyValueRow label="Average speed" value={formatSpeed(drive.avg_speed_mps)} />
            <KeyValueRow label="Max speed" value={formatSpeed(drive.max_speed_mps)} />
            <KeyValueRow label="Average power" value={formatPower(drive.avg_power_w)} />
            <KeyValueRow label="Start" value={drive.start_address ?? '-'} />
            <KeyValueRow label="End" value={drive.end_address ?? '-'} />
          </View>
          {hasError ? (
            <FleetMessage
              title="Partial drive detail"
              message="List data is shown when available; /drives/:id detail is unavailable."
              tone="error"
            />
          ) : null}
        </View>
      )}
    </ScreenSection>
  );
}
