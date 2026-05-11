package writers

import (
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// motorColumnByField is the static field→column map for destination
// motor_snapshot. Built at file-edit time from routing.yaml entries
// with `dest: motor_snapshot` (36 routes — see the AUDIT_EVIDENCE
// section of phase-42a/0013's log for the verbatim extraction).
//
// Per phase-42a prompt 0013 Decision #3 (mirrors prompt 0012) this
// map is a static var, NOT a runtime read of routing.yaml: the
// routing layer's loader already validated every entry at process
// start, the per-payload hot path must not re-parse a 1000-line YAML
// file, and a compile-time declaration here lets the reflective
// coverage test in motor_writer_test.go catch any drift between
// routing.yaml and this file at CI time rather than at the first
// Write call.
//
// New routes are added by:
//
//  1. appending the entry to routing.yaml under `dest: motor_snapshot`,
//  2. adding (and verifying) the matching column in
//     migrations/000183_snapshots_si.up.sql,
//  3. adding the entry below in the same commit.
//
// The reflective coverage test will fail until step 3 lands, which
// is the intended check.
//
// Per-corner suffix convention used by the source fields (mirrored
// in the column names): F=front, R=rear (single-motor or shared),
// REL=rear-left, RER=rear-right (Plaid tri-motor / Cybertruck
// quad-motor). The schema's power_w column is intentionally NOT
// routed here — there is no DiPower atomic in routing.yaml and the
// per-axle DiTorqueActual* + DiAxleSpeed* fields are the SI
// inputs from which power is derived downstream.
var motorColumnByField = map[string]string{
	"DiAxleSpeedF":        "front_axle_speed_rpm",
	"DiAxleSpeedR":        "rear_axle_speed_rpm",
	"DiAxleSpeedREL":      "rear_left_axle_speed_rpm",
	"DiAxleSpeedRER":      "rear_right_axle_speed_rpm",
	"DiHeatsinkTF":        "front_heatsink_c",
	"DiHeatsinkTR":        "rear_heatsink_c",
	"DiHeatsinkTREL":      "rear_left_heatsink_c",
	"DiHeatsinkTRER":      "rear_right_heatsink_c",
	"DiInverterTF":        "front_inverter_c",
	"DiInverterTR":        "rear_inverter_c",
	"DiInverterTREL":      "rear_left_inverter_c",
	"DiInverterTRER":      "rear_right_inverter_c",
	"DiMotorCurrentF":     "front_motor_current_a",
	"DiMotorCurrentR":     "rear_motor_current_a",
	"DiMotorCurrentREL":   "rear_left_motor_current_a",
	"DiMotorCurrentRER":   "rear_right_motor_current_a",
	"DiSlaveTorqueCmd":    "torque_command_nm",
	"DiStateF":            "front_state",
	"DiStateR":            "rear_state",
	"DiStateREL":          "rear_left_state",
	"DiStateRER":          "rear_right_state",
	"DiStatorTempF":       "front_stator_c",
	"DiStatorTempR":       "rear_stator_c",
	"DiStatorTempREL":     "rear_left_stator_c",
	"DiStatorTempRER":     "rear_right_stator_c",
	"DiTorqueActualF":     "front_torque_nm",
	"DiTorqueActualR":     "rear_torque_nm",
	"DiTorqueActualREL":   "rear_left_torque_nm",
	"DiTorqueActualRER":   "rear_right_torque_nm",
	"DiTorquemotor":       "torque_motor_nm",
	"DiVBatF":             "front_vbat_v",
	"DiVBatR":             "rear_vbat_v",
	"DiVBatREL":           "rear_left_vbat_v",
	"DiVBatRER":           "rear_right_vbat_v",
	"Hvil":                "hvil_state",
	"IsolationResistance": "isolation_resistance_ohm",
}

// motorColumnFor is the columnFor callback supplied to snapshotWriter
// per phase-42a prompt 0013 Decision #2. Closes over motorColumnByField
// so the snapshot helper has a single source-of-truth lookup; ok=false
// is returned for any field NOT routed here (the snapshot helper then
// errors out loudly per its drop-loud contract — see snapshot_base.go's
// columnFor godoc).
func motorColumnFor(field string) (string, bool) {
	col, ok := motorColumnByField[field]
	return col, ok
}

// NewMotorWriter constructs the production motor snapshot writer.
// Returns the router.Writer for destination motor_snapshot
// (constructor signature is locked by phase-42a prompt 0013 Decision #1).
//
// Composes the unexported snapshotWriter from snapshot_base.go: the
// table is "motor_snapshots" (matches migration 000183) and the
// columnFor callback is motorColumnFor above. All 36 routed fields
// resolve to a column; the compile-time map plus the reflective
// coverage test together guarantee routing.yaml ↔ writer alignment.
//
// A nil pool is a wiring bug and panics at process start so the
// failure is surfaced before any payload is processed. Same panic
// pattern as NewClimateWriter / NewPositionsWriter.
//
// snapshotWriter constructor errors are also fatal — they indicate
// a programmer typo in the table identifier or a nil columnFor —
// neither of which is a runtime-recoverable condition. The panic
// message includes the wrapped error so the operator can correlate.
func NewMotorWriter(pool *pgxpool.Pool) router.Writer {
	if pool == nil {
		panic("NewMotorWriter: pool must be non-nil")
	}
	w, err := newSnapshotWriter(pool, "motor_snapshots", motorColumnFor)
	if err != nil {
		panic(fmt.Sprintf("NewMotorWriter: %v", err))
	}
	return w
}
