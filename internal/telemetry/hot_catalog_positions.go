package telemetry

// Hot routes whose destination is the positions hypertable.
// One file per destination table keeps catalog growth reviewable (ADR-002).
//
// Source of truth: Phase 3 schema for `positions`.
//
// Note: Location is a compound signal that must be Flatten()-ed first into
// atomic Latitude/Longitude sub-signals (handled in prompt 13). It is
// registered here so the bucketer recognizes its target table.
//
// Transformer functions referenced below are declared in transformers.go
// (Phase 5). Stubs live in transformers_stub.go until Phase 5 lands.

func init() {
	add := func(r HotRoute) { HotCatalog[r.Name] = r }

	add(HotRoute{Name: "Location", Table: "positions", Column: "", Kind: KindCompoundLocation})
	add(HotRoute{Name: "Latitude", Table: "positions", Column: "latitude", Kind: KindNumeric})
	add(HotRoute{Name: "Longitude", Table: "positions", Column: "longitude", Kind: KindNumeric})

	add(HotRoute{Name: "VehicleSpeed", Table: "positions", Column: "speed_mps", Kind: KindNumeric, Transformer: ConvertMphToMps})
	add(HotRoute{Name: "Speed", Table: "positions", Column: "speed_mps", Kind: KindNumeric, Transformer: ConvertMphToMps}) // alias when emitted in position context

	add(HotRoute{Name: "Heading", Table: "positions", Column: "heading_deg", Kind: KindNumeric})

	add(HotRoute{Name: "Elevation", Table: "positions", Column: "altitude_m", Kind: KindNumeric})
	add(HotRoute{Name: "Altitude", Table: "positions", Column: "altitude_m", Kind: KindNumeric}) // alias
}
