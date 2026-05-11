package writers

import (
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// chargingTelemetryColumnByField is the static field→column map for
// destination charging_telemetry. Built at file-edit time from
// routing.yaml entries with `dest: charging_telemetry` (12 routes —
// see the AUDIT_EVIDENCE section of phase-42a/0019's log for the
// verbatim extraction).
//
// Per phase-42a prompt 0019 Decision #2 the charging_telemetry writer
// composes the shared snapshotWriter helper from snapshot_base.go.
// The (vehicle_id, ts) PK upsert pattern works for the per-tick
// time-series table exactly as it does for the *_snapshots tables:
// two atomics for the same tick (e.g. ACChargingPower +
// ACChargingEnergyIn at the same EmittedAt) coalesce into ONE row
// with both columns set, matching the table's ~1 Hz sampling
// contract documented at migration 000184_charging_si.up.sql:111-112.
//
// Per Decision #3 the writer NEVER touches the session_id column.
// migrations/000184_charging_si.up.sql:84 declares session_id
// nullable; the session tracker (a side-effect observer landing in
// phase-42a/0030) backfills it via a separate UPDATE after session
// boundaries are detected. snapshotWriter's INSERT statement at
// internal/tesla/router/writers/snapshot_base.go:158 names only
// (vehicle_id, ts, <col>) so session_id is naturally omitted from
// both the INSERT column list and the ON CONFLICT DO UPDATE SET
// clause — late-arriving session_id UPDATEs are preserved across
// per-column re-deliveries because the upsert SET clause references
// only the routed column.
//
// Per Decision #3 the writer also never touches the five other
// columns reserved on the table (charger_actual_current_a,
// charger_pilot_current_a, battery_heater_power_w, charge_request,
// and charge_state — see migration 000184 lines 90-96) because no
// routing.yaml entry under `dest: charging_telemetry` declares them
// today. Each future route lands by appending the entry to
// routing.yaml AND extending the map below; the reflective coverage
// test (see chargingTelemetryWriter_test.go) catches drift at CI
// time.
//
// Per Decision #4 this map is a static var, NOT a runtime read of
// routing.yaml: the routing layer's loader already validated every
// entry at process start, the per-payload hot path must not re-parse
// a 1000-line YAML file, and a compile-time declaration here lets
// the reflective coverage test catch any drift between routing.yaml
// and this file at CI time rather than at the first Write call.
//
// The codec.Atomic.Value type for each routed field is the SI scalar
// the codec emits — float64 for *_w / *_wh / *_v / *_pct, int64 for
// charger_phases (INTEGER column), bool for *_on / *_open, and
// string for *_type / *_latch. snapshot_base.go's bindSnapshotValue
// at lines 194-209 accepts exactly these four kinds; nothing in
// charging_telemetry needs the TIMESTAMPTZ hybrid wrapper applied to
// tire_pressure last-seen-at columns.
var chargingTelemetryColumnByField = map[string]string{
	"ACChargingEnergyIn": "ac_charging_energy_in_wh",
	"ACChargingPower":    "ac_charging_power_w",
	"BatteryHeaterOn":    "battery_heater_on",
	"ChargeLimitSoc":     "charge_limit_soc_pct",
	"ChargePortDoorOpen": "charge_port_door_open",
	"ChargePortLatch":    "charge_port_latch",
	"ChargerPhases":      "charger_phases",
	"ChargerVoltage":     "charger_voltage_v",
	"ChargingCableType":  "charging_cable_type",
	"DCChargingEnergyIn": "dc_charging_energy_in_wh",
	"DCChargingPower":    "dc_charging_power_w",
	"FastChargerType":    "fast_charger_type",
}

// chargingTelemetryColumnFor is the columnFor callback supplied to
// snapshotWriter per phase-42a prompt 0019 Decision #2. Closes over
// chargingTelemetryColumnByField so the snapshot helper has a single
// source-of-truth lookup; ok=false is returned for any field NOT
// routed here (the snapshot helper then errors out loudly per its
// drop-loud contract — see snapshot_base.go's columnFor godoc).
func chargingTelemetryColumnFor(field string) (string, bool) {
	col, ok := chargingTelemetryColumnByField[field]
	return col, ok
}

// NewChargingTelemetryWriter constructs the production charging
// telemetry writer. Returns the router.Writer for destination
// charging_telemetry (constructor signature is locked by phase-42a
// prompt 0019 Decision #1).
//
// Composes the unexported snapshotWriter from snapshot_base.go: the
// table is "charging_telemetry" (matches migration 000184) and the
// columnFor callback is chargingTelemetryColumnFor above. All 12
// routed fields resolve to a column; the compile-time map plus the
// reflective coverage test together guarantee routing.yaml ↔ writer
// alignment.
//
// charging_telemetry is the per-tick time-series table — NOT the
// session-aggregate charging_sessions table. session_id is left NULL
// at insert time and backfilled by the session tracker observer
// (phase-42a/0030).
//
// A nil pool is a wiring bug and panics at process start so the
// failure is surfaced before any payload is processed. Same panic
// pattern as NewClimateWriter / NewSafetyWriter / NewMediaWriter.
//
// snapshotWriter constructor errors are also fatal — they indicate
// a programmer typo in the table identifier or a nil columnFor —
// neither of which is a runtime-recoverable condition. The panic
// message includes the wrapped error so the operator can correlate.
func NewChargingTelemetryWriter(pool *pgxpool.Pool) router.Writer {
	if pool == nil {
		panic("NewChargingTelemetryWriter: pool must be non-nil")
	}
	w, err := newSnapshotWriter(pool, "charging_telemetry", chargingTelemetryColumnFor)
	if err != nil {
		panic(fmt.Sprintf("NewChargingTelemetryWriter: %v", err))
	}
	return w
}
