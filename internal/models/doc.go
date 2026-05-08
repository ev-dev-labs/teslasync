// Package models defines the domain types shared across TeslaSync.
//
// Core types include [Vehicle], [Position], [Drive], [ChargingSession],
// [EnergyStatsRow], [Alert], [AlertRule],
// [NotificationChannel], [Geofence], [TirePressureSnapshot],
// [SoftwareUpdate], [VampireDrainEvent], [Trip], and
// [VehicleState]. All structs carry both `json` and `db` tags for
// API serialization and database mapping. Pointer fields represent
// nullable columns; timestamps use time.Time.
package models
