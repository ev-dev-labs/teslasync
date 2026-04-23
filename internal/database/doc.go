// Package database provides the data access layer for TeslaSync.
//
// It wraps pgx/v5 connection pooling (pgxpool) with configurable pool
// sizes and health checks, and runs schema migrations automatically via
// golang-migrate. Twenty-two repository types (e.g. VehicleRepo,
// DriveRepo, ChargingRepo, AlertRuleRepo, MileageRepo, TripRepo) implement
// CRUD and domain-specific queries for all TeslaSync models. Native
// PostgreSQL partitioning is used for high-volume time-series data such
// as positions, with monthly partitions managed by the maintenance worker.
package database
