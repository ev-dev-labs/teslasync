package telemetry

// Hot routes whose destination is the motor_snapshots hypertable.
// One file per destination table keeps catalog growth reviewable (ADR-002).
//
// Source of truth: migrations/_baseline_source/06-motor-snapshots.sql
// (re-applied by migration 000142_baseline_typed). Every typed column on
// motor_snapshots has at least one entry here.
//
// Note: shift_state lives on vehicle_live_state (registered in
// hot_catalog_vehicle_live_state.go), not motor_snapshots, so it is
// intentionally absent from this file.

func init() {
	add := func(r HotRoute) { HotCatalog[r.Name] = r }

	// ---------------------------------------------------------------------
	// Power (signed: positive = consuming, negative = regenerating)
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "PowerState", Table: "motor_snapshots", Column: "power_kw", Kind: KindNumeric})
	add(HotRoute{Name: "Power", Table: "motor_snapshots", Column: "power_kw", Kind: KindNumeric}) // alias

	// ---------------------------------------------------------------------
	// Motor RPM (front + rear; single-motor cars emit on rear)
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "FrontMotorRpm", Table: "motor_snapshots", Column: "motor_rpm_front", Kind: KindNumeric})
	add(HotRoute{Name: "RearMotorRpm", Table: "motor_snapshots", Column: "motor_rpm_rear", Kind: KindNumeric})
	add(HotRoute{Name: "DriveMotorRpm", Table: "motor_snapshots", Column: "motor_rpm_rear", Kind: KindNumeric}) // single-motor alias

	// ---------------------------------------------------------------------
	// Motor torque (front + rear)
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "FrontMotorTorque", Table: "motor_snapshots", Column: "torque_nm_front", Kind: KindNumeric})
	add(HotRoute{Name: "RearMotorTorque", Table: "motor_snapshots", Column: "torque_nm_rear", Kind: KindNumeric})
	add(HotRoute{Name: "PowertrainTorqueNm", Table: "motor_snapshots", Column: "torque_nm_rear", Kind: KindNumeric}) // single-motor alias

	// ---------------------------------------------------------------------
	// Motor temperatures (front + rear stator)
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "FrontMotorTemp", Table: "motor_snapshots", Column: "motor_temp_c_front", Kind: KindNumeric})
	add(HotRoute{Name: "RearMotorTemp", Table: "motor_snapshots", Column: "motor_temp_c_rear", Kind: KindNumeric})

	// ---------------------------------------------------------------------
	// Inverter + battery pack temperature
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "DriveInverterTemp", Table: "motor_snapshots", Column: "inverter_temp_c", Kind: KindNumeric})
	add(HotRoute{Name: "InverterTemp", Table: "motor_snapshots", Column: "inverter_temp_c", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "BatteryTemp", Table: "motor_snapshots", Column: "battery_temp_c", Kind: KindNumeric})
	add(HotRoute{Name: "PackTemperature", Table: "motor_snapshots", Column: "battery_temp_c", Kind: KindNumeric}) // alias

	// ---------------------------------------------------------------------
	// Regen power (magnitude; redundant with negative power_kw)
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "RegenBrakeTorque", Table: "motor_snapshots", Column: "regen_kw", Kind: KindNumeric})
	add(HotRoute{Name: "RegenPower", Table: "motor_snapshots", Column: "regen_kw", Kind: KindNumeric}) // alias
}
