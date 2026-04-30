package telemetry

// Hot routes whose destination is the security_events hypertable.
// One file per destination table keeps catalog growth reviewable (ADR-002).
//
// Source of truth: migrations 000131 (door widening), 000132 (window state),
// 000133 (turn signal) re-applied by migration 000142_baseline_typed.
//
// DoorState and WindowState are compound parents with empty Column. Phase 7
// flatteners (flattenDoors / flattenWindows) expand them into the per-part
// atomic signals registered below, which in turn route to typed columns.

func init() {
	add := func(r HotRoute) { HotCatalog[r.Name] = r }

	// ---------------------------------------------------------------------
	// Compound parents — flattened by prompts 11/13 into atomic children.
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "DoorState", Table: "security_events", Column: "", Kind: KindCompoundDoors})
	add(HotRoute{Name: "WindowState", Table: "security_events", Column: "", Kind: KindCompoundWindows})

	// ---------------------------------------------------------------------
	// Door atomic children (produced by flattenDoors)
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "DoorState_DriverFront", Table: "security_events", Column: "door_driver_front_open", Kind: KindBool})
	add(HotRoute{Name: "DoorState_PassengerFront", Table: "security_events", Column: "door_passenger_front_open", Kind: KindBool})
	add(HotRoute{Name: "DoorState_DriverRear", Table: "security_events", Column: "door_driver_rear_open", Kind: KindBool})
	add(HotRoute{Name: "DoorState_PassengerRear", Table: "security_events", Column: "door_passenger_rear_open", Kind: KindBool})
	add(HotRoute{Name: "DoorState_FrontTrunk", Table: "security_events", Column: "front_trunk_open", Kind: KindBool})
	add(HotRoute{Name: "DoorState_RearTrunk", Table: "security_events", Column: "rear_trunk_open", Kind: KindBool})

	// ---------------------------------------------------------------------
	// Window atomic children (produced by flattenWindows; migration 000132)
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "WindowState_DriverFront", Table: "security_events", Column: "window_driver_front", Kind: KindEnumNormalized, Transformer: NormalizeWindowState})
	add(HotRoute{Name: "WindowState_PassengerFront", Table: "security_events", Column: "window_passenger_front", Kind: KindEnumNormalized, Transformer: NormalizeWindowState})
	add(HotRoute{Name: "WindowState_DriverRear", Table: "security_events", Column: "window_driver_rear", Kind: KindEnumNormalized, Transformer: NormalizeWindowState})
	add(HotRoute{Name: "WindowState_PassengerRear", Table: "security_events", Column: "window_passenger_rear", Kind: KindEnumNormalized, Transformer: NormalizeWindowState})

	// ---------------------------------------------------------------------
	// Lock / sentry / valet / tonneau / turn signal
	// ---------------------------------------------------------------------
	add(HotRoute{Name: "Locked", Table: "security_events", Column: "locked", Kind: KindBool})
	add(HotRoute{Name: "SentryMode", Table: "security_events", Column: "sentry_mode", Kind: KindEnumNormalized, Transformer: NormalizeSentryMode})
	add(HotRoute{Name: "ValetMode", Table: "security_events", Column: "valet_mode", Kind: KindBool})
	add(HotRoute{Name: "TonneauPosition", Table: "security_events", Column: "tonneau_position", Kind: KindEnumNormalized, Transformer: NormalizeTonneauPosition})
	add(HotRoute{Name: "TonneauTentMode", Table: "security_events", Column: "tonneau_tent_mode", Kind: KindEnumNormalized, Transformer: NormalizeTonneauTentMode})
	add(HotRoute{Name: "TurnSignal", Table: "security_events", Column: "turn_signal", Kind: KindEnumNormalized, Transformer: NormalizeTurnSignal})
}
