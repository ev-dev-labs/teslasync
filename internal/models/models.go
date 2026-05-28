package models

// APIKey moved to internal/models/auth in phase-R5.2.

// AuditLog has moved to system.go (regenerated for post-migration schema).

// Vehicle has moved to vehicle.go (regenerated for post-migration schema).

// Position has moved to position.go (regenerated for post-migration schema).

// Drive has moved to drive.go (regenerated for post-migration schema).

// DriveTelemetryReading has moved to drive.go.

// ChargeTelemetryReading has moved to charging.go.

// ChargingSession is defined in charging.go to mirror the post-migration
// `charging_sessions` schema (migrations/000142_baseline_typed.up.sql).

// Address moved to internal/models/geo in phase-R5.7.

// Geofence has moved to system.go (regenerated for post-migration schema).

// SoftwareUpdate has moved to vehicle.go.

// Token moved to internal/models/auth in phase-R5.2.

// LegacySettings + LegacyPollingConfig + DefaultPollingConfig + 4 method receivers
// moved to internal/models/settings in phase-R5.8.

// VehicleState has moved to vehicle.go.

// Alert and AlertRule have moved to alert.go. The legacy `alerts` table is
// dropped by the Phase 4 baseline migration; only `alert_rules` remains and is
// modeled by AlertRule in alert.go.

// CommandLog has moved to vehicle.go.

// EnergyStatsRow moved to internal/models/energy in phase-R5.5.

// BatterySnapshot was removed with the dropped battery_snapshots table.

// NotificationChannel + NotificationLog + NotificationSchedule +
// NotificationPreference + NotificationMetric moved to
// internal/models/notification in phase-R5.9.
// Note: NotificationLogEvent (acknowledgement audit timeline) lives in
// internal/models/alert per phase-R5.1.

// ChatMessage + ChatSessionInfo moved to internal/models/chatbot in phase-R5.4.

// TirePressureSnapshot has moved to vehicle.go.

// VampireDrainEvent has moved to vehicle.go.

// DailyMileage was removed; mileage endpoints derive from SI drives data.

// VisitedLocation moved to internal/models/geo in phase-R5.7.

// Trip is defined in trip.go (regenerated to match post-migration schema).

// VehicleStateRecord was removed; vehicle-state endpoints derive from fsm_transitions.

// APICallLog has been moved to tesla.go and regenerated to match the
// post-migration api_call_logs schema (ADR-005: no raw_json bodies).

// ExportJob + ExportJobSummary + ExportJobRequest moved to internal/models/export in phase-R5.6.

// MotorSnapshot moved to motor.go (regenerated for post-migration schema).

// ClimateSnapshot moved to climate.go (regenerated for post-migration schema).

// SecurityEvent moved to security.go (regenerated for post-migration schema).

// ChargingTelemetry moved to charging_telemetry.go (regenerated for post-migration schema).

// MediaSnapshot has moved to vehicle.go.

// VehicleConfigSnapshot has moved to vehicle.go.

// LocationSnapshot has moved to vehicle.go.

// SafetySnapshot has moved to vehicle.go.

// UserPreferenceSnapshot has moved to vehicle.go.

// BackupConfig + BackupRun moved to internal/models/backup in phase-R5.3.

// RawTelemetrySignal has moved to telemetry.go.

// Automation has been moved to automation.go to match the post-migration
// schema (ADR-001 typed-by-default, ADR-004 class-table-inheritance root).
// Trigger, conditions, and actions now live in the automation_steps CTI tree.

// AutomationHistory moved to internal/models/automation in phase-R5.10.

// TeslaEnergySite, TeslaEnergyLiveStatus moved to internal/models/tesla in phase-R5.11.

// DerefFloat64 safely dereferences a *float64, returning 0 if nil.
func DerefFloat64(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// DerefString safely dereferences a *string, returning "" if nil.
func DerefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// DerefBool safely dereferences a *bool, returning false if nil.
func DerefBool(p *bool) bool {
	if p == nil {
		return false
	}
	return *p
}

// AutomationVariable moved to internal/models/automation in phase-R5.10.

// TeslaChargingHistoryEntry, TeslaChargingHistorySummary,
// TeslaChargingSession, TeslaChargingSessionSummary,
// TeslaEnergyHistory, TeslaEnergyBackupEvent, TeslaEnergyWCCharging,
// TeslaUserConfig, TeslaUserOrder, TeslaUserProfile,
// TeslaVehicleDriver, TeslaVehicleInvitation moved to
// internal/models/tesla in phase-R5.11.
//
// TeslaToken + APICallLog (previously in internal/models/tesla.go) also
// moved to internal/models/tesla via `git mv` to tesla/core.go.
//
// TeslaFleetTelemetryError + TeslaFleetTelemetryErrorVIN remain in telemetry.go.

// GuardConfig has moved to vehicle.go.

// ShareToken has moved to drive.go.

// GuardEvent has moved to vehicle.go.
