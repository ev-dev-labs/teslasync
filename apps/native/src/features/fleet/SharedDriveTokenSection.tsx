import React, {useMemo} from 'react';
import {View} from 'react-native';

import type {Drive, DriveTelemetryReading} from '../../api/types';
import {KeyValueRow} from '../../components/data/KeyValueRow';
import {ListRow} from '../../components/data/ListRow';
import {MetricGrid, type MetricGridItem} from '../../components/data/MetricGrid';
import {ScreenSection} from '../../components/data/ScreenSection';
import {FleetMessage} from './FleetMessage';
import {fleetStyles} from './fleetStyles';
import {formatDateTime, formatDistance, formatDuration, formatEnergy} from './formatFleetValue';

interface SharedDriveTokenSectionProps {
  drive: Drive | null | undefined;
  hasError: boolean;
  isLoading: boolean;
  telemetry: DriveTelemetryReading[];
}

function coordinateCount(telemetry: DriveTelemetryReading[]) {
  return telemetry.filter(
    reading => Number.isFinite(reading.latitude) && Number.isFinite(reading.longitude),
  ).length;
}

export function SharedDriveTokenSection({
  drive,
  hasError,
  isLoading,
  telemetry,
}: SharedDriveTokenSectionProps) {
  const routeCoordinateCount = useMemo(() => coordinateCount(telemetry), [telemetry]);
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'shared-drive-distance',
        label: 'Shared distance',
        value: formatDistance(drive?.distance_m),
        helper: drive ? 'Selected drive summary' : 'No selected drive',
        tone: drive ? 'accent' : 'neutral',
        icon: 'navigation',
      },
      {
        id: 'shared-drive-duration',
        label: 'Shared duration',
        value: formatDuration(drive?.duration_s),
        helper: 'Read-only token route detail',
        tone: drive ? 'accent' : 'neutral',
        icon: 'clock',
      },
      {
        id: 'shared-drive-energy',
        label: 'Shared energy',
        value: formatEnergy(drive?.energy_used_wh),
        helper: 'SI watt-hours rendered natively',
        tone: drive ? 'warning' : 'neutral',
        icon: 'efficiency',
      },
      {
        id: 'shared-drive-route-points',
        label: 'Route points',
        value: routeCoordinateCount,
        helper: 'Telemetry points available for native map summary',
        tone: routeCoordinateCount > 1 ? 'success' : 'neutral',
        icon: 'mapPinned',
      },
    ],
    [drive, routeCoordinateCount],
  );

  return (
    <ScreenSection
      title="Shared drive token route surface"
      subtitle="The /s/:token route resolves to a read-only native drive summary and never fabricates token payloads or share-card data."
    >
      <MetricGrid items={metrics} minItemWidth={180} />
      {!drive && isLoading ? (
        <FleetMessage
          title="Loading shared drive context"
          message="Resolving /drives before rendering shared-drive token route evidence."
          tone="loading"
          icon="loading"
        />
      ) : !drive ? (
        <FleetMessage
          title="No shared drive selected"
          message="Shared-drive route evidence stays visible until a real drive is returned by the API."
          tone="empty"
          icon="share"
        />
      ) : (
        <View style={fleetStyles.detailStack}>
          <View>
            <KeyValueRow label="Token route pattern" value="/s/:token" />
            <KeyValueRow label="Native target" value="driving" />
            <KeyValueRow label="Drive source" value={`/drives/${drive.id}`} />
            <KeyValueRow label="Telemetry source" value={`/drives/${drive.id}/telemetry`} />
            <KeyValueRow label="Started" value={formatDateTime(drive.start_ts)} />
            <KeyValueRow label="Ended" value={formatDateTime(drive.end_ts)} />
          </View>
          <View style={fleetStyles.list}>
            <ListRow
              title="Shared drive token resolver"
              subtitle="Dynamic token paths are matched by the route manifest and navigate to the native Driving route."
              meta="s/:token"
              icon="share"
            />
            <ListRow
              title="Share safety boundary"
              subtitle="Native only renders API-resolved drive and telemetry details; it does not mint, guess, or persist public share tokens."
              meta={hasError ? 'partial' : 'read-only'}
              icon="security"
            />
          </View>
        </View>
      )}
    </ScreenSection>
  );
}
