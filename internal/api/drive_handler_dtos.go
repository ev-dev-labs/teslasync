package api

import (
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Drive telemetry signal → JSON field mappings (field names match the old
// DriveTelemetryReading JSON tags so the frontend contract is unchanged).
var driveTelemetryMappings = []database.PivotMapping{
	{Signal: "VehicleSpeed", Field: "speed"},
	{Signal: "PackCurrent", Field: "pack_current"},
	{Signal: "PackVoltage", Field: "pack_voltage"},
	{Signal: "BatteryLevel", Field: "battery_level"},
	{Signal: "Elevation", Field: "elevation"},
	{Signal: "InsideTemp", Field: "inside_temp"},
	{Signal: "OutsideTemp", Field: "outside_temp"},
	{Signal: "TpmsPressureFl", Field: "tire_pressure_fl"},
	{Signal: "TpmsPressureFr", Field: "tire_pressure_fr"},
	{Signal: "TpmsPressureRl", Field: "tire_pressure_rl"},
	{Signal: "TpmsPressureRr", Field: "tire_pressure_rr"},
	{Signal: "Latitude", Field: "latitude"},
	{Signal: "Longitude", Field: "longitude"},
}

// Position signal → JSON field mappings (field names match Position model tags).
var positionMappings = []database.PivotMapping{
	{Signal: "Latitude", Field: "latitude"},
	{Signal: "Longitude", Field: "longitude"},
	{Signal: "GpsHeading", Field: "heading"},
	{Signal: "VehicleSpeed", Field: "speed_mph"},
	{Signal: "Elevation", Field: "elevation_m"},
}
