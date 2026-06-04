package fsm

import (
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// DeriveExpectedState wraps the given signal.Store with a SignalAdapter
// and delegates to the adapter-driven reconciler core
// (deriveExpectedState in reconciler.go).
//
// Existing callers that still hold a *signal.Store directly (for example
// internal/api/fsm_handler.go and internal/api/fsm_handler_query.go)
// continue to work through this thin shim. Direct signal.Store access is
// reserved for the adapter translation layer (signal_adapter.go) and this
// back-compat wrapper.
//
// Newer call sites SHOULD construct a *SignalAdapter once at startup
// (or per-request, since NewSignalAdapter is allocation-free aside
// from the struct itself) and call deriveExpectedState through their
// own adapter rather than re-routing a *signal.Store through this
// wrapper.
func DeriveExpectedState(vehicleID int64, store *signal.Store, now time.Time) ReconcileResult {
	if store == nil {
		return ReconcileResult{Confidence: ConfidenceNone, Reason: "insufficient signals"}
	}
	return deriveExpectedState(vehicleID, NewSignalAdapter(store, zerolog.Nop()), now)
}
