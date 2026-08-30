package api

import (
	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

// Re-export metrics for use within the api package. Other packages should
// import internal/metrics directly.
//
// PrometheusMiddleware and normalizePath were carved out to
// internal/api/middleware.
var (
	// Telemetry
	TelemetrySignalsProcessed   = metrics.TelemetrySignalsProcessed
	TelemetryMessagesReceived   = metrics.TelemetryMessagesReceived
	TelemetryProcessingDuration = metrics.TelemetryProcessingDuration
	ActiveStreamingVehicles     = metrics.ActiveStreamingVehicles

	// Sessions
	DriveSessionsActive     = metrics.DriveSessionsActive
	DriveSessionsCompleted  = metrics.DriveSessionsCompleted
	ChargeSessionsActive    = metrics.ChargeSessionsActive
	ChargeSessionsCompleted = metrics.ChargeSessionsCompleted

	// Database
	DBQueryDuration      = metrics.DBQueryDuration
	DBConnectionPoolSize = metrics.DBConnectionPoolSize
	DBTransactionsTotal  = metrics.DBTransactionsTotal

	// Alerts
	AlertsEvaluated   = metrics.AlertsEvaluated
	AlertsFired       = metrics.AlertsFired
	NotificationsSent = metrics.NotificationsSent

	// API
	APIErrors          = metrics.APIErrors
	TeslaAPICallsTotal = metrics.TeslaAPICallsTotal

	// Vehicles
	VehiclesRegistered = metrics.VehiclesRegistered
	VehicleStateGauge  = metrics.VehicleStateGauge

	// Geocoding
	GeocodingTotal           = metrics.GeocodingTotal
	GeocodingDuration        = metrics.GeocodingDuration
	AddressBackfillRemaining = metrics.AddressBackfillRemaining
	AddressBackfillCompleted = metrics.AddressBackfillCompleted

	// Connections
	SSEConnectionsActive           = metrics.SSEConnectionsActive
	SSEEventsSent                  = metrics.SSEEventsSent
	SSEEventsDropped               = metrics.SSEEventsDropped
	SSEConnectionsTotal            = metrics.SSEConnectionsTotal
	SSEBroadcastDuration           = metrics.SSEBroadcastDuration
	SSEBytesSent                   = metrics.SSEBytesSent
	SSEClientBufferSaturationRatio = metrics.SSEClientBufferSaturationRatio

	// Auth
	AuthAttempts   = metrics.AuthAttempts
	TokenRefreshes = metrics.TokenRefreshes

	// Business
	TotalDistanceKm = metrics.TotalDistanceKm
	TotalEnergyKwh  = metrics.TotalEnergyKwh
	TotalDrives     = metrics.TotalDrives
	TotalCharges    = metrics.TotalCharges
)
