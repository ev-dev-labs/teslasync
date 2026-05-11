// Package router is the field-static dispatcher between the codec
// boundary (codec.Atomic) and the typed per-destination writers
// (positions, drive_telemetry, climate_snapshot, ...). It owns
// routing.yaml — the single source of truth that maps every Tesla
// proto Field to exactly one Destination — and the Writer contract
// that destinations satisfy.
//
// Three invariants from ADR-004 #8 are enforced here, NOT in the
// callers:
//
//  1. Routing is field-static and vehicle-agnostic. A field's
//     destination is a function of (field_name) only. Per-vehicle or
//     value-conditional routing (e.g. "Semitruck-only fields skip
//     Model 3", "speed > 0 → drive_telemetry") MUST live inside the
//     writer, never in the dispatcher.
//
//  2. Writer errors are best-effort. A Writer.Write failure is logged
//     + counted as tesla_router_writer_failures_total{dest, reason}
//     and surfaced to the immediate caller (typically
//     normalize.Pipeline.Process), which logs and continues with the
//     next atomic. Writer errors do NOT propagate to MQTT
//     redelivery; only codec failures (malformed proto bytes) cause
//     payload-level retries upstream of the router.
//
//  3. The Destination set is closed. routing.yaml entries that name
//     an unrecognised destination are rejected at Load time, not at
//     dispatch time, so a typo (e.g. "positons") fails the process
//     at startup rather than silently dropping every atomic for that
//     field forever.
//
// This prompt (phase-42 0025) ships the loader, the dispatcher, the
// closed Destination set, and the test scaffolding; routing.yaml
// itself begins EMPTY. Per-category prompts 0030-0037 fill it in
// incrementally; the coverage test in 0038 will then assert every
// protomodel.Signals entry has exactly one routing entry.
package router

// Destination names a single typed write target. The closed set below
// is the ONLY set of legal values for routing.yaml's `dest:` field;
// validateEntries (in routing_loader.go) rejects anything else at
// process start.
//
// New destinations are added by (a) appending a const here, (b)
// adding the const to validDestinations in routing_loader.go, and
// (c) wiring a Writer for it in normalize.Pipeline (Prompt 0026).
// All three steps land in the same commit.
type Destination string

const (
	// DestPositions is the geo-spatial hot table holding the canonical
	// per-vehicle position track (latitude, longitude, heading,
	// elevation, speed). Reads back the latest fix for "where is the
	// car right now" UI, and supports historical trip replay.
	DestPositions Destination = "positions"

	// DestClimateSnapshot is the climate-cabin hot table: inside/outside
	// temperature, HVAC state, seat heaters, defrost, etc. One row per
	// (vehicle_id, ts) under the natural key.
	DestClimateSnapshot Destination = "climate_snapshot"

	// DestSecurityEvent is the discrete-event log for sentry-mode
	// activations, lock/unlock transitions, valet-mode, and similar
	// security-relevant signals. Append-only by design.
	DestSecurityEvent Destination = "security_event"

	// DestMotorSnapshot is the powertrain hot table (motor RPM, torque,
	// power, regen). One row per (vehicle_id, ts) under the natural
	// key.
	DestMotorSnapshot Destination = "motor_snapshot"

	// DestTirePressure is the tire-pressure-monitor hot table (per-corner
	// kPa + warning flags). Setting*Unit changes are applied at write
	// time via the unit_history layer; values persisted here are SI
	// (Pa).
	DestTirePressure Destination = "tire_pressure_snapshot"

	// DestMediaSnapshot is the infotainment hot table (now-playing
	// title/artist/source, audio volume, media-state).
	DestMediaSnapshot Destination = "media_snapshot"

	// DestSafetySnapshot is the active-safety hot table (autopilot
	// state, FCW/AEB activations, emergency-vehicle detection, blind-
	// spot warnings).
	DestSafetySnapshot Destination = "safety_snapshot"

	// DestLocationSnapshot is the location-context hot table (named
	// places, geofence membership, trip origin/destination markers).
	// Distinct from DestPositions: positions is the dense geometry,
	// location_snapshot is the sparse semantic context.
	DestLocationSnapshot Destination = "location_snapshot"

	// DestChargingTelemetry is the charging-session hot table (charge
	// rate, pilot current, battery_level deltas, charger
	// type/state). Joined to charging_sessions on (vehicle_id, ts).
	DestChargingTelemetry Destination = "charging_telemetry"

	// DestDriveTelemetry is the drive-session hot table (speed, gear
	// shift, energy used, per-segment trip context). Joined to drives
	// on (vehicle_id, ts).
	DestDriveTelemetry Destination = "drive_telemetry"

	// DestSignalLog is the cold-path catch-all hypertable. Every value
	// of every signal that has no dedicated hot column lands here, and
	// hot-routed values may also dual-write here when the routing
	// entry sets `also_signal_log: true` (used for replay /
	// point-in-time reconstruction).
	DestSignalLog Destination = "signal_log"

	// DestUnitHistory is the destination for the four Setting*Unit
	// fields. Writes update vehicle_unit_history so subsequent unit-
	// bearing values look up the correct active unit at write time.
	DestUnitHistory Destination = "unit_history"

	// DestDrop is the explicit "discard this Field" destination. Used
	// for proto fields that exist in the wire schema but carry no
	// downstream value (e.g. Tesla's Unknown / Deprecated_* /
	// Experimental_* sentinel Fields). Routing to DestDrop is a
	// declarative no-op: the router skips the writer lookup entirely.
	DestDrop Destination = "drop"
)

// Entry is one row of routing.yaml. It binds a single canonical
// proto Field name (matching codec.Atomic.Field) to exactly one
// Destination, plus optional metadata the destination's writer needs
// to serialise the value into the right column / topic.
//
// Field is the canonical proto Field name as emitted by
// protomodel.Signals — for atomic fields the bare proto name (e.g.
// "VehicleSpeed"), for flattened compound children the source field
// + child suffix (e.g. "LocationLatitude", "TpmsHardWarningsFrontLeft").
// The codec is the only producer of these names; the routing layer
// treats them as opaque strings.
//
// Destination is the closed-set target. Validated at Load time
// against validDestinations.
//
// Column is the destination-specific column name (e.g. "speed_mps"
// for DestPositions, "inside_temp_c" for DestClimateSnapshot). It is
// empty for cold-path destinations (DestSignalLog, DestUnitHistory,
// DestDrop) where the writer infers the storage layout from the
// Field name itself.
//
// ToColdLogToo, when true, instructs the router to dual-write the
// atomic to DestSignalLog in addition to the primary destination.
// Used for high-value hot signals that should also be replayable
// from the cold log (e.g. trip-defining samples that hot tables
// down-sample).
type Entry struct {
	Field        string      `yaml:"field"`
	Destination  Destination `yaml:"dest"`
	Column       string      `yaml:"column,omitempty"`
	ToColdLogToo bool        `yaml:"also_signal_log,omitempty"`
}
