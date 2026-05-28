// Package signalinspect serves the per-vehicle signal-inspector endpoints:
// GET /signals/{vehicleID}/available, /live, /snapshot, /diff, /stats, and
// /{signalName}/history. It also owns the proto-derived AvailableSignals
// catalog function consumed by both the inspector and the AI signal-explorer
// natural-language filter.
//
// Carved out of internal/api by phase-R2d.4.
//
// # Wiring
//
// The handler is built with a MongoDB-backed signal_log repo and four
// optional fluent setters (WithDB, WithSignalHistory, WithRedisCache,
// WithLiveSignalStore). The composition root wires what is available at
// boot — none of the setters panic on nil so partial wiring (e.g. when
// Redis is disabled) keeps the handler functional but degrades reads to
// the database + in-process live store.
//
// # AvailableSignals
//
// The package-level AvailableSignals function returns the canonical Tesla
// telemetry signal catalog derived from protomodel.Signals (the vendored
// proto is the single source of truth — ADR-004 #2). It is exported so
// the ai_signal_explorer_nl_filter handler can reuse the SAME filtered
// catalog the /available endpoint serves.
//
// # Layer
//
// Layer: handler
package signalinspect
