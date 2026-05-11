// Package models defines persistence and transport DTOs for TeslaSync.
//
// Layer: domain
//
// Per ADR-006 (.github/ARCHITECTURE.md):
//   - Every exported field of every exported struct carries
//     `db:"..."` or `json:"..."` (or both). arch_test enforces.
//   - Pointer fields represent nullable columns.
//   - Methods are limited to ToDomain() / FromDomain() and validators.
//   - This package may NOT import internal/database, internal/adapter/*,
//     internal/api, internal/handler/*, internal/app/*, or
//     internal/port/*. arch_test enforces. Importing internal/domain/*
//     (for ToDomain conversion methods) is explicitly allowed.
//   - Pure-business invariants and rich methods belong in
//     internal/domain/<bounded-context>, not here.
//
// Conversion to domain types lives at the use-case boundary:
//
//	models.Vehicle.ToDomain() → domain/vehicle.Vehicle
//
// Core types include [Vehicle], [Position], [Drive], [ChargingSession],
// [EnergyStatsRow], [Alert], [AlertRule], [NotificationChannel],
// [Geofence], [TirePressureSnapshot], [SoftwareUpdate],
// [VampireDrainEvent], [Trip], and [VehicleState].
package models
