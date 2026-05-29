// Package teslaenergyhist serves Tesla Fleet API energy history
// endpoints for energy site and wall connector history. It owns the
// handlers that read stored energy, backup, and wall connector charging
// history and refresh those datasets from Tesla Fleet API energy site
// calendar_history and telemetry_history responses.
//
// Layer: handler
package teslaenergyhist
