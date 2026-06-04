// Package coaching contains the drive-coaching AI tool.
//
// Layer: domain
//
// RegisterDriveCoachingTools preserves the query_drive_telemetry_summary
// surface while keeping this bounded context separate from the parent tools
// package. Shared pointer helpers stay in the parent package because sibling
// tools still depend on them.
package coaching
