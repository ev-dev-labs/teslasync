// Package vehicle hosts persistence + transport DTOs for the
// vehicle-centric bounded context: the Vehicle aggregate root, its
// per-tick state snapshots (location, climate, media, tire pressure,
// safety, user-preferences, config), vampire-drain audit events,
// command/log entries, and Sentry/Guard mode configuration + events.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package was moved out of the formerly-flat
// internal/models. Recommended caller alias when importing alongside
// other model subpackages (per ADR-011 §3):
//
//	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
package vehicle
