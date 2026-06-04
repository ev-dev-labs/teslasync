package writers

import (
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// climateColumnByField is the static field→column map for destination
// climate_snapshot. It mirrors routing.yaml entries with `dest:
// climate_snapshot`.
//
// This map is static rather than read from routing.yaml at runtime: the
// routing loader already validates every entry at process start, the hot path
// must not re-parse YAML, and the reflective coverage test catches drift in CI.
//
// New routes are added by:
//
//  1. appending the entry to routing.yaml under `dest: climate_snapshot`,
//  2. adding (and verifying) the matching column in
//     migrations/000183_snapshots_si.up.sql,
//  3. adding the entry below in the same commit.
//
// The reflective coverage test will fail until step 3 lands, which is
// the intended check.
var climateColumnByField = map[string]string{
	"AutoSeatClimateLeft":                     "auto_seat_climate_left",
	"AutoSeatClimateRight":                    "auto_seat_climate_right",
	"CabinOverheatProtectionMode":             "cabin_overheat_protection_mode",
	"CabinOverheatProtectionTemperatureLimit": "cabin_overheat_protection_temperature_limit",
	"ClimateKeeperMode":                       "climate_keeper_mode",
	"ClimateSeatCoolingFrontLeft":             "climate_seat_cooling_front_left",
	"ClimateSeatCoolingFrontRight":            "climate_seat_cooling_front_right",
	"DefrostForPreconditioning":               "defrost_for_preconditioning",
	"DefrostMode":                             "defrost_mode",
	"DriverSeatBelt":                          "driver_seat_belt",
	"DriverSeatOccupied":                      "driver_seat_occupied",
	"HvacACEnabled":                           "hvac_ac_enabled",
	"HvacAutoMode":                            "hvac_auto_mode",
	"HvacFanSpeed":                            "hvac_fan_speed",
	"HvacFanStatus":                           "hvac_fan_status",
	"HvacLeftTemperatureRequest":              "hvac_left_request_c",
	"HvacPower":                               "hvac_power",
	"HvacRightTemperatureRequest":             "hvac_right_request_c",
	"HvacSteeringWheelHeatAuto":               "hvac_steering_wheel_heat_auto",
	"HvacSteeringWheelHeatLevel":              "hvac_steering_wheel_heat_level",
	"InsideTemp":                              "inside_temp_c",
	"OutsideTemp":                             "outside_temp_c",
	"PassengerSeatBelt":                       "passenger_seat_belt",
	"RearSeatHeaters":                         "rear_seat_heaters",
	"SeatHeaterLeft":                          "seat_heater_left",
	"SeatHeaterRearCenter":                    "seat_heater_rear_center",
	"SeatHeaterRearLeft":                      "seat_heater_rear_left",
	"SeatHeaterRearRight":                     "seat_heater_rear_right",
	"SeatHeaterRight":                         "seat_heater_right",
	"SeatVentEnabled":                         "seat_vent_enabled",
	"WiperHeatEnabled":                        "wiper_heat_enabled",
}

// climateColumnFor is the columnFor callback supplied to snapshotWriter. It
// closes over climateColumnByField
// so the snapshot helper has a single source-of-truth lookup; ok=false
// is returned for any field NOT routed here (the snapshot helper then
// errors out loudly per its drop-loud contract — see snapshot_base.go's
// columnFor godoc).
func climateColumnFor(field string) (string, bool) {
	col, ok := climateColumnByField[field]
	return col, ok
}

// NewClimateWriter constructs the production climate snapshot writer.
// Returns the router.Writer for destination climate_snapshot.
//
// Composes the unexported snapshotWriter from snapshot_base.go: the
// table is "climate_snapshots" (matches migration 000183) and the
// columnFor callback is climateColumnFor above. All 31 routed fields
// resolve to a column; the compile-time map plus the reflective
// coverage test together guarantee routing.yaml ↔ writer alignment.
//
// A nil pool is a wiring bug and panics at process start so the
// failure is surfaced before any payload is processed. Same panic
// pattern as NewPositionsWriter.
//
// snapshotWriter constructor errors are also fatal — they indicate
// a programmer typo in the table identifier or a nil columnFor —
// neither of which is a runtime-recoverable condition. The panic
// message includes the wrapped error so the operator can correlate.
func NewClimateWriter(pool *pgxpool.Pool) router.Writer {
	if pool == nil {
		panic("NewClimateWriter: pool must be non-nil")
	}
	w, err := newSnapshotWriter(pool, "climate_snapshots", climateColumnFor)
	if err != nil {
		panic(fmt.Sprintf("NewClimateWriter: %v", err))
	}
	return w
}
