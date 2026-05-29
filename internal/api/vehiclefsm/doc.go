// Package vehiclefsm hosts the FSM-based vehicle state management handler
// (drive/charge/park finite-state machines, reconciliation loop, shadow-mode
// stats, and the /fsm/debug + /fsm transition-log query surfaces).
//
// It is owned by the telemetry handler (which holds a *vehiclefsm.Handler and
// drives ProcessSignals from the ingest hot path) but lives in its own package
// because it has no other package-api dependencies.
//
// Layer: handler
package vehiclefsm
