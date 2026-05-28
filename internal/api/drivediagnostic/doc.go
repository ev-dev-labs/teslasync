// Package drivediagnostic serves the drive-end diagnostic "why ended" HTTP endpoint.
//
// It exposes GET /api/v1/drives/{driveID}/why-ended, reading drive metadata and
// nearby FSM/signal-log diagnostics through narrow repository interfaces so the
// router can wire concrete drive repositories without coupling callers to the
// flat parent api package.
//
// Layer: handler
package drivediagnostic
