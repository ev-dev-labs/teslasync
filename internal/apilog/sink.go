package apilog

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// SinkAdapter constructs an httputil.APICallSink backed by the supplied
// Logger. A nil logger yields a no-op sink so production wiring with
// API_LOGS_INBOUND_ENABLED=false is safe.
//
// captureBodies is captured by value at adapter-construction time and
// returned from CaptureBodies() on every round-trip.
func SinkAdapter(logger Logger, captureBodies bool) httputil.APICallSink {
	if logger == nil {
		return &nullSink{}
	}
	return &sinkAdapter{
		logger:        logger,
		captureBodies: captureBodies,
	}
}

// sinkAdapter is the production binding of httputil.APICallSink to the
// Logger. Enqueue is non-blocking by inheritance from Logger.Enqueue
// (drop-on-full).
type sinkAdapter struct {
	logger        Logger
	captureBodies bool
}

func (a *sinkAdapter) Enqueue(record httputil.APICallRecord) {
	if a == nil || a.logger == nil {
		return
	}
	entry := &models.APICallLog{
		Ts:         time.Now().UTC(),
		Service:    record.Service,
		HTTPMethod: record.Method,
		Endpoint:   record.URL,
		StatusCode: int16(record.StatusCode),
		DurationMs: int32(record.DurationMs),
	}
	if record.ErrorMessage != "" {
		s := record.ErrorMessage
		entry.ErrorMessage = &s
	}
	if len(record.RequestBody) > 0 {
		s := string(record.RequestBody)
		entry.RequestBody = &s
	}
	if len(record.ResponseBody) > 0 {
		s := string(record.ResponseBody)
		entry.ResponseBody = &s
	}
	a.logger.Enqueue(entry)
}

func (a *sinkAdapter) CaptureBodies() bool {
	if a == nil {
		return false
	}
	return a.captureBodies
}

// nullSink is the disabled-mode adapter: every method is a silent no-op.
// Used when SinkAdapter is constructed with a nil logger.
type nullSink struct{}

func (n *nullSink) Enqueue(httputil.APICallRecord) {}
func (n *nullSink) CaptureBodies() bool            { return false }
