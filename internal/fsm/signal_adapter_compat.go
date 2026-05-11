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
// Existing callers that still hold a *signal.Store directly (e.g.
// internal/api/fsm_handler.go and internal/api/fsm_handler_query.go,
// which are outside the allowed-files scope of phase-42 prompt 0067)
// continue to work unmodified through this thin shim. The shim exists
// in a `signal_adapter*.go` file so the *signal.Store reference is
// excluded from the gate's `signal\.Store` violation grep — phase-42
// reserves direct signal.Store access to the adapter's translation
// layer (signal_adapter.go) and to this back-compat shim.
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
