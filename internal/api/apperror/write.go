package apperror

import (
	"net/http"
	"sync/atomic"

	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

// Tracker is the one-method indirection that lets Write record errors
// into a centralised aggregator (the /admin/errors endpoint) without
// pulling the concrete *internal/api.ErrorTracker into this package
// (which would form an import cycle: api → apperror → api). NewRouter
// constructs the concrete tracker, then calls SetTracker exactly once
// after middleware wiring.
type Tracker interface {
	Track(code, category, message, path, method, reqID string, status int)
}

// trackerSlot holds the active Tracker behind an atomic.Value so that
// SetTracker is concurrency-safe with concurrent Write calls. The slot
// is nil-tolerant: nothing breaks if Write fires before SetTracker (the
// aggregator just doesn't see those early errors). Tests can call
// SetTracker(nil) for cleanup.
//
// We store a typed nil via a wrapper so atomic.Value.Store doesn't panic
// on the Go runtime constraint that Store can't accept a nil interface
// value directly.
type trackerHolder struct{ t Tracker }

var trackerSlot atomic.Value // holds trackerHolder

func init() {
	trackerSlot.Store(trackerHolder{t: nil})
}

// SetTracker installs the active Tracker. Safe to call concurrently
// with Write. Pass nil to detach (typically only useful in tests).
func SetTracker(t Tracker) {
	trackerSlot.Store(trackerHolder{t: t})
}

// loadTracker returns the active Tracker or nil if none is installed.
func loadTracker() Tracker {
	if v, ok := trackerSlot.Load().(trackerHolder); ok {
		return v.t
	}
	return nil
}

// Write emits the flat structured-error envelope for an AppError:
//
//	{"error": e.Message, "code": e.Code, "category": e.Category}
//
// at e.Status, increments the Prometheus APIErrors counter labelled
// {code, category}, and (if a Tracker is installed) records the error
// into the centralised aggregator the /admin/errors handler reads.
//
// Single source of truth for the structured-error wire shape; the
// frontend's resilience layer (web/src/lib/resilience.ts) byte-matches
// the `code` field to drive recovery flows.
func Write(w http.ResponseWriter, r *http.Request, e *AppError) {
	httpx.WriteJSON(w, e.Status, map[string]string{
		"error":    e.Message,
		"code":     e.Code,
		"category": e.Category,
	})
	metrics.APIErrors.WithLabelValues(e.Code, e.Category).Inc()
	if t := loadTracker(); t != nil {
		reqID := chimw.GetReqID(r.Context())
		t.Track(e.Code, e.Category, e.Message, r.URL.Path, r.Method, reqID, e.Status)
	}
}
