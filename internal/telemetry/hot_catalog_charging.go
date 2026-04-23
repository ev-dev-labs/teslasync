package telemetry

// Hot routes whose destination is the charging_telemetry hypertable.
// One file per destination table keeps catalog growth reviewable (ADR-002).
//
// Source of truth: migrations/_baseline_source/04-charging-telemetry.sql
// (re-applied by migration 000142_baseline_typed). Every typed column on
// charging_telemetry has at least one entry here.
//
// ScheduledChargingStartTime is a compound TypeTime parent emitted by Fleet
// Telemetry as {Hour, Minute, Second}. Phase 7 (prompt 12) provides
// flattenTime which collapses it into a normalized timestamptz suitable for
// scheduled_charging_at. Until then KindCompoundTime + NormalizeTimestamp
// keeps the route present without changing semantics.
//
// NOTE: Several signals here (ChargerPower, ChargerVoltage,
// ChargerActualCurrent, BatteryLevel, etc.) are also routed to
// vehicle_live_state by hot_catalog_vehicle_live_state.go. The writer
// (Phase 7) is responsible for fan-out / session-aware dispatch — the
// catalog itself only declares "this column accepts this signal".

func init() {
	add := func(r HotRoute) { HotCatalog[r.Name] = r }

	// ---------------------------------------------------------------------
	// Battery snapshot at charge sample (mirrored from vehicle_live_state)
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "BatteryLevel", Table: "charging_telemetry", Column: "battery_level", Kind: KindNumeric})
	add(HotRoute{Name: "Soc", Table: "charging_telemetry", Column: "battery_level", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "BatteryRange", Table: "charging_telemetry", Column: "battery_range_mi", Kind: KindNumeric})
	add(HotRoute{Name: "RatedRange", Table: "charging_telemetry", Column: "battery_range_mi", Kind: KindNumeric}) // alias

	// ---------------------------------------------------------------------
	// Charging state (enum-normalized per migration 000128)
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "ChargingState", Table: "charging_telemetry", Column: "charging_state", Kind: KindEnumNormalized, Transformer: NormalizeChargingState})
	add(HotRoute{Name: "ChargeState", Table: "charging_telemetry", Column: "charging_state", Kind: KindEnumNormalized, Transformer: NormalizeChargingState}) // alias

	// ---------------------------------------------------------------------
	// Charger electricals — voltage, current, power, phases, pilot
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "ChargerVoltage", Table: "charging_telemetry", Column: "charger_voltage", Kind: KindNumeric})

	add(HotRoute{Name: "ChargerActualCurrent", Table: "charging_telemetry", Column: "charger_actual_current", Kind: KindNumeric})

	add(HotRoute{Name: "ChargerPower", Table: "charging_telemetry", Column: "charger_power_kw", Kind: KindNumeric})
	add(HotRoute{Name: "ACChargingPower", Table: "charging_telemetry", Column: "charger_power_kw", Kind: KindNumeric})  // alias
	add(HotRoute{Name: "DCChargingPower", Table: "charging_telemetry", Column: "charger_power_kw", Kind: KindNumeric})  // alias
	add(HotRoute{Name: "FastChargerPower", Table: "charging_telemetry", Column: "charger_power_kw", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "ChargerPhases", Table: "charging_telemetry", Column: "charger_phases", Kind: KindNumeric})

	add(HotRoute{Name: "ChargerPilotCurrent", Table: "charging_telemetry", Column: "charger_pilot_current", Kind: KindNumeric})

	// ---------------------------------------------------------------------
	// Energy / range added during the session
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "ChargeEnergyAdded", Table: "charging_telemetry", Column: "charge_energy_added_kwh", Kind: KindNumeric})
	add(HotRoute{Name: "ACChargingEnergyIn", Table: "charging_telemetry", Column: "charge_energy_added_kwh", Kind: KindNumeric}) // alias
	add(HotRoute{Name: "DCChargingEnergyIn", Table: "charging_telemetry", Column: "charge_energy_added_kwh", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "ChargeMilesAdded", Table: "charging_telemetry", Column: "charge_miles_added", Kind: KindNumeric})
	add(HotRoute{Name: "ChargeMilesAddedRated", Table: "charging_telemetry", Column: "charge_miles_added", Kind: KindNumeric}) // alias

	add(HotRoute{Name: "ChargeRateMilePerHour", Table: "charging_telemetry", Column: "charge_rate_mph", Kind: KindNumeric})
	add(HotRoute{Name: "ChargeRate", Table: "charging_telemetry", Column: "charge_rate_mph", Kind: KindNumeric}) // alias

	// ---------------------------------------------------------------------
	// Scheduled charging — compound TypeTime collapsed by flattenTime
	// (Phase 7 / prompt 12) into a normalized timestamptz.
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "ScheduledChargingStartTime", Table: "charging_telemetry", Column: "scheduled_charging_at", Kind: KindCompoundTime, Transformer: NormalizeTimestamp})
	add(HotRoute{Name: "ScheduledChargingPending", Table: "charging_telemetry", Column: "scheduled_charging_at", Kind: KindCompoundTime, Transformer: NormalizeTimestamp}) // alias
}
