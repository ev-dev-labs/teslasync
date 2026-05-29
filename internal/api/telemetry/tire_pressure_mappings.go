package telemetry

import "github.com/ev-dev-labs/teslasync/internal/signal"

// Signal → JSON field mappings for TPMS timeline / state projection.
// Field names are snake_case; the frontend camelCaseKeys transform produces
// matching camelCase keys (e.g. front_left → frontLeft).
var tirePressureMappings = []signal.FieldMapping{
	{Signal: "TpmsPressureFl", Field: "front_left"},
	{Signal: "TpmsPressureFr", Field: "front_right"},
	{Signal: "TpmsPressureRl", Field: "rear_left"},
	{Signal: "TpmsPressureRr", Field: "rear_right"},
	{Signal: "TpmsLastSeenPressureTimeFl", Field: "last_seen_fl"},
	{Signal: "TpmsLastSeenPressureTimeFr", Field: "last_seen_fr"},
	{Signal: "TpmsLastSeenPressureTimeRl", Field: "last_seen_rl"},
	{Signal: "TpmsLastSeenPressureTimeRr", Field: "last_seen_rr"},
}
