import React, {useMemo} from 'react';
import {View} from 'react-native';

import type {Drive} from '../../api/types';
import {KeyValueRow} from '../../components/data/KeyValueRow';
import {MetricGrid, type MetricGridItem} from '../../components/data/MetricGrid';
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

interface TripSummarySectionProps {
  drives: Drive[];
  selectedTrip: Drive | null | undefined;
  isLoading: boolean;
  hasError: boolean;
}

export function TripSummarySection({
  drives,
  selectedTrip,
  isLoading,
  hasError,
}: TripSummarySectionProps) {
  const completedTrips = drives.filter(drive => Boolean(drive.end_ts)).length;
  const openTrips = drives.length - completedTrips;
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'trip-count',
        label: 'Trips represented',
        value: isLoading && drives.length === 0 ? '-' : drives.length,
        helper: hasError ? 'Trip source API unavailable' : 'Drive-backed trip rows',
        tone: hasError ? 'warning' : 'accent',
        icon: 'trip',
      },
      {
        id: 'completed-trips',
        label: 'Completed trips',
        value: drives.length === 0 ? '-' : completedTrips,
        helper: openTrips > 0 ? `${openTrips} open from /drives` : 'Ended trips in this slice',
        tone: openTrips > 0 ? 'warning' : 'success',
        icon: 'success',
      },
      {
        id: 'selected-trip-distance',
        label: 'Selected trip distance',
        value: formatDistance(selectedTrip?.distance_m),
        helper: selectedTrip ? 'Selected drive as trip parity' : 'No selected trip',
        tone: selectedTrip ? 'accent' : 'neutral',
        icon: 'navigation',
      },
      {
        id: 'selected-trip-energy',
        label: 'Selected trip energy',
        value: formatEnergy(selectedTrip?.energy_used_wh),
        helper: 'SI watt-hours converted at render',
        tone: selectedTrip ? 'warning' : 'neutral',
        icon: 'efficiency',
      },
    ],
    [completedTrips, drives.length, hasError, isLoading, openTrips, selectedTrip],
  );

  return (
    <ScreenSection
      title="Trip parity summary"
      subtitle="Native trips are represented by typed /drives data until a distinct trips API exists.">
      <MetricGrid items={metrics} minItemWidth={180} />
      {!selectedTrip && isLoading ? (
        <FleetMessage
          title="Loading trip summary"
          message="Resolving drive-backed trip data from the TeslaSync API."
          tone="loading"
        />
      ) : !selectedTrip ? (
        <FleetMessage
          title="No selected trip"
          message="Trip detail parity appears after /drives returns selectable route history."
          tone="empty"
          icon="trip"
        />
      ) : (
        <View style={fleetStyles.detailStack}>
          <View>
            <KeyValueRow label="Trip start" value={formatDateTime(selectedTrip.start_ts)} />
            <KeyValueRow label="Trip end" value={formatDateTime(selectedTrip.end_ts)} />
            <KeyValueRow label="Trip duration" value={formatDuration(selectedTrip.duration_s)} />
            <KeyValueRow
              label="State of charge"
              value={formatSocRange(selectedTrip.start_soc_pct, selectedTrip.end_soc_pct)}
            />
            <KeyValueRow label="Replay source" value={`/drives/${selectedTrip.id}/telemetry`} />
            <KeyValueRow label="Parity status" value="Drive-backed trip detail" />
          </View>
          {hasError ? (
            <FleetMessage
              title="Partial trip parity"
              message="Drive-backed trip data is shown when available; one or more trip source endpoints are unavailable."
              tone="error"
            />
          ) : null}
        </View>
      )}
    </ScreenSection>
  );
}
