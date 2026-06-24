import React from 'react';
import {View} from 'react-native';

import type {ChargingSession} from '../../api/types';
import {KeyValueRow} from '../../components/data/KeyValueRow';
import {ListRow} from '../../components/data/ListRow';
import {ScreenSection} from '../../components/data/ScreenSection';
import {FleetMessage} from './FleetMessage';
import {fleetStyles} from './fleetStyles';
import {
  formatChargingDuration,
  formatDateTime,
  formatEnergy,
  formatPower,
  formatSocRange,
} from './formatFleetValue';

interface ChargingSessionListSectionProps {
  sessions: ChargingSession[];
  selectedSessionId: number | null;
  isLoading: boolean;
  hasError: boolean;
  onSelect: (sessionId: number) => void;
}

export function ChargingSessionListSection({
  sessions,
  selectedSessionId,
  isLoading,
  hasError,
  onSelect,
}: ChargingSessionListSectionProps) {
  return (
    <ScreenSection
      title="Charging sessions"
      subtitle="Recent sessions from /charging with selectable native detail shells.">
      {isLoading && sessions.length === 0 ? (
        <FleetMessage
          title="Loading sessions"
          message="Fetching charging sessions from the TeslaSync API."
          tone="loading"
        />
      ) : hasError && sessions.length === 0 ? (
        <FleetMessage
          title="Charging API unavailable"
          message="Charging history will appear when /charging is reachable."
          tone="error"
        />
      ) : sessions.length === 0 ? (
        <FleetMessage
          title="No charging sessions"
          message="Charging history, live sessions, and energy totals will appear here."
          tone="empty"
          icon="charger"
        />
      ) : (
        <View style={fleetStyles.list}>
          {sessions.map(session => (
            <ListRow
              key={session.id}
              title={`Session #${session.id}`}
              subtitle={`${formatEnergy(session.total_energy_added_wh)} · ${formatChargingDuration(
                session,
              )}`}
              meta={session.id === selectedSessionId ? 'Selected' : formatDateTime(session.started_at)}
              icon="charging"
              onPress={() => onSelect(session.id)}
              detail={
                <View>
                  <KeyValueRow
                    label="State of charge"
                    value={formatSocRange(session.start_soc_pct, session.end_soc_pct)}
                  />
                  <KeyValueRow label="Peak power" value={formatPower(session.peak_power_w)} />
                  <KeyValueRow label="Charger" value={session.charger_type ?? '-'} />
                </View>
              }
            />
          ))}
        </View>
      )}
    </ScreenSection>
  );
}
