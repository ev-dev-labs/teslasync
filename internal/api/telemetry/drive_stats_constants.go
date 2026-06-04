package telemetry

// Constants shared by legacy parent-package analytics handlers that still
// query SI-canonical drives rows while the DriveHandler has moved to
// internal/api/drives.
const (
	driveStatsMetersPerMile  = 1609.344
	driveStatsMpsPerMph      = 0.44704
	driveStatsKilo           = 1000.0
	driveStatsTwoMilesMeters = 2.0 * driveStatsMetersPerMile
	driveStatsSpeedLimitMps  = 130.0 * driveStatsMpsPerMph
)
