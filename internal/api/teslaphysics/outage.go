package teslaphysics

import "time"

// BuildOutageAutobiography describes catch-up after MQTT/carbon loss.
func BuildOutageAutobiography(
	vehicleID int64,
	lastTelemetryAt *time.Time,
	mqttConnected *bool,
	now time.Time,
	notes []string,
) OutageAutobiography {
	out := OutageAutobiography{
		VehicleID:                vehicleID,
		LastTelemetryAt:          lastTelemetryAt,
		MQTTConnected:            mqttConnected,
		ReplayPreservesEventTime: true,
		Notes:                    notes,
		Honesty:                  outageHonesty,
	}
	if out.Notes == nil {
		out.Notes = []string{}
	}
	if lastTelemetryAt != nil && now.After(*lastTelemetryAt) {
		out.GapS = floatPtr(durationSeconds(*lastTelemetryAt, now))
		if now.Sub(*lastTelemetryAt) > 2*time.Minute {
			out.UnknownSince = lastTelemetryAt
		}
	}
	out.Notes = append(out.Notes,
		"Queued MQTT messages that carry the original event time are replayed with that time, not ingest time.",
		"A gap with no samples stays unknown. Absence is not a measured zero.",
	)
	return out
}
