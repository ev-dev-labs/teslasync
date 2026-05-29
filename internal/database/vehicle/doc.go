// Package vehicle holds the Vehicle aggregate-root repositories.
//
// Layer: adapter
//
// Bounded-context files:
//
//   - repo.go
//     VehicleRepo: CRUD over vehicles + timezone updates. Aggregate
//     root for the vehicle bounded context.
//   - photo_repo.go
//     VehiclePhotoRepo: per-vehicle photo upsert/retrieve/delete. Owns
//     ErrVehiclePhotoNotFound + VehiclePhotoRow.
//   - states_repo.go
//     VehicleStatesRepo: vehicle_state timeline + summary
//     aggregation. Owns VehicleStateSummaryRow + VehicleStateTransition.
//   - name_lookup.go
//     NewNameLookup adapter: wires *VehicleRepo to the
//     settingsdb.VehicleNameLookup seam used by the settings resolver.
//     Lives in the vehicle subpkg so the parent resolver does not
//     depend on the concrete VehicleRepo type (resolver depends only
//     on the interface).
//
// Cross-package wiring: callers import this subpkg as `vehicledb` per
// the ADR-011 alias convention.
//
//	import (
//	    vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
//	)
//
// Notable downstream: 38 caller files (heart-of-system; vehicle ID is
// the foreign key into drive, charging, energy, signal, telemetry,
// notification, automation, alert, and settings.
package vehicle
