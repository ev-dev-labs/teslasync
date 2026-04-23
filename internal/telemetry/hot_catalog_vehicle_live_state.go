package telemetry

// Hot routes whose destination is the vehicle_live_state table.
// One file per destination table keeps catalog growth reviewable (ADR-002).
//
// Source of truth: migrations/_baseline_source/02-vehicle-live-state.sql
// Every typed column on vehicle_live_state has at least one entry here.
//
// Transformer functions referenced below are declared in transformers.go
// (Phase 5). Stubs live in transformers_stub.go until Phase 5 lands.

func init() {
	add := func(r HotRoute) { HotCatalog[r.Name] = r }

	// ---------------------------------------------------------------------
	// Battery / charge
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "BatteryLevel", Table: "vehicle_live_state", Column: "battery_level", Kind: KindNumeric})
	add(HotRoute{Name: "Soc", Table: "vehicle_live_state", Column: "battery_level", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "BatteryRange", Table: "vehicle_live_state", Column: "battery_range_mi", Kind: KindNumeric})
	add(HotRoute{Name: "RatedRange", Table: "vehicle_live_state", Column: "battery_range_mi", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "ChargingState", Table: "vehicle_live_state", Column: "charging_state", Kind: KindEnumNormalized, Transformer: NormalizeChargingState})
	add(HotRoute{Name: "ChargeState", Table: "vehicle_live_state", Column: "charging_state", Kind: KindEnumNormalized, Transformer: NormalizeChargingState}) // alias

	add(HotRoute{Name: "ChargeLimitSoc", Table: "vehicle_live_state", Column: "charge_limit_soc", Kind: KindNumeric})
	add(HotRoute{Name: "ChargeLimitSoC", Table: "vehicle_live_state", Column: "charge_limit_soc", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "ChargerVoltage", Table: "vehicle_live_state", Column: "charger_voltage", Kind: KindNumeric})
	add(HotRoute{Name: "ChargerActualCurrent", Table: "vehicle_live_state", Column: "charger_actual_current", Kind: KindNumeric})
	add(HotRoute{Name: "ACChargingPower", Table: "vehicle_live_state", Column: "charger_power_kw", Kind: KindNumeric})
	add(HotRoute{Name: "DCChargingPower", Table: "vehicle_live_state", Column: "charger_power_kw", Kind: KindNumeric})    // alias
	add(HotRoute{Name: "FastChargerPower", Table: "vehicle_live_state", Column: "charger_power_kw", Kind: KindNumeric})   // alias
	add(HotRoute{Name: "ChargerPower", Table: "vehicle_live_state", Column: "charger_power_kw", Kind: KindNumeric})       // alias

	add(HotRoute{Name: "BatteryLastUpdated", Table: "vehicle_live_state", Column: "battery_last_updated_at", Kind: KindCompoundTime, Transformer: NormalizeTimestamp})

	// ---------------------------------------------------------------------
	// Position
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "Location", Table: "vehicle_live_state", Column: "", Kind: KindCompoundLocation, Transformer: FlattenLocation})
	add(HotRoute{Name: "Latitude", Table: "vehicle_live_state", Column: "latitude", Kind: KindNumeric})
	add(HotRoute{Name: "Longitude", Table: "vehicle_live_state", Column: "longitude", Kind: KindNumeric})
	add(HotRoute{Name: "Heading", Table: "vehicle_live_state", Column: "heading", Kind: KindNumeric})
	add(HotRoute{Name: "VehicleSpeed", Table: "vehicle_live_state", Column: "speed_mph", Kind: KindNumeric})
	add(HotRoute{Name: "Speed", Table: "vehicle_live_state", Column: "speed_mph", Kind: KindNumeric}) // alias
	add(HotRoute{Name: "Elevation", Table: "vehicle_live_state", Column: "elevation_m", Kind: KindNumeric})
	add(HotRoute{Name: "GpsState", Table: "vehicle_live_state", Column: "gps_state", Kind: KindText})
	add(HotRoute{Name: "GpsHeading", Table: "vehicle_live_state", Column: "heading", Kind: KindNumeric})                                                                            // alias
	add(HotRoute{Name: "PositionLastUpdated", Table: "vehicle_live_state", Column: "position_last_updated_at", Kind: KindCompoundTime, Transformer: NormalizeTimestamp})

	// ---------------------------------------------------------------------
	// Climate
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "InsideTemp", Table: "vehicle_live_state", Column: "inside_temp_c", Kind: KindNumeric})
	add(HotRoute{Name: "InsideTempCelsius", Table: "vehicle_live_state", Column: "inside_temp_c", Kind: KindNumeric}) // alias
	add(HotRoute{Name: "OutsideTemp", Table: "vehicle_live_state", Column: "outside_temp_c", Kind: KindNumeric})
	add(HotRoute{Name: "OutsideTempCelsius", Table: "vehicle_live_state", Column: "outside_temp_c", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "HvacState", Table: "vehicle_live_state", Column: "hvac_state", Kind: KindEnumNormalized, Transformer: NormalizeHvacState})
	add(HotRoute{Name: "HvacAutoMode", Table: "vehicle_live_state", Column: "hvac_state", Kind: KindEnumNormalized, Transformer: NormalizeHvacState}) // alias

	add(HotRoute{Name: "ClimateState", Table: "vehicle_live_state", Column: "is_climate_on", Kind: KindBool})
	add(HotRoute{Name: "IsClimateOn", Table: "vehicle_live_state", Column: "is_climate_on", Kind: KindBool}) // alias

	add(HotRoute{Name: "DefrostMode", Table: "vehicle_live_state", Column: "defrost_mode", Kind: KindText})
	add(HotRoute{Name: "ClimateLastUpdated", Table: "vehicle_live_state", Column: "climate_last_updated_at", Kind: KindCompoundTime, Transformer: NormalizeTimestamp})

	// ---------------------------------------------------------------------
	// Drive / motor
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "Gear", Table: "vehicle_live_state", Column: "shift_state", Kind: KindCompoundShift, Transformer: NormalizeShiftState})
	add(HotRoute{Name: "ShiftState", Table: "vehicle_live_state", Column: "shift_state", Kind: KindCompoundShift, Transformer: NormalizeShiftState}) // alias

	add(HotRoute{Name: "DriveState", Table: "vehicle_live_state", Column: "drive_state", Kind: KindText})
	add(HotRoute{Name: "VehicleState", Table: "vehicle_live_state", Column: "drive_state", Kind: KindEnumNormalized, Transformer: NormalizeDriveState}) // alias

	add(HotRoute{Name: "PowerKw", Table: "vehicle_live_state", Column: "power_kw", Kind: KindNumeric})
	add(HotRoute{Name: "Power", Table: "vehicle_live_state", Column: "power_kw", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "MotorRpm", Table: "vehicle_live_state", Column: "motor_rpm", Kind: KindNumeric})
	add(HotRoute{Name: "RearMotorRpm", Table: "vehicle_live_state", Column: "motor_rpm", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "DriveLastUpdated", Table: "vehicle_live_state", Column: "drive_last_updated_at", Kind: KindCompoundTime, Transformer: NormalizeTimestamp})

	// ---------------------------------------------------------------------
	// Security
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "Locked", Table: "vehicle_live_state", Column: "locked", Kind: KindBool})
	add(HotRoute{Name: "VehicleLocked", Table: "vehicle_live_state", Column: "locked", Kind: KindBool}) // alias

	add(HotRoute{Name: "SentryMode", Table: "vehicle_live_state", Column: "sentry_mode", Kind: KindBool})

	add(HotRoute{Name: "UserPresent", Table: "vehicle_live_state", Column: "user_present", Kind: KindBool})

	// Compound door/window flatteners — empty Column means Flatten() must run first.
	add(HotRoute{Name: "DoorState", Table: "vehicle_live_state", Column: "doors_open", Kind: KindCompoundDoors, Transformer: FlattenDoors})
	add(HotRoute{Name: "WindowState", Table: "vehicle_live_state", Column: "windows_open", Kind: KindCompoundWindows, Transformer: FlattenWindows})

	add(HotRoute{Name: "SecurityLastUpdated", Table: "vehicle_live_state", Column: "security_last_updated_at", Kind: KindCompoundTime, Transformer: NormalizeTimestamp})

	// ---------------------------------------------------------------------
	// Software / firmware
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "SoftwareVersion", Table: "vehicle_live_state", Column: "software_version", Kind: KindText})
	add(HotRoute{Name: "Version", Table: "vehicle_live_state", Column: "software_version", Kind: KindText}) // alias
}
