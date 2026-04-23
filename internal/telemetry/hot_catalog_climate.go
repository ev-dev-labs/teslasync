package telemetry

// Hot routes whose destination is the climate_snapshots hypertable.
// One file per destination table keeps catalog growth reviewable (ADR-002).
//
// Source of truth: migrations/_baseline_source/05-climate-snapshots.sql
// (re-applied by migration 000142_baseline_typed). Every typed column on
// climate_snapshots has at least one entry here.
//
// Enum-typed columns are pinned to migration 000139's normalized values via
// the matching transformer in transformers.go (Phase 5). Stubs live in
// transformers_stub.go until Phase 5 lands.

func init() {
	add := func(r HotRoute) { HotCatalog[r.Name] = r }

	// ---------------------------------------------------------------------
	// Cabin / outside temperatures
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "InsideTemp", Table: "climate_snapshots", Column: "inside_temp_c", Kind: KindNumeric})
	add(HotRoute{Name: "InsideTempCelsius", Table: "climate_snapshots", Column: "inside_temp_c", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "OutsideTemp", Table: "climate_snapshots", Column: "outside_temp_c", Kind: KindNumeric})
	add(HotRoute{Name: "OutsideTempCelsius", Table: "climate_snapshots", Column: "outside_temp_c", Kind: KindNumeric}) // alias

	// ---------------------------------------------------------------------
	// Driver / passenger setpoints
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "HvacLeftTemperatureRequest", Table: "climate_snapshots", Column: "driver_setpoint_c", Kind: KindNumeric})
	add(HotRoute{Name: "DriverTempSetting", Table: "climate_snapshots", Column: "driver_setpoint_c", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "HvacRightTemperatureRequest", Table: "climate_snapshots", Column: "passenger_setpoint_c", Kind: KindNumeric})
	add(HotRoute{Name: "PassengerTempSetting", Table: "climate_snapshots", Column: "passenger_setpoint_c", Kind: KindNumeric}) // alias

	// ---------------------------------------------------------------------
	// HVAC mode + defrost (enum-normalized per migration 000139)
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "HvacAutoMode", Table: "climate_snapshots", Column: "hvac_state", Kind: KindEnumNormalized, Transformer: NormalizeHvacState})
	add(HotRoute{Name: "HvacState", Table: "climate_snapshots", Column: "hvac_state", Kind: KindEnumNormalized, Transformer: NormalizeHvacState}) // alias

	add(HotRoute{Name: "DefrostMode", Table: "climate_snapshots", Column: "defrost_mode", Kind: KindEnumNormalized, Transformer: NormalizeDefrostMode})

	// ---------------------------------------------------------------------
	// Climate on/off + preconditioning
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "HvacPower", Table: "climate_snapshots", Column: "is_climate_on", Kind: KindBool})
	add(HotRoute{Name: "IsClimateOn", Table: "climate_snapshots", Column: "is_climate_on", Kind: KindBool})  // alias
	add(HotRoute{Name: "ClimateState", Table: "climate_snapshots", Column: "is_climate_on", Kind: KindBool}) // alias

	add(HotRoute{Name: "DefrostForPreconditioning", Table: "climate_snapshots", Column: "is_preconditioning", Kind: KindBool})
	add(HotRoute{Name: "IsPreconditioning", Table: "climate_snapshots", Column: "is_preconditioning", Kind: KindBool}) // alias

	// ---------------------------------------------------------------------
	// Fan
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "HvacFanStatus", Table: "climate_snapshots", Column: "fan_status", Kind: KindNumeric})
	add(HotRoute{Name: "FanStatus", Table: "climate_snapshots", Column: "fan_status", Kind: KindNumeric}) // alias

	// ---------------------------------------------------------------------
	// Seat heaters (enum-normalized to 0-3 per migration 000139)
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "SeatHeaterLeft", Table: "climate_snapshots", Column: "seat_heater_left", Kind: KindEnumNormalized, Transformer: NormalizeSeatHeater})
	add(HotRoute{Name: "SeatHeaterRight", Table: "climate_snapshots", Column: "seat_heater_right", Kind: KindEnumNormalized, Transformer: NormalizeSeatHeater})
	add(HotRoute{Name: "SeatHeaterRearLeft", Table: "climate_snapshots", Column: "seat_heater_rear_left", Kind: KindEnumNormalized, Transformer: NormalizeSeatHeater})
	add(HotRoute{Name: "SeatHeaterRearRight", Table: "climate_snapshots", Column: "seat_heater_rear_right", Kind: KindEnumNormalized, Transformer: NormalizeSeatHeater})

	// ---------------------------------------------------------------------
	// Steering wheel heater + cabin overheat protection
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "HvacSteeringWheelHeatAuto", Table: "climate_snapshots", Column: "steering_wheel_heater", Kind: KindBool})
	add(HotRoute{Name: "SteeringWheelHeater", Table: "climate_snapshots", Column: "steering_wheel_heater", Kind: KindBool}) // alias

	add(HotRoute{Name: "CabinOverheatProtectionMode", Table: "climate_snapshots", Column: "cabin_overheat_protection", Kind: KindBool})
	add(HotRoute{Name: "CabinOverheatProtection", Table: "climate_snapshots", Column: "cabin_overheat_protection", Kind: KindBool}) // alias
}
