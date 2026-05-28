// Package vehicle holds the Vehicle aggregate-root repositories.
//
// Layer: adapter
//
// Carved files (Phase R4.21 — bounded-context restructure per ADR-011):
//
//   - repo.go         (was internal/database/vehicle_repo.go)
//     VehicleRepo: CRUD over vehicles + timezone updates. Aggregate
//     root for the vehicle bounded context.
//   - photo_repo.go   (was internal/database/vehicle_photo_repo.go)
//     VehiclePhotoRepo: per-vehicle photo upsert/retrieve/delete. Owns
//     ErrVehiclePhotoNotFound + VehiclePhotoRow.
//   - states_repo.go  (was internal/database/vehicle_states_repo.go)
//     VehicleStatesRepo: vehicle_state timeline + summary
//     aggregation. Owns VehicleStateSummaryRow + VehicleStateTransition.
//   - name_lookup.go  (NEW, refactored out of parent vehicle_settings_resolver.go)
//     NewNameLookup adapter: wires *VehicleRepo to the
//     database.VehicleNameLookup seam used by the settings resolver.
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
// notification, automation, alert, settings, ...). Settings repos
// stay in parent for now (see plan §14 R4.25 settings cluster).
package vehicle
