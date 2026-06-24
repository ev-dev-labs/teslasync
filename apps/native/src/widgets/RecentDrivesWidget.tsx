import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useDrives, useVehicles, type DateRangeOptions } from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { ListRow } from '../components/data/ListRow';
import { formatDateTime, formatDistance, formatDuration, formatEnergy } from '../lib/format';
import { spacing } from '../theme/tokens';
import type { NativeWidgetProps } from './types';
import { WidgetCard } from './WidgetCard';
import { WidgetMessage } from './WidgetMessage';

export function RecentDrivesWidget({vehicleId}: NativeWidgetProps) {
  const vehiclesQuery = useVehicles();
  const selectedVehicle = (vehiclesQuery.data ?? []).find(vehicle => vehicle.id === vehicleId) ??
    vehiclesQuery.data?.[0];
  const options = useMemo<DateRangeOptions>(
    () => ({
      vehicle_id: selectedVehicle?.id,
      limit: 5,
    }),
    [selectedVehicle?.id],
  );
  const drivesQuery = useDrives(options);
  const drives = drivesQuery.data ?? [];

  return (
    <WidgetCard
      title="Recent drives"
      subtitle="Last five drives with SI distance, duration, energy, and score."
      icon="drives"
      testID="widget-recent-drives"
      statusLabel={drives.length > 0 ? `${drives.length} drives` : 'Drives'}
      statusState={drivesQuery.error ? 'warning' : 'online'}>
      {drivesQuery.isLoading ? (
        <WidgetMessage
          title="Loading drives"
          message="Fetching recent drive history for the selected dashboard vehicle."
          icon="loading"
        />
      ) : drivesQuery.error ? (
        <WidgetMessage
          title="Drive API unavailable"
          message="Recent drive cards will appear when /drives is reachable."
          icon="warning"
        />
      ) : drives.length === 0 ? (
        <WidgetMessage
          title="No recent drives"
          message="Trips will render here after the vehicle records drive sessions."
          icon="drive"
        />
      ) : (
        <View style={styles.list}>
          {drives.slice(0, 5).map(drive => (
            <ListRow
              key={drive.id}
              title={formatDistance(drive.distance_m)}
              subtitle={`${formatDuration(drive.duration_s)} · ${formatEnergy(drive.energy_used_wh)}`}
              meta={formatDateTime(drive.start_ts)}
              icon="drive"
              detail={
                <View>
                  <KeyValueRow
                    label="State of charge"
                    value={`${drive.start_soc_pct ?? '-'}% -> ${drive.end_soc_pct ?? '-'}%`}
                  />
                  <KeyValueRow label="Drive score" value={drive.score ?? '-'} />
                </View>
              }
            />
          ))}
        </View>
      )}
    </WidgetCard>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
});

