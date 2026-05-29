package models

// APIKey moved to internal/models/auth.

// AuditLog moved to internal/models/system (along with 14 other types).

// Vehicle has moved to internal/models/vehicle.

// Position moved to internal/models/telemetry.

// Drive has moved to internal/models/drive.

// DriveTelemetryReading has moved to internal/models/drive.

// ChargeTelemetryReading has moved to internal/models/charging.

// ChargingSession has moved to internal/models/charging.

// Address moved to internal/models/geo.

// Geofence has moved to system.go (regenerated for post-migration schema).

// SoftwareUpdate has moved to vehicle.go.

// Token moved to internal/models/auth.

// LegacySettings + LegacyPollingConfig + DefaultPollingConfig + 4 method receivers
// moved to internal/models/settings.

// VehicleState has moved to vehicle.go.

// Alert and AlertRule have moved to alert.go. The legacy `alerts` table is
// dropped by the baseline migration; only `alert_rules` remains and is
// modeled by AlertRule in alert.go.

// CommandLog has moved to vehicle.go.

// EnergyStatsRow moved to internal/models/energy.

// BatterySnapshot was removed with the dropped battery_snapshots table.

// NotificationChannel + NotificationLog + NotificationSchedule +
// NotificationPreference + NotificationMetric moved to
// internal/models/notification.
// Note: NotificationLogEvent (acknowledgement audit timeline) lives in
// internal/models/alert.

// ChatMessage + ChatSessionInfo moved to internal/models/chatbot.

// TirePressureSnapshot has moved to vehicle.go.

// VampireDrainEvent has moved to vehicle.go.

// DailyMileage was removed; mileage endpoints derive from SI drives data.

// VisitedLocation moved to internal/models/geo.

// Trip is defined in trip.go (regenerated to match post-migration schema).

// VehicleStateRecord was removed; vehicle-state endpoints derive from fsm_transitions.

// APICallLog has been moved to tesla.go and regenerated to match the
// post-migration api_call_logs schema (ADR-005: no raw_json bodies).

// ExportJob + ExportJobSummary + ExportJobRequest moved to internal/models/export.

// MotorSnapshot moved to motor.go (regenerated for post-migration schema).

// ClimateSnapshot moved to climate.go (regenerated for post-migration schema).

// SecurityEvent moved to internal/models/security.
// SignalObservation, SignalCatalog, SignalDataKind, SignalStorageTier moved to internal/models/signal.
// DashboardLayout, ChartAnnotation, AnnotationCategory, SavedView, PinnedItem, PinnedItemType moved to internal/models/dashboard.

// ChargingTelemetry moved to charging_telemetry.go (regenerated for post-migration schema).

// MediaSnapshot has moved to vehicle.go.

// VehicleConfigSnapshot has moved to vehicle.go.

// LocationSnapshot has moved to vehicle.go.

// SafetySnapshot has moved to vehicle.go.

// UserPreferenceSnapshot has moved to vehicle.go.

// BackupConfig + BackupRun moved to internal/models/backup.

// RawTelemetrySignal moved to internal/models/telemetry.

// Automation has been moved to automation.go to match the post-migration
// schema (ADR-001 typed-by-default, ADR-004 class-table-inheritance root).
// Trigger, conditions, and actions now live in the automation_steps CTI tree.

// AutomationHistory moved to internal/models/automation.

// TeslaEnergySite, TeslaEnergyLiveStatus moved to internal/models/tesla.

// DerefFloat64 / DerefString / DerefBool helpers were deleted
// after audit confirmed zero callers remained (per no-tech-debt mandate).
// Use the standard `if p != nil { v = *p }` idiom or per-field defaults
// at the use-case / DTO boundary.

// AutomationVariable moved to internal/models/automation.

// TeslaChargingHistoryEntry, TeslaChargingHistorySummary,
// TeslaChargingSession, TeslaChargingSessionSummary,
// TeslaEnergyHistory, TeslaEnergyBackupEvent, TeslaEnergyWCCharging,
// TeslaUserConfig, TeslaUserOrder, TeslaUserProfile,
// TeslaVehicleDriver, TeslaVehicleInvitation moved to
// internal/models/tesla.
//
// TeslaToken + APICallLog (previously in internal/models/tesla.go) also
// moved to internal/models/tesla via `git mv` to tesla/core.go.
//
// TeslaFleetTelemetryError + TeslaFleetTelemetryErrorVIN moved to internal/models/telemetry.

// GuardConfig has moved to internal/models/vehicle.

// ShareToken has moved to internal/models/drive.

// GuardEvent has moved to internal/models/vehicle.
