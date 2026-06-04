// Package tesla hosts persistence + transport DTOs for Tesla
// vendor-specific records: OAuth tokens, fleet API call logs, fleet
// charging history rows, energy site snapshots, and Tesla account /
// vehicle-driver metadata.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models in phase-R5.11. Recommended caller alias when
// importing alongside other models subpackages (per ADR-011 §3):
//
//	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
//
// The TeslaToken + APICallLog types previously living at
// internal/models/tesla.go are now in tesla/core.go; the remaining 14
// Tesla* types previously co-located in models.go are in tesla.go.
package tesla
