// Package tesla holds Tesla-account / Tesla-Fleet-API persistence
// repositories (NOT vehicle-telemetry SI signals — those go through
// internal/database/{drive,charging,energy,signal} via the phase-42
// normalize pipeline).
//
// Layer: adapter
//
// Carved files (Phase R4.20 — bounded-context restructure per ADR-011):
//
//   - charging_history_repo.go (was internal/database/tesla_charging_history_repo.go)
//     Account-level historical charging data fetched from the Fleet API
//     /vehicles/{id}/charging_history endpoint.
//   - charging_session_repo.go (was internal/database/tesla_charging_session_repo.go)
//     Account-level Supercharger-session billing records from
//     /dx/vehicles/charging_sessions.
//   - user_config_repo.go      (was internal/database/tesla_user_config_repo.go)
//     Tesla account configuration (UI prefs, units, region).
//   - user_order_repo.go       (was internal/database/tesla_user_order_repo.go)
//     Tesla account orders (vehicle/solar/powerwall purchases).
//   - user_profile_repo.go     (was internal/database/tesla_user_profile_repo.go)
//     Tesla account profile + linked email.
//   - vehicle_driver_repo.go   (was internal/database/tesla_vehicle_driver_repo.go)
//     Drivers + pending driver invitations per vehicle from
//     /api/1/vehicles/{id}/drivers + /invitations.
//
// Aggregate boundary: these are account/Fleet-API-mirror tables. They
// are distinct from the SI canonical signal-derived aggregates in
// internal/database/{charging,drive,energy,signal,vehicle}.
//
// Cross-package wiring: callers import this subpkg as `tesladb` per the
// ADR-011 alias convention.
//
//	import (
//	    tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
//	)
package tesla
