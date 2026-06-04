// Package command serves vehicle command endpoints under /api/v1/vehicles/{vehicleID}.
//
// It owns command execution, latest-command status, and command history
// HTTP handlers while preserving the pre-carve wire shapes consumed by the SPA.
//
// Layer: handler
package command
